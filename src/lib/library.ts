import type { PosterItem } from '$lib/components/PosterCard.svelte';
import type { LibraryItem } from '$lib/core/types';
import { cleanVideoId } from '$lib/player/deeplink';

export function libraryToPoster(item: LibraryItem): PosterItem {
    return {
        id: item._id,
        type: item.type,
        name: item.name,
        poster: item.poster,
        progress: item.progress > 0 ? item.progress / 100 : null,
    };
}

/**
 * A minimal meta preview from a library entry, enough for "Add to Library"
 * (Continue Watching items can be watch-history-only, not saved to the library).
 */
export function libraryItemPreview(item: LibraryItem) {
    return {
        id: item._id,
        type: item.type,
        name: item.name,
        poster: item.poster,
        posterShape: item.posterShape ?? 'poster',
        background: null,
        logo: null,
        description: null,
        releaseInfo: null,
        runtime: null,
        released: null,
        links: [],
        trailerStreams: [],
        behaviorHints: {},
    };
}

/** "S2 · E4" for a series' resume episode, from a video id like "tt0903747:2:4". */
export function episodeLabel(item: LibraryItem): string | null {
    const parts = cleanVideoId(item.state?.videoId)?.split(':');
    if (item.type !== 'series' || !parts || parts.length < 3) return null;
    return `S${parts[parts.length - 2]} · E${parts[parts.length - 1]}`;
}

/**
 * Season and episode from an episode id ("tt…:1:8"; a Kitsu anime's "kitsu:…:8"
 * is its one season's); null when it isn't one.
 */
export function seasonEpisode(videoId: string | null | undefined): [number, number] | null {
    const parts = cleanVideoId(videoId)?.split(':');
    if (!parts || parts.length < 3) return null;
    if (parts[0] === 'kitsu' && parts.length === 3) {
        const e = Number(parts[2]);
        return Number.isFinite(e) ? [1, e] : null;
    }
    const [s, e] = parts.slice(-2).map(Number);
    return Number.isFinite(s) && Number.isFinite(e) ? [s, e] : null;
}

/**
 * Stremio's new-episode count, leaving out episodes you're already on or past.
 * Core counts an episode as new when its listed release is after you last
 * watched, so one watched before its listed time (a show out at 9 PM listed
 * for the next morning) would stay "+1" after you've seen it.
 */
/**
 * The episode a show is in Continue Watching for, when it's there to start a
 * new one (rather than to finish one you're partway through): the first new
 * episode Stremio told of, else the next episode it points at. null otherwise.
 */
export function upNextEpisode(item: LibraryItem, notified: Record<string, unknown> | undefined): string | null {
    if (item.type !== 'series') return null;
    const at = seasonEpisode(item.state?.videoId);
    const fresh = Object.keys(notified ?? {})
        .map((id) => ({ id, se: seasonEpisode(id) }))
        .filter((x): x is { id: string; se: [number, number] } => !!x.se && (!at || x.se[0] > at[0] || (x.se[0] === at[0] && x.se[1] > at[1])))
        .sort((a, b) => a.se[0] - b.se[0] || a.se[1] - b.se[1]);
    if (fresh.length) return fresh[0].id;
    return !item.progress && item.state?.videoId ? cleanVideoId(item.state.videoId) : null;
}

export function newEpisodeCount(item: LibraryItem, notified: Record<string, unknown> | undefined): number {
    const ids = Object.keys(notified ?? {});
    if (ids.length === 0) return item.notifications ?? 0;
    const at = seasonEpisode(item.state?.videoId);
    if (!at) return ids.length;
    return ids.filter((id) => {
        const se = seasonEpisode(id);
        return !se || se[0] > at[0] || (se[0] === at[0] && se[1] > at[1]);
    }).length;
}
