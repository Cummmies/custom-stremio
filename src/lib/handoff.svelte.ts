// Handing something to your phone (the tracker's handoffs): the TV opens one,
// shows its link as a QR code (PhoneHandoff.svelte, in the app shell), and
// waits for the phone's answer, asking every second or so.
//   typeOnPhone: typing for a field (a review, a search, a list name)
//   rateOnPhone: the score and review at the credits
//   remote:      the phone as a remote (commands for the player)
// Closing the QR code cancels it.
import { tracker } from '$lib/tracker.svelte';

export type HandoffKind = 'text' | 'rate' | 'remote' | 'resume';
type Opened = { id: number; url: string; expires_in: number };
type Polled = { state: 'waiting' | 'answered' | 'closed' | 'expired'; result: Record<string, unknown> | null; commands: { seq: number; cmd: string }[] };

const POLL_MS = 1200;

export function openHandoff(kind: HandoffKind, payload: Record<string, unknown>) {
    return tracker.request<Opened>('/handoffs', { method: 'POST', body: { kind, payload } });
}
export function pollHandoff(id: number, after = 0) {
    return tracker.request<Polled>(`/handoffs/${id}?after=${after}`);
}
export function closeHandoff(id: number) {
    return tracker.request(`/handoffs/${id}`, { method: 'DELETE' });
}

class PhoneHandoff {
    /** The QR code on screen: what it's for, and its link. */
    current = $state<{ id: number; url: string; title: string; caption: string } | null>(null);
    #finish: ((result: Record<string, unknown> | null) => void) | null = null;

    /** Opens a handoff, shows its code, and resolves with the phone's answer (null: closed or expired). */
    async #ask(kind: 'text' | 'rate', payload: Record<string, unknown>, title: string, caption: string) {
        this.cancel();
        const opened = await openHandoff(kind, payload);
        if (!opened) return null;
        this.current = { id: opened.id, url: opened.url, title, caption };
        return new Promise<Record<string, unknown> | null>((resolve) => {
            this.#finish = resolve;
            const id = opened.id;
            const tick = async () => {
                if (this.current?.id !== id) return;
                const p = await pollHandoff(id);
                if (this.current?.id !== id) return;
                if (p && p.state === 'answered') return this.#done(p.result);
                if (p && (p.state === 'expired' || p.state === 'closed')) return this.#done(null);
                setTimeout(tick, POLL_MS);
            };
            setTimeout(tick, POLL_MS);
        });
    }

    #done(result: Record<string, unknown> | null) {
        const finish = this.#finish;
        this.#finish = null;
        this.current = null;
        finish?.(result);
    }

    /** Typing on the phone for a field; the text sent, or null. */
    async typeOnPhone(opts: { label: string; value?: string; placeholder?: string; multiline?: boolean; max?: number }) {
        const res = await this.#ask('text', { ...opts }, 'Type on Your Phone', 'Scan with your phone’s camera, type, and send. It appears here.');
        return typeof res?.text === 'string' ? res.text : null;
    }

    /** The score and review at the credits, given on the phone (saved by the tracker); what was saved, or null. */
    async rateOnPhone(title: string, logId: number) {
        const res = await this.#ask('rate', { title, log_id: logId }, 'Rate on Your Phone', 'Scan with your phone’s camera to score it and write a review.');
        return res && typeof res.rating === 'number' ? { rating: res.rating, review: (res.review as string | null) ?? null } : null;
    }

    /** The code was closed: the handoff is cancelled. */
    cancel() {
        const c = this.current;
        if (c) void closeHandoff(c.id);
        this.#done(null);
    }
}

export const phone = new PhoneHandoff();
