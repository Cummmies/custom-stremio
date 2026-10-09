// The sliding highlight of a pill of choices (the top nav's sections, the
// Library's status bar), after Lightboxd's: the highlight glides to the chosen
// item with a little overshoot, and can be dragged from the chosen item to
// another (stretching at the ends), which picks it on release.
//
// The highlight is a <span class="glider"> the action puts first in the
// container, under the items; the screen styles it (`:global(.glider)`) as
// its chosen item looked, and stops styling the chosen item's background once
// the container has `.glides` (before the action runs, it looks as it did).
// While dragging, `onhover` says which item the highlight is over (null when
// done), so the screen can show that one as chosen.
//
// The labels' color under the highlight: a copy of the items (`.glider-text`,
// over them, hidden from the remote and screen readers) cut to the
// highlight's shape, so a label half under it is half recolored. The screen
// colors that copy's items (`:global(.glider-text) a { color: … }`).

import type { Action } from 'svelte/action';

export type SliderParams = {
    /** The chosen item (an index into the container's items), or -1 for none. */
    active: number;
    /** The items: the container's children matching this (default: a, button). */
    items?: string;
    /** Dragged onto an item and let go. */
    onpick?: (index: number) => void;
    /** The item the highlight is over while dragging; null once it's let go. */
    onhover?: (index: number | null) => void;
};

const EASE = 'cubic-bezier(0.2, 0.9, 0.3, 1.2)';
const MS = 280;
/** How far past the ends a drag can stretch, and how stiffly. */
const ELASTIC = (overflow: number) => (overflow * 180 * 0.38) / (180 + 0.38 * overflow);

export const slider: Action<HTMLElement, SliderParams> = (node, initial) => {
    let params = initial;
    const glider = document.createElement('span');
    glider.className = 'glider';
    glider.setAttribute('aria-hidden', 'true');
    node.prepend(glider);
    const layer = document.createElement('div');
    layer.className = 'glider-text';
    layer.setAttribute('aria-hidden', 'true');
    layer.inert = true;
    node.append(layer);
    node.classList.add('glides');
    if (getComputedStyle(node).position === 'static') node.style.position = 'relative';

    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const items = () => [...node.querySelectorAll<HTMLElement>(`:scope > :is(${params.items ?? 'a, button'})`)];
    // Offsets, not screen positions: right in a container that scrolls sideways.
    const box = (el: HTMLElement) => ({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });

    /** The copy of the items, laid out as they are (it's redone when they change). */
    function copy() {
        const cs = getComputedStyle(node);
        Object.assign(layer.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            bottom: '0',
            // A bar that scrolls: as wide as all of it.
            width: `${node.scrollWidth}px`,
            boxSizing: 'border-box',
            display: cs.display,
            alignItems: cs.alignItems,
            justifyContent: cs.justifyContent,
            gap: cs.gap,
            padding: cs.padding,
            zIndex: '2',
            pointerEvents: 'none',
        });
        layer.replaceChildren(
            ...items().map((el) => {
                const c = el.cloneNode(true) as HTMLElement;
                c.removeAttribute('href');
                c.removeAttribute('id');
                c.removeAttribute('aria-current');
                c.tabIndex = -1;
                return c;
            })
        );
    }

    let at = { left: 0, width: 0, top: 0, height: 0 };
    function place(left: number, width: number, animate: boolean, top?: number, height?: number) {
        const motion = animate && !reduced.matches;
        glider.style.transition = motion ? `transform ${MS}ms ${EASE}, width ${MS}ms ${EASE}` : 'none';
        glider.style.transform = `translate3d(${left}px, 0, 0)`;
        glider.style.width = `${width}px`;
        if (top != null) glider.style.top = `${top}px`;
        if (height != null) glider.style.height = `${height}px`;
        at = { left, width, top: top ?? at.top, height: height ?? at.height };
        // The recolored labels: only what's under the highlight, moving with it.
        const radius = getComputedStyle(glider).borderTopLeftRadius;
        const right = Math.max(0, layer.offsetWidth - left - width);
        const bottom = Math.max(0, layer.offsetHeight - at.top - at.height);
        layer.style.transition = motion ? `clip-path ${MS}ms ${EASE}` : 'none';
        layer.style.clipPath = `inset(${at.top}px ${right}px ${bottom}px ${left}px round ${radius})`;
    }

    let shown = false;
    function update(animate: boolean) {
        const el = items()[params.active];
        glider.style.opacity = el ? '' : '0';
        layer.style.opacity = el ? '' : '0';
        if (!el) return;
        const b = box(el);
        // The first placement (and one after being hidden) doesn't slide in from 0.
        place(b.left, b.width, animate && shown, b.top, b.height);
        shown = true;
        // A bar that scrolls sideways (phones) brings the chosen item into view.
        if (node.scrollWidth > node.clientWidth) {
            const pad = 12;
            const to =
                b.left < node.scrollLeft + pad
                    ? b.left - pad
                    : b.left + b.width > node.scrollLeft + node.clientWidth - pad
                      ? b.left + b.width - node.clientWidth + pad
                      : null;
            if (to != null) node.scrollTo({ left: to, behavior: animate && !reduced.matches ? 'smooth' : 'auto' });
        }
    }

    // --- Dragging ---
    let down: { x: number; y: number; left: number; width: number } | null = null;
    let dragging = false;
    let over = -1;
    let swallowClick = false;

    function frame(x: number) {
        const list = items().map(box);
        if (!down || !list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        const rawLeft = down.left + (x - down.x);
        const centre = rawLeft + down.width / 2;
        let left = rawLeft;
        let width = down.width;
        let target = 0;
        if (centre <= first.left + first.width / 2) {
            width = first.width;
            target = 0;
            if (rawLeft < first.left) left = first.left - ELASTIC(first.left - rawLeft);
        } else if (centre >= last.left + last.width / 2) {
            width = last.width;
            target = list.length - 1;
            if (rawLeft > last.left) left = last.left + ELASTIC(rawLeft - last.left);
        } else {
            for (let i = 0; i < list.length - 1; i++) {
                const a = list[i].left + list[i].width / 2;
                const b = list[i + 1].left + list[i + 1].width / 2;
                if (centre >= a && centre <= b) {
                    const t = (centre - a) / (b - a);
                    const smooth = t * t * (3 - 2 * t);
                    width = list[i].width + (list[i + 1].width - list[i].width) * smooth;
                    target = t < 0.5 ? i : i + 1;
                    break;
                }
            }
        }
        place(left, width, false);
        if (target !== over) {
            over = target;
            params.onhover?.(target);
        }
    }

    function onpointerdown(e: PointerEvent) {
        if (e.button !== 0 || !params.onpick) return;
        const chosen = items()[params.active];
        // Only the chosen item (the highlight) is dragged; the others are tapped.
        if (!chosen?.contains(e.target as Node)) return;
        const b = box(chosen);
        down = { x: e.clientX, y: e.clientY, left: b.left, width: b.width };
        dragging = false;
        over = params.active;
    }
    function onpointermove(e: PointerEvent) {
        if (!down) return;
        if (!dragging) {
            if (Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 3) return;
            dragging = true;
            node.classList.add('dragging');
        }
        e.preventDefault();
        frame(e.clientX);
    }
    function finish(pick: boolean) {
        if (!down) return;
        const was = dragging;
        down = null;
        dragging = false;
        node.classList.remove('dragging');
        if (!was) return;
        // The click that ends a drag isn't a tap on what's under it.
        swallowClick = true;
        setTimeout(() => (swallowClick = false), 0);
        params.onhover?.(null);
        if (pick && over !== params.active && over >= 0) params.onpick?.(over);
        update(true);
    }
    const onpointerup = () => finish(true);
    const onpointercancel = () => finish(false);
    function onclick(e: MouseEvent) {
        if (!swallowClick) return;
        swallowClick = false;
        e.preventDefault();
        e.stopPropagation();
    }
    // Keeps a drag from also dragging the link (or selecting text).
    function ondragstart(e: DragEvent) {
        if (down) e.preventDefault();
    }

    node.addEventListener('pointerdown', onpointerdown);
    node.addEventListener('click', onclick, true);
    node.addEventListener('dragstart', ondragstart);
    window.addEventListener('pointermove', onpointermove, { passive: false });
    window.addEventListener('pointerup', onpointerup);
    window.addEventListener('pointercancel', onpointercancel);

    // Sizes change (fonts load, the window resizes, labels change): follow without sliding.
    const resize = new ResizeObserver(() => {
        copy();
        if (!dragging) update(false);
    });
    resize.observe(node);
    for (const el of items()) resize.observe(el);
    // (Not the copy's own changes, nor the highlight's.)
    const changes = new MutationObserver((list) => {
        if (list.some((m) => (m.target === node ? m.type === 'childList' : !layer.contains(m.target) && m.target !== glider))) copy();
    });
    changes.observe(node, { subtree: true, attributes: true, attributeFilter: ['class'], characterData: true, childList: true });

    copy();
    update(false);

    return {
        update(next) {
            const moved = next.active !== params.active;
            params = next;
            if (!dragging) update(moved);
        },
        destroy() {
            resize.disconnect();
            changes.disconnect();
            layer.remove();
            node.removeEventListener('pointerdown', onpointerdown);
            node.removeEventListener('click', onclick, true);
            node.removeEventListener('dragstart', ondragstart);
            window.removeEventListener('pointermove', onpointermove);
            window.removeEventListener('pointerup', onpointerup);
            window.removeEventListener('pointercancel', onpointercancel);
            glider.remove();
            node.classList.remove('glides', 'dragging');
        },
    };
};
