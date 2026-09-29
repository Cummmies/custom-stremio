<script lang="ts">
    import Shelf from './Shelf.svelte';
    import PosterCard, { type PosterItem } from './PosterCard.svelte';

    let {
        title,
        id,
        items,
        loading = false,
    }: { title: string; id?: string; items: PosterItem[] | null; loading?: boolean } = $props();
</script>

<Shelf {title} {id} busy={loading}>
    {#if items && items.length > 0}
        {#each items as item (item.id)}
            <PosterCard {item} />
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
