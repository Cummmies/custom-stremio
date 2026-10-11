// Cropping a moving GIF keeps it moving: every frame is cut to the same
// rectangle and the frames are made into a GIF again (gifenc), with their own
// timing. Uploads have a 5 MB limit, so a result that's too big is tried
// again smaller. Where the system can't read a GIF's frames (no ImageDecoder),
// the caller keeps the whole file as it is: uncropped, but still moving.
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

/** The upload limit is 5 MB of file; a data URL is a third bigger. Leave room. */
const MAX_BYTES = 4.5 * 1024 * 1024;
const MAX_FRAMES = 300;

export type Crop = { sx: number; sy: number; sw: number; sh: number; outW: number; outH: number };

type Decoder = {
    tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
    completed: Promise<void>;
    decode(o: { frameIndex: number }): Promise<{ image: VideoFrame }>;
    close(): void;
};
type DecoderClass = { new (o: { data: ArrayBuffer; type: string }): Decoder; isTypeSupported(type: string): Promise<boolean> };
const Decoder = (globalThis as { ImageDecoder?: DecoderClass }).ImageDecoder;

export async function canCropGif() {
    return !!Decoder && (await Decoder.isTypeSupported('image/gif').catch(() => false));
}

/** Whether a GIF file has more than one frame. */
export async function isAnimatedGif(file: File) {
    if (file.type !== 'image/gif' || !(await canCropGif())) return file.type === 'image/gif';
    const d = new Decoder!({ data: await file.arrayBuffer(), type: 'image/gif' });
    try {
        await d.tracks.ready;
        await d.completed;
        return (d.tracks.selectedTrack?.frameCount ?? 1) > 1;
    } finally {
        d.close();
    }
}

/** The GIF cut to `crop`, as a data URL, or null if it can't be made under the limit. */
export async function cropGif(file: File, crop: Crop): Promise<string | null> {
    const d = new Decoder!({ data: await file.arrayBuffer(), type: 'image/gif' });
    try {
        await d.tracks.ready;
        await d.completed;
        const count = d.tracks.selectedTrack?.frameCount ?? 1;
        // Very long GIFs: every other frame (or fewer), each shown that much longer.
        const step = Math.max(1, Math.ceil(count / MAX_FRAMES));
        sizes: for (const scale of [1, 0.75, 0.55, 0.4]) {
            const w = Math.max(1, Math.round(crop.outW * scale));
            const h = Math.max(1, Math.round(crop.outH * scale));
            const canvas = new OffscreenCanvas(w, h);
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
            ctx.imageSmoothingQuality = 'high';
            const gif = GIFEncoder();
            let size = 0;
            for (let i = 0; i < count; i += step) {
                const { image } = await d.decode({ frameIndex: i });
                // VideoFrame.duration is in microseconds; GIF delays in milliseconds.
                const delay = Math.max(20, Math.round(((image.duration ?? 100_000) / 1000) * step));
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
                image.close();
                const rgba = ctx.getImageData(0, 0, w, h).data;
                const palette = quantize(rgba, 256);
                gif.writeFrame(applyPalette(rgba, palette), w, h, { palette, delay });
                // A rough running size: clearly too big already, so on to a smaller size.
                size += w * h * 0.6;
                if (size > MAX_BYTES * 3) continue sizes;
            }
            gif.finish();
            const bytes = gif.bytes();
            if (bytes.length <= MAX_BYTES) return await toDataUrl(new Blob([bytes as BlobPart], { type: 'image/gif' }));
        }
        return null;
    } finally {
        d.close();
    }
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
