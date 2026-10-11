// Continue Watching, from Stremio and the tracker together (docs/lightboxd.md):
// Stremio's row knows only what was started in a Stremio app; the tracker
// (GET /app-api/v1/continue) knows what you've watched anywhere. So:
//
//   * a title you've marked Completed or Dropped leaves the row;
//   * a show the tracker has you further along in moves on to your next
//     episode (from the start, not Stremio's resume point for an earlier one);
//   * a show you're watching that Stremio doesn't have joins the row after
//     Stremio's own, when its next episode is out.

import type { LibraryItem } from '$lib/core/types';
import { seasonEpisode } from '$lib/library';

export type TrackerContinue = {
    watching: {
        id: string;
        type: 'movie' | 'series';
        name: string;
        poster: string | null;
        progress: number;
        next: { video_id: string; season: number; episode: number } | null;
        at: string | null;
    }[];
    finished: string[];
};

export function mergeContinueWatching(stremio: LibraryItem[], tracker: TrackerContinue | null): LibraryItem[] {
    if (!tracker) return stremio;
    const finished = new Set(tracker.finished);
    const watching = new Map(tracker.watching.map((w) => [w.id, w]));
    const kept = stremio
        .filter((i) => !finished.has(i._id))
        .map((i): LibraryItem => {
            const next = watching.get(i._id)?.next;
            if (i.type !== 'series' || !next) return i;
            const at = seasonEpisode(i.state?.videoId);
            const ahead = !at || next.season > at[0] || (next.season === at[0] && next.episode > at[1]);
            if (!ahead) return i;
            // The next episode, from its start (Stremio's resume point was an earlier one's).
            return { ...i, progress: 0, state: { ...i.state, videoId: next.video_id }, deepLinks: { ...i.deepLinks, player: null } };
        });
    const inStremio = new Set(stremio.map((i) => i._id));
    const added = tracker.watching
        .filter((w) => w.next && !inStremio.has(w.id) && !finished.has(w.id))
        .map(
            (w): LibraryItem => ({
                _id: w.id,
                name: w.name,
                type: w.type,
                poster: w.poster,
                posterShape: 'poster',
                progress: 0,
                state: { videoId: w.next!.video_id },
                deepLinks: {},
            })
        );
    return [...kept, ...added];
}
