// The TV remote: arrows move focus to the nearest item in that direction (any
// button, link or field on screen), OK clicks it (the browser does that for a
// focused button or link), Back closes what's open or goes back, and the media
// keys reach the player as the keyboard keys it already handles.
//
// Screens don't need to know about it: whatever they make focusable is
// reachable. A screen that wants the arrows itself (the player, over the
// video) handles them first and marks the event handled (preventDefault), or is
// skipped as below.

/* eslint-disable @typescript-eslint/no-explicit-any */
const tizen = () => (window as any).tizen;

/** Tizen key codes for the remote's extra keys. */
const KEY = {
    back: 10009,
    playPause: 10252,
    play: 415,
    pause: 19,
    stop: 413,
    fastForward: 417,
    rewind: 412,
};

/** Remote keys that have to be registered before the app receives them. */
const REGISTER = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind'];

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Dir = 'left' | 'right' | 'up' | 'down';
const ARROWS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

function visible(el: HTMLElement): DOMRect | null {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    if (el.closest('[inert], [aria-hidden="true"]')) return null;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.pointerEvents === 'none' || Number(style.opacity) === 0) return null;
    return r;
}

/** Where focus can go now: inside an open dialog only, when one is open. */
function scope(): ParentNode {
    const dialogs = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')];
    return dialogs.at(-1) ?? document;
}

function candidates(): { el: HTMLElement; r: DOMRect }[] {
    const out: { el: HTMLElement; r: DOMRect }[] = [];
    for (const el of scope().querySelectorAll<HTMLElement>(FOCUSABLE)) {
        const r = visible(el);
        if (r) out.push({ el, r });
    }
    return out;
}

/**
 * The best next item from `from` in direction `dir`: items ahead in that
 * direction, scored by distance along it plus (weighted) sideways offset, so a
 * row's neighbor wins over something diagonal.
 */
function nearest(from: DOMRect, dir: Dir, list: { el: HTMLElement; r: DOMRect }[], current: Element | null) {
    const cx = from.left + from.width / 2;
    const cy = from.top + from.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const { el, r } of list) {
        if (el === current || el.contains(current)) continue;
        let along: number;
        let side: number;
        switch (dir) {
            case 'right':
                along = r.left - from.right;
                side = Math.abs(r.top + r.height / 2 - cy);
                break;
            case 'left':
                along = from.left - r.right;
                side = Math.abs(r.top + r.height / 2 - cy);
                break;
            case 'down':
                along = r.top - from.bottom;
                side = Math.max(0, Math.max(r.left, from.left) - Math.min(r.right, from.right)) || Math.abs(r.left + r.width / 2 - cx) * 0.1;
                break;
            case 'up':
                along = from.top - r.bottom;
                side = Math.max(0, Math.max(r.left, from.left) - Math.min(r.right, from.right)) || Math.abs(r.left + r.width / 2 - cx) * 0.1;
                break;
        }
        // Allow a little overlap (items in the same row aren't pixel-aligned).
        if (along < -Math.min(r.width, r.height, 24) / 2) continue;
        const score = Math.max(0, along) + side * (dir === 'left' || dir === 'right' ? 3 : 2);
        if (score < bestScore) {
            bestScore = score;
            best = el;
        }
    }
    return best;
}

function focusEl(el: HTMLElement) {
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

/** The item to start from when nothing (or the page itself) has focus: top left. */
function first(list: { el: HTMLElement; r: DOMRect }[]) {
    const onScreen = list.filter(({ r }) => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth);
    onScreen.sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
    return onScreen[0]?.el ?? null;
}

function move(dir: Dir): boolean {
    const list = candidates();
    const active = document.activeElement as HTMLElement | null;
    const inList = active && active !== document.body && list.some(({ el }) => el === active);
    if (!inList) {
        const el = first(list);
        if (el) focusEl(el);
        return !!el;
    }
    const next = nearest(active!.getBoundingClientRect(), dir, list, active);
    if (next) focusEl(next);
    return !!next;
}

/** Sends a key to the focused element as if typed (the player listens for these). */
function synth(key: string): KeyboardEvent {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(e);
    return e;
}

function exitApp() {
    try {
        tizen().application.getCurrentApplication().exit();
    } catch {
        /* not a TV */
    }
}

export function startRemote(opts: { atHome: () => boolean; back: () => void }) {
    document.documentElement.classList.add('tv');
    try {
        for (const k of REGISTER) tizen()?.tvinputdevice?.registerKey(k);
    } catch {
        /* keys stay unregistered: the media keys just won't work */
    }

    window.addEventListener(
        'keydown',
        (e) => {
            if (e.defaultPrevented) return;
            // The player owns the arrows while the video (not a control) has focus.
            const playerOnVideo =
                document.documentElement.classList.contains('player-active') &&
                (document.activeElement === document.body || document.activeElement?.classList.contains('surface'));

            const dir = ARROWS[e.key];
            if (dir) {
                if (playerOnVideo) return;
                const el = document.activeElement;
                // Text fields keep left/right for the cursor.
                if ((dir === 'left' || dir === 'right') && el instanceof HTMLInputElement && el.type !== 'range' && el.type !== 'checkbox') return;
                // Sliders keep left/right for their value.
                if ((dir === 'left' || dir === 'right') && el instanceof HTMLInputElement && el.type === 'range') return;
                if (move(dir)) e.preventDefault();
                return;
            }

            switch (e.keyCode) {
                case KEY.back: {
                    e.preventDefault();
                    // Whatever is open (menu, sheet, player) handles Escape first.
                    if (synth('Escape').defaultPrevented) return;
                    const dialog = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
                    if (dialog) return dialog.close();
                    if (opts.atHome()) exitApp();
                    else opts.back();
                    return;
                }
                case KEY.playPause:
                case KEY.play:
                case KEY.pause:
                    e.preventDefault();
                    synth(' ');
                    return;
                case KEY.stop:
                    e.preventDefault();
                    synth('Escape');
                    return;
                case KEY.fastForward:
                    e.preventDefault();
                    synth('ArrowRight');
                    return;
                case KEY.rewind:
                    e.preventDefault();
                    synth('ArrowLeft');
                    return;
            }
        },
        // Before the screens' own handlers, so a move here is marked handled.
        { capture: true }
    );
}
