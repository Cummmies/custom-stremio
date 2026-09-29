<script lang="ts">
    import { page } from '$app/state';
    import { core } from '$lib/core';
    import type { Board } from '$lib/core/types';
    import CatalogList from '$lib/components/CatalogList.svelte';
    import EmptyState from '$lib/components/EmptyState.svelte';

    let results = $state<Board | null>(null);
    const query = $derived(page.url.searchParams.get('q')?.trim() ?? '');

    $effect(() => core.watch<Board>('search', (s) => (results = s)));

    $effect(() => {
        if (query) {
            core.dispatch({ action: 'Load', args: { model: 'CatalogsWithExtra', args: { extra: [['search', query]] } } }, 'search');
        } else {
            core.dispatch({ action: 'Unload' }, 'search');
        }
    });

    const catalogs = $derived(results?.catalogs ?? []);
    const settled = $derived(catalogs.length > 0 && catalogs.every((c) => c.content && c.content.type !== 'Loading'));
    const nothingFound = $derived(settled && catalogs.every((c) => c.content?.type !== 'Ready' || c.content.content.length === 0));
</script>

<svelte:head><title>{query ? `${query} · Search` : 'Search'} · Stremio</title></svelte:head>

<div class="page">
    {#if !query}
        <EmptyState icon="search" title="Find something to watch">
            <p>Search movies and series across all your addons. Press Ctrl K from anywhere to start typing.</p>
        </EmptyState>
    {:else}
        <h1>Results for “{query}”</h1>
        {#if nothingFound}
            <EmptyState icon="search" title="No results">
                <p>Nothing matched “{query}”. Check the spelling or try a shorter title.</p>
            </EmptyState>
        {:else}
            <div class="rows">
                <CatalogList model="search" {catalogs} />
            </div>
        {/if}
    {/if}
</div>

<style>
    .page {
        padding: calc(var(--nav-h) + 24px) 0 56px;
    }
    h1 {
        margin: 0 0 24px;
        padding: 0 var(--gutter);
        font-family: var(--font-display);
        font-size: var(--text-title2);
        font-weight: 600;
    }
    .rows {
        display: flex;
        flex-direction: column;
        gap: 28px;
    }
</style>
