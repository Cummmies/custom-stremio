<script lang="ts" module>
    export type PosterItem = {
        id: string;
        type: string;
        name: string;
        poster: string | null;
        releaseInfo?: string | null;
        /** 0..1, shows a progress bar (continue watching) */
        progress?: number | null;
    };
</script>

<script lang="ts">
    import { arrowNav } from '$lib/keyboard';
    import { titleHref } from '$lib/links';
    import { titleContext } from '$lib/contextmenu';
    import { previewInHero } from '$lib/heroPreview.svelte';
    import type { MetaItemPreview } from '$lib/core/types';

    /** `wide`: a 16:9 tile (a landscape catalog) instead of a 2:3 poster. */
    /**
     * `timeOnArt`: releaseInfo is when it airs ("Tomorrow · 5:30 PM"), shown on
     * the picture; the description (what airs) goes under the title instead.
     */
    let { item, wide = false, timeOnArt = false }: { item: PosterItem; wide?: boolean; timeOnArt?: boolean } = $props();

    let loaded = $state(false);
    let failed = $state(false);

    // Catalog items are full previews (addable to the library); library items aren't.
    const preview = $derived('posterShape' in item ? item : undefined);
    const when = $derived(timeOnArt ? item.releaseInfo : null);
    const below = $derived(timeOnArt ? ((preview as MetaItemPreview | undefined)?.description ?? null) : item.releaseInfo);
    // What the Home banner shows while this card is hovered.
    const heroItem = $derived<MetaItemPreview>(
        (preview as MetaItemPreview | undefined) ?? {
            id: item.id,
            type: item.type,
            name: item.name,
            poster: item.poster,
            posterShape: 'poster',
            background: null,
            logo: null,
            description: null,
            releaseInfo: item.releaseInfo ?? null,
        }
    );
</script>

<a
    class="card"
    href={titleHref(item.type, item.id)}
    use:titleContext={{ type: item.type, id: item.id, name: item.name, preview }}
    use:previewInHero={heroItem}
    onkeydown={arrowNav}
    aria-label={[item.name, when, below].filter(Boolean).join(', ')}
>
    <div class="poster" class:loaded class:wide>
        {#if item.poster && !failed}
            <img
                src={item.poster}
                alt=""
                loading="lazy"
                decoding="async"
                width={wide ? 320 : 168}
                height={wide ? 180 : 252}
                onload={() => (loaded = true)}
                onerror={() => (failed = true)}
            />
        {/if}
        {#if !item.poster || failed}
            <span class="fallback">{item.name}</span>
        {/if}
        {#if when}
            <span class="when" aria-hidden="true">{when}</span>
        {/if}
        {#if item.progress != null && item.progress > 0}
            <span class="progress" aria-hidden="true"><span style="width: {Math.min(100, item.progress * 100)}%"></span></span>
        {/if}
    </div>
    <span class="name" aria-hidden="true">{item.name}</span>
    {#if below}<span class="meta" aria-hidden="true">{below}</span>{/if}
</a>

<style>
    .card {
        all: unset;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        min-width: 0;
        scroll-snap-align: start;
        border-radius: var(--radius);
        color: inherit;
    }
    .card:focus-visible {
        outline: none;
    }
    .poster {
        position: relative;
        aspect-ratio: 2 / 3;
    }
    .poster.wide {
        aspect-ratio: 16 / 9;
    }
    .poster {
        border-radius: var(--radius);
        overflow: hidden;
        background: var(--elevated-2);
        margin-bottom: 8px;
        transition:
            transform var(--fast) var(--ease),
            box-shadow var(--fast) var(--ease);
    }
    /* Hover lift + highlight: HIG prefers a highlight over a ring in collections. */
    .card:hover .poster,
    .card:focus-visible .poster {
        transform: translateY(-4px);
        box-shadow:
            0 0 0 2px var(--label),
            0 14px 28px rgb(0 0 0 / 0.5);
    }
    .card:active .poster {
        transform: translateY(-2px) scale(0.98);
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
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 12px;
        text-align: center;
        font-weight: 600;
        color: var(--label-2);
    }
    .progress {
        position: absolute;
        left: 8px;
        right: 8px;
        bottom: 8px;
        height: 4px;
        border-radius: 2px;
        background: rgb(255 255 255 / 0.25);
        overflow: hidden;
    }
    .progress span {
        display: block;
        height: 100%;
        background: var(--accent-hover);
    }
    /* When it airs, on the picture: a dark tag at the bottom left. */
    .when {
        position: absolute;
        left: 8px;
        bottom: 8px;
        display: flex;
        align-items: center;
        height: 24px;
        padding: 0 9px;
        border-radius: 6px;
        background: rgb(14 14 20 / 0.72);
        color: white;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }
    :global(html.tv) .when {
        left: 10px;
        bottom: 10px;
        height: 30px;
        padding: 0 11px;
        font-size: 15px;
    }
    .name {
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .meta {
        font-size: var(--text-caption);
        color: var(--label-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
