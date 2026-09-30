import type { PosterItem } from '$lib/components/PosterCard.svelte';
import type { LibraryItem } from '$lib/core/types';
import { cleanVideoId } from '$lib/player/deeplink';
import { tmdb } from '$lib/tmdb.svelte';

/** The season a series entry is on, from its resume episode ("tt…:3:12" → 3). */
export function currentSeason(item: LibraryItem): number | null {
    return resumePosition(item)?.season ?? null;
}

/** Season and episode of a series entry's resume episode ("tt…:3:12" → 3, 12). */
export function resumePosition(item: LibraryItem): { season: number; episode: number } | null {
    const parts = cleanVideoId(item.state?.videoId)?.split(':');
    if (item.type !== 'series' || !parts || parts.length < 3) return null;
    const season = Number(parts[parts.length - 2]);
    const episode = Number(parts[parts.length - 1]);
    return Number.isFinite(season) && Number.isFinite(episode) ? { season, episode } : null;
}

export function libraryToPoster(item: LibraryItem): PosterItem {
    return {
        id: item._id,
        type: item.type,
        name: item.name,
        // With TMDB set up, a series shows the poster of the season you're on.
        poster: (item.type === 'series' ? tmdb.seasonPoster(item._id, currentSeason(item)) : null) ?? item.poster,
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
