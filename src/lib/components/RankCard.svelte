<script lang="ts">
    // Top 10 card: an oversized rank numeral tucked behind the poster.
    import type { MetaItemPreview } from '$lib/core/types';
    import { arrowNav } from '$lib/keyboard';
    import { titleHref } from '$lib/links';
    import { titleContext } from '$lib/contextmenu';
    import { previewInHero } from '$lib/heroPreview.svelte';

    let { item, rank }: { item: MetaItemPreview; rank: number } = $props();
    let loaded = $state(false);
</script>

<a
    class="card"
    href={titleHref(item.type, item.id)}
    use:titleContext={{ type: item.type, id: item.id, name: item.name, preview: item }}
    use:previewInHero={item}
    onkeydown={arrowNav} aria-label={`Number ${rank}: ${item.name}`}>
    <span class="rank" aria-hidden="true">{rank}</span>
    <div class="poster" class:loaded>
        {#if item.poster}
            <img src={item.poster} alt="" loading="lazy" decoding="async" width="140" height="210" onload={() => (loaded = true)} />
        {/if}
    </div>
</a>

<style>
    /* Numeral and poster sit side by side; the poster only overlaps the numeral's
       trailing edge, so every rank (including "10") stays fully readable. */
    .card {
        all: unset;
        cursor: pointer;
        display: flex;
        align-items: flex-end;
        padding-top: 8px;
        scroll-snap-align: start;
    }
    .rank {
        flex: none;
        margin-right: -18px;
        font-family: var(--font-display);
        font-size: 168px;
        font-weight: 800;
        line-height: 0.74;
        letter-spacing: -0.07em;
        color: var(--bg);
        -webkit-text-stroke: 4px rgb(255 255 255 / 0.55);
        paint-order: stroke fill;
        user-select: none;
        transition: -webkit-text-stroke-color var(--fast);
    }
    .poster {
        position: relative;
        flex: none;
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
