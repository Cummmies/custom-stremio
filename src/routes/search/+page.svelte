<script lang="ts">
    import { page } from '$app/state';
    import { goto } from '$lib/nav';
    import Icon from '$lib/components/Icon.svelte';
    import { isIOS, isTV } from '$lib/platform';
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
    // Phones: the search field lives on this page (the top bar's is hidden there).
    let field = $state('');
    let typing: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
        field = query;
    });
    function search(q: string) {
        const t = q.trim();
        goto(t ? `/search?q=${encodeURIComponent(t)}` : '/search', { replaceState: true, keepFocus: true, noScroll: true });
    }

    const nothingFound = $derived(settled && catalogs.every((c) => c.content?.type !== 'Ready' || c.content.content.length === 0));
</script>

<svelte:head><title>{query ? `${query} · Search` : 'Search'} · Stremio</title></svelte:head>

<div class="page">
    <form class="field" role="search" onsubmit={(e) => (e.preventDefault(), clearTimeout(typing), search(field))}>
        <Icon name="search" size={17} />
        <input
            type="search"
            bind:value={field}
            oninput={() => {
                clearTimeout(typing);
                typing = setTimeout(() => search(field), 400);
            }}
            placeholder="Movies, series…"
            aria-label="Search movies and series"
            enterkeyhint="search"
            autocomplete="off"
            spellcheck="false"
        />
    </form>
    {#if !query}
        <EmptyState icon="search" title="Find something to watch">
            <p>Search movies and series across all your addons.{#if !isIOS && !isTV}{' '}Press Ctrl K from anywhere to start typing.{/if}</p>
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
    .field {
        display: none;
    }
    @media (max-width: 700px) {
        .page {
            padding-top: calc(var(--nav-h) + 8px);
        }
        .field {
            display: flex;
            align-items: center;
            gap: 8px;
            height: 40px;
            margin: 0 var(--gutter) 20px;
            padding: 0 12px;
            border-radius: 12px;
            background: var(--fill-hover);
            color: var(--label-2);
        }
        .field input {
            flex: 1;
            min-width: 0;
            border: 0;
            background: none;
            color: var(--label);
            /* 16px or more, or iOS zooms the page when the field is focused. */
            font-size: 17px;
            outline: none;
        }
    }
    .rows {
        display: flex;
        flex-direction: column;
        gap: 28px;
    }
</style>
