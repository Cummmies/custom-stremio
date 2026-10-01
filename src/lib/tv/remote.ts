// The TV remote, after tvOS: arrows move focus to the nearest item in that
// direction (any button, link or field on screen), OK activates it, Back closes
// what's open or goes back, and the media keys reach the player as the
// keyboard keys it already handles.
//
// - A row (anything that scrolls sideways) remembers its focused item: moving
//   back into the row returns to it.
// - Text fields don't open the keyboard when focus lands on them, only on OK
//   (the TV's keyboard would otherwise pop up while just passing by).
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

/** Thinner than this (CSS px) either way isn't a TV target: page dots and the like. */
const MIN_TARGET = 16;

function visible(el: HTMLElement): DOMRect | null {
    const r = el.getBoundingClientRect();
    if (r.width < MIN_TARGET || r.height < MIN_TARGET) return null;
    if (el.closest('[inert], [aria-hidden="true"]')) return null;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.pointerEvents === 'none' || Number(style.opacity) === 0) return null;
    return r;
}

/** Where focus can go now: inside an open dialog only, when one is open. */
function scope(): ParentNode {
    // An open menu (the newest submenu last), then a dialog, holds focus.
    const menus = [...document.querySelectorAll<HTMLElement>('[data-menu]')].filter((m) => visible(m));
    if (menus.length) return menus.at(-1)!;
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
        // Left and right stay in the row: the item has to share the current
        // one's height band. At the end of a row, nothing happens (as on tvOS).
        if ((dir === 'left' || dir === 'right') && (r.bottom <= from.top + from.height * 0.25 || r.top >= from.bottom - from.height * 0.25)) continue;
        const score = Math.max(0, along) + side * (dir === 'left' || dir === 'right' ? 3 : 2);
        if (score < bestScore) {
            bestScore = score;
            best = el;
        }
    }
    return best;
}

/** Focus set by moving with the arrows (not by an app action or OK). */
let movingFocus = false;

function focusEl(el: HTMLElement) {
    movingFocus = true;
    try {
        el.focus({ preventScroll: true });
    } finally {
        movingFocus = false;
    }
    // Rows scroll just enough; the page keeps the focused row in the middle.
    // Instantly: smooth scrolling falls behind on a TV (and stops short when
    // the next press comes before it ends).
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    // Within the first screen (the Home banner, a title's header): show the
    // page from the top, as tvOS does, instead of centring the item.
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const r = el.getBoundingClientRect();
    const top = r.top - document.body.getBoundingClientRect().top;
    if (top + r.height < (innerHeight / zoom) * 0.85) window.scrollTo(0, 0);
}

// --- rows remember their focused item ------------------------------------------

const rowMemory = new WeakMap<Element, HTMLElement>();
/** Row (or item) → the item focus came from when it arrived from above / below. */
const cameFromAbove = new WeakMap<Element, HTMLElement>();
const cameFromBelow = new WeakMap<Element, HTMLElement>();

/** The sideways-scrolling container an item sits in, if any. */
function rowOf(el: Element): Element | null {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        // A sideways scroller only: a vertical list (overflow-y auto, which
        // makes overflow-x auto too) can be a little wider than itself while
        // its focused item is enlarged.
        const { overflowX: x, overflowY: y } = getComputedStyle(p);
        if ((x === 'auto' || x === 'scroll') && y !== 'auto' && y !== 'scroll' && p.scrollWidth > p.clientWidth + 1) return p;
    }
    return null;
}

function remember(el: HTMLElement) {
    const row = rowOf(el);
    if (row) rowMemory.set(row, el);
}

/** Moving up or down into a row: the item it last had, if it's still there. */
function recalled(target: HTMLElement, current: Element | null): HTMLElement {
    const row = rowOf(target);
    if (!row || (current && row.contains(current))) return target;
    const last = rowMemory.get(row);
    return last && last.isConnected && visible(last) ? last : target;
}

/** The item to start from when nothing (or the page itself) has focus: top left. */
function first(list: { el: HTMLElement; r: DOMRect }[]) {
    // The window in the page's units (the TV app is zoomed).
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const onScreen = list.filter(({ r }) => r.bottom > 0 && r.top < innerHeight / zoom && r.right > 0 && r.left < innerWidth / zoom);
    // The page before the top bar (focus starts in the content, as on tvOS).
    const inBar = (el: HTMLElement) => (el.closest('header') ? 1 : 0);
    onScreen.sort((a, b) => inBar(a.el) - inBar(b.el) || a.r.top - b.r.top || a.r.left - b.r.left);
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
    // Reversing a vertical move goes back where you came from (as on tvOS).
    const key = rowOf(active!) ?? active!;
    const back = dir === 'up' ? cameFromAbove.get(key) : dir === 'down' ? cameFromBelow.get(key) : undefined;
    let next = back && back !== active && back.isConnected && visible(back) ? back : nearest(active!.getBoundingClientRect(), dir, list, active);
    if (next && next !== back && (dir === 'up' || dir === 'down')) next = recalled(next, active);
    if (next && (dir === 'up' || dir === 'down')) {
        const nextKey = rowOf(next) ?? next;
        (dir === 'down' ? cameFromAbove : cameFromBelow).set(nextKey, active!);
    }
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

/** Elements OK should click: not text fields or pickers, which open the TV's own. */
function clicksOnOk(el: HTMLElement) {
    if (el instanceof HTMLSelectElement || isTextField(el)) return false;
    // The player's video takes OK as play/pause.
    return !el.classList.contains('surface');
}

const isTextField = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
    el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].includes(el.type));

/** Read-only while focus passes through (keeps the TV's keyboard closed). */
function lock(el: HTMLInputElement | HTMLTextAreaElement) {
    el.readOnly = true;
    el.dataset.tvLocked = '';
}
function unlock(el: HTMLInputElement | HTMLTextAreaElement) {
    el.readOnly = false;
    delete el.dataset.tvLocked;
}

/** Keys the TV's on-screen keyboard sends when it closes. */
const KEYBOARD_DONE = 65376;
const KEYBOARD_CANCEL = 65385;

/**
 * Focus a page's main action when it opens (tvOS always has something
 * focused): an element marked data-tv-focus, else the first item in the main
 * content. Waits for content that's still loading; never takes focus away from
 * something the person already moved to.
 */
export function focusPrimary(root: ParentNode = document.querySelector('main') ?? document, takeOver = false) {
    // A dialog that's open has its own (it may have opened with this navigation).
    if (!takeOver && document.querySelector('dialog[open]')) return;
    const started = Date.now();
    const generation = ++primaryGeneration;
    /** What this call focused itself (it may still trade it for the marked one). */
    let ours: HTMLElement | null = null;
    const attempt = () => {
        if (generation !== primaryGeneration || pressedSince(started)) return;
        const active = document.activeElement;
        // Focus that only filled in for an item the page took away (stopgap)
        // gives way too.
        const free =
            takeOver || !active || active === document.body || !document.contains(active) || active === ours || active === stopgap;
        // Something already has focus (a tab in the top bar keeps it, as on tvOS).
        if (!free) return;
        const marked = [...root.querySelectorAll<HTMLElement>('[data-tv-focus]')].find((el) => visible(el));
        if (marked) {
            if (marked !== active) focusEl(marked);
            return;
        }
        // takeOver (a dialog) keeps the browser's pick until a marked one shows.
        if (!ours && !takeOver) {
            const el = first(candidates().filter(({ el }) => root.contains(el)));
            if (el) {
                focusEl(el);
                ours = el;
            }
        }
        // The main action may still be loading (the Home banner): keep looking.
        if (Date.now() - started < 4000) setTimeout(attempt, 250);
    };
    setTimeout(attempt, 150);
}

let primaryGeneration = 0;
/** Where focus last went because the focused item disappeared. */
let stopgap: Element | null = null;
let lastPress = 0;
const pressedSince = (t: number) => lastPress > t;

export function startRemote(opts: { atHome: () => boolean; back: () => void }) {
    document.documentElement.classList.add('tv');

    // A sheet or dialog opens on its main action (marked data-tv-focus, as a
    // page's is), not on whatever the browser picks (its Close button).
    new MutationObserver((records) => {
        for (const { target } of records) {
            if (target instanceof HTMLDialogElement && target.open) focusPrimary(target, true);
        }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });

    // Text fields: arriving by the arrows doesn't start typing (read-only keeps
    // the TV's keyboard closed); OK does. Focus the app gives a field itself
    // (opening search, say) types right away.
    // The focused item went away (the banner moved to its next title, a list
    // re-rendered): focus what's now in its place, so focus never vanishes.
    document.addEventListener('focusout', (e) => {
        const gone = e.target as HTMLElement;
        const rect = gone.getBoundingClientRect();
        const wasInBar = !!gone.closest('header');
        requestAnimationFrame(() => {
            if (gone.isConnected || (document.activeElement && document.activeElement !== document.body)) return;
            // In the player, the video itself takes focus (OK pauses, arrows seek).
            const video = document.querySelector<HTMLElement>('.player .surface');
            if (video) {
                video.focus({ preventScroll: true });
                return;
            }
            // From the page, stay in the page: while a new page is still
            // loading the top bar would be all that's left (the logo lit up);
            // its main action takes focus when it appears (focusPrimary).
            const list = candidates().filter(({ el }) => wasInBar || !el.closest('header'));
            if (!list.length) return;
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            let best = list[0];
            let bestD = Infinity;
            for (const c of list) {
                const d = Math.hypot(c.r.left + c.r.width / 2 - cx, c.r.top + c.r.height / 2 - cy);
                if (d < bestD) {
                    bestD = d;
                    best = c;
                }
            }
            movingFocus = true;
            best.el.focus({ preventScroll: true });
            movingFocus = false;
            stopgap = best.el;
        });
    });
    document.addEventListener('focusin', (e) => {
        const el = e.target as Element;
        if (isTextField(el) && movingFocus && !el.readOnly) lock(el);
        if (el instanceof HTMLElement) remember(el);
    });
    document.addEventListener('focusout', (e) => {
        const el = e.target as Element;
        if (isTextField(el) && el.dataset.tvLocked !== undefined) unlock(el);
    });
    try {
        for (const k of REGISTER) tizen()?.tvinputdevice?.registerKey(k);
    } catch {
        /* keys stay unregistered: the media keys just won't work */
    }

    window.addEventListener(
        'keydown',
        (e) => {
            lastPress = Date.now();
            stopgap = null;
            if (e.defaultPrevented) return;
            // The player owns the arrows while the video (not a control) has focus.
            const playerOnVideo =
                document.documentElement.classList.contains('player-active') &&
                (document.activeElement === document.body || document.activeElement?.classList.contains('surface'));

            const active = document.activeElement;

            // OK on a text field that isn't typing yet: start typing.
            if (e.key === 'Enter' && isTextField(active) && active.dataset.tvLocked !== undefined) {
                e.preventDefault();
                unlock(active);
                active.blur();
                active.focus();
                return;
            }
            // The TV's keyboard closed: arrows move focus again.
            if ((e.keyCode === KEYBOARD_DONE || e.keyCode === KEYBOARD_CANCEL) && isTextField(active) && !active.readOnly) {
                lock(active);
                return;
            }

            const dir = ARROWS[e.key];
            if (dir) {
                if (playerOnVideo) return;
                const el = document.activeElement;
                // A field being typed in keeps left/right for the cursor.
                if ((dir === 'left' || dir === 'right') && isTextField(el) && el.dataset.tvLocked === undefined && !el.readOnly) return;
                // Sliders keep left/right for their value.
                if ((dir === 'left' || dir === 'right') && ((el instanceof HTMLInputElement && el.type === 'range') || el?.getAttribute('role') === 'slider')) return;
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

    // OK clicks what has focus. The remote's OK sends a keydown and no
    // keypress, and buttons only click on keypress, so they'd do nothing. This
    // runs after the screens' own handlers: one that used OK itself (a menu
    // item, the player) has marked the event handled.
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.defaultPrevented || e.repeat) return;
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || active === document.body || !clicksOnOk(active)) return;
        e.preventDefault();
        active.click();
    });
}
