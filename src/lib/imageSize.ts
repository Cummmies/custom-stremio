// On the TV, pictures at the size they're shown: a poster tile is under 200 px
// wide and the screen 1920, so TMDb's w500/original and metahub's "large" are
// several times the pixels the TV has to download, decode and keep in memory.
// Elsewhere (a PC or phone with a sharp screen) left as they are.
import { isTV } from '$lib/platform';

const TMDB = /^(https:\/\/image\.tmdb\.org\/t\/p\/)(original|w\d+)(\/.*)$/;

export function sized(url: string | null | undefined, kind: 'poster' | 'backdrop'): string | null {
    if (!url) return null;
    if (!isTV) return url;
    const tmdb = url.match(TMDB);
    if (tmdb) {
        const want = kind === 'poster' ? 'w342' : 'w1280';
        // Only ever smaller: a w185 stays w185.
        const have = tmdb[2] === 'original' ? Infinity : Number(tmdb[2].slice(1));
        return have > Number(want.slice(1)) ? `${tmdb[1]}${want}${tmdb[3]}` : url;
    }
    return url.includes('images.metahub.space/') ? url.replace('/large/', '/medium/') : url;
}
