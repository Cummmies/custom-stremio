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
    let { item, onspotlight }: { item: PosterItem; onspotlight?: (item: PosterItem) => void } = $props();

    let loaded = $state(false);
    let failed = $state(false);

    // Arrow keys move between posters in a row, like any native collection.
    function onkeydown(e: KeyboardEvent) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const card = e.currentTarget as HTMLElement;
        const next = (e.key === 'ArrowRight' ? card.nextElementSibling : card.previousElementSibling) as HTMLElement | null;
        if (next) {
            e.preventDefault();
            next.focus();
            next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        }
    }
</script>

<button
    class="card"
    onmouseenter={() => onspotlight?.(item)}
    onfocus={() => onspotlight?.(item)}
    {onkeydown}
    aria-label={[item.name, item.releaseInfo].filter(Boolean).join(', ')}
>
    <div class="poster" class:loaded>
        {#if item.poster && !failed}
            <img
                src={item.poster}
                alt=""
                loading="lazy"
                decoding="async"
                width="168"
                height="252"
                onload={() => (loaded = true)}
                onerror={() => (failed = true)}
            />
        {/if}
        {#if !item.poster || failed}
            <span class="fallback">{item.name}</span>
        {/if}
        {#if item.progress != null && item.progress > 0}
            <span class="progress" aria-hidden="true"><span style="width: {Math.min(100, item.progress * 100)}%"></span></span>
        {/if}
    </div>
    <span class="name" aria-hidden="true">{item.name}</span>
    {#if item.releaseInfo}<span class="meta" aria-hidden="true">{item.releaseInfo}</span>{/if}
</button>

<style>
    .card {
        all: unset;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        min-width: 0;
        scroll-snap-align: start;
        border-radius: var(--radius);
    }
    .card:focus-visible {
        outline: none;
    }
    .poster {
        position: relative;
        aspect-ratio: 2 / 3;
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
    }
</style>
