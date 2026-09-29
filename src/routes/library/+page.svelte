<script lang="ts">
    import { app } from '$lib/app.svelte';
    import { libraryToPoster } from '$lib/library';
    import PosterCard from '$lib/components/PosterCard.svelte';
    import EmptyState from '$lib/components/EmptyState.svelte';

    const filters = [
        { type: null, label: 'All' },
        { type: 'movie', label: 'Movies' },
        { type: 'series', label: 'Series' },
    ] as const;

    let type = $state<string | null>(null);

    // The library is already loaded app-wide, so filtering is instant.
    const items = $derived(
        (app.library?.catalog ?? []).filter((i) => !type || i.type === type).map(libraryToPoster)
    );
</script>

<svelte:head><title>Library · Stremio</title></svelte:head>

<div class="page">
    <header>
        <h1>Library</h1>
        <div class="segmented" role="radiogroup" aria-label="Filter by type">
            {#each filters as f (f.label)}
                <button role="radio" aria-checked={type === f.type} class:on={type === f.type} onclick={() => (type = f.type)}>
                    {f.label}
                </button>
            {/each}
        </div>
    </header>

    {#if app.library && items.length === 0}
        {#if !app.user}
            <EmptyState icon="library" title="Keep your library in sync">
                <p>Log in to bring over your library and watch progress from your other Stremio apps.</p>
                <button onclick={() => app.openLogin()}>Log In</button>
            </EmptyState>
        {:else if type}
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
        gap: 16px;
        margin-bottom: 24px;
    }
    h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title2);
        font-weight: 600;
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
</style>
