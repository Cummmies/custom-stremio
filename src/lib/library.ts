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

/** "S2 · E4" for a series' resume episode, from a video id like "tt0903747:2:4". */
export function episodeLabel(item: LibraryItem): string | null {
    const parts = cleanVideoId(item.state?.videoId)?.split(':');
    if (item.type !== 'series' || !parts || parts.length < 3) return null;
    return `S${parts[parts.length - 2]} · E${parts[parts.length - 1]}`;
}
