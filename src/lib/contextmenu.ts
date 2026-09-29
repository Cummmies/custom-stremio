// Replaces the browser's right-click menu with app menus that fit what was clicked:
// a title, a text field, selected text, a link, or empty space.
import { goto } from '$app/navigation';
import { app } from '$lib/app.svelte';
import { titleHref } from '$lib/links';
import { menu, type MenuEntry } from '$lib/menu.svelte';

export type TitleRef = {
    type: string;
    id: string;
    name: string;
    /** Full preview, needed to add to the library. */
    preview?: object;
};

const titles = new WeakMap<Element, TitleRef>();

/** Svelte action: `use:titleContext={item}` gives an element the title right-click menu. */
export function titleContext(node: HTMLElement, ref: TitleRef) {
    titles.set(node, ref);
    return {
        update: (next: TitleRef) => titles.set(node, next),
        destroy: () => titles.delete(node),
    };
}

function titleEntries(t: TitleRef): MenuEntry[] {
    const saved = app.inLibrary(t.id);
    return [
        { header: t.name, detail: t.type === 'series' ? 'Series' : t.type === 'movie' ? 'Movie' : t.type },
        { label: 'Open', icon: 'info', onselect: () => goto(titleHref(t.type, t.id)) },
        { label: 'Show Sources', icon: 'play', onselect: () => goto(titleHref(t.type, t.id, { play: '1' })) },
        { separator: true },
        saved
            ? { label: 'Remove from Library', icon: 'check', onselect: () => app.removeFromLibrary(t.id) }
            : {
                  label: 'Add to Library',
                  icon: 'plus',
                  disabled: !t.preview,
                  onselect: () => t.preview && app.addToLibrary(t.preview),
              },
        { label: 'Copy Title', onselect: () => navigator.clipboard.writeText(t.name) },
    ];
}

function fieldEntries(field: HTMLInputElement | HTMLTextAreaElement): MenuEntry[] {
    const hasSelection = (field.selectionStart ?? 0) !== (field.selectionEnd ?? 0);
    const readOnly = field.readOnly || field.disabled;
    const secret = field.type === 'password';
    const selected = () => field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0);

    // execCommand('insertText') keeps the field's undo history intact.
    const insert = (text: string) => {
        field.focus();
        document.execCommand('insertText', false, text);
    };

    return [
        {
            label: 'Cut',
            shortcut: 'Ctrl+X',
            disabled: !hasSelection || readOnly || secret,
            onselect: async () => {
                await navigator.clipboard.writeText(selected());
                insert('');
            },
        },
        {
            label: 'Copy',
            shortcut: 'Ctrl+C',
            disabled: !hasSelection || secret,
            onselect: () => navigator.clipboard.writeText(selected()),
        },
        {
            label: 'Paste',
            shortcut: 'Ctrl+V',
            disabled: readOnly,
            onselect: async () => {
                try {
                    insert(await navigator.clipboard.readText());
                } catch {
                    field.focus();
                }
            },
        },
        { separator: true },
        {
            label: 'Select All',
            shortcut: 'Ctrl+A',
            disabled: !field.value,
            onselect: () => {
                field.focus();
                field.select();
            },
        },
    ];
}

function selectionEntries(text: string): MenuEntry[] {
    const short = text.length > 24 ? `${text.slice(0, 24)}…` : text;
    return [
        { label: 'Copy', shortcut: 'Ctrl+C', onselect: () => navigator.clipboard.writeText(text) },
        { label: `Search for “${short}”`, icon: 'search', onselect: () => goto(`/search?q=${encodeURIComponent(text)}`) },
    ];
}

function pageEntries(): MenuEntry[] {
    return [
        { label: 'Back', icon: 'back', shortcut: 'Alt+←', disabled: history.length <= 1, onselect: () => history.back() },
        { label: 'Forward', shortcut: 'Alt+→', onselect: () => history.forward() },
        { label: 'Reload', shortcut: 'Ctrl+R', onselect: () => location.reload() },
    ];
}

function entriesFor(target: Element): MenuEntry[] | null {
    const field = target.closest('input, textarea');
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        const textual = !(field instanceof HTMLInputElement) || /^(text|search|email|password|url|tel|number)$/.test(field.type);
        return textual ? fieldEntries(field) : null;
    }

    const text = getSelection()?.toString().trim();
    if (text) return selectionEntries(text);

    for (let el: Element | null = target; el; el = el.parentElement) {
        const ref = titles.get(el);
        if (ref) return titleEntries(ref);
    }

    // Controls with their own behavior (buttons, links, menus) get no generic menu.
    if (target.closest('button, a, [role="menu"], [role="menuitem"], dialog, select')) return null;
    return pageEntries();
}

export function installContextMenu() {
    const open = (target: Element, x: number, y: number) => {
        const entries = entriesFor(target);
        if (entries) menu.show(entries, { x, y });
        else menu.close(false);
    };

    const onContextMenu = (e: MouseEvent) => {
        // Keep the native menu inside iframes (e.g. the trailer player) — we can't reach them anyway.
        e.preventDefault();
        if (!(e.target instanceof Element)) return;
        // Keyboard-invoked (Menu key / Shift+F10) events arrive at 0,0: anchor to the focused element.
        if (e.button !== 2 && e.clientX === 0 && e.clientY === 0 && document.activeElement instanceof HTMLElement) {
            const r = document.activeElement.getBoundingClientRect();
            open(document.activeElement, r.left + 12, r.top + Math.min(r.height, 28));
        } else {
            open(e.target, e.clientX, e.clientY);
        }
    };

    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
}
