// Ways to order the source list (as stremio-native's Seeders / Quality / Smallest /
// Smart): by addon, as the addons answer (the default); Smart, Easy Mode's own
// ranking; or by one thing read from each source's name.
import type { Stream } from '$lib/core/types';
import { episodeFit, episodeOf, parseStream, rankStreams, releaseText, type Candidate } from './ranking';

export type SourceSort = 'addon' | 'smart' | 'seeders' | 'quality' | 'smallest';

export const SORTS: { value: SourceSort; label: string }[] = [
    { value: 'addon', label: 'By Addon' },
    { value: 'smart', label: 'Smart' },
    { value: 'seeders', label: 'Seeders' },
    { value: 'quality', label: 'Quality' },
    { value: 'smallest', label: 'Smallest' },
];

export type SourceEntry = { stream: Stream; addon: string; addonIndex: number; key: string };

export type SortContext = {
    anime: boolean;
    /** The audio language to put first (a show's choice, or the setting). */
    language: string | null;
    videoId: string | null;
    tv: boolean;
};

/** `entries` in addon order, sorted by `sort`. Ties keep the addon order. */
export function sortSources(entries: SourceEntry[], sort: SourceSort, ctx: SortContext): SourceEntry[] {
    if (sort === 'addon') return entries;
    const candidates: (Candidate & { entry: SourceEntry })[] = entries.map((entry) => ({
        entry,
        stream: entry.stream,
        addon: entry.addon,
        addonIndex: entry.addonIndex,
        parsed: parseStream(entry.stream, { anime: ctx.anime }),
    }));
    if (sort === 'smart') {
        // Easy Mode's order, without its limits (quality cap, torrents): this sorts,
        // it doesn't hide. What it would never pick (links to websites, samples,
        // another episode) goes last, in addon order.
        const ranked = rankStreams(candidates, {
            maxResolution: Infinity,
            language: ctx.language,
            allowTorrents: true,
            anime: ctx.anime,
            episode: episodeOf(ctx.videoId),
            tv: ctx.tv,
        }) as typeof candidates;
        const picked = new Set(ranked.map((c) => c.entry));
        return [...ranked.map((c) => c.entry), ...entries.filter((e) => !picked.has(e))];
    }
    const last = (n: number | null) => n ?? -Infinity; // unknown goes last
    const by: Record<Exclude<SourceSort, 'addon' | 'smart'>, (a: Candidate, b: Candidate) => number> = {
        seeders: (a, b) => last(b.parsed.seeders) - last(a.parsed.seeders),
        quality: (a, b) =>
            last(b.parsed.resolution) - last(a.parsed.resolution) ||
            b.parsed.tier - a.parsed.tier ||
            last(b.parsed.sizeBytes) - last(a.parsed.sizeBytes),
        smallest: (a, b) => (a.parsed.sizeBytes ?? Infinity) - (b.parsed.sizeBytes ?? Infinity),
    };
    const compare = by[sort];
    return candidates
        .map((c, i) => [c, i] as const)
        .sort(([a, i], [b, j]) => compare(a, b) || i - j)
        .map(([c]) => c.entry);
}

// --- hidden sources ---------------------------------------------------------
// What Easy Mode would never pick stays out of the list too, behind "Show hidden".

export type HiddenReason = 'hdr' | 'junk' | 'episode' | 'not-video';

export const HIDDEN_LABELS: Record<HiddenReason, string> = {
    hdr: 'HDR, and this screen isn’t showing HDR',
    junk: 'Cam, sample, 3D or burned-in subtitles',
    episode: 'Named for another episode',
    'not-video': 'Not a video',
};

/**
 * Splits the list into what's shown and what's hidden (with why). HDR is only
 * hidden when there's something else to watch, and another episode only when
 * some source names this one (otherwise the numbering just differs).
 */
export function hideSources(
    entries: SourceEntry[],
    ctx: { anime: boolean; videoId: string | null; hideHdr: boolean }
): { shown: SourceEntry[]; hidden: { entry: SourceEntry; reason: HiddenReason }[] } {
    const want = episodeOf(ctx.videoId);
    const info = entries.map((entry) => {
        const p = parseStream(entry.stream, { anime: ctx.anime });
        const s = entry.stream;
        const notVideo = p.kind === 'skip' && !s.externalUrl && !s.ytId && !!(s.url || s.infoHash);
        return { entry, p, notVideo, fit: episodeFit(releaseText(s), want) };
    });
    const videos = info.filter((i) => !i.notVideo && !i.p.junk && i.p.kind !== 'skip');
    const anyMatch = videos.some((i) => i.fit === 'match');
    const anySdr = videos.some((i) => !i.p.hdr && !(anyMatch && i.fit === 'wrong'));
    const shown: SourceEntry[] = [];
    const hidden: { entry: SourceEntry; reason: HiddenReason }[] = [];
    for (const i of info) {
        const reason: HiddenReason | null = i.notVideo
            ? 'not-video'
            : i.p.junk
              ? 'junk'
              : anyMatch && i.fit === 'wrong'
                ? 'episode'
                : ctx.hideHdr && anySdr && i.p.hdr
                  ? 'hdr'
                  : null;
        if (reason) hidden.push({ entry: i.entry, reason });
        else shown.push(i.entry);
    }
    return { shown, hidden };
}

const KEY = 'sources-sort';

export function loadSort(): SourceSort {
    try {
        const v = localStorage.getItem(KEY);
        if (SORTS.some((s) => s.value === v)) return v as SourceSort;
    } catch {}
    return 'addon';
}

export function saveSort(sort: SourceSort) {
    try {
        localStorage.setItem(KEY, sort);
    } catch {}
}
