<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { isAction, type MenuAction, type MenuEntry } from '$lib/menu.svelte';
    import Icon from '../Icon.svelte';
    import MenuList from './MenuList.svelte';

    let {
        entries,
        x,
        y,
        anchorRect = null,
        align = 'start',
        minWidth = 0,
        level = 0,
        onclose,
        onback,
    }: {
        entries: MenuEntry[];
        x: number;
        y: number;
        anchorRect?: DOMRect | null;
        align?: 'start' | 'end';
        minWidth?: number;
        level?: number;
        /** Close the whole menu tree. */
        onclose: (restoreFocus?: boolean) => void;
        /** Close just this submenu and return to the parent. */
        onback?: () => void;
    } = $props();

    let el = $state<HTMLElement>();
    let left = $state(-9999);
    let top = $state(-9999);
    let sub = $state<{ index: number; x: number; y: number; parentRect: DOMRect } | null>(null);
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;

    const items = () => [...(el?.querySelectorAll<HTMLElement>(':scope > [role^="menuitem"]:not([aria-disabled="true"])') ?? [])];

    // Place the menu, flipping it to stay fully inside the window.
    onMount(async () => {
        await tick();
        if (!el) return;
        // Top layer, so menus also appear above open dialogs (which live there too).
        el.showPopover?.();
        // Layout size, unaffected by the opening scale animation.
        const width = el.offsetWidth;
        const height = el.offsetHeight;
        const vw = innerWidth;
        const vh = innerHeight;
        const pad = 8;

        let l = align === 'end' ? x - width : x;
        if (level > 0 && l + width > vw - pad && anchorRect) l = anchorRect.left - width + 4;
        let t = y;
        if (t + height > vh - pad) t = anchorRect && level === 0 ? anchorRect.top - height - 6 : vh - height - pad;

        left = Math.max(pad, Math.min(l, vw - width - pad));
        top = Math.max(pad, t);
        items()[0]?.focus({ preventScroll: true });
    });

    function openSub(index: number, target: HTMLElement) {
        if (sub?.index === index) return;
        const rect = target.getBoundingClientRect();
        sub = { index, x: rect.right - 4, y: rect.top - 5, parentRect: rect };
    }

    function activate(entry: MenuAction, index: number, target: HTMLElement) {
        if (entry.disabled) return;
        if (entry.submenu) {
            openSub(index, target);
            return;
        }
        onclose(true);
        entry.onselect?.();
    }

    function onkeydown(e: KeyboardEvent) {
        const list = items();
        const current = list.indexOf(document.activeElement as HTMLElement);
        const move = (i: number) => list[(i + list.length) % list.length]?.focus();

        switch (e.key) {
            case 'ArrowDown':
                move(current + 1);
                break;
            case 'ArrowUp':
                move(current - 1);
                break;
            case 'Home':
                move(0);
                break;
            case 'End':
                move(list.length - 1);
                break;
            case 'ArrowRight': {
                const target = document.activeElement as HTMLElement;
                const idx = Number(target?.dataset.index);
                const entry = entries[idx];
                if (entry && isAction(entry) && entry.submenu) openSub(idx, target);
                else return;
                break;
            }
            case 'ArrowLeft':
                if (level > 0) onback?.();
                else return;
                break;
            case 'Escape':
                if (level > 0) onback?.();
                else onclose();
                break;
            case 'Tab':
                onclose();
                break;
            default:
                // Type-ahead: jump to the next item starting with the typed letter.
                if (e.key.length === 1 && /\S/.test(e.key)) {
                    const start = current + 1;
                    const order = [...list.slice(start), ...list.slice(0, start)];
                    order.find((n) => n.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()))?.focus();
                    break;
                }
                return;
        }
        e.preventDefault();
        e.stopPropagation();
    }
</script>

<div
    bind:this={el}
    class="menu"
    role="menu"
    tabindex="-1"
    popover="manual"
    style:left="{left}px"
    style:top="{top}px"
    style:min-width="{Math.max(minWidth, 200)}px"
    data-menu
    {onkeydown}
>
    {#each entries as entry, i}
        {#if 'separator' in entry}
            <div class="separator" role="separator"></div>
        {:else if 'header' in entry}
            <div class="header" role="presentation">
                <span class="header-title">{entry.header}</span>
                {#if entry.detail}<span class="header-detail">{entry.detail}</span>{/if}
            </div>
        {:else}
            <div
                class="item"
                class:destructive={entry.destructive}
                class:open={sub?.index === i}
                role={entry.checked !== undefined ? 'menuitemradio' : 'menuitem'}
                aria-checked={entry.checked}
                aria-disabled={entry.disabled || undefined}
                aria-haspopup={entry.submenu ? 'menu' : undefined}
                aria-expanded={entry.submenu ? sub?.index === i : undefined}
                tabindex="-1"
                data-index={i}
                onclick={(e) => activate(entry, i, e.currentTarget)}
                onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        activate(entry, i, e.currentTarget);
                    }
                }}
                onmouseenter={(e) => {
                    const target = e.currentTarget;
                    target.focus({ preventScroll: true });
                    clearTimeout(hoverTimer);
                    if (entry.submenu && !entry.disabled) {
                        hoverTimer = setTimeout(() => openSub(i, target), 120);
                    } else if (sub) {
                        hoverTimer = setTimeout(() => (sub = null), 200);
                    }
                }}
            >
                <span class="check" aria-hidden="true">
                    {#if entry.checked}<Icon name="check" size={14} />{:else if entry.icon}<Icon name={entry.icon} size={15} />{/if}
                </span>
                <span class="label">{entry.label}</span>
                {#if entry.shortcut}<kbd>{entry.shortcut}</kbd>{/if}
                {#if entry.submenu}<span class="chev" aria-hidden="true"><Icon name="chevronRight" size={13} /></span>{/if}
            </div>
        {/if}
    {/each}
</div>

{#if sub}
    {@const parent = entries[sub.index]}
    {#if isAction(parent) && parent.submenu}
        <!-- Keyed so each submenu mounts fresh and measures/positions itself. -->
        {#key sub.index}
        <MenuList
            entries={parent.submenu}
            x={sub.x}
            y={sub.y}
            anchorRect={sub.parentRect}
            level={level + 1}
            {onclose}
            onback={() => {
                const idx = sub?.index;
                sub = null;
                el?.querySelector<HTMLElement>(`[data-index="${idx}"]`)?.focus();
            }}
        />
        {/key}
    {/if}
{/if}

<style>
    .menu {
        position: fixed;
        inset: auto;
        margin: 0;
        z-index: 1000;
        max-width: 320px;
        max-height: calc(100vh - 16px);
        overflow-y: auto;
        padding: 5px;
        border-radius: 12px;
        background: rgb(31 31 40 / 0.86);
        backdrop-filter: blur(28px) saturate(1.5);
        -webkit-backdrop-filter: blur(28px) saturate(1.5);
        border: 1px solid rgb(255 255 255 / 0.1);
        box-shadow:
            0 0 0 0.5px rgb(0 0 0 / 0.6),
            0 18px 48px rgb(0 0 0 / 0.55);
        color: var(--label);
        font-size: 13px;
        outline: none;
        animation: pop 120ms var(--ease);
        transform-origin: top left;
        user-select: none;
    }
    @keyframes pop {
        from {
            opacity: 0;
            transform: scale(0.97);
        }
    }
    @media (prefers-reduced-transparency: reduce) {
        .menu {
            background: var(--elevated-2);
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .menu {
            animation: none;
        }
    }
    .item {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 30px;
        padding: 0 10px 0 6px;
        border-radius: 7px;
        cursor: default;
        outline: none;
        white-space: nowrap;
    }
    .item:focus,
    .item.open {
        background: var(--accent);
        color: white;
    }
    .item[aria-disabled='true'] {
        color: var(--label-3);
    }
    .item[aria-disabled='true']:focus {
        background: transparent;
    }
    .item.destructive {
        color: #ff6961;
    }
    .item.destructive:focus {
        background: var(--bad);
        color: white;
    }
    .check {
        width: 18px;
        display: grid;
        place-items: center;
        flex: none;
        opacity: 0.9;
    }
    .label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    kbd {
        margin-left: 18px;
        font-family: var(--font);
        font-size: 12px;
        color: var(--label-2);
    }
    .item:focus kbd {
        color: rgb(255 255 255 / 0.8);
    }
    .chev {
        display: grid;
        margin-right: -4px;
        opacity: 0.7;
    }
    .separator {
        height: 1px;
        margin: 5px 8px;
        background: rgb(255 255 255 / 0.1);
    }
    .header {
        display: flex;
        flex-direction: column;
        padding: 8px 10px 6px;
    }
    .header-title {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .header-detail {
        font-size: var(--text-caption);
        color: var(--label-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
