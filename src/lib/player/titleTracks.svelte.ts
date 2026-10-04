// The audio and subtitles you chose for a show (or movie), used again for every
// episode of it: turn the Signs & Songs subtitles off once and they stay off for
// that show; pick Japanese audio with English subtitles and the next episode
// starts that way. Only choices you make in the player count, never ones made
// for you. Kept on this device, the most recent 500 titles.
import type { Track } from './backend';

/** Subtitles: none, only the signs-and-songs (forced) kind, or full subtitles. */
export type SubChoice =
    | { kind: 'off' }
    | { kind: 'forced'; lang: string | null }
    | { kind: 'full'; lang: string | null };

export type TitleTracks = { audio?: string | null; subs?: SubChoice; at: number };

const KEY = 'title-tracks';
const MAX = 500;

// A track that only translates on-screen text and songs: flagged forced, or named so
// ("Signs & Songs"). Not "Full Subtitles"/"Dialogue" tracks that mention songs.
const SIGNS = /\b(?:signs?|songs?|forced|on-?screen)\b/i;
const FULL = /\b(?:full|dialog(?:ue)?|sdh|cc)\b/i;
export const isForcedTrack = (t: Track) => !!t.forced || (SIGNS.test(t.title ?? '') && !FULL.test(t.title ?? ''));

/** What picking this subtitle track (or none) means, to remember. */
export function subChoiceOf(track: Track | null): SubChoice {
    if (!track) return { kind: 'off' };
    return { kind: isForcedTrack(track) ? 'forced' : 'full', lang: track.lang ?? null };
}

function load(): Record<string, TitleTracks> {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
        return saved && typeof saved === 'object' ? saved : {};
    } catch {
        return {};
    }
}

class TitleTrackPrefs {
    #all = $state<Record<string, TitleTracks>>(load());

    get(id: string | null | undefined): TitleTracks | null {
        return (id && this.#all[id]) || null;
    }

    remember(id: string | null | undefined, change: { audio?: string | null; subs?: SubChoice }) {
        if (!id) return;
        const all = { ...this.#all, [id]: { ...this.#all[id], ...change, at: Date.now() } };
        const ids = Object.keys(all);
        if (ids.length > MAX) {
            ids.sort((a, b) => all[a].at - all[b].at)
                .slice(0, ids.length - MAX)
                .forEach((old) => delete all[old]);
        }
        this.#save(all);
    }

    get count() {
        return Object.keys(this.#all).length;
    }

    clear() {
        this.#save({});
    }

    #save(all: Record<string, TitleTracks>) {
        this.#all = all;
        try {
            localStorage.setItem(KEY, JSON.stringify(all));
        } catch {}
    }
}

export const titleTracks = new TitleTrackPrefs();
