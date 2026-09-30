<script lang="ts">
    // Customize Home: reorder, hide, rename and merge Home's rows (per profile).
    // An edit mode like iOS's "Edit Home Screen": changes apply as you make them,
    // anything removed can be undone from the toast, and Done goes back to Home.
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { core } from '$lib/core';
    import type { Board } from '$lib/core/types';
    import { menu, type MenuEntry } from '$lib/menu.svelte';
    import { catalogKey, homeLayout, type BoardCatalog, type ResolvedRow } from '$lib/homeLayout.svelte';
    import { catalogTitle } from '$lib/components/CatalogList.svelte';
    import Icon from '$lib/components/Icon.svelte';

    let board = $state<Board | null>(null);
    onMount(() => {
        const off = core.watch<Board>('board', (s) => (board = s));
        core.dispatch({ action: 'Load', args: { model: 'CatalogsWithExtra', args: { extra: [] } } }, 'board');
        return () => {
            off();
            core.dispatch({ action: 'Unload' }, 'board');
        };
    });

    $effect(() => homeLayout.sync());

    const catalogs = $derived((board?.catalogs ?? []) as BoardCatalog[]);
    const byKey = $derived(new Map(catalogs.map((c) => [catalogKey(c), c])));
    const rows = $derived(homeLayout.resolve(catalogs, new Map(catalogs.map((c) => [catalogKey(c), catalogTitle(c)]))));
    const shown = $derived(rows.filter((r) => !r.hidden));
    const hidden = $derived(rows.filter((r) => r.hidden));

    /** "Cinemeta · Movie" for each catalog a row draws from. */
    function sources(r: ResolvedRow): string[] {
        if (r.kind === 'special') return ['Built in'];
        return r.parts.map((p) => {
            const c = byKey.get(p);
            const type = c?.type ? c.type.charAt(0).toUpperCase() + c.type.slice(1) : '';
            return [c?.addon?.manifest?.name, type].filter(Boolean).join(' · ');
        });
    }

    // --- Rename (inline) ---------------------------------------------------------
    let renaming = $state<string | null>(null);
    let draftName = $state('');
    function startRename(r: ResolvedRow) {
        renaming = r.key;
        draftName = r.name;
    }
    function finishRename(save: boolean) {
        if (renaming && save) homeLayout.rename(rows, renaming, draftName);
        renaming = null;
    }
    function focusSelect(node: HTMLInputElement) {
        node.focus();
        node.select();
    }

    // --- Row menu ------------------------------------------------------------------
    function rowMenu(e: MouseEvent, r: ResolvedRow) {
        const i = rows.indexOf(r);
        const list = r.hidden ? hidden : shown;
        const j = list.indexOf(r);
        const entries: MenuEntry[] = [];
        if (r.kind !== 'special') entries.push({ label: 'Rename…', icon: 'pencil', onselect: () => startRename(r) });
        entries.push(
            { label: 'Move Up', disabled: j <= 0, onselect: () => homeLayout.move(rows, i, rows.indexOf(list[j - 1])) },
            { label: 'Move Down', disabled: j >= list.length - 1, onselect: () => homeLayout.move(rows, i, rows.indexOf(list[j + 1])) }
        );
        if (r.kind !== 'special') {
            entries.push({ separator: true }, { label: 'Merge With…', icon: 'merge', onselect: () => startSelect(r.key) });
        }
        if (r.kind === 'merge') entries.push({ label: 'Unmerge', onselect: () => homeLayout.unmerge(rows, r.key) });
        entries.push({ separator: true }, {
            label: r.hidden ? 'Show on Home' : 'Hide from Home',
            icon: r.hidden ? 'eye' : 'eyeOff',
            onselect: () => homeLayout.setHidden(rows, r.key, !r.hidden),
        });
        menu.toggleFor(e.currentTarget as HTMLElement, entries, 'end');
    }

    function pageMenu(e: MouseEvent) {
        menu.toggleFor(
            e.currentTarget as HTMLElement,
            [{ label: 'Reset Home to Default', destructive: true, onselect: () => homeLayout.reset() }],
            'end'
        );
    }

    // --- Select & merge ----------------------------------------------------------------
    let selecting = $state(false);
    let selected = $state<string[]>([]);
    function startSelect(first?: string) {
        selecting = true;
        selected = first ? [first] : [];
    }
    function toggleSelected(key: string) {
        selected = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    }
    function stopSelect() {
        selecting = false;
        selected = [];
    }

    let merging = $state(false);
    let mergeName = $state('');
    let mergeDialog = $state<HTMLDialogElement>();
    const mergeRows = $derived(rows.filter((r) => selected.includes(r.key)));
    /** "Popular · Movie" + "Popular · Series" → "Popular". */
    function commonName(list: ResolvedRow[]) {
        const firsts = list.map((r) => r.name.split(' · ')[0]);
        return firsts.every((f) => f === firsts[0]) ? firsts[0] : list[0]?.name ?? '';
    }
    function openMerge() {
        mergeName = commonName(mergeRows);
        merging = true;
    }
    $effect(() => {
        if (merging) mergeDialog?.showModal();
    });
    function confirmMerge(e: SubmitEvent) {
        e.preventDefault();
        homeLayout.merge(rows, selected, mergeName);
        mergeDialog?.close();
        stopSelect();
    }

    // --- Drag to reorder -------------------------------------------------------------
    // The drop position comes from where the pointer is against the middle of the
    // other rows in the same list (shown or hidden), so the row follows smoothly.
    let dragKey = $state<string | null>(null);
    /** Where the dragged row would land, counting the other rows of its list. */
    let dropIndex = $state<number | null>(null);
    const dragged = $derived(rows.find((r) => r.key === dragKey) ?? null);

    function dragStart(e: PointerEvent, r: ResolvedRow) {
        if (e.button !== 0) return;
        dragKey = r.key;
        const list = r.hidden ? hidden : shown;
        dropIndex = list.indexOf(r);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    function dragMove(e: PointerEvent) {
        if (!dragged) return;
        const others = [...document.querySelectorAll<HTMLElement>(`[data-list="${dragged.hidden ? 'hidden' : 'shown'}"] > [data-row]`)].filter(
            (el) => el.dataset.row !== dragKey
        );
        dropIndex = others.filter((el) => {
            const box = el.getBoundingClientRect();
            return box.top + box.height / 2 < e.clientY;
        }).length;
    }
    function dragEnd() {
        if (dragged && dropIndex != null) {
            const list = (dragged.hidden ? hidden : shown).filter((r) => r !== dragged);
            const from = rows.indexOf(dragged);
            const before = list[dropIndex];
            let to: number;
            if (before) {
                to = rows.indexOf(before);
                if (from < to) to--;
            } else {
                to = rows.indexOf(list[list.length - 1]);
                if (from > to) to++;
            }
            homeLayout.move(rows, from, to);
        }
        dragKey = null;
        dropIndex = null;
    }
    /** The list as it would be after dropping, so rows make room while dragging. */
    function arranged(list: ResolvedRow[]) {
        if (!dragged || dropIndex == null || !list.includes(dragged)) return list;
        const out = list.filter((r) => r !== dragged);
        out.splice(dropIndex, 0, dragged);
        return out;
    }

    // --- Undo toast ------------------------------------------------------------------
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
        if (!homeLayout.undoLabel) return;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => homeLayout.dismissUndo(), 6000);
        return () => clearTimeout(toastTimer);
    });
    onMount(() => () => homeLayout.dismissUndo());
</script>

<svelte:head><title>Customize Home · Stremio</title></svelte:head>

<svelte:window onpointermove={dragMove} onpointerup={dragEnd} />

<div class="page">
    <header class="top">
        <button class="icon-btn" onclick={() => history.back()} aria-label="Back"><Icon name="back" size={20} /></button>
        <div class="top-actions">
            <button class="icon-btn" onclick={pageMenu} aria-label="More" aria-haspopup="menu" aria-expanded="false"><Icon name="more" size={22} /></button>
            <button class="pill primary" onclick={() => goto('/')}>Done</button>
        </div>
    </header>

    <h1>Customize Home</h1>
    <p class="lede">Rows come from your addons. Reorder, rename, merge or hide any of them. Changes are saved for this profile.</p>

    <section>
        <div class="section-head">
            <h2>Home Rows <span class="count">{shown.length} shown · {hidden.length} hidden</span></h2>
            {#if selecting}
                <button class="pill" onclick={stopSelect}>Cancel</button>
            {:else}
                <button class="pill" onclick={() => startSelect()}>Select</button>
            {/if}
        </div>

        {#if !board}
            <p class="empty">Loading your rows…</p>
        {/if}

        <ul class="rows" aria-label="Shown on Home" data-list="shown">
            {#each arranged(shown) as r (r.key)}
                {@render row(r)}
            {/each}
        </ul>

        {#if hidden.length}
            <h3 class="hidden-head">Hidden · Not Shown on Home</h3>
            <ul class="rows" aria-label="Hidden" data-list="hidden">
                {#each arranged(hidden) as r (r.key)}
                    {@render row(r)}
                {/each}
            </ul>
        {/if}
    </section>
</div>

{#snippet row(r: ResolvedRow)}
    {@const canSelect = r.kind !== 'special'}
    <li class="row" class:off={r.hidden} class:dragging={dragKey === r.key} data-row={r.key}>
        {#if selecting}
            <button
                class="check"
                class:on={selected.includes(r.key)}
                role="checkbox"
                aria-checked={selected.includes(r.key)}
                aria-label={`Select ${r.name}`}
                disabled={!canSelect}
                onclick={() => toggleSelected(r.key)}
            >
                {#if selected.includes(r.key)}<Icon name="check" size={14} />{/if}
            </button>
        {:else}
            <button class="handle" aria-label={`Drag to reorder ${r.name}`} title="Drag to reorder" onpointerdown={(e) => dragStart(e, r)}>
                <Icon name="grip" size={18} />
            </button>
        {/if}

        <div class="info">
            {#if renaming === r.key}
                <input
                    class="rename"
                    bind:value={draftName}
                    use:focusSelect
                    maxlength="40"
                    aria-label="Row name"
                    onkeydown={(e) => {
                        if (e.key === 'Enter') finishRename(true);
                        else if (e.key === 'Escape') {
                            e.stopPropagation();
                            finishRename(false);
                        }
                    }}
                    onblur={() => finishRename(true)}
                />
            {:else}
                <span class="name">{r.name}</span>
            {/if}
            <span class="sources">
                {#each sources(r) as s, i (i)}
                    {#if i}<span class="plus" aria-hidden="true">+</span>{/if}<span class="chip">{s}</span>
                {/each}
            </span>
        </div>

        <button
            class="icon-btn eye"
            class:on={!r.hidden}
            onclick={() => homeLayout.setHidden(rows, r.key, !r.hidden)}
            aria-label={r.hidden ? `Show ${r.name} on Home` : `Hide ${r.name} from Home`}
            title={r.hidden ? 'Show on Home' : 'Hide from Home'}
        >
            <Icon name={r.hidden ? 'eyeOff' : 'eye'} size={19} />
        </button>
        <button class="icon-btn" onclick={(e) => rowMenu(e, r)} aria-label={`More for ${r.name}`} aria-haspopup="menu" aria-expanded="false">
            <Icon name="more" size={22} />
        </button>
    </li>
{/snippet}

{#if selecting}
    <div class="select-bar" role="toolbar" aria-label="Selection">
        <span>{selected.length} selected</span>
        <button class="pill primary" disabled={selected.length < 2} onclick={openMerge}><Icon name="merge" size={16} /> Merge Rows</button>
    </div>
{/if}

{#if merging}
    <dialog bind:this={mergeDialog} class="merge" aria-labelledby="merge-title" onclose={() => (merging = false)}>
        <form onsubmit={confirmMerge}>
            <h2 id="merge-title">Merge Rows</h2>
            <p class="sub">Combines {mergeRows.length} rows into one on Home, their titles taking turns.</p>
            <label class="label" for="merge-name">New Row Name</label>
            <input id="merge-name" class="field" bind:value={mergeName} maxlength="40" required />
            <p class="label">Combining</p>
            <ul class="combining">
                {#each mergeRows as r (r.key)}
                    <li><span>{r.name}</span><span class="chips">{#each sources(r) as s, i (i)}<span class="chip">{s}</span>{/each}</span></li>
                {/each}
            </ul>
            <div class="dialog-actions">
                <span class="note">You can unmerge anytime.</span>
                <button type="button" class="pill" onclick={() => mergeDialog?.close()}>Cancel</button>
                <button type="submit" class="pill primary" disabled={!mergeName.trim()}>Merge Rows</button>
            </div>
        </form>
    </dialog>
{/if}

{#if homeLayout.undoLabel}
    <div class="toast" class:lifted={selecting} role="status">
        <span>{homeLayout.undoLabel}</span>
        <button onclick={() => homeLayout.undo()}>Undo</button>
    </div>
{/if}

<style>
    .page {
        max-width: 760px;
        margin: 0 auto;
        padding: calc(var(--nav-h) + 12px) var(--gutter) 120px;
    }
    .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 18px;
    }
    .top-actions {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: clamp(30px, 4vw, 40px);
        font-weight: 700;
        letter-spacing: -0.02em;
    }
    .lede {
        margin: 6px 0 28px;
        color: var(--label-2);
        font-size: var(--text-callout);
    }
    .section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
    }
    h2 {
        margin: 0;
        font-size: var(--text-title3);
        font-weight: 600;
    }
    .count {
        margin-left: 8px;
        font-size: 13px;
        font-weight: 500;
        color: var(--label-2);
    }
    .hidden-head {
        margin: 28px 0 10px 4px;
        font-size: 13px;
        font-weight: 600;
        color: var(--label-2);
    }
    .empty {
        color: var(--label-2);
    }
    .rows {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .row {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 68px;
        padding: 10px 10px 10px 8px;
        border-radius: var(--radius-l);
        background: var(--elevated);
        border: 1px solid var(--separator);
        transition:
            box-shadow var(--fast),
            opacity var(--fast);
    }
    .row.off .name,
    .row.off .chip {
        opacity: 0.55;
    }
    .row.dragging {
        box-shadow: 0 12px 30px rgb(0 0 0 / 0.45);
        border-color: rgb(255 255 255 / 0.25);
    }
    .handle {
        display: grid;
        place-items: center;
        width: 32px;
        height: 44px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--label-3);
        cursor: grab;
        touch-action: none;
    }
    .handle:active {
        cursor: grabbing;
    }
    .check {
        display: grid;
        place-items: center;
        flex: none;
        width: 24px;
        height: 24px;
        margin: 0 4px;
        padding: 0;
        border-radius: 50%;
        border: 2px solid var(--label-3);
        background: none;
        color: var(--bg);
        cursor: pointer;
    }
    .check.on {
        border-color: var(--label);
        background: var(--label);
    }
    .check:disabled {
        opacity: 0.3;
        cursor: default;
    }
    .info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .name {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .rename {
        height: 32px;
        padding: 0 10px;
        border-radius: 8px;
        border: 1px solid var(--accent-hover);
        background: var(--bg);
        color: var(--label);
        font: inherit;
        font-weight: 600;
    }
    .sources {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
    }
    .chip {
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--fill-hover);
        font-size: 12px;
        color: var(--label-2);
    }
    .plus {
        font-size: 12px;
        color: var(--label-3);
    }
    .icon-btn {
        display: grid;
        place-items: center;
        flex: none;
        width: 44px;
        height: 44px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: var(--label-2);
        cursor: pointer;
        transition:
            background var(--fast),
            color var(--fast);
    }
    .icon-btn:hover {
        background: var(--fill-hover);
        color: var(--label);
    }
    .icon-btn.eye.on {
        background: var(--fill);
        color: var(--label);
    }
    .top .icon-btn {
        background: var(--fill);
        color: var(--label);
    }
    .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 40px;
        padding: 0 18px;
        border: 1px solid var(--separator);
        border-radius: 999px;
        background: var(--fill);
        color: var(--label);
        font-weight: 600;
        cursor: pointer;
    }
    .pill:hover:not(:disabled) {
        background: var(--fill-hover);
    }
    .pill.primary {
        border-color: transparent;
        background: var(--label);
        color: var(--bg);
    }
    .pill.primary:hover:not(:disabled) {
        background: white;
    }
    .pill:disabled {
        opacity: 0.45;
        cursor: default;
    }
    .select-bar {
        position: fixed;
        left: 50%;
        bottom: 24px;
        translate: -50% 0;
        z-index: 20;
        display: flex;
        align-items: center;
        gap: 18px;
        padding: 8px 8px 8px 20px;
        border-radius: 999px;
        background: rgb(31 31 40 / 0.92);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid var(--separator);
        box-shadow: 0 16px 40px rgb(0 0 0 / 0.5);
        font-weight: 600;
    }
    .merge {
        width: min(520px, calc(100vw - 32px));
        padding: 28px;
        border: 1px solid var(--separator);
        border-radius: 24px;
        background: var(--elevated-2);
        color: var(--label);
        box-shadow: 0 24px 64px rgb(0 0 0 / 0.6);
    }
    .merge::backdrop {
        background: rgb(0 0 0 / 0.55);
    }
    .merge h2 {
        font-size: 26px;
        font-family: var(--font-display);
        font-weight: 700;
    }
    .merge .sub {
        margin: 6px 0 20px;
        color: var(--label-2);
        font-size: 14px;
    }
    .label {
        display: block;
        margin: 16px 0 8px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--label-2);
    }
    .field {
        width: 100%;
        box-sizing: border-box;
        height: 48px;
        padding: 0 18px;
        border-radius: 999px;
        border: 1px solid var(--separator);
        background: var(--bg);
        color: var(--label);
        font-size: var(--text-body);
    }
    .field:focus {
        outline: none;
        border-color: var(--accent-hover);
    }
    .combining {
        list-style: none;
        margin: 0;
        padding: 0;
        border-radius: 16px;
        background: var(--fill);
        overflow: hidden;
    }
    .combining li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 16px;
        font-weight: 600;
    }
    .combining li + li {
        border-top: 1px solid var(--separator);
    }
    .combining .chips {
        display: flex;
        gap: 6px;
    }
    .dialog-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 24px;
    }
    .note {
        flex: 1;
        font-size: 13px;
        color: var(--label-2);
    }
    .toast {
        position: fixed;
        left: 50%;
        bottom: 24px;
        translate: -50% 0;
        z-index: 30;
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 8px 8px 8px 20px;
        border-radius: 999px;
        background: var(--label);
        color: var(--bg);
        box-shadow: 0 16px 40px rgb(0 0 0 / 0.5);
        font-weight: 500;
    }
    .toast button {
        height: 36px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        background: var(--bg);
        color: var(--label);
        font-weight: 700;
        cursor: pointer;
    }
    /* Above the selection bar when both are up. */
    .toast.lifted {
        bottom: 88px;
    }
    @media (prefers-reduced-motion: reduce) {
        .row {
            transition: none;
        }
    }
</style>
