// The message the team posted for everyone (server maintenance tonight, say):
// asked for while the tracker is connected, at start and now and then. Closing
// it hides that one on this device; a new one shows again.
import { tracker } from '$lib/tracker.svelte';

export type Announcement = { id: number; message: string; level: 'info' | 'warning'; ends_at: string | null };

const CLOSED_KEY = 'announcement-closed';
const EVERY_MS = 15 * 60_000;

function readClosed(): number | null {
    try {
        const v = localStorage.getItem(CLOSED_KEY);
        return v ? Number(v) : null;
    } catch {
        return null;
    }
}

class Announcements {
    current = $state<Announcement | null>(null);
    #closed = $state<number | null>(readClosed());
    #timer: ReturnType<typeof setInterval> | undefined;
    #lastAt = 0;

    /** The one to show: not closed here. */
    get showing(): Announcement | null {
        const a = this.current;
        return a && a.id !== this.#closed ? a : null;
    }

    start() {
        if (this.#timer) return;
        this.refresh();
        this.#timer = setInterval(() => this.refresh(), EVERY_MS);
        if (typeof window !== 'undefined') {
            window.addEventListener('focus', () => {
                if (Date.now() - this.#lastAt > 60_000) this.refresh();
            });
        }
    }

    async refresh() {
        if (!tracker.ready) return;
        this.#lastAt = Date.now();
        const res = await tracker.request<{ announcement: Announcement | null }>('/announcement');
        if (res) this.current = res.announcement ?? null;
    }

    close() {
        const a = this.current;
        if (!a) return;
        this.#closed = a.id;
        try {
            localStorage.setItem(CLOSED_KEY, String(a.id));
        } catch {}
    }
}

export const announcements = new Announcements();
