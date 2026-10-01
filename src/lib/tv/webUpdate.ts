// Over-the-air updates for the TV app, like the iPhone app's: the app's code
// is downloaded into its own storage and runs from there on the next start
// (tv/boot.js picks it). Reinstalling is only needed when the installed part
// changes (tv/wgt/native-api.txt).
//
// tv.yml publishes each build's files to the tv-web branch and a manifest,
// tv-web.json, to the tv release. A download copies files the installed app
// already has (same hashed name, same content: usually Stremio's core) and
// fetches the rest.
/* eslint-disable @typescript-eslint/no-explicit-any */

const REPO = 'Cummmies/custom-stremio';
const MANIFEST = `https://github.com/${REPO}/releases/download/tv/tv-web.json`;

type Manifest = {
    version: number;
    native: number;
    commit: string;
    start: string;
    app: string;
    css: string[];
    files: { path: string; size: number }[];
};

type Entry = { version: number; native: number; start: string; app: string; css: string[] };

declare global {
    interface Window {
        __tvEntry?: Entry;
        __tvBundle?: { version: number; downloaded: boolean };
    }
}

const fs = () => (window as any).tizen?.filesystem;

/** Whether this TV app can update itself (the installed app has the boot script and storage). */
export function canUpdate(): boolean {
    return !!window.__tvEntry && typeof fs()?.openFile === 'function';
}

/** The version running now. */
function running(): number {
    return window.__tvBundle?.version ?? window.__tvEntry?.version ?? 0;
}

function stored(): (Entry & { base: string }) | null {
    try {
        return JSON.parse(localStorage.getItem('tv.bundle') ?? 'null');
    } catch {
        return null;
    }
}

export function versionLabel(version: number): string {
    return new Date(version * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Looks for a newer build and downloads it. Resolves with the version that's
 * ready to load on the next start, or null when there's nothing new.
 */
export async function checkAndDownload(onProgress?: (fraction: number) => void): Promise<number | null> {
    const entry = window.__tvEntry;
    if (!entry || !canUpdate()) return null;
    const res = await fetch(`${MANIFEST}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Update check failed (${res.status})`);
    const m: Manifest = await res.json();
    if (m.native > entry.native || m.version <= running()) return null;
    if (localStorage.getItem('tv.bundle.failed') === String(m.version)) return null;
    // Downloaded earlier and waiting for a restart.
    if (stored()?.version === m.version) return m.version;

    const root = `wgt-private/web/${m.version}`;
    await download(m, root, onProgress);
    const base = fs().toURI(root).replace(/\/?$/, '/');
    localStorage.setItem('tv.bundle', JSON.stringify({ version: m.version, native: m.native, start: m.start, app: m.app, css: m.css, base }));
    void cleanUp(m.version);
    return m.version;
}

async function download(m: Manifest, root: string, onProgress?: (fraction: number) => void) {
    const f = fs();
    const total = m.files.reduce((n, x) => n + x.size, 0) || 1;
    let done = 0;
    const made = new Set<string>();
    for (const file of m.files) {
        const dest = `${root}/${file.path}`;
        const parent = dest.slice(0, dest.lastIndexOf('/'));
        if (!made.has(parent)) {
            if (!f.pathExists(parent)) await new Promise((resolve, reject) => f.createDirectory(parent, true, resolve, reject));
            made.add(parent);
        }
        const installed = `wgt-package/${file.path}`;
        if (f.pathExists(installed)) {
            // Same hashed name as a file the installed app has: same content.
            await new Promise<void>((resolve, reject) => f.copyFile(installed, dest, true, resolve, reject));
        } else {
            const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${m.commit}/${file.path}`);
            if (!r.ok) throw new Error(`Download failed: ${file.path} (${r.status})`);
            const data = new Uint8Array(await r.arrayBuffer());
            if (data.length !== file.size) throw new Error(`Download incomplete: ${file.path}`);
            const h = f.openFile(dest, 'w');
            try {
                h.writeData(data);
            } finally {
                h.close();
            }
        }
        done += file.size;
        onProgress?.(done / total);
    }
}

/** Removes downloaded versions other than the one running and the new one. */
async function cleanUp(keep: number) {
    const f = fs();
    try {
        if (!f.pathExists('wgt-private/web')) return;
        const names: string[] = await new Promise((resolve, reject) => f.listDirectory('wgt-private/web', resolve, reject));
        const current = String(running());
        for (const name of names) {
            if (name !== String(keep) && name !== current) {
                await new Promise((resolve) => f.deleteDirectory(`wgt-private/web/${name}`, true, resolve, resolve));
            }
        }
    } catch {
        /* best effort */
    }
}

/** The app started fine on this version: tv/boot.js may keep using it. */
export function confirmStarted() {
    try {
        localStorage.removeItem('tv.bundle.trial');
    } catch {
        /* nothing to confirm */
    }
}
