// Easy Mode: turn the addons' streams into a ranked queue of player links,
// and hand out the next one when a stream fails.
import type { MetaDetails, Stream } from '$lib/core/types';
import { parsePlayerDeepLink, playerHref } from './deeplink';
import { playerPrefs } from './prefs.svelte';
import { parseStream, rankStreams, type Candidate } from './ranking';

const linkOf = (s: Stream) => s.deepLinks?.externalPlayer?.streaming ?? s.url ?? null;

export type Pick = { href: string; label: string; torrent: boolean };

/** Ranked, playable choices from whatever the addons have returned so far. */
export function rankedPicks(streams: MetaDetails['streams']): { picks: Pick[]; top: Candidate | null } {
    const candidates: Candidate[] = [];
    streams.forEach((group, addonIndex) => {
        if (group.content.type !== 'Ready') return;
        for (const stream of group.content.content) {
            candidates.push({ stream, addon: group.addon.manifest.name, addonIndex, parsed: parseStream(stream) });
        }
    });
    const ranked = rankStreams(candidates, {
        maxResolution: playerPrefs.maxResolution,
        language: playerPrefs.easyLanguage,
        allowTorrents: playerPrefs.allowTorrents,
    });
    const picks: Pick[] = [];
    for (const c of ranked) {
        const link = c.stream.deepLinks?.player ? parsePlayerDeepLink(c.stream.deepLinks.player) : null;
        const url = linkOf(c.stream);
        if (!link || !url) continue;
        const firstLine = (c.stream.title ?? c.stream.description ?? '').split('\n')[0];
        picks.push({ href: playerHref(link, url), label: `${c.addon} · ${firstLine}`.slice(0, 120), torrent: c.parsed.kind === 'torrent' });
    }
    return { picks, top: ranked[0] ?? null };
}

/** The fallback queue for the video being auto-played (survives page changes). */
class EasyQueue {
    videoId: string | null = null;
    #rest: Pick[] = [];
    tried: Pick[] = [];

    start(videoId: string, picks: Pick[]) {
        this.videoId = videoId;
        this.tried = picks.slice(0, 1);
        // Try a handful of the best (debrid first) before asking, and keep the best
        // plain torrent as the last resort even when many debrid options rank above it.
        const rest = picks.slice(1, 4);
        const torrent = picks.find((p) => p.torrent);
        if (torrent && !rest.includes(torrent) && picks[0] !== torrent) rest.push(torrent);
        this.#rest = rest;
    }

    /** Next choice after a failure, or null when we should ask the person. */
    next(): Pick | null {
        const n = this.#rest.shift() ?? null;
        if (n) this.tried.push(n);
        return n;
    }

    activeFor(videoId: string | null) {
        return !!videoId && this.videoId === videoId;
    }

    clear() {
        this.videoId = null;
        this.#rest = [];
        this.tried = [];
    }
}

export const easyQueue = new EasyQueue();
