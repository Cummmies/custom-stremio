// Find sources for the next episode while this one is still playing,
// so "Next Episode" can start right away instead of waiting on the addons.
import { core } from '$lib/core';
import type { MetaDetails } from '$lib/core/types';
import { anime } from '$lib/anime.svelte';
import { PICK_WAIT_MS, rankedPicks, readyToPick, type Like, type Pick } from './easy';

const GIVE_UP_MS = 20000;

/**
 * Asks the addons for `videoId`'s streams through the (otherwise idle while
 * playing) MetaDetails model and resolves with the ranked picks as soon as
 * they're good enough to start (`readyToPick`, as the title page decides), or
 * with whatever has arrived after 20s.
 */
export function prefetchPicks(
    type: string,
    id: string,
    videoId: string,
    like?: Like | null
): Promise<{ picks: Pick[]; anime: boolean }> {
    return new Promise((resolve) => {
        let done = false;
        let latest: { picks: Pick[]; anime: boolean } = { picks: [], anime: false };
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            clearTimeout(recheck);
            unwatch();
            resolve(latest);
        };
        const started = Date.now();
        const timer = setTimeout(finish, GIVE_UP_MS);
        // Slow addons don't send anything when they time out: look again then.
        const recheck = setTimeout(() => last && check(last), PICK_WAIT_MS + 50);
        let last: MetaDetails | null = null;
        const check = (details: MetaDetails) => {
            const ranked = rankedPicks(details.streams, like, anime.isAnime(id), videoId);
            latest = { picks: ranked.picks, anime: ranked.anime };
            const pending = details.streams.some((g) => g.content.type === 'Loading');
            if (!pending || readyToPick(details.streams, ranked, like, Date.now() - started)) finish();
        };
        const unwatch = core.watch<MetaDetails>('meta_details', (details) => {
            if (done || details?.selected?.streamPath?.id !== videoId) return;
            last = details;
            check(details);
        });
        core.dispatch(
            {
                action: 'Load',
                args: {
                    model: 'MetaDetails',
                    args: {
                        metaPath: { resource: 'meta', type, id, extra: [] },
                        streamPath: { resource: 'stream', type, id: videoId, extra: [] },
                        guessStream: false,
                    },
                },
            },
            'meta_details'
        );
    });
}
