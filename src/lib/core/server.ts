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
