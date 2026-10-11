// Cropping a moving picture (a GIF or an animated WebP) keeps it moving: every
// frame is cut to the same rectangle and the frames are put back together
// with their own timing, as an animated WebP (full colour, usually a quarter
// of a GIF's size). Each part has a stand-in where the system lacks it:
//   reading frames: the system's ImageDecoder, else (a GIF) gifuct-js;
//   making WebP:    the system's canvas, else libwebp as WebAssembly (@jsquash/webp,
//                   loaded only then; iPhone needs it), else a GIF (gifenc).
// Uploads have a 5 MB limit, so a result that's too big is tried again smaller.
// One the app can't read at all (an animated WebP on iPhone) is kept whole:
// uncropped, but still moving.
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

/** The upload limit is 5 MB of file; a data URL is a third bigger. Leave room. */
const MAX_BYTES = 4.5 * 1024 * 1024;
const MAX_FRAMES = 300;

export type Crop = { sx: number; sy: number; sw: number; sh: number; outW: number; outH: number };

// ---- Reading frames ----

type Decoder = {
    tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
    completed: Promise<void>;
    decode(o: { frameIndex: number }): Promise<{ image: VideoFrame }>;
    close(): void;
};
type DecoderClass = { new (o: { data: ArrayBuffer; type: string }): Decoder; isTypeSupported(type: string): Promise<boolean> };
const SystemDecoder = (globalThis as { ImageDecoder?: DecoderClass }).ImageDecoder;
/** Development only: act as an iPhone does (no ImageDecoder, no WebP from the canvas), to try the stand-ins. */
const likeIPhone = () => import.meta.env.DEV && (globalThis as { __movingLikeIPhone?: boolean }).__movingLikeIPhone === true;

async function systemReads(type: string) {
    if (likeIPhone()) return false;
    return !!SystemDecoder && (await SystemDecoder.isTypeSupported(type).catch(() => false));
}

/** A picture's frames, one at a time: drawn by `draw` and then let go. */
type Frames = {
    count: number;
    /** Draws frame `i` (asked in order) into ctx at the crop, and gives its delay in ms. */
    draw(i: number, ctx: OffscreenCanvasRenderingContext2D, crop: Crop, w: number, h: number): Promise<number>;
    close(): void;
};

async function systemFrames(file: File): Promise<Frames> {
    const d = new SystemDecoder!({ data: await file.arrayBuffer(), type: file.type });
    await d.tracks.ready;
    await d.completed;
    return {
        count: d.tracks.selectedTrack?.frameCount ?? 1,
        async draw(i, ctx, c, w, h) {
            const { image } = await d.decode({ frameIndex: i });
            ctx.drawImage(image, c.sx, c.sy, c.sw, c.sh, 0, 0, w, h);
            const delay = (image.duration ?? 100_000) / 1000; // microseconds
            image.close();
            return delay;
        },
        close: () => d.close(),
    };
}

/** A GIF's frames without ImageDecoder: gifuct-js unpacks each change, and they're laid over one another as the GIF says. */
async function gifFrames(file: File): Promise<Frames> {
    const { parseGIF, decompressFrames } = await import('gifuct-js');
    const gif = parseGIF(await file.arrayBuffer());
    const frames = decompressFrames(gif, true);
    const full = new OffscreenCanvas(gif.lsd.width, gif.lsd.height);
    const fctx = full.getContext('2d')!;
    const patch = new OffscreenCanvas(1, 1);
    const pctx = patch.getContext('2d')!;
    let drawn = -1;
    let restore: ImageData | null = null;
    function step(n: number) {
        const prev = frames[n - 1];
        if (prev) {
            const r = prev.dims;
            if (prev.disposalType === 2) fctx.clearRect(r.left, r.top, r.width, r.height);
            else if (prev.disposalType === 3 && restore) fctx.putImageData(restore, 0, 0);
        }
        const f = frames[n];
        restore = f.disposalType === 3 ? fctx.getImageData(0, 0, full.width, full.height) : null;
        patch.width = f.dims.width;
        patch.height = f.dims.height;
        pctx.putImageData(new ImageData(new Uint8ClampedArray(f.patch), f.dims.width, f.dims.height), 0, 0);
        fctx.drawImage(patch, f.dims.left, f.dims.top);
    }
    return {
        count: frames.length,
        async draw(i, ctx, c, w, h) {
            // Frames build on one another, so every one up to i is laid down (skipped ones too).
            if (i < drawn) {
                fctx.clearRect(0, 0, full.width, full.height);
                drawn = -1;
            }
            while (drawn < i) step(++drawn);
            ctx.drawImage(full, c.sx, c.sy, c.sw, c.sh, 0, 0, w, h);
            return frames[i].delay || 100;
        },
        close() {},
    };
}

async function framesOf(file: File): Promise<Frames | null> {
    if (await systemReads(file.type)) return systemFrames(file);
    if (file.type === 'image/gif') return gifFrames(file);
    return null;
}

/** Whether a picture has more than one frame, read from the file itself where it can be. */
export async function isMoving(file: File) {
    if (file.type === 'image/webp') {
        // VP8X's "animation" flag (byte 20, bit 2): no decoder needed.
        const head = new Uint8Array(await file.slice(0, 21).arrayBuffer());
        return ascii4(head, 12) === 'VP8X' && (head[20] & 0b10) !== 0;
    }
    if (file.type !== 'image/gif') return false;
    const frames = await framesOf(file);
    try {
        return (frames?.count ?? 2) > 1;
    } finally {
        frames?.close();
    }
}

/** Whether its frames can be read here (else it's kept whole). */
export const canCropMoving = async (file: File) => (await systemReads(file.type)) || file.type === 'image/gif';

// ---- Making the moving picture ----

type Writer = { add(ctx: OffscreenCanvasRenderingContext2D, canvas: OffscreenCanvas, delay: number): Promise<void>; size(): number; finish(): Blob };
type Kind = 'canvas-webp' | 'wasm-webp' | 'gif';

let systemWebp: Promise<boolean> | null = null;
/** Whether this system's canvas makes WebP images (Chromium does; WebKit gives back a PNG). */
function canvasWritesWebp() {
    if (likeIPhone()) return Promise.resolve(false);
    systemWebp ??= (async () => {
        const canvas = new OffscreenCanvas(1, 1);
        canvas.getContext('2d'); // (a canvas with nothing to draw on can't make any image)
        return (await canvas.convertToBlob({ type: 'image/webp' })).type === 'image/webp';
    })().catch(() => false);
    return systemWebp;
}

type WasmEncode = (data: ImageData, options?: { quality?: number; method?: number }) => Promise<ArrayBuffer>;
let wasm: Promise<WasmEncode | null> | null = null;
/** libwebp as WebAssembly, fetched the first time it's needed. */
function wasmWebp() {
    wasm ??= import('@jsquash/webp/encode')
        .then(async (m) => {
            await m.init();
            return m.default as WasmEncode;
        })
        .catch(() => null);
    return wasm;
}

async function writerKind(): Promise<Kind> {
    if (await canvasWritesWebp()) return 'canvas-webp';
    if (await wasmWebp()) return 'wasm-webp';
    return 'gif';
}

/** The moving picture cut to `crop`, as a data URL, or null if it can't be made under the limit. */
export async function cropMoving(file: File, crop: Crop): Promise<string | null> {
    const frames = await framesOf(file);
    if (!frames) return null;
    try {
        // Very long ones: every other frame (or fewer), each shown that much longer.
        const step = Math.max(1, Math.ceil(frames.count / MAX_FRAMES));
        const kind = await writerKind();
        const tries = kind === 'gif' ? [ [1, 0], [0.75, 0], [0.55, 0], [0.4, 0] ] : [ [1, 0.82], [1, 0.65], [0.75, 0.65], [0.55, 0.6], [0.4, 0.55] ];
        for (const [scale, quality] of tries) {
            const w = Math.max(2, Math.round(crop.outW * scale));
            const h = Math.max(2, Math.round(crop.outH * scale));
            const canvas = new OffscreenCanvas(w, h);
            const ctx = canvas.getContext('2d', { willReadFrequently: kind !== 'canvas-webp' })!;
            ctx.imageSmoothingQuality = 'high';
            const out = kind === 'gif' ? gifWriter(w, h) : webpWriter(w, h, kind, quality);
            let tooBig = false;
            for (let i = 0; i < frames.count; i += step) {
                ctx.clearRect(0, 0, w, h);
                const delay = Math.max(20, Math.round((await frames.draw(i, ctx, crop, w, h)) * step));
                await out.add(ctx, canvas, delay);
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
        frames.close();
    }
}

function gifWriter(w: number, h: number): Writer {
    const gif = GIFEncoder();
    let size = 0;
    return {
        async add(ctx, _canvas, delay) {
            const rgba = ctx.getImageData(0, 0, w, h).data;
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
function webpWriter(w: number, h: number, kind: Kind, quality: number): Writer {
    const frames: Uint8Array[] = [];
    let size = 0;
    let alpha = false;
    return {
        async add(ctx, canvas, delay) {
            const bytes =
                kind === 'canvas-webp'
                    ? new Uint8Array(await (await canvas.convertToBlob({ type: 'image/webp', quality })).arrayBuffer())
                    : new Uint8Array(await (await wasmWebp())!(ctx.getImageData(0, 0, w, h), { quality: Math.round(quality * 100), method: 3 }));
            const image: Uint8Array[] = [];
            for (let at = 12; at + 8 <= bytes.length; ) {
                const id = ascii4(bytes, at);
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
const ascii4 = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
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
