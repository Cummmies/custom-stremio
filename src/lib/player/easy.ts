// Easy Mode: turn the addons' streams into a ranked queue of player links,
// and hand out the next one when a stream fails.
import type { MetaDetails, Stream } from '$lib/core/types';
import { parsePlayerDeepLink, playerHref } from './deeplink';
import { playerPrefs } from './prefs.svelte';
import { audioMatch, parseStream, rankStreams, type AudioMatch, type Candidate } from './ranking';

const linkOf = (s: Stream) => s.deepLinks?.externalPlayer?.streaming ?? s.url ?? null;

export type Pick = {
    href: string;
    label: string;
    torrent: boolean;
    /** Plays instantly (cached on a debrid service, or a direct link). */
    cached: boolean;
    /** How likely it is to have audio in the Easy Mode language, from its name. */
    audio: AudioMatch;
};

/** "More like what you were watching": the addon and resolution of the previous episode's source. */
export type Like = { addonUrl: string | null; resolution: number | null };

/** Ranked, playable choices from whatever the addons have returned so far. */
export function rankedPicks(streams: MetaDetails['streams'], like?: Like | null): { picks: Pick[]; top: Candidate | null } {
    const candidates: Candidate[] = [];
    streams.forEach((group, addonIndex) => {
        if (group.content.type !== 'Ready') return;
        for (const stream of group.content.content) {
            candidates.push({ stream, addon: group.addon.manifest.name, addonUrl: group.addon.transportUrl ?? null, addonIndex, parsed: parseStream(stream) });
        }
    });
    let ranked = rankStreams(candidates, {
        // A source you picked yourself above the Easy Mode cap is still fine for the next episode.
        maxResolution: Math.max(playerPrefs.maxResolution, like?.resolution ?? 0),
        language: playerPrefs.easyLanguage,
        allowTorrents: playerPrefs.allowTorrents,
    });
    if (like?.addonUrl) {
        // Same addon at the same quality first, then the same addon, then everything else (each still in rank order).
        const score = (c: Candidate) =>
            c.addonUrl !== like.addonUrl ? 2 : like.resolution && c.parsed.resolution !== like.resolution ? 1 : 0;
        ranked = ranked.map((c, i) => [c, i] as const).sort((a, b) => score(a[0]) - score(b[0]) || a[1] - b[1]).map(([c]) => c);
    }
    const picks: Pick[] = [];
    for (const c of ranked) {
        const link = c.stream.deepLinks?.player ? parsePlayerDeepLink(c.stream.deepLinks.player) : null;
        const url = linkOf(c.stream);
        if (!link || !url) continue;
        const firstLine = (c.stream.title ?? c.stream.description ?? '').split('\n')[0];
        picks.push({
            href: playerHref(link, url),
            label: `${c.addon} · ${firstLine}`.slice(0, 120),
            torrent: c.parsed.kind === 'torrent',
            cached: c.parsed.kind === 'debrid',
            audio: audioMatch(c.parsed, playerPrefs.easyLanguage),
        });
    }
    return { picks, top: ranked[0] ?? null };
}

/** The fallback queue for the video being auto-played (survives page changes). */
class EasyQueue {
    videoId: string | null = null;
    #rest: Pick[] = [];
    #all: Pick[] = [];
    tried: Pick[] = [];
    /** The source playing now. */
    current: Pick | null = null;
    /** Language search: the first source that played (to return to), and how many we've tried. */
    #fallback: Pick | null = null;
    #languageTries = 0;
    languageSearchDone = false;

    start(videoId: string, picks: Pick[]) {
        this.videoId = videoId;
        this.#all = picks;
        this.current = picks[0] ?? null;
        this.#fallback = null;
        this.#languageTries = 0;
        this.languageSearchDone = false;
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
        if (n) {
            this.tried.push(n);
            this.current = n;
        }
        return n;
    }

    /**
     * The playing source has no audio in your language: the next cached source
     * whose name says it has (or might have) that language, up to 3 tries. When
     * none is left, the first source that played, to go back to; null when
     * there's nothing to do.
     */
    nextForLanguage(): { pick: Pick; returning: boolean } | null {
        if (this.languageSearchDone || !this.current) return null;
        this.#fallback ??= this.current;
        const tried = new Set(this.tried.map((p) => p.href));
        const candidate =
            this.#languageTries < 3
                ? (this.#all.find((p) => p.cached && p.audio === 'match' && !tried.has(p.href)) ??
                  this.#all.find((p) => p.cached && p.audio === 'maybe' && !tried.has(p.href)))
                : undefined;
        if (candidate) {
            this.#languageTries++;
            this.tried.push(candidate);
            this.#rest = this.#rest.filter((p) => p !== candidate);
            this.current = candidate;
            return { pick: candidate, returning: false };
        }
        this.languageSearchDone = true;
        const back = this.#fallback;
        if (back.href === this.current.href) return null;
        this.current = back;
        return { pick: back, returning: true };
    }

    activeFor(videoId: string | null) {
        return !!videoId && this.videoId === videoId;
    }

    clear() {
        this.videoId = null;
        this.#rest = [];
        this.#all = [];
        this.tried = [];
        this.current = null;
        this.#fallback = null;
        this.languageSearchDone = false;
    }
}

export const easyQueue = new EasyQueue();
