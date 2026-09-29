// Seek-bar thumbnails from the Rust thumbnailer (a second, silent mpv).
// One request at a time; if you keep moving, only the latest position is fetched.
import { invoke } from '@tauri-apps/api/core';

const WIDTH = 224;
const BUCKET = 2; // seconds; nearby hovers share a frame

export class Thumbnails {
    #url: string;
    #cache = new Map<number, ImageBitmap>();
    #busy = false;
    #wanted: number | null = null;
    #listeners = new Set<() => void>();
    #failed = false;

    constructor(url: string) {
        this.#url = url;
    }

    get available() {
        return !this.#failed;
    }

    /** Nearest cached frame for a time (exact bucket first). */
    get(time: number): ImageBitmap | null {
        return this.#cache.get(this.#bucket(time)) ?? null;
    }

    onChange(fn: () => void) {
        this.#listeners.add(fn);
        return () => this.#listeners.delete(fn);
    }

    request(time: number) {
        if (this.#failed) return;
        const b = this.#bucket(time);
        if (this.#cache.has(b)) return;
        this.#wanted = b;
        if (!this.#busy) this.#pump();
    }

    async #pump() {
        while (this.#wanted != null) {
            const b = this.#wanted;
            this.#wanted = null;
            if (this.#cache.has(b)) continue;
            this.#busy = true;
            try {
                const buf = await invoke<ArrayBuffer>('thumb_frame', { url: this.#url, time: b, width: WIDTH });
                const view = new DataView(buf);
                const w = view.getUint32(0, true);
                const h = view.getUint32(4, true);
                const pixels = new Uint8ClampedArray(buf, 8, w * h * 4);
                this.#cache.set(b, await createImageBitmap(new ImageData(pixels, w, h)));
                if (this.#cache.size > 400) this.#cache.delete(this.#cache.keys().next().value!);
                this.#listeners.forEach((fn) => fn());
            } catch (e) {
                // A source that can't be opened for thumbnails won't recover; stop asking.
                if (String(e).includes('couldn')) this.#failed = true;
            } finally {
                this.#busy = false;
            }
        }
    }

    #bucket(time: number) {
        return Math.max(0, Math.round(time / BUCKET) * BUCKET);
    }

    close() {
        this.#wanted = null;
        this.#cache.forEach((b) => b.close());
        this.#cache.clear();
        invoke('thumb_close').catch(() => {});
    }
}
