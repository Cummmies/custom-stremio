// Cropping a moving picture (a GIF or an animated WebP) keeps it moving: every
// frame is cut to the same rectangle and the frames are put back together
// with their own timing. Saved as an animated WebP where the system can make
// WebP images (full colour, usually well under half a GIF's size), else as a
// GIF (gifenc). Uploads have a 5 MB limit, so a result that's too big is tried
// again smaller. Where the system can't read the frames (no ImageDecoder),
// the caller keeps the whole file as it is: uncropped, but still moving.
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

/** The upload limit is 5 MB of file; a data URL is a third bigger. Leave room. */
const MAX_BYTES = 4.5 * 1024 * 1024;
const MAX_FRAMES = 300;
const MOVING_TYPES = ['image/gif', 'image/webp'];

export type Crop = { sx: number; sy: number; sw: number; sh: number; outW: number; outH: number };

type Decoder = {
    tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
    completed: Promise<void>;
    decode(o: { frameIndex: number }): Promise<{ image: VideoFrame }>;
    close(): void;
};
type DecoderClass = { new (o: { data: ArrayBuffer; type: string }): Decoder; isTypeSupported(type: string): Promise<boolean> };
const Decoder = (globalThis as { ImageDecoder?: DecoderClass }).ImageDecoder;

async function canRead(type: string) {
    return !!Decoder && (await Decoder.isTypeSupported(type).catch(() => false));
}

let webpWrites: Promise<boolean> | null = null;
/** Whether this system makes WebP images (Chromium does; WebKit gives back a PNG). */
function canWriteWebp() {
    webpWrites ??= (async () => {
        const canvas = new OffscreenCanvas(1, 1);
        canvas.getContext('2d'); // (a canvas with nothing to draw on can't make any image)
        return (await canvas.convertToBlob({ type: 'image/webp' })).type === 'image/webp';
    })().catch(() => false);
    return webpWrites;
}

async function open(file: File) {
    const d = new Decoder!({ data: await file.arrayBuffer(), type: file.type });
    await d.tracks.ready;
    await d.completed;
    return d;
}

/** Whether a picture has more than one frame (a GIF we can't look inside counts as moving). */
export async function isMoving(file: File) {
    if (!MOVING_TYPES.includes(file.type)) return false;
    if (!(await canRead(file.type))) return file.type === 'image/gif';
    const d = await open(file);
    try {
        return (d.tracks.selectedTrack?.frameCount ?? 1) > 1;
    } finally {
        d.close();
    }
}

export const canCropMoving = (file: File) => canRead(file.type);

/** The moving picture cut to `crop`, as a data URL, or null if it can't be made under the limit. */
export async function cropMoving(file: File, crop: Crop): Promise<string | null> {
    const d = await open(file);
    try {
        const count = d.tracks.selectedTrack?.frameCount ?? 1;
        // Very long ones: every other frame (or fewer), each shown that much longer.
        const step = Math.max(1, Math.ceil(count / MAX_FRAMES));
        const webp = await canWriteWebp();
        const tries = webp
            ? [ [1, 0.82], [1, 0.65], [0.75, 0.65], [0.55, 0.6], [0.4, 0.55] ]
            : [ [1, 0], [0.75, 0], [0.55, 0], [0.4, 0] ];
        for (const [scale, quality] of tries) {
            const w = Math.max(2, Math.round(crop.outW * scale));
            const h = Math.max(2, Math.round(crop.outH * scale));
            const canvas = new OffscreenCanvas(w, h);
            const ctx = canvas.getContext('2d', { willReadFrequently: !webp })!;
            ctx.imageSmoothingQuality = 'high';
            const out = webp ? webpWriter(w, h) : gifWriter(w, h);
            let tooBig = false;
            for (let i = 0; i < count; i += step) {
                const { image } = await d.decode({ frameIndex: i });
                // VideoFrame.duration is in microseconds; frame delays are in milliseconds.
                const delay = Math.max(20, Math.round(((image.duration ?? 100_000) / 1000) * step));
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
                image.close();
                if (webp) await (out as WebpWriter).add(await canvas.convertToBlob({ type: 'image/webp', quality }), delay);
                else (out as GifWriter).add(ctx.getImageData(0, 0, w, h).data, delay);
                if (out.size() > MAX_BYTES) {
                    tooBig = true;
                    break;
                }
            }
            if (tooBig) continue;
            const blob = out.finish();
            if (blob.size <= MAX_BYTES) return await toDataUrl(blob);
        }
        return null;
    } finally {
        d.close();
    }
}

type GifWriter = ReturnType<typeof gifWriter>;
function gifWriter(w: number, h: number) {
    const gif = GIFEncoder();
    let size = 0;
    return {
        add(rgba: Uint8ClampedArray, delay: number) {
            const palette = quantize(rgba, 256);
            gif.writeFrame(applyPalette(rgba, palette), w, h, { palette, delay });
            size += w * h * 0.6; // a rough running size (LZW of indexed pixels)
        },
        size: () => size,
        finish: () => {
            gif.finish();
            return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
        },
    };
}

/**
 * An animated WebP from still WebP frames. The container is RIFF chunks:
 * VP8X (canvas size, "animated"), ANIM (loop forever), then one ANMF per
 * frame holding that still's own image chunks (ALPH and VP8 / VP8L).
 */
type WebpWriter = ReturnType<typeof webpWriter>;
function webpWriter(w: number, h: number) {
    const frames: Uint8Array[] = [];
    let size = 0;
    let alpha = false;
    return {
        async add(still: Blob, delay: number) {
            const bytes = new Uint8Array(await still.arrayBuffer());
            const image: Uint8Array[] = [];
            for (let at = 12; at + 8 <= bytes.length; ) {
                const id = String.fromCharCode(...bytes.subarray(at, at + 4));
                const len = u32(bytes, at + 4);
                const end = at + 8 + len + (len & 1);
                if (id === 'ALPH' || id === 'VP8 ' || id === 'VP8L') image.push(bytes.subarray(at, end));
                if (id === 'ALPH' || id === 'VP8L') alpha = true;
                at = end;
            }
            const head = new Uint8Array(16);
            put24(head, 0, 0); // x / 2
            put24(head, 3, 0); // y / 2
            put24(head, 6, w - 1);
            put24(head, 9, h - 1);
            put24(head, 12, Math.min(delay, 0xffffff));
            head[15] = 0b10; // replace the canvas (don't blend), keep it after
            const frame = chunk('ANMF', concat([head, ...image]));
            frames.push(frame);
            size += frame.length;
        },
        size: () => size,
        finish() {
            const vp8x = new Uint8Array(10);
            vp8x[0] = 0b10 | (alpha ? 0b10000 : 0); // animation (and alpha)
            put24(vp8x, 4, w - 1);
            put24(vp8x, 7, h - 1);
            const anim = new Uint8Array(6); // background 0 (transparent black), loop 0 (forever)
            const body = concat([ascii('WEBP'), chunk('VP8X', vp8x), chunk('ANIM', anim), ...frames]);
            return new Blob([concat([ascii('RIFF'), le32(body.length), body]) as BlobPart], { type: 'image/webp' });
        },
    };
}

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
function le32(n: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
}
function put24(b: Uint8Array, at: number, n: number) {
    b[at] = n & 0xff;
    b[at + 1] = (n >> 8) & 0xff;
    b[at + 2] = (n >> 16) & 0xff;
}
function chunk(id: string, data: Uint8Array) {
    const pad = data.length & 1;
    return concat([ascii(id), le32(data.length), data, new Uint8Array(pad)]);
}
function concat(parts: Uint8Array[]) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}

/** A file as a data URL (the whole file, as chosen). */
export function toDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}

export const fitsUpload = (file: Blob) => file.size <= MAX_BYTES;
