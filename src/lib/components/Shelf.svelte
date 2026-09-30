<script lang="ts">
    // A titled, horizontally scrolling row. Every rail on Home is one of these.
    import type { Snippet } from 'svelte';
    import Icon from './Icon.svelte';

    let {
        title,
        href,
        id,
        itemWidth = 'var(--poster-w)',
        gap = '16px',
        busy = false,
        children,
    }: {
        title: string;
        href?: string;
        id?: string;
        itemWidth?: string;
        gap?: string;
        busy?: boolean;
        children: Snippet;
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
        track?.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: 'smooth' });
    }

    $effect(() => {
        if (!track) return;
        updateEdges();
        const ro = new ResizeObserver(updateEdges);
        ro.observe(track);
        return () => ro.disconnect();
    });
</script>

<section class="shelf" aria-label={title} {id}>
    <header>
        <h2>{title}</h2>
        {#if href}<a class="see-all" {href}>See All</a>{/if}
    </header>

    <div class="viewport">
        <div
            class="track"
            bind:this={track}
            onscroll={updateEdges}
            aria-busy={busy}
            style:--item-w={itemWidth}
            style:--gap={gap}
        >
            {@render children()}
        </div>
        <!-- Pointer affordance for paging; keyboard users move with arrow keys. -->
        <button class="pager left" class:hidden={atStart} onclick={() => page(-1)} tabindex="-1" aria-hidden="true">
            <Icon name="chevronLeft" size={22} />
        </button>
        <button class="pager right" class:hidden={atEnd} onclick={() => page(1)} tabindex="-1" aria-hidden="true">
            <Icon name="chevronRight" size={22} />
        </button>
    </div>
</section>

<style>
    .shelf {
        content-visibility: auto;
        contain-intrinsic-size: auto 320px;
        scroll-margin-top: calc(var(--nav-h) + 16px);
    }
    header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 16px;
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
    .see-all {
        font-size: 13px;
        font-weight: 600;
        color: var(--label-2);
        text-decoration: none;
        border-radius: 4px;
    }
    .see-all:hover {
        color: var(--label);
    }
    .viewport {
        position: relative;
    }
    .track {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: var(--item-w);
        gap: var(--gap);
        overflow-x: auto;
        overflow-y: hidden;
        overscroll-behavior-x: contain;
        scroll-snap-type: x mandatory;
        scroll-padding: 0 var(--gutter);
        /* Room for the hover lift and highlight so they're never clipped. */
        padding: 8px var(--gutter);
        margin-top: -8px;
        scrollbar-width: none;
    }
    .track::-webkit-scrollbar {
        display: none;
    }
    .pager {
        position: absolute;
        top: 0;
        bottom: 44px;
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
        background: linear-gradient(to right, var(--bg) 25%, transparent);
    }
    .pager.right {
        right: 0;
        background: linear-gradient(to left, var(--bg) 25%, transparent);
    }
    .viewport:hover .pager:not(.hidden) {
        opacity: 1;
    }
    .pager.hidden {
        pointer-events: none;
    }
    /* Phones: tighter rows so the next poster peeks in (it scrolls), no arrows. */
    @media (max-width: 700px) {
        .track {
            gap: 10px;
        }
        .pager {
            display: none;
        }
        header {
            margin-bottom: 8px;
        }
    }
</style>
