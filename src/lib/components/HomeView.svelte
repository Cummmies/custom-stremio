<script lang="ts">
    // Home, Movies and Series share this layout; `type` narrows it to one kind.
    import { onMount } from 'svelte';
    import { core } from '$lib/core';
    import type { Board, ContinueWatchingPreview, MetaItemPreview } from '$lib/core/types';
    import { backgroundOf } from '$lib/core/art';
    import Hero from './Hero.svelte';
    import Shelf from './Shelf.svelte';
    import WideCard from './WideCard.svelte';
    import CategoryTiles from './CategoryTiles.svelte';
    import CatalogList, { catalogTitle, isEmptyCatalog, rowAnchor, type ListRow } from './CatalogList.svelte';
    import { catalogKey, homeLayout, type BoardCatalog } from '$lib/homeLayout.svelte';
    import Icon from './Icon.svelte';
    import EmptyState from './EmptyState.svelte';

    let { type = null }: { type?: 'movie' | 'series' | null } = $props();

    let board = $state<Board | null>(null);
    let continueWatching = $state<ContinueWatchingPreview | null>(null);

    onMount(() => {
        const unwatch = [
            core.watch<Board>('board', (s) => (board = s)),
            core.watch<ContinueWatchingPreview>('continue_watching_preview', (s) => (continueWatching = s)),
        ];
        core.dispatch({ action: 'Load', args: { model: 'CatalogsWithExtra', args: { extra: [] } } }, 'board');
        return () => {
            unwatch.forEach((fn) => fn());
            core.dispatch({ action: 'Unload' }, 'board');
        };
    });

    const catalogs = $derived(board?.catalogs ?? []);
    const ofType = $derived(
        catalogs.map((c, index) => ({ c, index })).filter(({ c }) => !type || c.type === type)
    );
    const readyItems = (i: number) => {
        const c = catalogs[i];
        return c?.content?.type === 'Ready' ? c.content.content : [];
    };

    // Hero: the top titles of the first loaded catalog (for Home, favor movies then series).
    const featured = $derived.by((): MetaItemPreview[] => {
        const first = ofType.find(({ index }) => readyItems(index).length > 0);
        return first ? readyItems(first.index).filter((m) => backgroundOf(m)).slice(0, 6) : [];
    });

    const cwItems = $derived((continueWatching?.items ?? []).filter((i) => !type || i.type === type));

    // Rows in the order set in Customize Home (per profile): hidden ones left out,
    // renamed and merged ones as set. Movies / Series keep only their own catalogs.
    $effect(() => homeLayout.sync());
    const boardCatalogs = $derived(catalogs as BoardCatalog[]);
    const indexByKey = $derived(new Map(boardCatalogs.map((c, i) => [catalogKey(c), i])));
    const resolved = $derived(
        homeLayout.resolve(boardCatalogs, new Map(boardCatalogs.map((c) => [catalogKey(c), catalogTitle(c)])))
    );
    const rows = $derived<ListRow[]>(
        resolved
            .filter((r) => !r.hidden)
            .map((r): ListRow => {
                if (r.kind === 'special') return { key: r.key, title: r.name, special: true, indices: [] };
                const indices = r.parts
                    .map((p) => indexByKey.get(p))
                    .filter((i): i is number => i != null && (!type || catalogs[i].type === type));
                return { key: r.key, title: r.name, indices };
            })
            .filter((r) => r.special || r.indices.length > 0)
    );

    const tiles = $derived(
        rows
            .filter((r) => !r.special && r.indices.some((i) => !isEmptyCatalog(catalogs[i])))
            .map((r) => {
                const first = readyItems(r.indices[0])[0];
                return {
                    label: r.title,
                    anchor: rowAnchor(r.key),
                    art: first?.id.startsWith('tt') ? `https://images.metahub.space/background/small/${first.id}/img` : (first?.poster ?? null),
                };
            })
    );

    const pageTitle = $derived(type === 'movie' ? 'Movies' : type === 'series' ? 'Series' : 'Home');
</script>

<svelte:head><title>{pageTitle} · Stremio</title></svelte:head>

<Hero items={featured} />

<div class="content">
    {#if tiles.length > 1}
        <CategoryTiles {tiles} />
    {/if}

    {#if board && ofType.length === 0}
        <EmptyState icon="library" title="Nothing here yet">
            <p>None of your addons provide {type === 'series' ? 'series' : type === 'movie' ? 'movie' : ''} catalogs. Install an addon like Cinemeta to fill this page.</p>
        </EmptyState>
    {:else}
        <CatalogList
            model="board"
            {catalogs}
            {type}
            {rows}
        >
            {#snippet special(key)}
                {#if key === 'cw' && cwItems.length > 0}
                    <Shelf title={resolved.find((r) => r.key === 'cw')?.name ?? 'Continue Watching'} href="/library" itemWidth="clamp(240px, 21vw, 320px)">
                        {#each cwItems as item (item._id)}
                            <WideCard {item} />
                        {/each}
                    </Shelf>
                {/if}
            {/snippet}
        </CatalogList>
    {/if}

    {#if !type && board}
        <div class="customize">
            <a class="customize-btn" href="/customize"><Icon name="gear" size={16} /> Customize Home</a>
        </div>
    {/if}
</div>

<style>
    .customize {
        display: flex;
        justify-content: center;
        padding: 8px var(--gutter) 0;
    }
    .customize-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 40px;
        padding: 0 18px;
        border-radius: 999px;
        border: 1px solid var(--separator);
        background: var(--fill);
        color: var(--label);
        font-weight: 600;
        text-decoration: none;
        transition: background var(--fast);
    }
    .customize-btn:hover {
        background: var(--fill-hover);
    }
    .content {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 36px;
        padding-bottom: 64px;
    }
    @media (max-width: 700px) {
        .content {
            gap: 26px;
        }
    }
</style>
