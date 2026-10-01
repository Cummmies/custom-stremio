// Home banner preview: hovering (or focusing) a title card shows that title in
// the banner; moving off the cards goes back to the banner's own cycle. Moving
// from a card up onto the banner keeps the preview, so its buttons can be used.
import type { MetaItemPreview } from '$lib/core/types';
import { isTV } from '$lib/platform';

const ENTER_MS = 180; // brief, so sweeping the mouse across a row doesn't flicker the banner
const LEAVE_MS = 600; // time to move from a card up onto the banner
const TV_SETTLE_MS = 450;

// Continue Watching and Library cards only know a title's name and poster, so
// the rest (description, year, runtime, rating, genres) is fetched once from
// Cinemeta and remembered for the session.
const details = new Map<string, Promise<Partial<MetaItemPreview> | null>>();

/** A card or catalog entry that's missing what the banner shows. */
export function needsDetails(item: MetaItemPreview) {
    return !item.description || !item.imdbRating || !item.genres?.length;
}

export function fetchDetails(item: MetaItemPreview): Promise<Partial<MetaItemPreview> | null> {
    const key = `${item.type}/${item.id}`;
    let p = details.get(key);
    if (!p) {
        p = /^tt\d+$/.test(item.id)
            ? fetch(`https://v3-cinemeta.strem.io/meta/${item.type}/${item.id}.json`)
                  .then((r) => (r.ok ? r.json() : null))
                  .then((j) => {
                      const m = j?.meta;
                      if (!m) return null;
                      return {
                          description: m.description ?? null,
                          releaseInfo: m.releaseInfo ?? m.year ?? null,
                          runtime: m.runtime ?? null,
                          imdbRating: m.imdbRating ?? null,
                          genres: m.genres ?? m.genre ?? undefined,
                          logo: m.logo ?? null,
                          background: m.background ?? null,
                      };
                  })
                  .catch(() => null)
            : Promise.resolve(null);
        details.set(key, p);
    }
    return p;
}

/** Fill in whatever the card didn't have, keeping what it did. */
export function merge(item: MetaItemPreview, extra: Partial<MetaItemPreview>): MetaItemPreview {
    const out = { ...item } as Record<string, unknown>;
    for (const [k, v] of Object.entries(extra)) if (v != null && (out[k] == null || out[k] === '')) out[k] = v;
    return out as MetaItemPreview;
}

class HeroPreview {
    item = $state<MetaItemPreview | null>(null);
    #enter: ReturnType<typeof setTimeout> | undefined;
    #leave: ReturnType<typeof setTimeout> | undefined;
    #held = false;

    show(item: MetaItemPreview) {
        clearTimeout(this.#leave);
        clearTimeout(this.#enter);
        // TV: moving along a row with the remote shouldn't redraw the banner at
        // every step, only where focus settles.
        this.#enter = setTimeout(() => (this.item = item), isTV ? TV_SETTLE_MS : this.item ? 0 : ENTER_MS);
        if (needsDetails(item)) {
            fetchDetails(item).then((extra) => {
                if (extra && this.item?.id === item.id) this.item = merge(this.item, extra);
                // Also when the fetch beats the enter delay.
                else if (extra) item = merge(item, extra);
            });
        }
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
