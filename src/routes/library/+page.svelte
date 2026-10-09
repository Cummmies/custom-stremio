<script lang="ts">
    // Library. With Lightboxd connected (docs/lightboxd.md): what you track,
    // all of it (by status) or one status (Watching, Plan to Watch, Completed
    // by month of your last watch, Dropped); the address says which
    // (?status=watching, which Continue Watching's See All opens). At the
    // right: Type (a menu: Movies, Series, Anime), Sort (Lightboxd's sorts; picking
    // the current one again flips it) and Edit (select titles, then change
    // their status, add them to a list or remove them). Without Lightboxd:
    // your Stremio library.
    import { page } from '$app/state';
    import { SvelteSet } from 'svelte/reactivity';
    import { goto, appUrl } from '$lib/nav';
    import { app } from '$lib/app.svelte';
    import { core } from '$lib/core';
    import { libraryToPoster } from '$lib/library';
    import { lightboxd } from '$lib/lightboxd.svelte';
    import { lb, day, score, STATUS_LABEL, type LibraryItem, type Status } from '$lib/lightboxd/api';
    import { menu, type MenuEntry } from '$lib/menu.svelte';
    import { isTV } from '$lib/platform';
    import PosterCard, { type PosterItem } from '$lib/components/PosterCard.svelte';
    import NewListDialog from '$lib/components/NewListDialog.svelte';
    import EmptyState from '$lib/components/EmptyState.svelte';
    import Icon from '$lib/components/Icon.svelte';
    import { slider } from '$lib/slider';

    // --- Type ---
    const types = $derived([
        { value: 'all', label: 'All' },
        { value: 'movie', label: 'Movies' },
        { value: 'series', label: 'Series' },
        // Only Lightboxd knows which titles are anime.
        ...(lightboxd.ready ? [{ value: 'anime', label: 'Anime' }] : []),
    ]);
    let type = $state<string>('all');
    $effect(() => {
        if (!types.some((t) => t.value === type)) type = 'all';
    });
    // As Lightboxd does: Movies and Series leave anime out.
    const keep = (i: { type: string; anime?: boolean }) =>
        type === 'all' || (type === 'anime' ? !!i.anime : !i.anime && i.type === type);
    const typeLabel = $derived(types.find((t) => t.value === type)?.label ?? 'All');
    function openType(e: MouseEvent) {
        menu.toggleFor(
            e.currentTarget as HTMLElement,
            types.map((t) => ({ label: t.label, checked: t.value === type, onselect: () => (type = t.value) })),
            'end'
        );
    }
    const typeNoun = $derived(type === 'movie' ? 'movies' : type === 'series' ? 'series' : 'anime');

    // --- Stremio's library (no Lightboxd) ---
    // The library is already loaded app-wide, so filtering is instant.
    const items = $derived((app.library?.catalog ?? []).filter((i) => keep(i)).map(libraryToPoster));

    // --- Lightboxd ---
    const STATUSES: Status[] = ['watching', 'plan_to_watch', 'completed', 'dropped'];
    const sections = [{ id: 'all', label: 'All' }, ...STATUSES.map((st) => ({ id: st as string, label: STATUS_LABEL[st] }))];
    const ids = sections.map((x) => x.id);
    let section = $state<string>('all');
    /** The section the bar's highlight is dragged over (lib/slider.ts). */
    let statusOver = $state<number | null>(null);

    // Sort: Lightboxd's, newest / highest / most first; Title A to Z.
    type SortKey = 'recent' | 'added' | 'rating' | 'year' | 'title' | 'episodes' | 'rewatches';
    const SORTS: { key: SortKey; label: string }[] = [
        { key: 'recent', label: 'Recently Watched' },
        { key: 'added', label: 'Recently Added' },
        { key: 'rating', label: 'Rating' },
        { key: 'year', label: 'Year' },
        { key: 'title', label: 'Title' },
        { key: 'episodes', label: 'Episodes' },
        { key: 'rewatches', label: 'Rewatched' },
    ];
    let sort = $state<SortKey>('recent');
    let desc = $state(true);
    function chooseSort(key: SortKey) {
        if (key === sort) desc = !desc;
        else {
            sort = key;
            desc = key !== 'title';
        }
    }
    const sortLabel = $derived(SORTS.find((x) => x.key === sort)?.label ?? 'Recently Watched');
    const arrow = $derived(desc ? '↓' : '↑');
    function openSort(e: MouseEvent) {
        menu.toggleFor(
            e.currentTarget as HTMLElement,
            [
                { header: 'Sort By', detail: 'Choose it again to reverse' },
                ...SORTS.map((x) => ({
                    label: x.label,
                    checked: x.key === sort,
                    shortcut: x.key === sort ? arrow : undefined,
                    onselect: () => chooseSort(x.key),
                })),
            ],
            'end'
        );
    }

    // The address says which (a row's See All links straight to one).
    $effect(() => {
        const asked = appUrl(page.url).searchParams.get('status');
        // An old link to Ratings: what you've completed, highest rated first.
        if (asked === 'ratings') {
            section = 'completed';
            sort = 'rating';
            desc = true;
            return;
        }
        section = asked && ids.includes(asked) ? asked : 'all';
    });
    function pick(next: string) {
        goto(next === 'all' ? '/library' : `/library?status=${next}`, { replaceState: true, noScroll: true, keepFocus: true });
    }
    let loaded = $state<Record<string, LibraryItem[] | null | undefined>>({});

    // Each loads when first shown (and again when Lightboxd comes back, or
    // after an edit).
    $effect(() => {
        const k = section;
        if (!lightboxd.ready || loaded[k] !== undefined) return;
        loaded = { ...loaded, [k]: null };
        lb.library('titles', k === 'all' ? null : (k as Status)).then((res) => {
            loaded = { ...loaded, [k]: res ? res.items : undefined };
        });
    });

    /** What a sort goes by; null (no date, no score…) always goes last. */
    function sortValue(i: LibraryItem): string | number | null {
        switch (sort) {
            case 'recent':
                return i.date ?? null;
            case 'added':
                return i.added ?? null;
            case 'rating':
                return i.rating ?? null;
            case 'year':
                return i.year ? Number(i.year) : null;
            case 'title':
                return i.name;
            case 'episodes':
                return i.episodes ?? (i.type === 'movie' ? 1 : null);
            case 'rewatches':
                return (i.watches ?? 0) - 1;
        }
    }
    const current = $derived.by(() => {
        let list = (loaded[section] ?? null)?.filter(keep) ?? null;
        if (!list) return null;
        // Rewatched: only what you've watched more than once.
        if (sort === 'rewatches') list = list.filter((i) => (i.watches ?? 0) > 1);
        const dir = desc ? -1 : 1;
        // Ties keep the server's order (newest first).
        return list
            .map((i, n) => ({ i, n, v: sortValue(i) }))
            .sort((a, b) => {
                if (a.v == null || b.v == null) return a.v == null && b.v == null ? a.n - b.n : a.v == null ? 1 : -1;
                const c =
                    typeof a.v === 'string'
                        ? a.v.localeCompare(b.v as string, undefined, { sensitivity: 'base', numeric: true })
                        : a.v - (b.v as number);
                return dir * c || a.n - b.n;
            })
            .map((x) => x.i);
    });

    // Under each poster: what it's sorted by.
    const thisYear = String(new Date().getFullYear());
    function lastWatch(i: LibraryItem) {
        const parts = [
            day(i.date, { month: 'short', day: 'numeric' }),
            i.rating != null ? score(i.rating) : null,
            (i.watches ?? 0) > 1 ? `Watched ${i.watches}×` : null,
        ].filter(Boolean);
        return parts.length ? parts.join(' · ') : i.year;
    }
    function below(i: LibraryItem): string | null {
        switch (sort) {
            case 'recent':
                return i.status === 'completed' ? lastWatch(i) : i.year;
            case 'added':
                return i.added
                    ? `Added ${day(i.added, { month: 'short', day: 'numeric', year: i.added.startsWith(thisYear) ? undefined : 'numeric' })}`
                    : i.year;
            case 'rating':
                return i.rating != null ? score(i.rating) : i.year;
            case 'episodes':
                return i.type !== 'movie' && i.episodes ? `${i.episodes} Episode${i.episodes === 1 ? '' : 's'}` : i.year;
            case 'rewatches':
                return `Watched ${i.watches}×`;
            default:
                return i.year;
        }
    }
    const poster = (i: LibraryItem): PosterItem => ({
        id: i.id,
        type: i.type,
        name: i.name,
        poster: i.poster,
        releaseInfo: below(i),
        progress: null,
    });

    // Headings: by status (All) or month (Completed) when sorted by Recently
    // Watched, by score band when sorted by Rating; otherwise one grid.
    type Group = { title: string; items: LibraryItem[] };
    function grouped(list: LibraryItem[], heading: (i: LibraryItem) => string): Group[] {
        const out: Group[] = [];
        for (const i of list) {
            const title = heading(i);
            let g = out.find((x) => x.title === title);
            if (!g) out.push((g = { title, items: [] }));
            g.items.push(i);
        }
        return out;
    }
    const groups = $derived.by((): Group[] => {
        if (!current) return [];
        if (sort === 'rating') {
            return grouped(current, (i) => (i.rating == null ? 'Not Rated' : i.rating >= 9 ? '9 and Up' : String(Math.floor(i.rating))));
        }
        if (sort === 'recent' && section === 'all') {
            const order = (g: Group) => STATUSES.indexOf(g.items[0].status as Status);
            return grouped(current, (i) => (i.status ? STATUS_LABEL[i.status] : '')).sort((a, b) => order(a) - order(b));
        }
        if (sort === 'recent' && section === 'completed') {
            return grouped(current, (i) =>
                i.date ? (day(i.date, { month: 'long', year: i.date.startsWith(thisYear) ? undefined : 'numeric' }) ?? 'Date Unknown') : 'Date Unknown'
            );
        }
        return [{ title: '', items: current }];
    });

    const emptyText = $derived(
        sort === 'rewatches'
            ? { title: 'No rewatches yet', body: 'Titles you’ve watched more than once show up here.' }
            : section === 'all'
              ? { title: 'Nothing here yet', body: 'Use the + button on any title to track it.' }
              : section === 'completed'
                ? { title: 'Nothing completed yet', body: 'What you finish watching shows up here.' }
                : section === 'watching'
                  ? { title: 'Nothing you’re watching', body: 'Start something, or set a title to Watching with the + button on its page.' }
                  : { title: `Nothing ${STATUS_LABEL[section as Status].toLowerCase()}`, body: 'Set a title’s status with the + button on its page.' }
    );

    // --- Edit: select titles, then act on them all ---
    // Not on TV: picking many with a remote is slow, and each title page does it.
    const canEdit = $derived(lightboxd.ready && !isTV);
    let editing = $state(false);
    const picked = new SvelteSet<number>();
    // Only what's shown counts (a filter can hide some you picked).
    const chosen = $derived((current ?? []).filter((i) => picked.has(i.title_id)));
    const allPicked = $derived(!!current?.length && chosen.length === current.length);
    let busy = $state(false);
    let note = $state<string | null>(null);
    let newListOpen = $state(false);

    function toggleEditing() {
        editing = !editing;
        picked.clear();
        note = null;
    }
    function togglePick(id: number) {
        if (picked.has(id)) picked.delete(id);
        else picked.add(id);
        note = null;
    }
    function toggleAll() {
        if (allPicked) picked.clear();
        else for (const i of current ?? []) picked.add(i.title_id);
    }

    /** Runs `act` on every chosen title, then reloads and leaves Edit. */
    async function each(act: (i: LibraryItem) => Promise<unknown>, done: (n: number) => string) {
        const list = chosen;
        if (!list.length || busy) return;
        busy = true;
        note = null;
        const results = await Promise.all(list.map((i) => act(i).catch(() => null)));
        busy = false;
        const failed = results.filter((r) => r == null).length;
        loaded = {};
        if (failed) {
            note = `Couldn’t change ${failed} of ${list.length}. Try again in a moment.`;
            return;
        }
        editing = false;
        picked.clear();
        note = done(list.length);
        setTimeout(() => (note = null), 4000);
    }
    const titles = (n: number) => `${n} title${n === 1 ? '' : 's'}`;

    function statusMenu(e: MouseEvent) {
        menu.toggleFor(e.currentTarget as HTMLElement, [
            { header: 'Set Status' },
            ...STATUSES.map((st) => ({
                label: STATUS_LABEL[st],
                onselect: () => each((i) => lb.setStatus(i.title_id, st), (n) => `${titles(n)} set to ${STATUS_LABEL[st]}.`),
            })),
        ]);
    }
    const addAll = (listId: number, name: string) =>
        each((i) => lb.addToList(listId, i.id, i.type, i.name), (n) => `Added ${titles(n)} to ${name}.`);
    async function listMenu(e: MouseEvent) {
        const button = e.currentTarget as HTMLElement;
        const res = await lb.lists();
        menu.toggleFor(button, [
            { header: 'Add to List' },
            ...(res?.lists ?? []).map((l) => ({ label: l.name, icon: 'list' as const, onselect: () => addAll(l.id, l.name) })),
            ...(res?.lists.length ? [{ separator: true } as const] : []),
            { label: 'New List…', icon: 'plus', onselect: () => (newListOpen = true) },
        ]);
    }
    let listBusy = $state(false);
    let listError = $state<string | null>(null);
    async function createList(name: string) {
        listBusy = true;
        listError = null;
        const made = await lb.newList(name);
        listBusy = false;
        if (!made) {
            listError = 'Couldn’t make the list. Try again in a moment.';
            return;
        }
        newListOpen = false;
        await addAll(made.id, made.name);
    }
    /** Removing takes watches, scores and list entries with it: asked once more. */
    function removeMenu(e: MouseEvent) {
        const n = chosen.length;
        menu.toggleFor(e.currentTarget as HTMLElement, [
            { header: `Remove ${titles(n)} from your library?`, detail: 'Their watches, scores and lists go too.' },
            {
                label: 'Remove',
                icon: 'trash',
                destructive: true,
                onselect: () =>
                    each(
                        async (i) => {
                            const res = await lb.remove(i.title_id);
                            // Stremio's library (the backup) lets go of it too, as on its page.
                            if (res && app.library?.catalog.some((c) => c._id === i.id)) {
                                core.dispatch({ action: 'Ctx', args: { action: 'RemoveFromLibrary', args: i.id } });
                            }
                            return res;
                        },
                        (n) => `Removed ${titles(n)}.`
                    ),
            },
            { label: 'Cancel' },
        ] satisfies MenuEntry[]);
    }

    // Escape leaves Edit (a menu or dialog open takes it first).
    function onkeydown(e: KeyboardEvent) {
        if (e.key === 'Escape' && editing && !menu.open && !newListOpen && !e.defaultPrevented) toggleEditing();
    }
    // Leaving Lightboxd (it went away) leaves Edit too.
    $effect(() => {
        if (!canEdit && editing) toggleEditing();
    });
</script>

<svelte:head><title>Library · Stremio</title></svelte:head>
<svelte:window {onkeydown} />

<div class="page" class:editing>
    <!-- The bar names the page; the title stays for screen readers. -->
    <header>
        <h1 class:sr-only={lightboxd.ready}>Library</h1>
        {#if lightboxd.ready}
            <div
                class="segmented status"
                role="radiogroup"
                aria-label="Status"
                use:slider={{ active: ids.indexOf(section), onhover: (i) => (statusOver = i), onpick: (i) => pick(ids[i]) }}
            >
                {#each sections as s, i (s.id)}
                    <button role="radio" aria-checked={section === s.id} class:on={statusOver != null ? statusOver === i : section === s.id} onclick={() => pick(s.id)}>
                        {s.label}
                    </button>
                {/each}
            </div>
        {/if}
        <div class="tools">
            <button class="pill" aria-haspopup="menu" aria-expanded="false" aria-label="Type: {typeLabel}" onclick={openType}>Type: {typeLabel}</button>
            {#if lightboxd.ready}
                <button
                    class="pill sort"
                    aria-haspopup="menu"
                    aria-expanded="false"
                    aria-label="Sort: {sortLabel}, {desc ? 'descending' : 'ascending'}"
                    onclick={openSort}
                >
                    <span class="sort-text">Sort: {sortLabel} {arrow}</span>
                    <span class="sort-icon"><Icon name="sort" size={18} /></span>
                </button>
            {/if}
            {#if canEdit}
                <button class="pill edit" class:done={editing} aria-pressed={editing} onclick={toggleEditing}>{editing ? 'Done' : 'Edit'}</button>
            {/if}
        </div>
    </header>

    {#if lightboxd.ready}
        {#if current === null}
            <p class="loading" role="status">Loading…</p>
        {:else if current.length === 0}
            <EmptyState icon="library" title={type === 'all' || sort === 'rewatches' ? emptyText.title : `No ${typeNoun} here`}>
                <p>{emptyText.body}</p>
            </EmptyState>
        {:else}
            {#each groups as g (g.title)}
                {#if g.title}<h2>{g.title}</h2>{/if}
                <div class="grid">
                    {#each g.items as i (i.title_id)}
                        {#if editing}
                            <div class="cell" class:on={picked.has(i.title_id)}>
                                <div inert><PosterCard item={poster(i)} /></div>
                                <button class="pick" aria-pressed={picked.has(i.title_id)} aria-label={i.name} onclick={() => togglePick(i.title_id)}>
                                    <span class="mark" aria-hidden="true">
                                        {#if picked.has(i.title_id)}<Icon name="check" size={14} />{/if}
                                    </span>
                                </button>
                            </div>
                        {:else}
                            <PosterCard item={poster(i)} />
                        {/if}
                    {/each}
                </div>
            {/each}
        {/if}
    {:else if app.library && items.length === 0}
        {#if !app.user}
            <EmptyState icon="library" title="Keep your library in sync">
                <p>Log in to bring over your library and watch progress from your other Stremio apps.</p>
                <button onclick={() => app.openLogin()}>Log In</button>
            </EmptyState>
        {:else if type !== 'all'}
            <EmptyState icon="library" title="No {typeNoun} saved">
                <p>Use the + button on any title to save it here.</p>
            </EmptyState>
        {:else}
            <EmptyState icon="library" title="Your library is empty">
                <p>Titles you save or start watching in any Stremio app show up here.</p>
            </EmptyState>
        {/if}
    {:else}
        <div class="grid">
            {#each items as item (item.id)}
                <PosterCard {item} />
            {/each}
        </div>
    {/if}
</div>

{#if editing}
    <div class="toolbar" role="toolbar" aria-label="Selected titles">
        <button class="plain" onclick={toggleAll} disabled={busy}>{allPicked ? 'Deselect All' : 'Select All'}</button>
        <span class="count" role="status">{busy ? 'Saving…' : (note ?? (chosen.length ? `${chosen.length} Selected` : 'Select Titles'))}</span>
        <div class="acts">
            <button disabled={!chosen.length || busy} aria-haspopup="menu" aria-expanded="false" onclick={statusMenu}>Status</button>
            <button disabled={!chosen.length || busy} aria-haspopup="menu" aria-expanded="false" onclick={listMenu}>Add to List</button>
            <button class="destructive" disabled={!chosen.length || busy} aria-haspopup="menu" aria-expanded="false" onclick={removeMenu}>Remove</button>
        </div>
    </div>
{:else if note}
    <p class="done-note" role="status">{note}</p>
{/if}

{#if newListOpen}
    <NewListDialog busy={listBusy} error={listError} oncreate={createList} onclose={() => ((newListOpen = false), (listError = null))} />
{/if}

<style>
    .page {
        padding: calc(var(--nav-h) + 24px) var(--gutter) 56px;
    }
    /* Room for the toolbar under the last row. */
    .page.editing {
        padding-bottom: 120px;
    }
    /* PC: the status bar at the left; Type, Sort and Edit at the right
       (no Lightboxd: the title, then Type). */
    header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 24px;
    }
    h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title2);
        font-weight: 600;
    }
    .tools {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
    }
    h2 {
        margin: 32px 0 12px;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 600;
    }
    h2:first-of-type {
        margin-top: 0;
    }
    .segmented {
        display: flex;
        padding: 3px;
        border-radius: var(--radius);
        background: var(--fill);
    }
    .segmented button {
        height: 30px;
        padding: 0 14px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--label-2);
        font-weight: 500;
        white-space: nowrap;
        cursor: pointer;
        transition: background var(--fast), color var(--fast);
    }
    .segmented button:hover {
        color: var(--label);
    }
    .segmented button.on {
        background: var(--elevated-2);
        color: var(--label);
        box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
    }
    /* The status bar's highlight slides (and drags) between sections. */
    .segmented button {
        position: relative;
        z-index: 1;
    }
    .segmented:global(.glides) button.on {
        background: transparent;
        box-shadow: none;
    }
    .segmented :global(.glider) {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 0;
        border-radius: 7px;
        background: var(--elevated-2);
        box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
        pointer-events: none;
        will-change: transform, width;
    }
    .segmented:global(.dragging),
    .segmented:global(.dragging) button {
        cursor: grabbing;
        user-select: none;
    }
    /* Sort and Edit: the same height as the bars beside them. */
    .pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 36px;
        padding: 0 14px;
        border: 0;
        border-radius: var(--radius);
        background: var(--fill);
        color: var(--label);
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
        transition: background var(--fast);
    }
    .pill:hover,
    .pill:global([aria-expanded='true']) {
        background: var(--fill-hover);
    }
    .sort-icon {
        display: none;
    }
    /* Done: the emphasized one, as Apple's Edit/Done. */
    .edit {
        min-width: 64px;
    }
    .edit.done {
        background: var(--accent);
        color: white;
    }
    .edit.done:hover {
        background: var(--accent-hover);
    }
    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(var(--poster-w), 1fr));
        gap: 24px 16px;
        padding-top: 8px;
    }
    .loading {
        color: var(--label-2);
    }

    /* Edit: each poster a toggle, with a circle at its top right. */
    .cell {
        position: relative;
        min-width: 0;
    }
    .cell :global(.poster) {
        transition: box-shadow var(--fast);
    }
    .cell.on :global(.poster) {
        box-shadow: 0 0 0 3px var(--accent);
    }
    .pick {
        position: absolute;
        inset: 0;
        border: 0;
        border-radius: var(--radius);
        background: transparent;
        cursor: pointer;
    }
    .pick:focus-visible {
        outline: 2px solid var(--label);
        outline-offset: 2px;
    }
    .mark {
        position: absolute;
        top: 8px;
        right: 8px;
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid white;
        background: rgb(0 0 0 / 0.35);
        color: white;
        box-shadow: 0 1px 4px rgb(0 0 0 / 0.5);
    }
    .cell.on .mark {
        border-color: var(--accent);
        background: var(--accent);
    }

    /* The toolbar for what's selected: floating at the bottom on PC. */
    .toolbar {
        position: fixed;
        left: 50%;
        bottom: calc(24px + var(--tabbar-h));
        z-index: 20;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 8px;
        border: 1px solid var(--separator);
        border-radius: var(--radius-l);
        background: var(--elevated);
        box-shadow: 0 12px 32px rgb(0 0 0 / 0.5);
        white-space: nowrap;
    }
    .toolbar button {
        height: 36px;
        padding: 0 14px;
        border: 0;
        border-radius: var(--radius);
        background: var(--fill);
        color: var(--label);
        font-weight: 600;
        cursor: pointer;
    }
    .toolbar button:hover:not(:disabled) {
        background: var(--fill-hover);
    }
    .toolbar button:disabled {
        color: var(--label-3);
        cursor: default;
    }
    .toolbar .plain {
        background: transparent;
        color: var(--accent-text);
    }
    .toolbar .destructive:not(:disabled) {
        color: var(--bad);
    }
    .count {
        min-width: 110px;
        color: var(--label-2);
        font-variant-numeric: tabular-nums;
        text-align: center;
    }
    .acts {
        display: flex;
        gap: 8px;
    }
    .done-note {
        position: fixed;
        left: 50%;
        bottom: calc(24px + var(--tabbar-h));
        z-index: 20;
        transform: translateX(-50%);
        margin: 0;
        padding: 10px 16px;
        border-radius: var(--radius-l);
        background: var(--elevated);
        border: 1px solid var(--separator);
        box-shadow: 0 12px 32px rgb(0 0 0 / 0.5);
    }

    @media (pointer: coarse) {
        .segmented button,
        .pill,
        .toolbar button {
            height: 44px;
        }
    }
    /* Phones: the status bar a row of its own, scrolling sideways when it
       doesn't all fit; Type, then Sort (an icon) and Edit under it. The
       toolbar sits on the tab bar, edge to edge. */
    @media (max-width: 600px) {
        .status {
            flex: 1 1 100%;
            min-width: 0;
            overflow-x: auto;
            scrollbar-width: none;
        }
        .segmented button {
            flex: none;
            padding: 0 12px;
        }
        .tools {
            flex: 1 1 100%;
            margin-left: 0;
        }
        .tools > :first-child {
            margin-right: auto;
        }
        .sort {
            width: 44px;
            padding: 0;
        }
        .sort-text {
            display: none;
        }
        .sort-icon {
            display: contents;
        }
        .toolbar {
            left: 0;
            right: 0;
            bottom: var(--tabbar-h);
            transform: none;
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 8px;
            padding: 10px var(--gutter);
            border-width: 1px 0 0;
            border-radius: 0;
            box-shadow: none;
        }
        .count {
            min-width: 0;
            text-align: right;
        }
        .acts {
            grid-column: 1 / -1;
        }
        .acts button {
            flex: 1;
            padding: 0 8px;
        }
        .done-note {
            bottom: calc(16px + var(--tabbar-h));
            width: max-content;
            max-width: calc(100vw - 32px);
        }
    }
</style>
