<script lang="ts">
    import PosterCard, { type PosterItem } from './PosterCard.svelte';
    import Icon from './Icon.svelte';

    let {
        title,
        items,
        loading = false,
        onspotlight,
    }: {
        title: string;
        items: PosterItem[] | null;
        loading?: boolean;
        onspotlight?: (item: PosterItem) => void;
    } = $props();

    let track = $state<HTMLElement>();
    let atStart = $state(true);
    let atEnd = $state(false);

    function updateEdges() {
        if (!track) return;
        atStart = track.scrollLeft < 8;
        atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8;
    }

    function page(direction: 1 | -1) {
        if (!track) return;
        track.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: 'smooth' });
    }

    $effect(() => {
        items;
        queueMicrotask(updateEdges);
    });
</script>

<section class="row" aria-label={title}>
    <header>
        <h2>{title}</h2>
    </header>

    <div class="viewport">
        {#if items && items.length > 0}
            <div class="track" bind:this={track} onscroll={updateEdges}>
                {#each items as item (item.id)}
                    <PosterCard {item} {onspotlight} />
                {/each}
            </div>
            <!-- Pointer affordance for paging; keyboard users use arrow keys on posters. -->
            <button class="pager left" class:hidden={atStart} onclick={() => page(-1)} tabindex="-1" aria-hidden="true">
                <Icon name="chevronLeft" size={22} />
            </button>
            <button class="pager right" class:hidden={atEnd} onclick={() => page(1)} tabindex="-1" aria-hidden="true">
                <Icon name="chevronRight" size={22} />
            </button>
        {:else if loading}
            <div class="track" aria-busy="true">
                {#each Array(9) as _}
                    <div class="skeleton"><div></div></div>
                {/each}
            </div>
        {/if}
    </div>
</section>

<style>
    .row {
        /* Skip layout and paint for rows that are off screen. */
        content-visibility: auto;
        contain-intrinsic-size: auto 340px;
    }
    header {
        padding: 0 var(--gutter);
        margin-bottom: 12px;
    }
    h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 600;
        letter-spacing: -0.01em;
    }
    .viewport {
        position: relative;
    }
    .track {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: var(--poster-w);
        gap: 16px;
        overflow-x: auto;
        overflow-y: hidden;
        overscroll-behavior-x: contain;
        scroll-snap-type: x mandatory;
        scroll-padding: 0 var(--gutter);
        /* Room for the hover lift and highlight so they're never clipped. */
        padding: 8px var(--gutter) 8px;
        margin-top: -8px;
        scrollbar-width: none;
    }
    .track::-webkit-scrollbar {
        display: none;
    }
    .pager {
        position: absolute;
        top: 0;
        bottom: 48px;
        width: var(--gutter);
        min-width: 36px;
        display: grid;
        place-items: center;
        border: 0;
        padding: 0;
        color: var(--label);
        cursor: pointer;
        opacity: 0;
        transition: opacity var(--fast);
    }
    .pager.left {
        left: 0;
        background: linear-gradient(to right, var(--bg) 20%, transparent);
    }
    .pager.right {
        right: 0;
        background: linear-gradient(to left, var(--bg) 20%, transparent);
    }
    .viewport:hover .pager:not(.hidden) {
        opacity: 1;
    }
    .pager.hidden {
        pointer-events: none;
    }
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
