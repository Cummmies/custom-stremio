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

/** "S2 · E4" for series episodes, from a video id like "tt0903747:2:4". */
export function episodeLabel(item: LibraryItem): string | null {
    const parts = item.state.video_id?.split(':');
    if (item.type !== 'series' || !parts || parts.length < 3) return null;
    return `S${parts[parts.length - 2]} · E${parts[parts.length - 1]}`;
}

/** "1 h 10 min left", "32 min left", or null when the length is unknown. */
export function timeLeft(item: LibraryItem): string | null {
    const { timeOffset, duration } = item.state;
    if (!duration) return null;
    const minutes = Math.max(1, Math.round((duration - timeOffset) / 60000));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? `${h} h ${m} min left` : `${m} min left`;
}
