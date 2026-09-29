<script lang="ts">
    // Featured carousel. Its artwork runs behind the rows below and fades out.
    import { app } from '$lib/app.svelte';
    import { backgroundOf, logoOf } from '$lib/core/art';
    import type { MetaItemPreview } from '$lib/core/types';
    import Icon from './Icon.svelte';

    let { items, badge }: { items: MetaItemPreview[]; badge: string } = $props();

    const INTERVAL = 9000;

    let index = $state(0);
    let paused = $state(false);
    let reducedMotion = $state(false);
    let logoFailed = $state<Record<string, boolean>>({});

    const item = $derived(items[index] ?? items[0] ?? null);

    // Crossfade layers: the previous artwork stays until the next has loaded.
    let layers = $state<{ key: string; src: string; ready: boolean }[]>([]);
    const shown = $derived(layers.findLastIndex((l) => l.ready));

    $effect(() => {
        const src = item ? backgroundOf(item) : null;
        if (!src || layers.at(-1)?.src === src) return;
        layers = [...layers.slice(-1), { key: `${item!.id}-${Date.now()}`, src, ready: false }];
    });

    $effect(() => {
        const mq = matchMedia('(prefers-reduced-motion: reduce)');
        reducedMotion = mq.matches;
        const on = () => (reducedMotion = mq.matches);
        mq.addEventListener('change', on);
        return () => mq.removeEventListener('change', on);
    });

    // Auto-advance, except while someone is hovering/focused in it or asked for less motion.
    $effect(() => {
        if (paused || reducedMotion || items.length < 2) return;
        index;
        const t = setTimeout(() => (index = (index + 1) % items.length), INTERVAL);
        return () => clearTimeout(t);
    });

    $effect(() => {
        if (index >= items.length) index = 0;
    });

    // Preload the next backdrop so advancing is instant.
    $effect(() => {
        const next = items[(index + 1) % items.length];
        const src = next && backgroundOf(next);
        if (src) new Image().src = src;
    });

    function onkeydown(e: KeyboardEvent) {
        if (e.key === 'ArrowRight') index = (index + 1) % items.length;
        else if (e.key === 'ArrowLeft') index = (index - 1 + items.length) % items.length;
    }

    const meta = $derived(
        item
            ? [
                  item.imdbRating ? `★ ${item.imdbRating}` : null,
                  item.releaseInfo,
                  item.runtime,
                  ...(item.genres?.slice(0, 2) ?? []),
              ].filter(Boolean)
            : []
    );
    const logo = $derived(item && !logoFailed[item.id] ? logoOf(item) : null);
    const saved = $derived(item ? app.inLibrary(item.id) : false);
</script>

<div class="art" aria-hidden="true">
    {#each layers as layer, i (layer.key)}
        <img
            src={layer.src}
            alt=""
            decoding="async"
            class:show={i === shown}
            onload={() => (layers = layers.map((l) => (l.key === layer.key ? { ...l, ready: true } : l)))}
        />
    {/each}
    <div class="scrim"></div>
</div>

{#if item}
    <section
        class="hero"
        aria-roledescription="carousel"
        aria-label="Featured"
        onmouseenter={() => (paused = true)}
        onmouseleave={() => (paused = false)}
        onfocusin={() => (paused = true)}
        onfocusout={() => (paused = false)}
    >
        {#key item.id}
            <div class="copy" aria-live={paused ? 'polite' : 'off'}>
                <span class="badge">{badge}</span>
                {#if logo}
                    <img
                        class="logo"
                        src={logo}
                        alt={item.name}
                        onerror={() => (logoFailed = { ...logoFailed, [item.id]: true })}
                    />
                {:else}
                    <h1>{item.name}</h1>
                {/if}
                {#if meta.length}
                    <ul class="meta">
                        {#each meta as m}<li>{m}</li>{/each}
                    </ul>
                {/if}
                {#if item.description}<p class="description">{item.description}</p>{/if}

                <div class="actions">
                    <button class="play" disabled title="Playback is coming next">
                        <Icon name="play" size={16} filled />
                        Play
                    </button>
                    <button
                        class="round"
                        class:on={saved}
                        onclick={() => app.toggleLibrary(item)}
                        aria-label={saved ? `Remove ${item.name} from Library` : `Add ${item.name} to Library`}
                        title={saved ? 'In your Library' : 'Add to Library'}
                    >
                        <Icon name={saved ? 'check' : 'plus'} size={18} />
                    </button>
                    <button class="round" disabled aria-label="Details" title="Details are coming next">
                        <Icon name="info" size={18} />
                    </button>
                </div>
            </div>
        {/key}

        {#if items.length > 1}
            <div class="dots" role="group" aria-label="Choose featured title">
                {#each items as it, i (it.id)}
                    <button
                        class:current={i === index}
                        aria-label={`${i + 1} of ${items.length}: ${it.name}`}
                        aria-current={i === index}
                        onclick={() => (index = i)}
                        {onkeydown}
                    ></button>
                {/each}
            </div>
        {/if}
    </section>
{:else}
    <section class="hero placeholder" aria-hidden="true"></section>
{/if}

<style>
    .art {
        position: absolute;
        inset: 0 0 auto 0;
        height: min(96vh, 900px);
        overflow: hidden;
        pointer-events: none;
        z-index: 0;
    }
    .art img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center 22%;
        opacity: 0;
        transition: opacity 700ms var(--ease);
    }
    .art img.show {
        opacity: 0.7;
    }
    /* Art continues behind the rows, then fades out into the page. */
    .scrim {
        position: absolute;
        inset: 0;
        background:
            linear-gradient(to right, rgb(13 13 18 / 0.92) 0%, rgb(13 13 18 / 0.55) 38%, transparent 70%),
            linear-gradient(to top, var(--bg) 8%, rgb(13 13 18 / 0.7) 40%, transparent 70%),
            linear-gradient(to bottom, rgb(13 13 18 / 0.5), transparent 18%);
    }
    .hero {
        position: relative;
        z-index: 1;
        min-height: min(78vh, 700px);
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 24px;
        padding: calc(var(--nav-h) + 24px) var(--gutter) 40px;
    }
    .placeholder {
        pointer-events: none;
    }
    .copy {
        max-width: 560px;
        animation: enter var(--slow) var(--ease);
    }
    @keyframes enter {
        from {
            opacity: 0;
            transform: translateY(6px);
        }
    }
    .badge {
        display: inline-block;
        margin-bottom: 16px;
        padding: 3px 8px;
        border: 1px solid rgb(255 255 255 / 0.4);
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--label);
    }
    .logo {
        display: block;
        max-width: min(420px, 80%);
        max-height: 140px;
        object-fit: contain;
        object-position: left bottom;
        margin-bottom: 18px;
        filter: drop-shadow(0 4px 20px rgb(0 0 0 / 0.55));
    }
    h1 {
        margin: 0 0 14px;
        font-family: var(--font-display);
        font-size: clamp(32px, 4vw, 52px);
        font-weight: 700;
        letter-spacing: -0.025em;
        line-height: 1.05;
    }
    .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        list-style: none;
        margin: 0 0 12px;
        padding: 0;
    }
    .meta li {
        padding: 3px 9px;
        border-radius: 999px;
        background: rgb(255 255 255 / 0.12);
        font-size: var(--text-caption);
        font-weight: 600;
    }
    .description {
        margin: 0 0 22px;
        font-size: var(--text-callout);
        line-height: 1.5;
        color: rgb(244 244 246 / 0.82);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .actions {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .play {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 44px;
        padding: 0 24px 0 20px;
        border: 0;
        border-radius: 999px;
        background: var(--label);
        color: var(--bg);
        font-size: var(--text-callout);
        font-weight: 700;
        cursor: pointer;
        transition: transform var(--fast) var(--ease), background var(--fast);
    }
    .play:hover:not(:disabled) {
        background: white;
        transform: scale(1.03);
    }
    .round {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: 1px solid rgb(255 255 255 / 0.25);
        background: rgb(255 255 255 / 0.12);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        color: var(--label);
        cursor: pointer;
        transition: background var(--fast);
    }
    .round:hover:not(:disabled) {
        background: rgb(255 255 255 / 0.22);
    }
    .round.on {
        background: var(--label);
        color: var(--bg);
    }
    button:disabled {
        opacity: 0.45;
        cursor: default;
    }
    .dots {
        display: flex;
        gap: 6px;
        padding-bottom: 8px;
    }
    .dots button {
        width: 8px;
        height: 8px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: rgb(255 255 255 / 0.35);
        cursor: pointer;
        transition:
            width var(--slow) var(--ease),
            background var(--fast);
    }
    /* Invisible 20px hit area around each small dot. */
    .dots button {
        position: relative;
    }
    .dots button::after {
        content: '';
        position: absolute;
        inset: -6px -3px;
    }
    .dots button.current {
        width: 24px;
        background: var(--label);
    }
</style>
