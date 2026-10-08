<script lang="ts">
    // Library. With Lightboxd connected (docs/lightboxd.md): what you track by
    // status (Watching, Plan to Watch, Completed by month of your last watch,
    // Dropped); the address says which (?status=watching, which Continue
    // Watching's See All opens). The menu beside them: Movies or Series, and
    // Recent or Highest Rated (by your score). Without Lightboxd: your Stremio
    // library.
    import { page } from '$app/state';
    import { goto, appUrl } from '$lib/nav';
    import { app } from '$lib/app.svelte';
    import { libraryToPoster } from '$lib/library';
    import { lightboxd } from '$lib/lightboxd.svelte';
    import { lb, day, score, STATUS_LABEL, type LibraryItem, type Status } from '$lib/lightboxd/api';
    import PosterCard, { type PosterItem } from '$lib/components/PosterCard.svelte';
    import PopupButton from '$lib/components/menu/PopupButton.svelte';
    import type { MenuEntry } from '$lib/menu.svelte';
    import EmptyState from '$lib/components/EmptyState.svelte';

    const filters = [
        { value: 'all', label: 'All' },
        { value: 'movie', label: 'Movies' },
        { value: 'series', label: 'Series' },
    ];
    let type = $state<string>('all');
    const keep = (t: string) => type === 'all' || t === type;

    // --- Stremio's library (no Lightboxd) ---
    // The library is already loaded app-wide, so filtering is instant.
    const items = $derived((app.library?.catalog ?? []).filter((i) => keep(i.type)).map(libraryToPoster));

    // --- Lightboxd ---
    const STATUSES: Status[] = ['watching', 'plan_to_watch', 'completed', 'dropped'];
    const sections = STATUSES.map((st) => ({ id: st as string, label: STATUS_LABEL[st] }));
    const ids = sections.map((x) => x.id);
    let section = $state<string>('watching');
    let sort = $state<'recent' | 'rating'>('recent');
    // The address says which (a row's See All links straight to one).
    $effect(() => {
        const asked = appUrl(page.url).searchParams.get('status');
        // An old link to Ratings: what you've completed, highest rated first.
        if (asked === 'ratings') {
            section = 'completed';
            sort = 'rating';
            return;
        }
        section = asked && ids.includes(asked) ? asked : 'watching';
    });
    const sortMenu = $derived<MenuEntry[]>([
        { header: 'Sort' },
        { label: 'Recent', checked: sort === 'recent', onselect: () => (sort = 'recent') },
        { label: 'Highest Rated', checked: sort === 'rating', onselect: () => (sort = 'rating') },
    ]);
    const typeLabel = $derived(filters.find((f) => f.value === type)?.label ?? 'All');
    const menuLabel = $derived(sort === 'rating' ? `${typeLabel} · Highest Rated` : typeLabel);
    function pick(next: string) {
        goto(next === 'watching' ? '/library' : `/library?status=${next}`, { replaceState: true, noScroll: true, keepFocus: true });
    }
    let loaded = $state<Record<string, LibraryItem[] | null | undefined>>({});

    // Each loads when first shown (and again when Lightboxd comes back).
    $effect(() => {
        const k = section;
        if (!lightboxd.ready || loaded[k] !== undefined) return;
        loaded = { ...loaded, [k]: null };
        lb.library('titles', k as Status).then((res) => {
            loaded = { ...loaded, [k]: res ? res.items : undefined };
        });
    });
    // Highest Rated: your score, highest first (unscored last, as they were).
    const current = $derived.by(() => {
        const list = (loaded[section] ?? null)?.filter((i) => keep(i.type)) ?? null;
        if (!list || sort !== 'rating') return list;
        return [...list].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    });

    const poster = (i: LibraryItem, below: string | null): PosterItem => ({
        id: i.id,
        type: i.type,
        name: i.name,
        poster: i.poster,
        releaseInfo: below,
        progress: null,
    });

    type Group = { title: string; items: PosterItem[]; keys: string[] };
    const thisYear = String(new Date().getFullYear());
    const groups = $derived.by((): Group[] => {
        if (!current) return [];
        if (sort === 'rating') {
            // By score: 9 and up, 8, 7…; unscored ones last.
            const out: Group[] = [];
            for (const i of current) {
                const band = i.rating == null ? 'Not Rated' : i.rating >= 9 ? '9 and Up' : String(Math.floor(i.rating));
                let g = out.find((x) => x.title === band);
                if (!g) out.push((g = { title: band, items: [], keys: [] }));
                g.items.push(poster(i, i.rating != null ? score(i.rating) : i.year));
                g.keys.push(String(i.title_id));
            }
            return out;
        }
        if (section === 'completed') {
            const out: Group[] = [];
            for (const i of current) {
                const month = i.date
                    ? (day(i.date, { month: 'long', year: i.date.startsWith(thisYear) ? undefined : 'numeric' }) ?? 'Date Unknown')
                    : 'Date Unknown';
                const below = [
                    day(i.date, { month: 'short', day: 'numeric' }),
                    i.rating != null ? score(i.rating) : null,
                    (i.watches ?? 0) > 1 ? `Watched ${i.watches}×` : null,
                ]
                    .filter(Boolean)
                    .join(' · ');
                let g = out.find((x) => x.title === month);
                if (!g) out.push((g = { title: month, items: [], keys: [] }));
                g.items.push(poster(i, below || i.year));
                g.keys.push(String(i.title_id));
            }
            return out;
        }
        return [{ title: '', items: current.map((i) => poster(i, i.year)), keys: current.map((i) => String(i.title_id)) }];
    });

    const emptyText = $derived(
        section === 'completed'
              ? { title: 'Nothing completed yet', body: 'What you finish watching shows up here.' }
              : section === 'watching'
                ? { title: 'Nothing you’re watching', body: 'Start something, or set a title to Watching with the + button on its page.' }
                : { title: `Nothing ${STATUS_LABEL[section as Status].toLowerCase()}`, body: 'Set a title’s status with the + button on its page.' }
    );
</script>

<svelte:head><title>Library · Stremio</title></svelte:head>

<div class="page">
    <header>
        <h1>Library</h1>
        {#if lightboxd.ready}
            <div class="segmented" role="radiogroup" aria-label="Section">
                {#each sections as s (s.id)}
                    <button role="radio" aria-checked={section === s.id} class:on={section === s.id} onclick={() => pick(s.id)}>{s.label}</button>
                {/each}
            </div>
        {/if}
        <div class="type">
            <PopupButton label="Show and Sort" heading="Show" bind:value={type} options={filters} extra={lightboxd.ready ? sortMenu : []} display={menuLabel} />
        </div>
    </header>

    {#if lightboxd.ready}
        {#if current === null}
            <p class="loading" role="status">Loading…</p>
        {:else if current.length === 0}
            <EmptyState icon="library" title={type === 'all' ? emptyText.title : `No ${type === 'movie' ? 'movies' : 'series'} here`}>
                <p>{emptyText.body}</p>
            </EmptyState>
        {:else}
            {#each groups as g (g.title)}
                {#if g.title}<h2>{g.title}</h2>{/if}
                <div class="grid">
                    {#each g.items as item, n (g.keys[n])}
                        <PosterCard {item} />
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
            <EmptyState icon="library" title="No {type === 'movie' ? 'movies' : 'series'} saved">
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

<style>
    .page {
        padding: calc(var(--nav-h) + 24px) var(--gutter) 56px;
    }
    /* PC: the title, then the sections and Movies/Series at the right. */
    header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 24px;
    }
    h1 {
        margin: 0 auto 0 0;
        font-family: var(--font-display);
        font-size: var(--text-title2);
        font-weight: 600;
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
    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(var(--poster-w), 1fr));
        gap: 24px 16px;
        padding-top: 8px;
    }
    .loading {
        color: var(--label-2);
    }
    @media (pointer: coarse) {
        .segmented button {
            height: 40px;
        }
    }
    /* Phones: Movies/Series beside the title; the sections a row of their
       own, scrolling sideways when they don't all fit. */
    @media (max-width: 600px) {
        .type {
            order: 1;
        }
        .segmented {
            order: 2;
            flex: 1 1 100%;
            min-width: 0;
            overflow-x: auto;
            scrollbar-width: none;
        }
        .segmented button {
            flex: none;
            padding: 0 12px;
            white-space: nowrap;
        }
    }
</style>
