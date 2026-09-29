<script lang="ts">
    // Home, Movies and Series share this layout; `type` narrows it to one kind.
    import { onMount } from 'svelte';
    import { core } from '$lib/core';
    import type { Board, ContinueWatchingPreview, MetaItemPreview } from '$lib/core/types';
    import { backgroundOf } from '$lib/core/art';
    import Hero from './Hero.svelte';
    import Shelf from './Shelf.svelte';
    import WideCard from './WideCard.svelte';
    import RankCard from './RankCard.svelte';
    import CategoryTiles from './CategoryTiles.svelte';
    import CatalogList, { catalogAnchor, catalogTitle, isEmptyCatalog } from './CatalogList.svelte';
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
    const featured = $derived.by(() => {
        const first = ofType.find(({ index }) => readyItems(index).length > 0);
        if (!first) return { items: [] as MetaItemPreview[], badge: '' };
        return {
            items: readyItems(first.index).filter((m) => backgroundOf(m)).slice(0, 6),
            badge: catalogTitle(first.c),
        };
    });

    // Top 10: the first catalog of this kind, which is the most popular one.
    const top10 = $derived.by(() => {
        const first = ofType.find(({ index }) => readyItems(index).length > 0);
        return first
            ? {
                  index: first.index,
                  items: readyItems(first.index).slice(0, 10),
                  title: `Top 10 ${first.c.type === 'series' ? 'Series' : 'Movies'} Today`,
              }
            : null;
    });

    const cwItems = $derived((continueWatching?.items ?? []).filter((i) => !type || i.type === type));

    const tiles = $derived(
        ofType
            .filter(({ c }) => !isEmptyCatalog(c))
            .map(({ c, index }) => {
                const first = readyItems(index)[0];
                return {
                    label: type ? c.name ?? catalogTitle(c) : catalogTitle(c),
                    anchor: catalogAnchor(index),
                    art: first?.id.startsWith('tt') ? `https://images.metahub.space/background/small/${first.id}/img` : (first?.poster ?? null),
                };
            })
    );

    const pageTitle = $derived(type === 'movie' ? 'Movies' : type === 'series' ? 'Series' : 'Home');
</script>

<svelte:head><title>{pageTitle} · Stremio</title></svelte:head>

<Hero items={featured.items} badge={featured.badge} />

<div class="content">
    {#if tiles.length > 1}
        <CategoryTiles {tiles} />
    {/if}

    {#if cwItems.length > 0}
        <Shelf title="Continue Watching" href="/library" itemWidth="clamp(240px, 21vw, 320px)">
            {#each cwItems as item (item._id)}
                <WideCard {item} />
            {/each}
        </Shelf>
    {/if}

    {#if top10 && top10.items.length >= 5}
        <Shelf title={top10.title} itemWidth="max-content" gap="20px">
            {#each top10.items as item, i (item.id)}
                <RankCard {item} rank={i + 1} />
            {/each}
        </Shelf>
    {/if}

    {#if board && ofType.length === 0}
        <EmptyState icon="library" title="Nothing here yet">
            <p>None of your addons provide {type === 'series' ? 'series' : type === 'movie' ? 'movie' : ''} catalogs. Install an addon like Cinemeta to fill this page.</p>
        </EmptyState>
    {:else}
        <!-- The Top 10 already shows that catalog's first ten; its row continues from #11. -->
        <CatalogList
            model="board"
            {catalogs}
            {type}
            continueFrom={top10 && top10.items.length >= 5 ? { index: top10.index, skip: top10.items.length } : null}
        />
    {/if}
</div>

<style>
    .content {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 36px;
        padding-bottom: 64px;
    }
</style>
