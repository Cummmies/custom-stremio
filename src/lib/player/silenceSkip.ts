// Tab-to-skip when no intro timing is known (same idea as Stremio Community's
// skip-intro.lua): mute, drop video, fast-forward, and stop at the next moment
// of silence, which is almost always the gap between an intro and the episode.
import { mpv } from './mpv.svelte';

const LABEL = '@introsilence';
const MAX_SEARCH = 180; // seconds of video to search before giving up
const SPEED = 100;

type State = { from: number; vid: string; mute: boolean; timer: ReturnType<typeof setInterval> };

let active: State | null = null;

export const silenceSkipActive = () => !!active;

async function restore(state: State) {
    clearInterval(state.timer);
    await mpv.command('af', 'remove', LABEL).catch(() => {});
    await mpv.set('speed', 1).catch(() => {});
    await mpv.set('vid', state.vid).catch(() => {});
    await mpv.set('mute', state.mute).catch(() => {});
}

/**
 * Starts searching; resolves with where it jumped to (seconds), or null when it
 * gave up or was cancelled (playback goes back to where it started).
 */
export async function startSilenceSkip(onDone?: (result: number | null) => void) {
    if (active) return cancelSilenceSkip();
    const from = mpv.time;
    const vid = (await mpv.get('vid').catch(() => 'auto')) ?? 'auto';
    const wasMuted = mpv.muted;

    // Decoding audio only (no video) is what makes the fast-forward quick.
    await mpv.command('af', 'add', `${LABEL}:lavfi=[silencedetect=noise=-30dB:d=0.5]`).catch(() => {});
    await mpv.set('mute', true);
    await mpv.set('vid', 'no');
    await mpv.set('pause', false);
    await mpv.set('speed', SPEED);

    const state: State = {
        from,
        vid,
        mute: wasMuted,
        timer: setInterval(async () => {
            if (active !== state) return;
            const meta = await mpv.get(`af-metadata/${LABEL.slice(1)}`).catch(() => null);
            const m = meta?.match(/silence_start[^\d-]*(-?\d+(?:\.\d+)?)/);
            const at = m ? Number(m[1]) : NaN;
            const now = Number(await mpv.get('time-pos').catch(() => from)) || from;

            if (Number.isFinite(at) && at > from + 1) {
                active = null;
                await restore(state);
                await mpv.seek(at);
                onDone?.(at);
            } else if (now - from > MAX_SEARCH) {
                active = null;
                await restore(state);
                await mpv.seek(from);
                onDone?.(null);
            }
        }, 150),
    };
    active = state;
}

/** Stops searching and returns to where it started. */
export async function cancelSilenceSkip() {
    const state = active;
    if (!state) return;
    active = null;
    await restore(state);
    await mpv.seek(state.from);
}
