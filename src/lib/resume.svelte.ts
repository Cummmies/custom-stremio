// Keep watching on this device: leaving the player leaves a note on the
// tracker (a "resume" handoff: what, which episode, the second you stopped,
// on which device), and your other devices offer to carry on from there
// (ResumeBanner.svelte), starting at that exact second (the player asks
// takeStartAt). Checked when the app opens or comes back, and every minute.
import { tracker } from '$lib/tracker.svelte';
import { openHandoff } from '$lib/handoff.svelte';
import { isDesktop, isIOS, isTV } from '$lib/platform';

export type ResumeOffer = {
    handoff_id: number;
    id: string;
    type: string;
    video_id: string | null;
    name: string;
    time: number;
    from: string;
};

const CHECK_MS = 60_000;
/** Too early to bother, or as good as finished: no note. */
const MIN_SECONDS = 60;
const DONE_SHARE = 0.92;

const deviceName = () => (isTV ? 'your TV' : isIOS ? 'your iPhone' : isDesktop ? 'your computer' : 'another device');

/** Leaving the player: a note for your other devices (when there's something worth carrying on). */
export function leaveResumeNote(n: { id: string; type: string; videoId: string | null; name: string; time: number; duration: number }) {
    if (!tracker.ready || n.time < MIN_SECONDS || (n.duration && n.time > n.duration * DONE_SHARE)) return;
    void openHandoff('resume', { id: n.id, type: n.type, video_id: n.videoId, name: n.name, time: Math.floor(n.time), from: deviceName() });
}

/** A start time handed over for this title (and episode), used once. */
let startAt: { id: string; videoId: string | null; time: number } | null = null;
export function takeStartAt(id: string, videoId: string | null) {
    const s = startAt;
    if (!s || s.id !== id || (s.videoId && s.videoId !== videoId)) return null;
    startAt = null;
    return s.time;
}

class ResumeOffers {
    offer = $state<ResumeOffer | null>(null);
    #timer: ReturnType<typeof setInterval> | undefined;

    start() {
        if (this.#timer) return;
        const check = () => {
            if (typeof document === 'undefined' || document.visibilityState === 'visible') void this.check();
        };
        this.#timer = setInterval(check, CHECK_MS);
        document.addEventListener('visibilitychange', check);
        check();
    }

    async check() {
        if (!tracker.ready) return;
        const res = await tracker.request<{ resumes: ResumeOffer[] }>('/handoffs/resume');
        this.offer = res?.resumes[0] ?? null;
    }

    /** Carry on here: the other devices stop offering it; the player starts at that second. */
    take(o: ResumeOffer) {
        startAt = { id: o.id, videoId: o.video_id, time: o.time };
        this.dismiss(o);
    }

    dismiss(o: ResumeOffer) {
        void tracker.request(`/handoffs/${o.handoff_id}/take`, { method: 'POST' });
        if (this.offer?.handoff_id === o.handoff_id) this.offer = null;
    }
}

export const resumeOffers = new ResumeOffers();
