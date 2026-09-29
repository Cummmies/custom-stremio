// One menu system for the whole app: right-click menus, the account menu and
// every pop-up picker render through <MenuHost>, so they all look and behave alike.
import type { IconName } from '$lib/components/Icon.svelte';

export type MenuAction = {
    label: string;
    icon?: IconName;
    shortcut?: string;
    checked?: boolean;
    disabled?: boolean;
    destructive?: boolean;
    onselect?: () => void;
    submenu?: MenuEntry[];
};
export type MenuEntry = MenuAction | { separator: true } | { header: string; detail?: string };

export const isAction = (e: MenuEntry): e is MenuAction => 'label' in e;

type Anchor = { x: number; y: number } | { element: HTMLElement; align?: 'start' | 'end' };

class MenuState {
    open = $state(false);
    entries = $state<MenuEntry[]>([]);
    x = $state(0);
    y = $state(0);
    /** Where the menu should grow from when anchored to a control. */
    anchorRect = $state<DOMRect | null>(null);
    align = $state<'start' | 'end'>('start');
    minWidth = $state(0);
    /** Bumped on every show() so the host re-mounts, re-measures and refocuses. */
    generation = $state(0);
    #returnFocus: HTMLElement | null = null;
    #invoker: HTMLElement | null = null;

    show(entries: MenuEntry[], anchor: Anchor) {
        this.#returnFocus = document.activeElement as HTMLElement | null;
        this.#invoker?.setAttribute('aria-expanded', 'false');
        this.#invoker = null;
        if ('element' in anchor) {
            const rect = anchor.element.getBoundingClientRect();
            this.anchorRect = rect;
            this.align = anchor.align ?? 'start';
            this.x = this.align === 'end' ? rect.right : rect.left;
            this.y = rect.bottom + 6;
            this.minWidth = rect.width;
            this.#invoker = anchor.element;
            anchor.element.setAttribute('aria-expanded', 'true');
        } else {
            this.anchorRect = null;
            this.align = 'start';
            this.x = anchor.x;
            this.y = anchor.y;
            this.minWidth = 0;
        }
        this.entries = entries;
        this.generation++;
        this.open = true;
    }

    close(restoreFocus = true) {
        if (!this.open) return;
        this.open = false;
        this.#invoker?.setAttribute('aria-expanded', 'false');
        if (restoreFocus) this.#returnFocus?.focus?.({ preventScroll: true });
        this.#invoker = null;
    }

    /** Toggle a menu anchored to a button (clicking the button again closes it). */
    toggleFor(element: HTMLElement, entries: MenuEntry[], align: 'start' | 'end' = 'start') {
        if (this.open && this.#invoker === element) this.close();
        else this.show(entries, { element, align });
    }
}

export const menu = new MenuState();
