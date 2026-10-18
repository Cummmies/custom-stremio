// What the tracker knows you've watched, marked watched in your Stremio library
// too: watches it learned elsewhere (a backup brought back, the website,
// another device) get Stremio's checkmarks and episode ticks. The tracker does
// the work (POST /stremio/push) with this profile's Stremio sign-in, sent for it
// and not kept; then the library here is pulled again so it shows.
// Add-only: nothing is ever unmarked. Now and then by itself, and right after a
// backup is brought back.
import { app } from '$lib/app.svelte';
import { core } from '$lib/core';
import { tracker } from '$lib/tracker.svelte';

const EVERY_MS = 6 * 3600_000;
const lastKey = (uid: string) => `stremio-push-at:${uid}`;
let running = false;

export type PushResult = { movies: number; shows: number; episodes: number };

export async function pushWatchedToStremio(force = false): Promise<PushResult | null> {
    const key = app.ctx?.profile.auth?.key;
    const uid = app.ctx?.profile.auth?.user._id;
    if (!key || !uid || !tracker.ready || running) return null;
    if (!force) {
        try {
            if (Date.now() - Number(localStorage.getItem(lastKey(uid)) || 0) < EVERY_MS) return null;
        } catch {}
    }
    running = true;
    try {
        const res = await tracker.request<PushResult>('/stremio/push', { method: 'POST', body: { auth_key: key }, timeout: 90_000 });
        if (!res) return null;
        try {
            localStorage.setItem(lastKey(uid), String(Date.now()));
        } catch {}
        // What changed in Stremio's records: brought into this device's library.
        if (res.movies || res.shows) core.dispatch({ action: 'Ctx', args: { action: 'SyncLibraryWithAPI' } });
        return res;
    } finally {
        running = false;
    }
}
