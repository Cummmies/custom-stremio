// Seek-bar thumbnails from the Rust thumbnailer (a second, silent mpv).
//
// Network streams take seconds per frame, so hovering can't wait for an exact
// frame. Instead we fill a spread of frames across the whole video in the
// background (coarse first, then finer) and always show the nearest one we
// have; the exact frame for where you hover is fetched first and swaps in.
import { invoke } from '@tauri-apps/api/core';

const WIDTH = 224;
const BUCKET = 2; // seconds; nearby hovers share a frame
const BACKGROUND_GAP_MS = 1200; // breathing room between background fetches
const MAX_FRAMES = 600;

export class Thumbnails {
    #url: string;
    #cache = new Map<number, ImageBitmap>();
    #busy = false;
    #hover: number | null = null;
    #background: number[] = [];
    #listeners = new Set<() => void>();
    #failed = false;
    #closed = false;
    #paused: () => boolean;

    /** `paused` lets the player hold background work (e.g. while it's buffering). */
    constructor(url: string, paused: () => boolean = () => false) {
        this.#url = url;
        this.#paused = paused;
    }

    get available() {
        return !this.#failed;
    }

    get count() {
        return this.#cache.size;
    }

    /** The cached frame closest to `time`, or null if we have none yet. */
    nearest(time: number): ImageBitmap | null {
        const exact = this.#cache.get(this.#bucket(time));
        if (exact) return exact;
        let best: number | null = null;
        for (const t of this.#cache.keys()) {
            if (best == null || Math.abs(t - time) < Math.abs(best - time)) best = t;
        }
        return best == null ? null : this.#cache.get(best)!;
    }

    onChange(fn: () => void) {
        this.#listeners.add(fn);
        return () => this.#listeners.delete(fn);
    }

    /** Hovering: fetch this spot next, ahead of any background work. */
    request(time: number) {
        if (this.#failed || this.#closed) return;
        const b = this.#bucket(time);
        if (this.#cache.has(b)) return;
        this.#hover = b;
        this.#pump();
    }

    /**
     * Starts filling frames across the video. Order is coarse-to-fine (halves,
     * then quarters, then eighths…) so the whole bar is covered quickly.
     */
    warmUp(duration: number) {
        if (this.#failed || this.#closed || !duration) return;
        const step = Math.max(10, duration / 150);
        const slots = Math.floor(duration / step);
        const order: number[] = [];
        const seen = new Set<number>();
        for (let div = 2; order.length < slots && div <= slots * 2; div *= 2) {
            for (let k = 1; k < div; k += 2) {
                const s = Math.round((k / div) * slots);
                if (s > 0 && s < slots && !seen.has(s)) {
                    seen.add(s);
                    order.push(s);
                }
            }
        }
        this.#background = order.map((s) => this.#bucket(s * step));
        this.#pump();
    }

    async #pump() {
        if (this.#busy) return;
        this.#busy = true;
        try {
            while (!this.#closed && !this.#failed) {
                let b: number | undefined;
                let fromHover = false;
                if (this.#hover != null) {
                    b = this.#hover;
                    this.#hover = null;
                    fromHover = true;
                } else if (this.#background.length && !this.#paused()) {
                    b = this.#background.shift();
                } else if (this.#background.length) {
                    // Buffering: check again shortly without hogging the stream.
                    await new Promise((r) => setTimeout(r, 1000));
                    continue;
                } else {
                    break;
                }
                if (b == null || this.#cache.has(b)) continue;
                await this.#fetch(b);
                if (!fromHover && this.#hover == null) await new Promise((r) => setTimeout(r, BACKGROUND_GAP_MS));
            }
        } finally {
            this.#busy = false;
        }
    }

    async #fetch(b: number) {
        try {
            const buf = await invoke<ArrayBuffer>('thumb_frame', { url: this.#url, time: b, width: WIDTH });
            if (this.#closed) return;
            const view = new DataView(buf);
            const w = view.getUint32(0, true);
            const h = view.getUint32(4, true);
            const pixels = new Uint8ClampedArray(buf, 8, w * h * 4);
            this.#cache.set(b, await createImageBitmap(new ImageData(pixels, w, h)));
            if (this.#cache.size > MAX_FRAMES) {
                const oldest = this.#cache.keys().next().value!;
                this.#cache.get(oldest)?.close();
                this.#cache.delete(oldest);
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

    #bucket(time: number) {
        return Math.max(0, Math.round(time / BUCKET) * BUCKET);
    }

    close() {
        this.#closed = true;
        this.#hover = null;
        this.#background = [];
        this.#cache.forEach((b) => b.close());
        this.#cache.clear();
        invoke('thumb_close').catch(() => {});
    }
}
