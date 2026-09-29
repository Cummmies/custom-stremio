<script lang="ts">
    // Continue Watching card: 16:9 artwork, progress, and what's left.
    import type { LibraryItem } from '$lib/core/types';
    import { episodeLabel, timeLeft } from '$lib/library';
    import { arrowNav } from '$lib/keyboard';
    import { titleHref } from '$lib/links';
    import { titleContext } from '$lib/contextmenu';

    let { item }: { item: LibraryItem } = $props();

    const isImdb = $derived(/^tt\d+$/.test(item._id));
    const art = $derived(isImdb ? `https://images.metahub.space/background/small/${item._id}/img` : item.poster);
    const progress = $derived(item.state.duration > 0 ? Math.min(1, item.state.timeOffset / item.state.duration) : 0);
    const detail = $derived([episodeLabel(item), timeLeft(item)].filter(Boolean).join(' · '));

    let loaded = $state(false);
    let failed = $state(false);
</script>

<a
    class="card"
    href={titleHref(item.type, item._id, item.state.video_id && item.type === 'series' ? { video: item.state.video_id } : undefined)}
    use:titleContext={{ type: item.type, id: item._id, name: item.name }}
    onkeydown={arrowNav}
    aria-label={[item.name, detail].filter(Boolean).join(', ')}>
    <div class="art" class:loaded>
        {#if art && !failed}
            <img
                src={art}
                alt=""
                loading="lazy"
                decoding="async"
                width="320"
                height="180"
                onload={() => (loaded = true)}
                onerror={() => (failed = true)}
            />
        {:else}
            <span class="fallback">{item.name}</span>
        {/if}
        {#if progress > 0}
            <span class="progress" aria-hidden="true"><span style="width: {progress * 100}%"></span></span>
        {/if}
    </div>
    <span class="name" aria-hidden="true">{item.name}</span>
    {#if detail}<span class="detail" aria-hidden="true">{detail}</span>{/if}
</a>

<style>
    .card {
        all: unset;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        min-width: 0;
        scroll-snap-align: start;
        color: inherit;
    }
    .art {
        position: relative;
        aspect-ratio: 16 / 9;
        border-radius: var(--radius);
        overflow: hidden;
        background: var(--elevated-2);
        margin-bottom: 10px;
        transition:
            transform var(--fast) var(--ease),
            box-shadow var(--fast) var(--ease);
    }
    .card:hover .art,
    .card:focus-visible .art {
        transform: translateY(-3px);
        box-shadow:
            0 0 0 2px var(--label),
            0 14px 28px rgb(0 0 0 / 0.5);
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
    .fallback {
        display: grid;
        place-items: center;
        height: 100%;
        padding: 12px;
        text-align: center;
        font-weight: 600;
        color: var(--label-2);
    }
    .progress {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 4px;
        background: rgb(255 255 255 / 0.2);
    }
    .progress span {
        display: block;
        height: 100%;
        background: var(--label);
    }
    .name {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .detail {
        margin-top: 2px;
        font-size: var(--text-caption);
        color: var(--label-2);
    }
</style>
