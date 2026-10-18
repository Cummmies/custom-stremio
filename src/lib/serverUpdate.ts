// The streaming server Set Up put on this PC, kept current (src-tauri/src/server.rs):
// about once a week, a newer Stremio Service release is downloaded quietly, then
// swapped in when the player isn't open (the server restarts in a few seconds).
// If the app closes first, it's swapped in at the next launch. A Stremio Service
// install or tray app of its own isn't touched: that keeps itself up to date.
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from '$lib/platform';

const KEY = 'server-update-at';
const EVERY_MS = 7 * 86_400_000;
const FIRST_AFTER_MS = 2 * 60_000;
const RETRY_MS = 60_000;

const playing = () => document.documentElement.classList.contains('player-active');

async function applyWhenIdle() {
    if (playing()) return void setTimeout(applyWhenIdle, RETRY_MS);
    await invoke('server_update_apply').catch(() => {});
}

async function check() {
    try {
        if (Date.now() - Number(localStorage.getItem(KEY) || 0) < EVERY_MS) return;
    } catch {}
    let waiting = false;
    try {
        waiting = await invoke<boolean>('server_update_download');
    } catch {
        return; // an app from before this, or no internet: next time
    }
    try {
        localStorage.setItem(KEY, String(Date.now()));
    } catch {}
    if (waiting) void applyWhenIdle();
}

export function startServerUpdates() {
    if (!isDesktop) return;
    setTimeout(check, FIRST_AFTER_MS);
    setInterval(check, 6 * 3600_000);
}
