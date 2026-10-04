// Easy Mode: turn the addons' streams into a ranked queue of player links,
// and hand out the next one when a stream fails.
import type { MetaDetails, Stream } from '$lib/core/types';
import { parsePlayerDeepLink, playerHref } from './deeplink';
import { playerPrefs } from './prefs.svelte';
import { titleTracks } from './titleTracks.svelte';
import { audioLanguage } from './language';
import { isDesktop, isTV } from '$lib/platform';
import { audioMatch, episodeOf, looksLikeAnime, parseStream, rankStreams, type AudioMatch, type Candidate } from './ranking';

const linkOf = (s: Stream) => s.deepLinks?.externalPlayer?.streaming ?? s.url ?? null;

export type Pick = {
    href: string;
    label: string;
    torrent: boolean;
    /** Plays instantly (cached on a debrid service, or a direct link). */
    cached: boolean;
    /** How likely it is to have audio in your language, from its name. */
    audio: AudioMatch;
};

/** "More like what you were watching": the addon and resolution of the previous episode's source. */
export type Like = { addonUrl: string | null; resolution: number | null };

/**
 * Ranked, playable choices from whatever the addons have returned so far.
 * `isAnime` comes from the anime list; when that can't tell (null), the
 * sources themselves decide. `videoId` is the episode they're for: sources
 * that name a different one are left out. `titleId` is the show: the audio you
 * chose for it in the player comes before Easy Mode's language.
 */
export function rankedPicks(
    streams: MetaDetails['streams'],
    like?: Like | null,
    isAnime: boolean | null = null,
    videoId: string | null = null,
    titleId: string | null = null
): { picks: Pick[]; top: Candidate | null; anime: boolean } {
    const ready = streams.flatMap((g) => (g.content.type === 'Ready' ? g.content.content : []));
    const anime = isAnime ?? looksLikeAnime(ready);
    // Your own choice for this show (picked in the player's audio menu) wins over the
    // setting: Japanese for this anime means Japanese releases first, not dubs.
    const language = titleTracks.get(titleId)?.audio ?? audioLanguage();
    const candidates: Candidate[] = [];
    streams.forEach((group, addonIndex) => {
        if (group.content.type !== 'Ready') return;
        for (const stream of group.content.content) {
            candidates.push({
                stream,
                addon: group.addon.manifest.name,
                addonUrl: group.addon.transportUrl ?? null,
                addonIndex,
                parsed: parseStream(stream, { anime }),
            });
        }
    });
    let ranked = rankStreams(candidates, {
        // A source you picked yourself above the Easy Mode cap is still fine for the next episode.
        maxResolution: Math.max(playerPrefs.maxResolution, like?.resolution ?? 0),
        language,
        // Torrents need the streaming server, which only the desktop app has.
        allowTorrents: playerPrefs.allowTorrents && isDesktop,
        anime,
        episode: episodeOf(videoId),
        tv: isTV,
    });
    if (like?.addonUrl) {
        // Same addon at the same quality first, then the same addon, then everything else (each still in rank order).
        // The language still comes first: the last episode's addon doesn't make a dub
        // worth playing when you wanted Japanese (or the other way round).
        const lang = (c: Candidate) => {
            const m = audioMatch(c.parsed, language, anime);
            return m === 'other' || (anime && m !== 'match') ? 1 : 0;
        };
        const score = (c: Candidate) =>
            c.addonUrl !== like.addonUrl ? 2 : like.resolution && c.parsed.resolution !== like.resolution ? 1 : 0;
        ranked = ranked
            .map((c, i) => [c, i] as const)
            .sort((a, b) => lang(a[0]) - lang(b[0]) || score(a[0]) - score(b[0]) || a[1] - b[1])
            .map(([c]) => c);
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
            audio: audioMatch(c.parsed, language, anime),
        });
    }
    return { picks, top: ranked[0] ?? null, anime };
}

/** How long to wait on slow addons once something playable has turned up. */
export const PICK_WAIT_MS = 7000;

/**
 * The picks so far are worth starting now: every addon has answered, the best
 * is a cached debrid source (from the addon you were watching, once it has
 * answered), or `PICK_WAIT_MS` has passed with something to play.
 */
export function readyToPick(
    streams: MetaDetails['streams'],
    { picks, top }: { picks: Pick[]; top: Candidate | null },
    like: Like | null | undefined,
    elapsedMs: number
): boolean {
    if (!picks.length) return false;
    const pending = streams.some((g) => g.content.type === 'Loading');
    const likeAddonDone = !like?.addonUrl || !streams.some((g) => g.addon.transportUrl === like.addonUrl && g.content.type === 'Loading');
    const great =
        !!top &&
        top.parsed.kind === 'debrid' &&
        likeAddonDone &&
        (!like?.addonUrl || top.addonUrl === like.addonUrl || !streams.some((g) => g.addon.transportUrl === like.addonUrl));
    return great || !pending || elapsedMs > PICK_WAIT_MS;
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
    /** A video whose source you chose yourself: Easy Mode leaves it alone. */
    handPicked: string | null = null;
    /** The title is anime: worth searching other sources for your audio language. */
    anime = false;

    start(videoId: string, picks: Pick[], anime = false) {
        this.videoId = videoId;
        this.anime = anime;
        this.handPicked = null;
        this.#all = picks;
        this.current = picks[0] ?? null;
        this.#fallback = null;
        this.#languageTries = 0;
        this.languageSearchDone = false;
        this.tried = picks.slice(0, 1);
        // Try up to 10 of the best before asking, and keep the best
        // plain torrent as the last resort even when many debrid options rank above it.
        const rest = picks.slice(1, 10);
        const torrent = picks.find((p) => p.torrent);
        if (torrent && !rest.includes(torrent) && picks[0] !== torrent) {
            if (rest.length === 9) rest.pop();
            rest.push(torrent);
        }
        this.#rest = rest;
    }

    /**
     * Easy Mode is on but didn't pick what's playing (a remembered stream, e.g.
     * resuming): take over with fresh picks, leaving out the source playing now.
     */
    adopt(videoId: string, picks: Pick[], currentHref: string, anime = false) {
        const streamOf = (href: string) => new URL(href, 'http://x').searchParams.get('stream');
        const playing = streamOf(currentHref);
        const others = picks.filter((p) => streamOf(p.href) !== playing);
        const current: Pick = picks.find((p) => streamOf(p.href) === playing) ?? {
            href: currentHref,
            label: 'the source playing now',
            torrent: false,
            cached: true,
            audio: 'unknown',
        };
        this.start(videoId, [current, ...others], anime);
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
     * The playing source has no audio in your language: the next most likely
     * source to have it (see the order below), up to 10 tries. When none is
     * left, the first source that played, to go back to; null when there's
     * nothing to do.
     */
    nextForLanguage(): { pick: Pick; returning: boolean } | null {
        if (this.languageSearchDone || !this.current) return null;
        this.#fallback ??= this.current;
        const tried = new Set(this.tried.map((p) => p.href));
        // Most likely first: says your language (cached, then not), might have it
        // (dual/multi audio, streaming-service releases), then cached sources that
        // don't say (some dubs aren't labelled). Never ones marked as another language.
        const order: ((p: Pick) => boolean)[] = [
            (p) => p.cached && p.audio === 'match',
            (p) => p.audio === 'match',
            (p) => p.cached && p.audio === 'maybe',
            (p) => p.audio === 'maybe',
            (p) => p.cached && p.audio === 'unknown',
        ];
        const candidate =
            this.#languageTries < 10
                ? order.map((ok) => this.#all.find((p) => ok(p) && !tried.has(p.href))).find(Boolean)
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
        this.anime = false;
    }
}

export const easyQueue = new EasyQueue();
