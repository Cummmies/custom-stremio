<script lang="ts">
    import Shelf from './Shelf.svelte';
    import PosterCard, { type PosterItem } from './PosterCard.svelte';
    import { WIDE_ITEM_WIDTH } from '$lib/shelf';

    let {
        title,
        id,
        items,
        loading = false,
        timeOnArt = false,
    }: {
        title: string;
        id?: string;
        items: PosterItem[] | null;
        loading?: boolean;
        /** When it airs on the picture, what airs under the title (Airing This Week). */
        timeOnArt?: boolean;
    } = $props();

    // An addon can ask for wide tiles (posterShape "landscape", as Stremio's own
    // apps honor): a row whose items all do gets 16:9 cards, Continue Watching's size.
    const wide = $derived(
        !!items?.length && items.every((i) => (i as { posterShape?: string }).posterShape === 'landscape')
    );
</script>

<Shelf {title} {id} busy={loading} itemWidth={wide ? WIDE_ITEM_WIDTH : undefined}>
    {#if items && items.length > 0}
        {#each items as item (item.id)}
            <PosterCard {item} {wide} {timeOnArt} />
        {/each}
    {:else if loading}
        {#each Array(9) as _}
            <div class="skeleton"><div></div></div>
        {/each}
    {/if}
</Shelf>

<style>
    .skeleton div {
        aspect-ratio: 2 / 3;
        border-radius: var(--radius);
        background: var(--elevated-2);
        animation: pulse 1.6s ease-in-out infinite;
    }
    .skeleton::after {
        content: '';
        display: block;
        height: 12px;
        width: 70%;
        margin-top: 10px;
        border-radius: 4px;
        background: var(--elevated-2);
    }
    @keyframes pulse {
        50% {
            opacity: 0.55;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .skeleton div {
            animation: none;
        }
    }
</style>
