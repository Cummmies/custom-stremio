// Seek-bar thumbnails from a second, silent mpv: the Rust thumbnailer on the
// desktop (raw pixels), the Swift one on iOS (JPEGs; plugins/mpv).
//
// As stremio-native does it (after thumbfast): only the frame for where you
// hover is fetched, and the newest hover always wins. While the pointer moves,
// a quick frame from the nearest keyframe (at most one every 50 ms); once it
// rests for 100 ms, the exact frame, which replaces it. Frames are kept in a
// 16 MiB cache at 0.1 s, the least recently shown going first. While a frame
// is on its way, the nearest one already cached stands in.
import { invoke } from '@tauri-apps/api/core';
import { isIOS } from '$lib/platform';

const WIDTH = 320;
const BUCKET = 0.1; // seconds
const CACHE_BYTES = 16 * 1024 * 1024;
const FAST_GAP_MS = 50;
const EXACT_DELAY_MS = 100;

type Frame = { bitmap: ImageBitmap; bytes: number; exact: boolean };

export class Thumbnails {
    #url: string;
    /** Bucket → frame; Map order is least to most recently used. */
    #cache = new Map<number, Frame>();
    #bytes = 0;
    #busy = false;
    #fast: number | null = null;
    #exact: number | null = null;
    #exactTimer: ReturnType<typeof setTimeout> | undefined;
    #lastFast = 0;
    #listeners = new Set<() => void>();
    #failed = false;
    #closed = false;

    constructor(url: string) {
        this.#url = url;
    }

    get available() {
        return !this.#failed;
    }

    /** The frame for `time` if cached, else the nearest cached one (or null). */
    nearest(time: number): ImageBitmap | null {
        const b = this.#bucket(time);
        const hit = this.#cache.get(b);
        if (hit) {
            this.#touch(b, hit);
            return hit.bitmap;
        }
        let best: number | null = null;
        for (const t of this.#cache.keys()) {
            if (best == null || Math.abs(t - time) < Math.abs(best - time)) best = t;
        }
        return best == null ? null : this.#cache.get(best)!.bitmap;
    }

    onChange(fn: () => void) {
        this.#listeners.add(fn);
        return () => this.#listeners.delete(fn);
    }

    /** The pointer is over `time`: a quick frame now, the exact one when it rests. */
    request(time: number) {
        if (this.#failed || this.#closed) return;
        if (this.#cache.get(this.#bucket(time))?.exact) return;
        this.#fast = time;
        clearTimeout(this.#exactTimer);
        this.#exactTimer = setTimeout(() => {
            this.#exact = time;
            this.#pump();
        }, EXACT_DELAY_MS);
        this.#pump();
    }

    async #pump() {
        if (this.#busy) return;
        this.#busy = true;
        try {
            while (!this.#closed && !this.#failed) {
                let time: number;
                let exact = false;
                if (this.#exact != null) {
                    time = this.#exact;
                    this.#exact = null;
                    exact = true;
                } else if (this.#fast != null) {
                    time = this.#fast;
                    this.#fast = null;
                } else {
                    break;
                }
                const b = this.#bucket(time);
                const hit = this.#cache.get(b);
                if (hit && (hit.exact || !exact)) continue;
                if (!exact) {
                    const wait = FAST_GAP_MS - (Date.now() - this.#lastFast);
                    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
                    // A newer hover (or the exact frame) came meanwhile: that instead.
                    if (this.#fast != null || this.#exact != null) continue;
                    this.#lastFast = Date.now();
                }
                await this.#fetch(b, time, exact);
            }
        } finally {
            this.#busy = false;
        }
    }

    async #fetch(b: number, time: number, exact: boolean) {
        try {
            const bitmap = isIOS ? await this.#fetchJpeg(time, exact) : await this.#fetchPixels(time, exact);
            if (this.#closed) return bitmap.close();
            const old = this.#cache.get(b);
            if (old) {
                this.#bytes -= old.bytes;
                old.bitmap.close();
                this.#cache.delete(b);
            }
            const frame = { bitmap, bytes: bitmap.width * bitmap.height * 4, exact };
            this.#cache.set(b, frame);
            this.#bytes += frame.bytes;
            // Least recently used out, down to 16 MiB (always keeping this one).
            for (const [key, f] of this.#cache) {
                if (this.#bytes <= CACHE_BYTES || key === b) break;
                f.bitmap.close();
                this.#bytes -= f.bytes;
                this.#cache.delete(key);
            }
            this.#listeners.forEach((fn) => fn());
        } catch (e) {
            // A source that can't be opened for thumbnails won't recover; stop asking.
            if (String(e).includes('couldn')) {
                this.#failed = true;
                this.#listeners.forEach((fn) => fn());
            }
        }
    }

    /** Desktop: [width u32 LE][height u32 LE][RGBA pixels]. */
    async #fetchPixels(time: number, exact: boolean) {
        const buf = await invoke<ArrayBuffer>('thumb_frame', { url: this.#url, time, width: WIDTH, exact });
        const view = new DataView(buf);
        const w = view.getUint32(0, true);
        const h = view.getUint32(4, true);
        return createImageBitmap(new ImageData(new Uint8ClampedArray(buf, 8, w * h * 4), w, h));
    }

    /** iOS: a base64 JPEG (plugin responses are JSON); sharper for the Retina screen. */
    async #fetchJpeg(time: number, exact: boolean) {
        const { data } = await invoke<{ data: string }>('plugin:mpv|thumb_frame', {
            url: this.#url,
            time,
            width: Math.round(WIDTH * 1.5),
            exact,
        });
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        return createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    }

    #touch(b: number, frame: Frame) {
        this.#cache.delete(b);
        this.#cache.set(b, frame);
    }

    #bucket(time: number) {
        return Math.max(0, Math.round(time / BUCKET) * BUCKET);
    }

    close() {
        this.#closed = true;
        clearTimeout(this.#exactTimer);
        this.#fast = this.#exact = null;
        this.#cache.forEach((f) => f.bitmap.close());
        this.#cache.clear();
        this.#bytes = 0;
        invoke(isIOS ? 'plugin:mpv|thumb_close' : 'thumb_close').catch(() => {});
    }
}
