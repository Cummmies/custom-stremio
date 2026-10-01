<script lang="ts">
    // Customize Home: one calm list of Home's rows, each with a few posters, a plain
    // description and a switch for whether it's on Home (the app's own switch, as
    // in Settings). The drag handle and ⋯ menu appear on hover or focus. Combining is
    // offered where it makes sense (a suggestion card), works like making a folder
    // (drop a row onto another), and is in every row's menu for keyboard users.
    // Changes apply as you make them; Undo covers every one of them.
    import { onMount, tick } from 'svelte';
    import { goto } from '$app/navigation';
    import { core } from '$lib/core';
    import type { Board, ContinueWatchingPreview, MetaItemPreview } from '$lib/core/types';
    import { menu, type MenuEntry } from '$lib/menu.svelte';
    import { catalogKey, homeLayout, interleave, type BoardCatalog, type ResolvedRow } from '$lib/homeLayout.svelte';
    import { catalogTitle } from '$lib/components/CatalogList.svelte';
    import Icon from '$lib/components/Icon.svelte';
    import Toggle from '$lib/components/Toggle.svelte';

    let board = $state<Board | null>(null);
    let cw = $state<ContinueWatchingPreview | null>(null);
    onMount(() => {
        const offs = [
            core.watch<Board>('board', (s) => (board = s)),
            core.watch<ContinueWatchingPreview>('continue_watching_preview', (s) => (cw = s)),
        ];
        core.dispatch({ action: 'Load', args: { model: 'CatalogsWithExtra', args: { extra: [] } } }, 'board');
        return () => {
            offs.forEach((off) => off());
            core.dispatch({ action: 'Unload' }, 'board');
        };
    });

    // Every row shows a few of its posters, so load them all (once the list is known).
    let loadedCount = 0;
    $effect(() => {
        const n = board?.catalogs?.length ?? 0;
        if (n && n !== loadedCount) {
            loadedCount = n;
            core.dispatch({ action: 'CatalogsWithExtra', args: { action: 'LoadRange', args: { start: 0, end: n - 1 } } }, 'board');
        }
    });

    $effect(() => homeLayout.sync());

    const catalogs = $derived((board?.catalogs ?? []) as BoardCatalog[]);
    const byKey = $derived(new Map(catalogs.map((c) => [catalogKey(c), c])));
    const rows = $derived(homeLayout.resolve(catalogs, new Map(catalogs.map((c) => [catalogKey(c), catalogTitle(c)]))));
    const onHome = $derived(rows.filter((r) => !r.hidden));

    const TYPE_LABEL: Record<string, string> = { movie: 'Movies', series: 'Series', channel: 'Channels', tv: 'TV' };
    const typeLabel = (t?: string) => (t ? (TYPE_LABEL[t] ?? t.charAt(0).toUpperCase() + t.slice(1)) : '');

    function itemsOf(key: string): MetaItemPreview[] {
        const c = byKey.get(key);
        return c?.content?.type === 'Ready' ? c.content.content : [];
    }
    /** A few posters to recognize the row by. */
    /** One poster per row it's made of: a combined row of two shows two. */
    function posters(r: ResolvedRow): (string | null)[] {
        if (r.kind === 'special') return [cw?.items?.[0]?.poster ?? null];
        return r.parts.slice(0, 3).map((p) => itemsOf(p)[0]?.poster ?? null);
    }
    /** The plain-language line under a row's name. */
    function detail(r: ResolvedRow): string {
        if (r.kind === 'special') return 'Shows and movies you haven’t finished';
        if (r.kind === 'merge') return `Combined from ${r.parts.length} rows`;
        const c = byKey.get(r.parts[0]);
        return [typeLabel(c?.type), c?.addon?.manifest?.name && `from ${c.addon.manifest.name}`].filter(Boolean).join(' · ');
    }
    const canCombine = (r: ResolvedRow) => r.kind !== 'special';

    // --- Suggestions: rows that belong together ("Popular · Movie" + "Popular · Series") ---
    const suggestion = $derived.by(() => {
        const groups = new Map<string, ResolvedRow[]>();
        for (const r of onHome) {
            if (r.kind !== 'catalog' || r.renamed) continue;
            const c = byKey.get(r.parts[0]);
            const base = r.defaultName.split(' · ')[0];
            const id = `${c?.addon?.manifest?.id}|${base}`;
            groups.set(id, [...(groups.get(id) ?? []), r]);
        }
        for (const [id, list] of groups) {
            const types = new Set(list.map((r) => byKey.get(r.parts[0])?.type));
            if (list.length >= 2 && types.size >= 2 && !homeLayout.isDismissed(id)) {
                return { id, name: list[0].defaultName.split(' · ')[0], rows: list };
            }
        }
        return null;
    });

    // --- Rename: click the name ------------------------------------------------------
    let renaming = $state<string | null>(null);
    let draftName = $state('');
    function startRename(r: ResolvedRow) {
        if (r.kind === 'special') return;
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

    // --- Row menu (everything also reachable without dragging) -------------------------
    function rowMenu(e: MouseEvent, r: ResolvedRow) {
        const i = rows.indexOf(r);
        const others = onHome.filter((o) => o !== r && canCombine(o));
        const entries: MenuEntry[] = [];
        if (r.kind !== 'special') entries.push({ label: 'Rename…', icon: 'pencil', onselect: () => startRename(r) });
        entries.push(
            { label: 'Move Up', disabled: i <= 0, onselect: () => homeLayout.move(rows, i, i - 1) },
            { label: 'Move Down', disabled: i >= rows.length - 1, onselect: () => homeLayout.move(rows, i, i + 1) }
        );
        if (canCombine(r)) {
            entries.push({ separator: true }, {
                label: 'Combine With',
                icon: 'merge',
                disabled: !others.length,
                submenu: others.map((o) => ({ label: o.name, onselect: () => openCombine([o, r]) })),
            });
        }
        if (r.kind === 'merge') entries.push({ label: 'Separate Rows', onselect: () => homeLayout.unmerge(rows, r.key) });
        menu.toggleFor(e.currentTarget as HTMLElement, entries, 'end');
    }

    // --- Combine sheet ---------------------------------------------------------------
    let combining = $state<ResolvedRow[] | null>(null);
    let combineName = $state('');
    let combineDialog = $state<HTMLDialogElement>();
    function openCombine(list: ResolvedRow[]) {
        combining = list;
        const firsts = list.map((r) => r.name.split(' · ')[0]);
        combineName = firsts.every((f) => f === firsts[0]) ? firsts[0] : list[0].name;
        tick().then(() => combineDialog?.showModal());
    }
    const combinePreview = $derived(
        combining ? interleave(combining.flatMap((r) => r.parts).map(itemsOf)).slice(0, 8) : []
    );
    function confirmCombine(e: SubmitEvent) {
        e.preventDefault();
        if (combining) homeLayout.merge(rows, combining.map((r) => r.key), combineName);
        combineDialog?.close();
    }

    // --- Drag: between rows reorders, onto a row combines --------------------------------
    let dragKey = $state<string | null>(null);
    let dropIndex = $state<number | null>(null);
    let combineTarget = $state<string | null>(null);
    const dragged = $derived(rows.find((r) => r.key === dragKey) ?? null);

    // A row can be picked up anywhere but its controls; it lifts once the
    // pointer has moved a little, so a plain click doesn't flash it.
    let pressed: { key: string; y: number } | null = null;
    function dragStart(e: PointerEvent, r: ResolvedRow) {
        if (e.button !== 0 || renaming) return;
        const fromHandle = !!(e.target as HTMLElement).closest('.handle');
        if (!fromHandle && (e.target as HTMLElement).closest('button, input')) return;
        e.preventDefault();
        pressed = { key: r.key, y: e.clientY };
        if (fromHandle) lift();
    }
    function lift() {
        if (!pressed) return;
        dragKey = pressed.key;
        dropIndex = rows.findIndex((r) => r.key === pressed!.key);
        combineTarget = null;
        pressed = null;
    }
    function dragMove(e: PointerEvent) {
        if (pressed && Math.abs(e.clientY - pressed.y) > 5) lift();
        if (!dragged) return;
        const others = [...document.querySelectorAll<HTMLElement>('[data-list="home"] > [data-row]')].filter(
            (el) => el.dataset.row !== dragKey
        );
        // Over the middle of another row: combine with it (not the built-in row).
        const over = others.find((el) => {
            const b = el.getBoundingClientRect();
            return e.clientY > b.top + b.height * 0.28 && e.clientY < b.bottom - b.height * 0.28;
        });
        const overRow = over && rows.find((r) => r.key === over.dataset.row);
        if (overRow && canCombine(dragged) && canCombine(overRow)) {
            combineTarget = overRow.key;
            return;
        }
        combineTarget = null;
        dropIndex = others.filter((el) => {
            const b = el.getBoundingClientRect();
            return b.top + b.height / 2 < e.clientY;
        }).length;
    }
    function dragEnd() {
        pressed = null;
        if (!dragged) return;
        if (combineTarget) {
            const target = rows.find((r) => r.key === combineTarget);
            if (target) openCombine([target, dragged]);
        } else if (dropIndex != null) {
            const list = rows.filter((r) => r !== dragged);
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
        combineTarget = null;
    }
    /** The list as it would be after dropping, so rows make room while dragging. */
    function arranged(list: ResolvedRow[]) {
        if (!dragged || dropIndex == null || combineTarget || !list.includes(dragged)) return list;
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

<div class="page" class:is-dragging={!!dragKey}>
    <a class="back" href="/"><Icon name="back" size={16} />Home</a>
    <header class="top">
        <h1>Customize Home</h1>
        <button class="pill primary" onclick={() => goto('/')}>Done</button>
    </header>
    <p class="tip">Switch rows on or off, drag to reorder, and drop one row onto another to combine them.</p>

    {#if suggestion}
        <div class="suggest" role="region" aria-label="Suggestion">
            <span class="suggest-icon" aria-hidden="true"><Icon name="merge" size={20} /></span>
            <div class="suggest-text">
                <strong>Combine “{suggestion.name}” into one row?</strong>
                <span>{suggestion.rows.map((r) => typeLabel(byKey.get(r.parts[0])?.type)).join(' and ')} together, taking turns.</span>
            </div>
            <button class="pill" onclick={() => homeLayout.dismissSuggestion(suggestion.id)}>Not Now</button>
            <button class="pill primary" onclick={() => openCombine(suggestion.rows)}>Combine</button>
        </div>
    {/if}

    <section aria-labelledby="rows-head">
        <h2 id="rows-head">Rows <span class="count">{onHome.length} of {rows.length} on Home</span></h2>
        {#if !board}
            <p class="empty">Loading your rows…</p>
        {/if}
        <ul class="list" data-list="home">
            {#each arranged(rows) as r (r.key)}
                {@render row(r)}
            {/each}
        </ul>
    </section>

    <div class="footer">
        <button class="text-btn" onclick={() => homeLayout.reset()}>Restore Default Rows</button>
    </div>
</div>

{#snippet row(r: ResolvedRow)}
    {@const pics = posters(r)}
    <li
        class="row"
        class:off={r.hidden}
        class:dragging={dragKey === r.key}
        class:target={combineTarget === r.key}
        data-row={r.key}
        onpointerdown={(e) => dragStart(e, r)}
    >
        <span class="handle" aria-hidden="true" title="Drag to reorder, or onto another row to combine">
            <Icon name="grip" size={14} />
        </span>

        <div class="art" aria-hidden="true">
            {#each pics as pic, i (i)}
                {#if pic}<img src={pic} alt="" loading="lazy" />{:else}<span></span>{/if}
            {/each}
        </div>

        <div class="text">
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
            {:else if r.kind === 'special'}
                <span class="name">{r.name}</span>
            {:else}
                <button class="name editable" onclick={() => startRename(r)} title="Rename">{r.name}<Icon name="pencil" size={13} /></button>
            {/if}
            <span class="detail">{detail(r)}</span>
        </div>

        {#if combineTarget === r.key}
            <span class="combine-badge" aria-hidden="true"><Icon name="merge" size={14} /> Combine</span>
        {/if}

        <button class="more" onclick={(e) => rowMenu(e, r)} aria-label={`More for ${r.name}`} aria-haspopup="menu">
            <Icon name="more" size={20} />
        </button>
        <Toggle label={`Show ${r.name} on Home`} checked={!r.hidden} onchange={(on) => homeLayout.setHidden(rows, r.key, !on)} />
    </li>
{/snippet}

{#if combining}
    <dialog bind:this={combineDialog} class="sheet" aria-labelledby="combine-title" onclose={() => (combining = null)}>
        <form onsubmit={confirmCombine}>
            <span class="sheet-icon" aria-hidden="true"><Icon name="merge" size={22} /></span>
            <h2 id="combine-title">Combine Rows</h2>
            <p class="sub">{combining.map((r) => r.name).join(' and ')} become one row, their titles taking turns.</p>

            <div class="preview" aria-hidden="true">
                {#each combinePreview as item (item.id)}
                    {#if item.poster}<img src={item.poster} alt="" />{:else}<span></span>{/if}
                {/each}
            </div>

            <label class="field-label" for="combine-name">Row Name</label>
            <input id="combine-name" class="field" bind:value={combineName} maxlength="40" required />

            <div class="sheet-actions">
                <button type="button" class="pill" onclick={() => combineDialog?.close()}>Cancel</button>
                <button type="submit" class="pill primary" disabled={!combineName.trim()}>Combine</button>
            </div>
            <p class="fine">You can separate them again anytime.</p>
        </form>
    </dialog>
{/if}

{#if homeLayout.undoLabel}
    <div class="toast" role="status">
        <span>{homeLayout.undoLabel}</span>
        <button onclick={() => homeLayout.undo()}>Undo</button>
    </div>
{/if}

<style>
    .page {
        max-width: 720px;
        margin: 0 auto;
        padding: calc(var(--nav-h) + 20px) var(--gutter) 120px;
    }
    .page.is-dragging {
        user-select: none;
        cursor: grabbing;
    }
    .back {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        margin: 0 0 10px -4px;
        padding: 4px 8px 4px 4px;
        border-radius: 8px;
        color: var(--label-2);
        font-size: var(--text-callout);
        font-weight: 500;
        text-decoration: none;
    }
    .back:hover {
        background: var(--fill);
        color: var(--label);
    }
    .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
    }
    /* Same title style as Library and Settings. */
    h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title2);
        font-weight: 600;
    }
    .tip {
        max-width: 60ch;
        margin: 6px 0 24px;
        color: var(--label-2);
        font-size: var(--text-callout);
    }
    /* Suggestion */
    .suggest {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 28px;
        padding: 14px 14px 14px 16px;
        border-radius: var(--radius-l);
        background: linear-gradient(135deg, rgb(109 74 240 / 0.22), rgb(45 140 240 / 0.12));
        border: 1px solid rgb(109 74 240 / 0.35);
    }
    .suggest-icon {
        display: grid;
        place-items: center;
        flex: none;
        width: 40px;
        height: 40px;
        border-radius: 12px;
        background: rgb(109 74 240 / 0.35);
        color: white;
    }
    .suggest-text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .suggest-text span {
        font-size: 13px;
        color: var(--label-2);
    }

    /* Sections */
    h2 {
        margin: 0 0 10px 4px;
        font-size: 13px;
        font-weight: 600;
        color: var(--label-2);
    }
    .count {
        margin-left: 6px;
        font-weight: 400;
        color: var(--label-3);
    }
    .empty {
        margin: 0 0 0 4px;
        color: var(--label-2);
        font-size: 14px;
    }
    .list {
        list-style: none;
        margin: 0;
        padding: 0;
        border-radius: var(--radius-l);
        background: var(--elevated);
        border: 1px solid var(--separator);
        overflow: hidden;
    }
    .row {
        position: relative;
        cursor: grab;
        user-select: none;
        touch-action: none;
        display: flex;
        align-items: center;
        gap: 14px;
        min-height: 72px;
        padding: 10px 14px 10px 8px;
        background: var(--elevated);
        transition:
            background var(--fast),
            box-shadow var(--fast);
    }
    .row + .row {
        border-top: 1px solid var(--separator);
    }
    .row.dragging {
        z-index: 2;
        background: var(--elevated-2);
        box-shadow: 0 12px 32px rgb(0 0 0 / 0.5);
    }
    .row.target {
        background: rgb(109 74 240 / 0.18);
        box-shadow: inset 0 0 0 2px rgb(109 74 240 / 0.8);
    }

    .more {
        display: grid;
        place-items: center;
        flex: none;
        width: 36px;
        height: 36px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: var(--label-2);
        cursor: pointer;
    }
    .more:hover,
    .more:focus-visible {
        background: var(--fill-hover);
        color: var(--label);
    }

    /* Drag handle and ⋯ stay out of the way until the row is pointed at. */
    .handle,
    .more {
        opacity: 0;
        transition:
            opacity var(--fast),
            background var(--fast);
    }
    .row:hover .handle,
    .row:hover .more,
    .row:focus-within .more,
    .row.dragging .handle {
        opacity: 1;
    }
    @media (hover: none) {
        .handle,
        .more {
            opacity: 1;
        }
    }

    /* Switched off: still listed, but quieter. */
    .row.off .art,
    .row.off .text {
        opacity: 0.45;
    }
    .art,
    .text {
        transition: opacity var(--fast);
    }

    .art {
        display: flex;
        justify-content: center;
        flex: none;
        width: 50px;
    }
    .art img,
    .art span {
        width: 30px;
        height: 45px;
        border-radius: 5px;
        object-fit: cover;
        background: var(--elevated-2);
        box-shadow: 0 0 0 2px var(--elevated);
    }
    .art > * + * {
        margin-left: -10px;
    }
    .text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 3px;
    }
    .name {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
    }
    .name.editable {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--label);
        font: inherit;
        font-weight: 600;
        cursor: text;
        border-radius: 4px;
    }
    .name.editable :global(svg) {
        opacity: 0;
        color: var(--label-2);
        transition: opacity var(--fast);
    }
    .row:hover .name.editable :global(svg),
    .name.editable:focus-visible :global(svg) {
        opacity: 1;
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
    .detail {
        font-size: 13px;
        color: var(--label-2);
    }
    .combine-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        background: #6d4af0;
        color: white;
        font-size: 12px;
        font-weight: 700;
    }
    .handle {
        display: grid;
        place-items: center;
        flex: none;
        width: 16px;
        margin-right: -6px;
        color: var(--label-3);
    }

    /* Buttons */
    .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex: none;
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
    .footer {
        display: flex;
        justify-content: center;
        margin-top: 28px;
    }
    .text-btn {
        height: 40px;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: none;
        color: var(--label-2);
        font-weight: 600;
        cursor: pointer;
    }
    .text-btn:hover {
        background: var(--fill);
        color: var(--label);
    }

    /* Combine sheet */
    .sheet {
        width: min(480px, calc(100vw - 32px));
        padding: 28px 28px 22px;
        border: 1px solid var(--separator);
        border-radius: 24px;
        background: var(--elevated-2);
        color: var(--label);
        box-shadow: 0 24px 64px rgb(0 0 0 / 0.6);
        text-align: center;
    }
    .sheet::backdrop {
        background: rgb(0 0 0 / 0.55);
    }
    .sheet[open] {
        animation: pop var(--slow) var(--ease);
    }
    @keyframes pop {
        from {
            opacity: 0;
            transform: scale(0.96);
        }
    }
    .sheet-icon {
        display: inline-grid;
        place-items: center;
        width: 48px;
        height: 48px;
        border-radius: 14px;
        background: #6d4af0;
        color: white;
    }
    .sheet h2 {
        margin: 12px 0 0;
        font-family: var(--font-display);
        font-size: 24px;
        font-weight: 700;
        color: var(--label);
    }
    .sheet .sub {
        margin: 6px 0 18px;
        color: var(--label-2);
        font-size: 14px;
    }
    .preview {
        display: flex;
        justify-content: center;
        gap: 6px;
        margin-bottom: 18px;
    }
    .preview img,
    .preview span {
        width: 44px;
        height: 66px;
        border-radius: 6px;
        object-fit: cover;
        background: var(--elevated);
    }
    .field-label {
        display: block;
        margin: 0 0 8px;
        text-align: left;
        font-size: 13px;
        font-weight: 600;
        color: var(--label-2);
    }
    .field {
        width: 100%;
        box-sizing: border-box;
        height: 48px;
        padding: 0 18px;
        border-radius: 12px;
        border: 1px solid var(--separator);
        background: var(--bg);
        color: var(--label);
        font-size: var(--text-body);
    }
    .field:focus {
        outline: none;
        border-color: var(--accent-hover);
    }
    .sheet-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-top: 20px;
    }
    .sheet-actions .pill {
        justify-content: center;
    }
    .fine {
        margin: 12px 0 0;
        font-size: 12px;
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
    @media (max-width: 560px) {
        .art {
            display: none;
        }
        .suggest {
            flex-wrap: wrap;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .row,
        .art,
        .text,
        .handle,
        .more {
            transition: none;
        }
        .sheet[open] {
            animation: none;
        }
    }
    /* Phones: the suggestion stacks (icon and text, then its buttons); the
       tab bar replaces the back link. */
    @media (max-width: 700px) {
        .suggest {
            flex-wrap: wrap;
        }
        .suggest-text {
            flex: 1 1 calc(100% - 60px);
        }
        .suggest .pill {
            flex: 1;
            justify-content: center;
        }
        .back {
            display: none;
        }
    }
    /* Phones: the Undo notice spans the width above the tab bar. */
    @media (max-width: 700px) {
        .toast {
            left: 12px;
            right: 12px;
            bottom: calc(var(--tabbar-h) + 12px);
            translate: none;
            gap: 12px;
            padding: 8px 8px 8px 16px;
            border-radius: 16px;
        }
        .toast span {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .toast button {
            flex: none;
        }
    }
</style>
