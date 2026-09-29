import type { PosterItem } from '$lib/components/PosterCard.svelte';
import type { LibraryItem } from '$lib/core/types';

export function libraryToPoster(item: LibraryItem): PosterItem {
    const { timeOffset, duration } = item.state;
    return {
        id: item._id,
        type: item.type,
        name: item.name,
        poster: item.poster,
        progress: duration > 0 ? timeOffset / duration : null,
    };
}
