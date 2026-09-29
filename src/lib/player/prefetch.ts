// Easy Mode: find sources for the next episode while this one is still playing,
// so "Next Episode" can start right away instead of waiting on the addons.
import { core } from '$lib/core';
import type { MetaDetails } from '$lib/core/types';
import { rankedPicks, type Pick } from './easy';

const GIVE_UP_MS = 20000;

/**
 * Asks the addons for `videoId`'s streams through the (otherwise idle while
 * playing) MetaDetails model and resolves with the ranked picks once they've
 * all answered, or with whatever has arrived after 20s.
 */
export function prefetchPicks(type: string, id: string, videoId: string): Promise<Pick[]> {
    return new Promise((resolve) => {
        let done = false;
        let latest: Pick[] = [];
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            unwatch();
            resolve(latest);
        };
        const timer = setTimeout(finish, GIVE_UP_MS);
        const unwatch = core.watch<MetaDetails>('meta_details', (details) => {
            if (done || details?.selected?.streamPath?.id !== videoId) return;
            latest = rankedPicks(details.streams).picks;
            if (!details.streams.some((g) => g.content.type === 'Loading')) finish();
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
