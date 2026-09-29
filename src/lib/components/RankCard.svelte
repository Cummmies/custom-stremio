<script lang="ts">
    // Top 10 card: an oversized rank numeral tucked behind the poster.
    import type { MetaItemPreview } from '$lib/core/types';
    import { arrowNav } from '$lib/keyboard';

    let { item, rank }: { item: MetaItemPreview; rank: number } = $props();
    let loaded = $state(false);
</script>

<button class="card" onkeydown={arrowNav} aria-label={`Number ${rank}: ${item.name}`}>
    <span class="rank" aria-hidden="true">{rank}</span>
    <div class="poster" class:loaded>
        {#if item.poster}
            <img src={item.poster} alt="" loading="lazy" decoding="async" width="140" height="210" onload={() => (loaded = true)} />
        {/if}
    </div>
</button>

<style>
    .card {
        all: unset;
        cursor: pointer;
        position: relative;
        display: flex;
        align-items: flex-end;
        justify-content: flex-end;
        height: 220px;
        scroll-snap-align: start;
    }
    .rank {
        position: absolute;
        left: 0;
        bottom: -18px;
        font-family: var(--font-display);
        font-size: 190px;
        font-weight: 800;
        line-height: 1;
        letter-spacing: -0.06em;
        color: var(--bg);
        -webkit-text-stroke: 2px rgb(255 255 255 / 0.6);
        paint-order: stroke fill;
        user-select: none;
    }
    .poster {
        position: relative;
        width: 140px;
        aspect-ratio: 2 / 3;
        border-radius: var(--radius);
        overflow: hidden;
        background: var(--elevated-2);
        box-shadow: -8px 0 24px rgb(0 0 0 / 0.6);
        transition:
            transform var(--fast) var(--ease),
            box-shadow var(--fast) var(--ease);
    }
    .card:hover .poster,
    .card:focus-visible .poster {
        transform: translateY(-4px);
        box-shadow:
            0 0 0 2px var(--label),
            0 14px 28px rgb(0 0 0 / 0.5);
    }
    .card:hover .rank,
    .card:focus-visible .rank {
        -webkit-text-stroke-color: rgb(255 255 255 / 0.95);
    }
    img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        opacity: 0;
        transition: opacity var(--slow) var(--ease);
    }
    .loaded img {
        opacity: 1;
    }
</style>
