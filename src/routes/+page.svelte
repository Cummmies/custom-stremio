<script lang="ts">
    import { onMount } from 'svelte';
    import { core } from '$lib/core';
    import type { Board, ContinueWatchingPreview, MetaItemPreview } from '$lib/core/types';
    import { libraryToPoster } from '$lib/library';
    import CatalogList from '$lib/components/CatalogList.svelte';
    import CatalogRow from '$lib/components/CatalogRow.svelte';
    import Spotlight from '$lib/components/Spotlight.svelte';
    import EmptyState from '$lib/components/EmptyState.svelte';
    import type { PosterItem } from '$lib/components/PosterCard.svelte';

    let board = $state<Board | null>(null);
    let continueWatching = $state<ContinueWatchingPreview | null>(null);
    let pointed = $state<MetaItemPreview | null>(null);

    const catalogs = $derived(board?.catalogs ?? []);
    const cwItems = $derived(continueWatching?.items.map(libraryToPoster) ?? []);

    // Until someone points at a title, feature the first one of the first loaded row.
    const firstReady = $derived.by(() => {
        for (const c of catalogs) {
            if (c.content?.type === 'Ready' && c.content.content.length) return c.content.content[0];
        }
        return null;
    });
    const spotlight = $derived(pointed ?? firstReady);

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

    // Wait for the pointer to settle so sweeping across a row doesn't flicker the backdrop.
    let timer: ReturnType<typeof setTimeout> | undefined;
    function onspotlight(item: PosterItem) {
        clearTimeout(timer);
        timer = setTimeout(() => (pointed = item as MetaItemPreview), 220);
    }
    $effect(() => () => clearTimeout(timer));
</script>

<svelte:head><title>Home · Stremio</title></svelte:head>

<Spotlight item={spotlight} />

<div class="rows">
    {#if cwItems.length > 0}
        <CatalogRow title="Continue Watching" items={cwItems} {onspotlight} />
    {/if}

    {#if !board}
        <CatalogRow title="Loading" items={null} loading />
    {:else if catalogs.length === 0}
        <EmptyState icon="library" title="Nothing to show yet">
            <p>Your addons don't provide any catalogs. Install an addon like Cinemeta to fill your home screen.</p>
        </EmptyState>
    {:else}
        <CatalogList model="board" {catalogs} {onspotlight} />
    {/if}
</div>

<style>
    .rows {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 28px;
        padding-bottom: 56px;
    }
</style>
