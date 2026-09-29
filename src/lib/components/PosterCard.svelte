<script lang="ts">
    import type { MetaItemPreview } from '$lib/core/types';

    let { item }: { item: MetaItemPreview } = $props();
    let loaded = $state(false);
</script>

<button class="card" title={item.name}>
    <div class="poster" class:loaded>
        {#if item.poster}
            <img
                src={item.poster}
                alt=""
                loading="lazy"
                decoding="async"
                width="150"
                height="225"
                onload={() => (loaded = true)}
            />
        {:else}
            <span class="fallback">{item.name}</span>
        {/if}
    </div>
    <span class="name">{item.name}</span>
</button>

<style>
    .card {
        all: unset;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 8px;
        scroll-snap-align: start;
        min-width: 0;
    }
    .poster {
        aspect-ratio: 2 / 3;
        border-radius: var(--radius);
        overflow: hidden;
        background: var(--surface);
        /* Only transform/opacity are animated: cheap, GPU-composited. */
        transition: transform 160ms ease;
    }
    .card:hover .poster,
    .card:focus-visible .poster {
        transform: scale(1.04);
    }
    .card:focus-visible .poster {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        opacity: 0;
        transition: opacity 200ms ease;
    }
    .loaded img {
        opacity: 1;
    }
    .fallback {
        display: grid;
        place-items: center;
        height: 100%;
        padding: 8px;
        text-align: center;
        color: var(--text-dim);
        font-size: 0.85rem;
    }
    .name {
        font-size: 0.85rem;
        color: var(--text-dim);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
