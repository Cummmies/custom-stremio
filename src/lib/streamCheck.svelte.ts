// Whether an episode can actually be watched yet: some installed addon has a
// source for it. A new season being announced (often with a placeholder date)
// isn't it being out, so Continue Watching and its +1 wait for this.
//
// Asked straight from the addons (their /stream/ resource), one episode at a
// time. A yes is kept for a month on this device; a no is asked again after a
// few hours.
import { SvelteMap } from 'svelte/reactivity';
import { app } from '$lib/app.svelte';
import { reachableUrl } from '$lib/tracker.svelte';
import { isInternalAddon } from '$lib/serverIds';

const YES_KEY = 'stream-ok:';
const YES_FOR_MS = 30 * 24 * 3600_000;
const NO_FOR_MS = 3 * 3600_000;
const TIMEOUT_MS = 12_000;

type Resource = string | { name: string; types?: string[]; idPrefixes?: string[] };
type Manifest = { resources?: Resource[]; types?: string[]; idPrefixes?: string[] };

/** Known answers: true (has sources), false (none yet). Missing: not asked yet. */
const known = new SvelteMap<string, boolean>();
const noAt = new Map<string, number>();
const asking = new Set<string>();

function rememberedYes(videoId: string): boolean {
    try {
        const at = Number(localStorage.getItem(YES_KEY + videoId));
        return !!at && Date.now() - at < YES_FOR_MS;
    } catch {
        return false;
    }
}

/** The installed addons that give streams for this type and id. */
function streamAddons(type: string, videoId: string): string[] {
    const out: string[] = [];
    for (const a of app.ctx?.profile.addons ?? []) {
        const m = a.manifest as Manifest;
        const fits = (types?: string[], prefixes?: string[]) =>
            (!types || types.includes(type)) && (!prefixes || prefixes.some((p) => videoId.startsWith(p)));
        const ok = (m.resources ?? []).some((r) =>
            typeof r === 'string' ? r === 'stream' && fits(m.types, m.idPrefixes) : r.name === 'stream' && fits(r.types ?? m.types, r.idPrefixes ?? m.idPrefixes)
        );
        if (ok) out.push(a.transportUrl.replace(/\/manifest\.json$/, ''));
    }
    return out;
}

/**
 * Whether any installed addon can give sources to play. Stremio's own (local
 * files, WatchHub's "Open in …" links, a few public-domain films) don't count:
 * with only those, a new account can't play anything. Null until addons load.
 */
export function hasSourceAddon(): boolean | null {
    const addons = app.ctx?.profile.addons;
    if (!addons) return null;
    return addons.some((a) => {
        if (a.flags?.official || isInternalAddon(a.manifest.id)) return false;
        const m = a.manifest as Manifest;
        return (m.resources ?? []).some((r) => (typeof r === 'string' ? r : r.name) === 'stream');
    });
}

async function anySources(base: string, type: string, videoId: string, signal: AbortSignal): Promise<boolean> {
    const id = encodeURIComponent(videoId).replace(/%3A/gi, ':');
    const res = await fetch(reachableUrl(`${base}/stream/${type}/${id}.json`), { signal });
    const body = res.ok ? await res.json() : null;
    // Only something playable counts: services' "Open in …" links (externalUrl)
    // come back for any episode, out or not.
    const playable = Array.isArray(body?.streams) && body.streams.some((s: { url?: string; infoHash?: string; ytId?: string }) => s?.url || s?.infoHash || s?.ytId);
    if (!playable) throw new Error('none');
    return true;
}

async function ask(type: string, videoId: string) {
    if (asking.has(videoId)) return;
    const addons = streamAddons(type, videoId);
    // No stream addons at all: nothing to go by, so don't hold anything back.
    if (!addons.length) {
        known.set(videoId, true);
        return;
    }
    asking.add(videoId);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        // The first addon with a source settles it (no Promise.any on the TV's Chromium 69).
        await new Promise<void>((resolve, reject) => {
            let left = addons.length;
            for (const base of addons) {
                anySources(base, type, videoId, ctrl.signal).then(
                    () => resolve(),
                    () => --left === 0 && reject()
                );
            }
        });
        known.set(videoId, true);
        try {
            localStorage.setItem(YES_KEY + videoId, String(Date.now()));
        } catch {
            /* fine: asked again next time */
        }
    } catch {
        known.set(videoId, false);
        noAt.set(videoId, Date.now());
    } finally {
        ctrl.abort();
        clearTimeout(timer);
        asking.delete(videoId);
    }
}

/**
 * Whether `videoId` has sources: true, false, or null while it's being asked
 * (reactive: reading it in a $derived updates when the answer comes).
 */
export function hasSources(type: string, videoId: string): boolean | null {
    const k = known.get(videoId);
    if (k === true) return true;
    if (k === false && Date.now() - (noAt.get(videoId) ?? 0) < NO_FOR_MS) return false;
    if (rememberedYes(videoId)) {
        queueMicrotask(() => known.set(videoId, true));
        return true;
    }
    queueMicrotask(() => ask(type, videoId));
    return k ?? null;
}
