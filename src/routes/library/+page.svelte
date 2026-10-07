<script lang="ts">
    // Library. With Lightboxd connected (docs/lightboxd.md): your Watchlist
    // (watching first), Watched (every watch, by month) and Ratings (by score),
    // from Lightboxd. Without it: your Stremio library, as before.
    import { app } from '$lib/app.svelte';
    import { libraryToPoster } from '$lib/library';
    import { lightboxd } from '$lib/lightboxd.svelte';
    import { lb, day, score, STATUS_SHORT, type LibraryItem } from '$lib/lightboxd/api';
    import PosterCard, { type PosterItem } from '$lib/components/PosterCard.svelte';
    import PopupButton from '$lib/components/menu/PopupButton.svelte';
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
    const sections = [
        { id: 'watchlist', label: 'Watchlist' },
        { id: 'watched', label: 'Watched' },
        { id: 'ratings', label: 'Ratings' },
    ] as const;
    type Section = (typeof sections)[number]['id'];
    let section = $state<Section>('watchlist');
    let loaded = $state<Partial<Record<Section, LibraryItem[] | null>>>({});

    // Each section loads when first shown (and again when Lightboxd comes back).
    $effect(() => {
        const s = section;
        if (!lightboxd.ready || loaded[s] !== undefined) return;
        loaded = { ...loaded, [s]: null };
        lb.library(s).then((res) => {
            loaded = { ...loaded, [s]: res ? res.items : undefined };
        });
    });
    const current = $derived((loaded[section] ?? null)?.filter((i) => keep(i.type)) ?? null);

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
        if (section === 'watchlist') {
            const below = (i: LibraryItem) => (i.status === 'watching' ? STATUS_SHORT.watching : i.year);
            return [{ title: '', items: current.map((i) => poster(i, below(i))), keys: current.map((i) => String(i.title_id)) }];
        }
        if (section === 'watched') {
            const out: Group[] = [];
            for (const i of current) {
                const month = i.date
                    ? (day(i.date, { month: 'long', year: i.date.startsWith(thisYear) ? undefined : 'numeric' }) ?? 'Date Unknown')
                    : 'Date Unknown';
                const below = [day(i.date, { month: 'short', day: 'numeric' }), i.rating != null ? score(i.rating) : null, i.rewatch ? 'Rewatch' : null]
                    .filter(Boolean)
                    .join(' · ');
                let g = out.find((x) => x.title === month);
                if (!g) out.push((g = { title: month, items: [], keys: [] }));
                g.items.push(poster(i, below || null));
                g.keys.push(String(i.log_id));
            }
            return out;
        }
        const out: Group[] = [];
        for (const i of current) {
            const r = i.rating ?? 0;
            const band = r >= 9 ? '9 and Up' : String(Math.floor(r));
            let g = out.find((x) => x.title === band);
            if (!g) out.push((g = { title: band, items: [], keys: [] }));
            g.items.push(poster(i, score(r)));
            g.keys.push(String(i.title_id));
        }
        return out;
    });

    const emptyText = $derived(
        section === 'watchlist'
            ? { title: 'Nothing on your watchlist', body: 'Use the + button on any title to save it here.' }
            : section === 'watched'
              ? { title: 'Nothing watched yet', body: 'What you finish here, or log in Lightboxd, shows up here.' }
              : { title: 'No ratings yet', body: 'Rate a title with the ★ button on its page.' }
    );
</script>

<svelte:head><title>Library · Stremio</title></svelte:head>

<div class="page">
    <header>
        <h1>Library</h1>
        <div class="controls">
            {#if lightboxd.ready}
                <div class="segmented" role="radiogroup" aria-label="Section">
                    {#each sections as s (s.id)}
                        <button role="radio" aria-checked={section === s.id} class:on={section === s.id} onclick={() => (section = s.id)}>{s.label}</button>
                    {/each}
                </div>
            {/if}
            <PopupButton label="Show" bind:value={type} options={filters} />
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
    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 16px;
        margin-bottom: 24px;
    }
    h1 {
        margin: 0;
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
    .controls {
        display: flex;
        align-items: center;
        gap: 10px;
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
    @media (max-width: 600px) {
        .controls {
            width: 100%;
        }
        .segmented {
            flex: 1;
        }
        .segmented button {
            flex: 1;
            padding: 0 6px;
        }
    }
</style>
