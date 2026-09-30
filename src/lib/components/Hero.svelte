<script lang="ts">
    // Featured carousel. Its artwork runs behind the rows below and fades out.
    import { app } from '$lib/app.svelte';
    import { backgroundOf, logoOf } from '$lib/core/art';
    import type { MetaItemPreview } from '$lib/core/types';
    import Icon from './Icon.svelte';
    import { titleHref } from '$lib/links';
    import { titleContext } from '$lib/contextmenu';
    import { fetchDetails, heroPreview, merge, needsDetails } from '$lib/heroPreview.svelte';
    import { onDestroy } from 'svelte';

    let { items }: { items: MetaItemPreview[] } = $props();

    const INTERVAL = 9000;

    let index = $state(0);
    let paused = $state(false);
    let reducedMotion = $state(false);
    let logoFailed = $state<Record<string, boolean>>({});

    // A hovered title card takes over the banner; otherwise it cycles through `items`.
    const previewing = $derived(!!heroPreview.item);
    const base = $derived(heroPreview.item ?? items[index] ?? items[0] ?? null);
    // Catalogs often leave out the rating and genres (and Continue Watching the
    // description too): fill them in from Cinemeta so every title shows the same.
    let extras = $state<Record<string, Partial<MetaItemPreview>>>({});
    $effect(() => {
        const it = base;
        if (!it || extras[it.id] || !needsDetails(it)) return;
        fetchDetails(it).then((extra) => {
            if (extra) extras = { ...extras, [it.id]: extra };
        });
    });
    const item = $derived(base && extras[base.id] ? merge(base, extras[base.id]) : base);
    onDestroy(() => heroPreview.clear());

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
        if (paused || previewing || reducedMotion || items.length < 2) return;
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

    // Phones: swipe sideways to move between titles.
    let swipeX: number | null = null;
    /** A swipe just happened: the click that follows isn't a tap on the poster. */
    let swiped = false;
    function onpointerdown(e: PointerEvent) {
        swipeX = e.pointerType === 'mouse' ? null : e.clientX;
    }
    function onpointerup(e: PointerEvent) {
        if (swipeX == null || items.length < 2) return;
        const dx = e.clientX - swipeX;
        swipeX = null;
        if (Math.abs(dx) < 50) return;
        swiped = true;
        setTimeout(() => (swiped = false), 400);
        heroPreview.clear();
        index = (index + (dx < 0 ? 1 : items.length - 1)) % items.length;
    }

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
        onmouseenter={() => {
            paused = true;
            heroPreview.hold(true);
        }}
        onmouseleave={() => {
            paused = false;
            heroPreview.hold(false);
        }}
        onfocusin={() => (paused = true)}
        onfocusout={() => (paused = false)}
        {onpointerdown}
        {onpointerup}
        onpointercancel={() => (swipeX = null)}
        onclickcapture={(e) => {
            if (swiped) {
                e.preventDefault();
                e.stopPropagation();
            }
        }}
    >
        {#key item.id}
            <div
                class="copy"
                aria-live={paused ? 'polite' : 'off'}
                use:titleContext={{ type: item.type, id: item.id, name: item.name, preview: item }}
            >
                <!-- Phones: the poster, which is made for a tall frame (backdrops
                     cropped to a phone's width often lose their subject). -->
                {#if item.poster}
                    <a class="poster-card" href={titleHref(item.type, item.id)} aria-label={`More about ${item.name}`}>
                        <img src={item.poster} alt="" />
                    </a>
                {/if}
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
                    <a class="play" href={titleHref(item.type, item.id, { play: '1' })}>
                        <Icon name="play" size={16} filled />
                        Play
                    </a>
                    <button
                        class="round"
                        class:on={saved}
                        onclick={() => app.toggleLibrary(item)}
                        aria-label={saved ? `Remove ${item.name} from Library` : `Add ${item.name} to Library`}
                        title={saved ? 'In your Library' : 'Add to Library'}
                    >
                        <Icon name={saved ? 'check' : 'plus'} size={18} />
                    </button>
                    <a class="round" href={titleHref(item.type, item.id)} aria-label={`More about ${item.name}`} title="More Info">
                        <Icon name="info" size={18} />
                    </a>
                </div>
            </div>
        {/key}

        {#if items.length > 1}
            <div class="dots" role="group" aria-label="Choose featured title">
                {#each items as it, i (it.id)}
                    <button
                        class:current={!previewing && i === index}
                        aria-label={`${i + 1} of ${items.length}: ${it.name}`}
                        aria-current={!previewing && i === index}
                        onclick={() => {
                            heroPreview.clear();
                            index = i;
                        }}
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
    /* Outlined, nearly square tags (same as the title page). */
    .meta li {
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid rgb(255 255 255 / 0.4);
        font-size: 11px;
        font-weight: 600;
        line-height: 1.4;
        letter-spacing: 0.02em;
        color: rgb(255 255 255 / 0.92);
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
        text-decoration: none;
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
    a.round {
        text-decoration: none;
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

    .poster-card {
        display: none;
    }
    /* Phones: the poster as a big centered card over a blurred backdrop, then
       tags and a wide Play button; swipe between titles. */
    @media (max-width: 700px) {
        .art {
            height: 78vh;
        }
        .art img {
            filter: blur(28px) saturate(1.3);
            transform: scale(1.15);
        }
        .art img.show {
            opacity: 0.55;
        }
        .scrim {
            background: linear-gradient(to top, var(--bg) 6%, rgb(13 13 18 / 0.55) 40%, rgb(13 13 18 / 0.2) 70%, rgb(13 13 18 / 0.5));
        }
        .hero {
            min-height: 0;
            flex-direction: column;
            align-items: stretch;
            justify-content: flex-end;
            gap: 16px;
            padding: calc(var(--nav-h) + 8px) var(--gutter) 20px;
            touch-action: pan-y;
        }
        .copy {
            max-width: none;
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
        }
        .poster-card {
            display: block;
            width: min(64vw, 300px);
            aspect-ratio: 2 / 3;
            margin-bottom: 18px;
            border-radius: 14px;
            overflow: hidden;
            background: var(--elevated);
            box-shadow:
                0 24px 60px rgb(0 0 0 / 0.55),
                0 0 0 0.5px rgb(255 255 255 / 0.15);
        }
        .poster-card img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        /* The poster already carries the title. */
        .poster-card ~ .logo,
        .poster-card ~ h1,
        .description {
            display: none;
        }
        .logo {
            max-width: 72%;
            max-height: 96px;
            object-position: center bottom;
            margin-bottom: 14px;
        }
        h1 {
            font-size: 30px;
        }
        .meta {
            justify-content: center;
            margin-bottom: 16px;
        }
        .actions {
            width: 100%;
            max-width: 420px;
        }
        .play {
            flex: 1;
            justify-content: center;
            height: 48px;
        }
        .round {
            width: 48px;
            height: 48px;
        }
        .dots {
            justify-content: center;
            padding-bottom: 0;
        }
    }
</style>
