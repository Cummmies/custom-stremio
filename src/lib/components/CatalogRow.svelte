<script lang="ts">
    import type { Catalog } from '$lib/core/types';
    import PosterCard from './PosterCard.svelte';

    let { catalog }: { catalog: Catalog } = $props();

    const title = $derived([catalog.name, catalog.type].filter(Boolean).join(' · '));
    const content = $derived(catalog.content);
</script>

<section class="row">
    <h2>{title}</h2>
    {#if content?.type === 'Ready'}
        <div class="track">
            {#each content.content as item (item.id)}
                <PosterCard {item} />
            {/each}
        </div>
    {:else if content?.type === 'Err'}
        <p class="muted">Couldn't load this catalog.</p>
    {:else}
        <div class="track">
            {#each Array(8) as _}
                <div class="skeleton"></div>
            {/each}
        </div>
    {/if}
</section>

<style>
    .row {
        /* Let the browser skip layout/paint for rows that are off screen. */
        content-visibility: auto;
        contain-intrinsic-size: auto 330px;
        padding: 0 var(--gutter);
    }
    h2 {
        font-size: 1.05rem;
        font-weight: 600;
        margin: 0 0 12px;
        text-transform: capitalize;
    }
    .track {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: var(--poster-w);
        gap: 14px;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        scroll-snap-type: x proximity;
        padding-bottom: 8px;
        scrollbar-width: thin;
    }
    .skeleton {
        aspect-ratio: 2 / 3;
        border-radius: var(--radius);
        background: var(--surface);
    }
    .muted {
        color: var(--text-dim);
        margin: 0;
    }
</style>
