<script lang="ts">
    // Continue Watching card: 16:9 artwork, progress, and where you are.
    import type { LibraryItem } from '$lib/core/types';
    import { episodeLabel, libraryItemPreview, newEpisodeCount } from '$lib/library';
    import { arrowNav } from '$lib/keyboard';
    import { titleHref } from '$lib/links';
    import { titleContext } from '$lib/contextmenu';
    import { previewInHero } from '$lib/heroPreview.svelte';
    import { cleanVideoId, resumeHref } from '$lib/player/deeplink';
    import { canPlay } from '$lib/platform';
    import { playerPrefs } from '$lib/player/prefs.svelte';
    import { lightboxd } from '$lib/lightboxd.svelte';
    import { app } from '$lib/app.svelte';

    let { item }: { item: LibraryItem } = $props();

    const isImdb = $derived(/^tt\d+$/.test(item._id));
    const art = $derived(isImdb ? `https://images.metahub.space/background/small/${item._id}/img` : item.poster);
    const progress = $derived(Math.min(1, Math.max(0, item.progress / 100)));
    const detail = $derived(episodeLabel(item) ?? '');
    // New episodes out since you last watched: "+N" in the corner. For anime,
    // Lightboxd's count when it's connected (it knows when the dub is out, if
    // that's what you watch); otherwise Stremio's own, minus episodes you've seen.
    const lightboxdCount = $derived(lightboxd.ready ? lightboxd.newEpisodes[item._id] : undefined);
    const stremioCount = $derived(newEpisodeCount(item, app.ctx?.notifications?.items[item._id]));
    const fresh = $derived(item.type === 'series' ? Math.max(0, lightboxdCount ?? stremioCount) : 0);
    const freshLabel = $derived(fresh ? `${fresh} new ${fresh === 1 ? 'episode' : 'episodes'}` : '');
    const resumeVideo = $derived(item.type === 'series' ? cleanVideoId(item.state?.videoId) : null);
    // Core remembers the stream you last used; if it has one, go straight back to it.
    // Otherwise Easy Mode picks a source for the episode (or movie) you were on, and
    // without it you choose. Not knowing the episode, open the title's episode list.
    const target = $derived(item.type === 'series' ? resumeVideo : item._id);
    const href = $derived(
        (canPlay && resumeHref(item.deepLinks?.player)) ||
            (target
                ? titleHref(item.type, item._id, playerPrefs.easyMode && canPlay ? { video: target, auto: '1' } : { video: target })
                : titleHref(item.type, item._id))
    );

    let loaded = $state(false);
    let failed = $state(false);
</script>

<a
    class="card"
    {href}
    use:titleContext={{ type: item.type, id: item._id, name: item.name, preview: libraryItemPreview(item) }}
    use:previewInHero={libraryItemPreview(item)}
    onkeydown={arrowNav}
    aria-label={[item.name, detail, freshLabel].filter(Boolean).join(', ')}>
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
        {#if fresh}
            <span class="fresh" aria-hidden="true" title={freshLabel}>+{fresh > 99 ? '99' : fresh}</span>
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
    /* "+N" new episodes: the same dark tag as an air time on Airing This
       Week (PosterCard's .when), in the top right corner. Flex-centred at a
       fixed height, so the digits sit in the middle. */
    .fresh {
        position: absolute;
        top: 8px;
        right: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 24px;
        padding: 0 9px;
        border-radius: 6px;
        background: var(--scrim-tag);
        color: white;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        font-variant-numeric: tabular-nums;
    }
    :global(html.tv) .fresh {
        top: 10px;
        right: 10px;
        height: 30px;
        padding: 0 11px;
        font-size: 15px;
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
