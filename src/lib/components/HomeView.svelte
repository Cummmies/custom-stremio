<script lang="ts">
    // Home, Movies and Series share this layout; `type` narrows it to one kind.
    import { onMount } from 'svelte';
    import { isTV } from '$lib/platform';
    import { core } from '$lib/core';
    import type { Board, ContinueWatchingPreview, MetaItemPreview } from '$lib/core/types';
    import { backgroundOf } from '$lib/core/art';
    import Hero from './Hero.svelte';
    import Shelf from './Shelf.svelte';
    import WideCard from './WideCard.svelte';
    import { WIDE_ITEM_WIDTH } from '$lib/shelf';
    import CategoryTiles from './CategoryTiles.svelte';
    import CatalogList, { catalogTitle, isEmptyCatalog, rowAnchor, type ListRow } from './CatalogList.svelte';
    import { catalogKey, homeLayout, type BoardCatalog } from '$lib/homeLayout.svelte';
    import Icon from './Icon.svelte';
    import EmptyState from './EmptyState.svelte';

    // TV: fixed (an inline clamp() is lost on the TV's Chromium 69, and vw is
    // off under the TV's zoom); about as tall as a poster, like tvOS's Up Next.
    const cwWidth = WIDE_ITEM_WIDTH;

    let { type = null }: { type?: 'movie' | 'series' | null } = $props();

    let board = $state<Board | null>(null);
    let continueWatching = $state<ContinueWatchingPreview | null>(null);

    onMount(() => {
        const unwatch = [
            core.watch<Board>('board', (s) => (board = s)),
            core.watch<ContinueWatchingPreview>('continue_watching_preview', (s) => (continueWatching = s)),
        ];
        core.dispatch({ action: 'Load', args: { model: 'CatalogsWithExtra', args: { extra: [] } } }, 'board');
        return () => {
            unwatch.forEach((fn) => fn());
            core.dispatch({ action: 'Unload' }, 'board');
        };
    });

    const catalogs = $derived(board?.catalogs ?? []);
    const ofType = $derived(
        catalogs.map((c, index) => ({ c, index })).filter(({ c }) => !type || c.type === type)
    );
    const readyItems = (i: number) => {
        const c = catalogs[i];
        return c?.content?.type === 'Ready' ? c.content.content : [];
    };

    // Hero: the top titles of the first loaded catalog (for Home, favor movies then series).
    const featured = $derived.by((): MetaItemPreview[] => {
        const first = ofType.find(({ index }) => readyItems(index).length > 0);
        return first ? readyItems(first.index).filter((m) => backgroundOf(m)).slice(0, 6) : [];
    });

    const cwItems = $derived((continueWatching?.items ?? []).filter((i) => !type || i.type === type));

    // Rows in the order set in Customize Home (per profile): hidden ones left out,
    // renamed and merged ones as set. Movies / Series keep only their own catalogs.
    $effect(() => homeLayout.sync());
    const boardCatalogs = $derived(catalogs as BoardCatalog[]);
    const indexByKey = $derived(new Map(boardCatalogs.map((c, i) => [catalogKey(c), i])));
    const resolved = $derived(
        homeLayout.resolve(boardCatalogs, new Map(boardCatalogs.map((c) => [catalogKey(c), catalogTitle(c)])))
    );
    const rows = $derived<ListRow[]>(
        resolved
            .filter((r) => !r.hidden)
            .map((r): ListRow => {
                if (r.kind === 'special') return { key: r.key, title: r.name, special: true, indices: [] };
                const indices = r.parts
                    .map((p) => indexByKey.get(p))
                    .filter((i): i is number => i != null && (!type || catalogs[i].type === type));
                return { key: r.key, title: r.name, indices };
            })
            .filter((r) => r.special || r.indices.length > 0)
    );

    const tiles = $derived(
        rows
            .filter((r) => !r.special && r.indices.some((i) => !isEmptyCatalog(catalogs[i])))
            .map((r) => {
                const first = readyItems(r.indices[0])[0];
                return {
                    label: r.title,
                    anchor: rowAnchor(r.key),
                    art: first?.id.startsWith('tt') ? `https://images.metahub.space/background/small/${first.id}/img` : (first?.poster ?? null),
                };
            })
    );

    const pageTitle = $derived(type === 'movie' ? 'Movies' : type === 'series' ? 'Series' : 'Home');

    // The opening screen (the banner's height is what's left of the window,
    // see .home below): how much room the feed tiles, the first row and a
    // glimpse of the next one take, measured as they are. TV: its own layout.
    const PEEK = 56; // the next row's title and the top of its cards
    let content = $state<HTMLElement>();
    let below = $state<number | null>(null);
    $effect(() => {
        const el = content;
        if (!el || isTV) return;
        let frame = 0;
        const measure = () => {
            frame = 0;
            const [first, second] = el.querySelectorAll<HTMLElement>('.shelf');
            if (!first) return;
            ro.observe(first);
            const top = el.getBoundingClientRect().top;
            const end = first.getBoundingClientRect().bottom;
            const next = second ? second.getBoundingClientRect().top - end + PEEK : 0;
            below = Math.round(end - top + next);
        };
        const schedule = () => (frame ||= window.setTimeout(measure, 30));
        // Sizes change with the window and as the first row fills in; rows
        // replace their placeholders (the same height) when they load.
        const ro = new ResizeObserver(schedule);
        ro.observe(el);
        const mo = new MutationObserver(schedule);
        mo.observe(el, { childList: true, subtree: true });
        schedule();
        return () => {
            clearTimeout(frame);
            ro.disconnect();
            mo.disconnect();
        };
    });
</script>

<svelte:head><title>{pageTitle} · Stremio</title></svelte:head>

<div class="home" style:--below={below != null ? `${below}px` : null}>
<Hero items={featured} />

<div class="content" bind:this={content}>
    {#if tiles.length > 1}
        <CategoryTiles {tiles} />
    {/if}

    {#if board && ofType.length === 0}
        <EmptyState icon="library" title="Nothing here yet">
            <p>None of your addons provide {type === 'series' ? 'series' : type === 'movie' ? 'movie' : ''} catalogs. Install an addon like Cinemeta to fill this page.</p>
        </EmptyState>
    {:else}
        <CatalogList
            model="board"
            {catalogs}
            {type}
            {rows}
        >
            {#snippet special(key)}
                {#if key === 'cw' && cwItems.length > 0}
                    <Shelf title={resolved.find((r) => r.key === 'cw')?.name ?? 'Continue Watching'} href="/library?status=watching" itemWidth={cwWidth}>
                        {#each cwItems as item (item._id)}
                            <WideCard {item} />
                        {/each}
                    </Shelf>
                {/if}
            {/snippet}
        </CatalogList>
    {/if}

    {#if !type && board}
        <div class="customize">
            <a class="customize-btn" href="/customize"><Icon name="gear" size={16} /> Customize Home</a>
        </div>
    {/if}
</div>
</div>

<style>
    /*
     * The opening screen, on every phone, tablet and window size. In order:
     *   1. the banner, its buttons always whole;
     *   2. the feed tiles;
     *   3. the first row (Continue Watching, or whichever is first), whole;
     *   4. the title and top of the next row, so it's clear the page goes on.
     * The banner gets the height 2–4 leave (`--below`, measured above), between
     * a minimum (room for its logo and buttons) and a maximum (a tall window
     * shows more rows, not a bigger banner). When it's short, its contents
     * tighten (Hero.svelte: smaller logo, then no description, then no tags).
     * On a short window (a phone on its side) 1 and 2 come first and the row
     * starts on screen. TV: its own, fixed layout (Hero.svelte).
     */
    .home {
        --screen-h: 100vh;
        --hero-min: 300px;
        --hero-max: min(720px, 72vh);
        --hero-h: clamp(var(--hero-min), calc(var(--screen-h) - var(--tabbar-h) - var(--below, 480px)), var(--hero-max));
    }
    @supports (height: 100svh) {
        .home {
            --screen-h: 100svh;
            --hero-max: min(720px, 72svh);
        }
    }
    @media (max-width: 700px) {
        .home {
            --hero-max: 62svh;
        }
    }
    .customize {
        display: flex;
        justify-content: center;
        padding: 8px var(--gutter) 0;
    }
    .customize-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 40px;
        padding: 0 18px;
        border-radius: 999px;
        border: 1px solid var(--separator);
        background: var(--fill);
        color: var(--label);
        font-weight: 600;
        text-decoration: none;
        transition: background var(--fast);
    }
    .customize-btn:hover {
        background: var(--fill-hover);
    }
    .content {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 36px;
        padding-bottom: 64px;
    }
    @media (max-width: 700px) {
        .content {
            gap: 26px;
        }
    }
</style>
