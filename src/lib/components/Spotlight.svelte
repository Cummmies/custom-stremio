<script lang="ts">
    // The signature element: an ambient backdrop that follows whatever title you
    // point at, so browsing the rows below feels like flipping through the posters' world.
    import type { MetaItemPreview } from '$lib/core/types';
    import { backgroundOf, logoOf } from '$lib/core/art';

    let { item }: { item: MetaItemPreview | null } = $props();

    // Two stacked layers crossfade. The previous image stays up until the next
    // one has loaded, so the backdrop never flashes empty.
    let layers = $state<{ key: string; src: string; ready: boolean }[]>([]);
    let logoFailed = $state(false);

    $effect(() => {
        const src = item ? backgroundOf(item) : null;
        logoFailed = false;
        if (!src || layers.at(-1)?.src === src) return;
        const key = `${item!.id}-${Date.now()}`;
        layers = [...layers.slice(-1), { key, src, ready: false }];
    });

    function onload(key: string) {
        layers = layers.map((l) => (l.key === key ? { ...l, ready: true } : l));
    }

    const shown = $derived(layers.findLastIndex((l) => l.ready));

    const logo = $derived(item && !logoFailed ? logoOf(item) : null);
    const meta = $derived(
        item ? [item.type === 'series' ? 'Series' : item.type === 'movie' ? 'Movie' : item.type, item.releaseInfo, item.runtime].filter(Boolean) : []
    );
</script>

<div class="backdrop" aria-hidden="true">
    {#each layers as layer, i (layer.key)}
        <img
            src={layer.src}
            alt=""
            decoding="async"
            class:show={i === shown}
            onload={() => onload(layer.key)}
        />
    {/each}
    <div class="scrim"></div>
</div>

<section class="spotlight" aria-live="polite">
    {#if item}
        <div class="copy">
            {#if logo}
                <img class="logo" src={logo} alt={item.name} onerror={() => (logoFailed = true)} />
            {:else}
                <h1>{item.name}</h1>
            {/if}
            {#if meta.length}<p class="meta">{meta.join('  ·  ')}</p>{/if}
            {#if item.description}<p class="description">{item.description}</p>{/if}
        </div>
    {/if}
</section>

<style>
    .backdrop {
        position: absolute;
        inset: 0 0 auto 0;
        height: min(72vh, 680px);
        overflow: hidden;
        z-index: 0;
        pointer-events: none;
    }
    .backdrop img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center 20%;
        opacity: 0;
        transition: opacity 600ms var(--ease);
    }
    .backdrop img.show {
        opacity: 0.55;
    }
    @media (prefers-reduced-motion: reduce) {
        .backdrop img {
            transition: none;
        }
    }
    /* Fade art into the page so rows sit on a calm surface. */
    .scrim {
        position: absolute;
        inset: 0;
        background:
            linear-gradient(to right, var(--bg) 0%, rgb(13 13 18 / 0.75) 35%, transparent 75%),
            linear-gradient(to top, var(--bg) 2%, transparent 55%);
    }
    .spotlight {
        position: relative;
        z-index: 1;
        min-height: min(46vh, 420px);
        display: flex;
        align-items: flex-end;
        padding: 32px var(--gutter) 28px;
    }
    .copy {
        max-width: 560px;
    }
    .logo {
        display: block;
        max-width: min(380px, 70%);
        max-height: 120px;
        object-fit: contain;
        object-position: left bottom;
        margin-bottom: 16px;
        filter: drop-shadow(0 4px 16px rgb(0 0 0 / 0.5));
    }
    h1 {
        margin: 0 0 12px;
        font-family: var(--font-display);
        font-size: var(--text-large);
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1.1;
    }
    .meta {
        margin: 0 0 10px;
        font-size: var(--text-body);
        font-weight: 600;
        color: var(--label-2);
    }
    .description {
        margin: 0;
        font-size: var(--text-callout);
        line-height: 1.5;
        color: var(--label-2);
        display: -webkit-box;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
</style>
