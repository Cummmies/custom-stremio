// Streaming server status, reported by the Rust side (src-tauri/src/server.rs).
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { core } from '.';
import type { ServerStatus } from './types';

const inTauri = '__TAURI_INTERNALS__' in window;
const onTV = !inTauri && /Tizen/i.test(navigator.userAgent);

export function watchServer(onChange: (status: ServerStatus) => void): () => void {
    if (onTV) {
        onChange({ state: 'missing', message: 'TVs have no streaming server: debrid links play, torrents don’t.' });
        return () => {};
    }
    if (!inTauri) {
        onChange({ state: 'missing', message: 'Running in a plain browser: start Stremio Service manually.' });
        return () => {};
    }

    const apply = (status: ServerStatus) => {
        onChange(status);
        // Tell the core to re-check the server as soon as it is up.
        if (status.state === 'ready') {
            void fastTorrents();
            core.dispatch({ action: 'StreamingServer', args: { action: 'Reload' } });
        }
    };

    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<ServerStatus>('server-status', (e) => apply(e.payload)).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
    });
    invoke<ServerStatus>('server_status').then(apply);

    return () => {
        disposed = true;
        unlisten?.();
    };
}

// Stremio's torrent profiles (its Settings → Streaming → Torrent Profile).
// "Default" caps a torrent at 3.5 MB/s (28 Mbit/s) and 55 peers: under what a
// big 1080p or any 4K file needs, so it starts slowly and stops to buffer
// whatever your connection. "Fast" lets it use the connection.
const DEFAULT_PROFILE = { btMaxConnections: 55, btDownloadSpeedSoftLimit: 2621440, btDownloadSpeedHardLimit: 3670016, btMinPeersForStable: 5 };
const FAST_PROFILE = { btMaxConnections: 200, btDownloadSpeedSoftLimit: 4194304, btDownloadSpeedHardLimit: 39321600, btMinPeersForStable: 10 };
const LOCAL_SERVER = 'http://127.0.0.1:11470/';
let tuned = false;

/**
 * The app's own streaming server, still on Stremio's Default profile: Fast
 * instead, once per launch. A profile you chose yourself (anything else) is
 * left alone. Stremio's app uses the same server, so it's faster there too.
 */
async function fastTorrents() {
    if (tuned) return;
    tuned = true;
    try {
        const res = await fetch(`${LOCAL_SERVER}settings`);
        const values = (await res.json())?.values as Record<string, unknown> | undefined;
        if (!values) return;
        const onDefault = Object.entries(DEFAULT_PROFILE).every(([k, v]) => values[k] === v);
        if (!onDefault) return;
        await fetch(`${LOCAL_SERVER}settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...values, ...FAST_PROFILE }),
        });
    } catch {
        tuned = false; // the next time it's ready
    }
}
