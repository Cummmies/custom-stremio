// Home banner preview: hovering (or focusing) a title card shows that title in
// the banner; moving off the cards goes back to the banner's own cycle. Moving
// from a card up onto the banner keeps the preview, so its buttons can be used.
import type { MetaItemPreview } from '$lib/core/types';

const ENTER_MS = 180; // brief, so sweeping the mouse across a row doesn't flicker the banner
const LEAVE_MS = 600; // time to move from a card up onto the banner

class HeroPreview {
    item = $state<MetaItemPreview | null>(null);
    #enter: ReturnType<typeof setTimeout> | undefined;
    #leave: ReturnType<typeof setTimeout> | undefined;
    #held = false;

    show(item: MetaItemPreview) {
        clearTimeout(this.#leave);
        clearTimeout(this.#enter);
        this.#enter = setTimeout(() => (this.item = item), this.item ? 0 : ENTER_MS);
    }

    hide() {
        clearTimeout(this.#enter);
        clearTimeout(this.#leave);
        this.#leave = setTimeout(() => {
            if (!this.#held) this.item = null;
        }, LEAVE_MS);
    }

    /** The pointer is on the banner itself: keep what it shows. */
    hold(on: boolean) {
        this.#held = on;
        if (on) clearTimeout(this.#leave);
        else if (this.item) this.hide();
    }

    clear() {
        clearTimeout(this.#enter);
        clearTimeout(this.#leave);
        this.#held = false;
        this.item = null;
    }
}

export const heroPreview = new HeroPreview();

/** `use:previewInHero={item}` on a title card. */
export function previewInHero(node: HTMLElement, item: MetaItemPreview) {
    let current = item;
    const enter = (e: PointerEvent) => e.pointerType === 'mouse' && heroPreview.show(current);
    const leave = (e: PointerEvent) => e.pointerType === 'mouse' && heroPreview.hide();
    const focus = () => heroPreview.show(current);
    const blur = () => heroPreview.hide();
    node.addEventListener('pointerenter', enter);
    node.addEventListener('pointerleave', leave);
    node.addEventListener('focusin', focus);
    node.addEventListener('focusout', blur);
    return {
        update(next: MetaItemPreview) {
            current = next;
        },
        destroy() {
            node.removeEventListener('pointerenter', enter);
            node.removeEventListener('pointerleave', leave);
            node.removeEventListener('focusin', focus);
            node.removeEventListener('focusout', blur);
        },
    };
}
