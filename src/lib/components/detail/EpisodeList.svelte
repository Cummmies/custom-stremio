<script lang="ts">
    import type { Video } from '$lib/core/types';
    import Icon from '../Icon.svelte';
    import PopupButton from '../menu/PopupButton.svelte';

    let {
        videos,
        season = $bindable(),
        selectedId,
        currentId = null,
        onselect,
        ontogglewatched,
    }: {
        videos: Video[];
        season: number;
        selectedId: string | null;
        /** The episode you're up to; the list opens scrolled to it. */
        currentId?: string | null;
        onselect: (video: Video) => void;
        ontogglewatched: (video: Video) => void;
    } = $props();

    let list = $state<HTMLElement>();
    let atTop = $state(true);
    let atBottom = $state(false);

    // Which edges have hidden episodes past them; those edges get a fade.
    function updateEdges() {
        if (!list) return;
        atTop = list.scrollTop <= 1;
        atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
    }

    // On opening a season, bring the relevant episode into view (inside the list only).
    $effect(() => {
        season;
        const target = selectedId ?? currentId;
        const row = target && list?.querySelector<HTMLElement>(`[data-id="${CSS.escape(target)}"]`);
        if (list) list.scrollTop = row ? Math.max(0, row.offsetTop - list.offsetTop - 8) : 0;
        updateEdges();
    });

    // Specials (season 0) go last, as every TV app does.
    const seasons = $derived(
        [...new Set(videos.map((v) => v.season ?? 0))].sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b))
    );
    const episodes = $derived(
        videos.filter((v) => (v.season ?? 0) === season).sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))
    );

    const fmtDate = (iso: string | null) =>
        iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
</script>

<div class="head">
    {#if seasons.length > 1}
        <PopupButton
            label="Season"
            bind:value={season}
            options={seasons.map((s) => ({ value: s, label: s === 0 ? 'Specials' : `Season ${s}` }))}
        />
    {:else}
        <h3>{season === 0 ? 'Specials' : `Season ${season}`}</h3>
    {/if}
    <span class="count">{episodes.length} {episodes.length === 1 ? 'episode' : 'episodes'}</span>
</div>

<ol class="episodes" class:fade-top={!atTop} class:fade-bottom={!atBottom} bind:this={list} onscroll={updateEdges}>
    {#each episodes as ep (ep.id)}
        {@const progress = ep.progress && ep.progress > 0 ? Math.min(ep.progress, 100) : 0}
        <li class:selected={ep.id === selectedId} class:current={ep.id === currentId} data-id={ep.id}>
            <button class="main" onclick={() => onselect(ep)} class:upcoming-ep={ep.upcoming} aria-label={`Episode ${ep.episode}: ${ep.title}${ep.watched ? ', watched' : ''}${ep.upcoming ? ', upcoming: see if sources are out early' : ''}`}>
                <div class="thumb">
                    {#if ep.thumbnail}
                        <img
                            src={ep.thumbnail}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            width="176"
                            height="99"
                            onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
                        />
                    {/if}
                    {#if !ep.upcoming}<span class="play-hint" aria-hidden="true"><Icon name="play" size={18} filled /></span>{/if}
                    {#if progress > 0 && !ep.watched}
                        <span class="progress"><span style="width: {progress}%"></span></span>
                    {/if}
                </div>
                <div class="text">
                    <span class="title">{ep.episode}. {ep.title || `Episode ${ep.episode}`}</span>
                    {#if ep.overview}<span class="overview">{ep.overview}</span>{/if}
                    <span class="meta">
                        {#if ep.upcoming}<span class="upcoming">Upcoming</span>{/if}
                        {fmtDate(ep.released) ?? ''}
                    </span>
                </div>
            </button>
            <button
                class="watched"
                class:on={ep.watched}
                onclick={() => ontogglewatched(ep)}
                aria-pressed={ep.watched}
                aria-label={ep.watched ? `Mark episode ${ep.episode} as unwatched` : `Mark episode ${ep.episode} as watched`}
                title={ep.watched ? 'Watched' : 'Mark as Watched'}
            >
                <Icon name="check" size={16} />
            </button>
        </li>
    {/each}
</ol>

<style>
    .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 14px;
    }
    h3 {
        margin: 0;
        font-size: var(--text-title3);
        font-weight: 600;
    }
    .count {
        font-size: 13px;
        color: var(--label-2);
    }
    /* The list scrolls by itself: wheel/touchpad scrolling here moves episodes,
       not the page, and stops at the ends instead of handing off to the page. */
    .episodes {
        list-style: none;
        margin: 0;
        padding: 0 0 24px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        /* Fills whatever height the page layout leaves, down to the window's bottom edge. */
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        --fade-top: 0px;
        --fade-bottom: 0px;
        /* Edges that cut off episodes fade out, hinting there's more to scroll. */
        mask-image: linear-gradient(
            to bottom,
            transparent,
            black var(--fade-top),
            black calc(100% - var(--fade-bottom)),
            transparent
        );
    }
    .episodes.fade-top {
        --fade-top: 48px;
    }
    .episodes.fade-bottom {
        --fade-bottom: 72px;
    }
    li.current:not(.selected) {
        box-shadow: inset 3px 0 0 var(--label);
    }
    li {
        position: relative;
        /* The list scrolls; its rows keep their height (Chromium 69 squeezed
           them into the list's height instead, on top of each other). */
        flex-shrink: 0;
        display: flex;
        align-items: center;
        border-radius: var(--radius);
        background: var(--elevated);
        transition: background var(--fast);
    }
    li:hover,
    li.selected {
        background: var(--elevated-2);
    }
    li.selected {
        box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.18);
    }
    .main {
        all: unset;
        flex: 1;
        min-width: 0;
        display: flex;
        gap: 16px;
        padding: 10px;
        border-radius: var(--radius);
        cursor: pointer;
    }
    .main:focus-visible {
        outline: 2px solid var(--accent-hover);
    }
    /* Not aired yet: dimmed, but it still opens the sources (some come out early). */
    .main.upcoming-ep .thumb,
    .main.upcoming-ep .text {
        opacity: 0.6;
    }
    .main.upcoming-ep:hover .thumb,
    .main.upcoming-ep:hover .text,
    .main.upcoming-ep:focus-visible .thumb,
    .main.upcoming-ep:focus-visible .text {
        opacity: 0.85;
    }
    .thumb {
        position: relative;
        flex: none;
        width: 176px;
        aspect-ratio: 16 / 9;
        border-radius: var(--radius-s);
        overflow: hidden;
        background: var(--elevated-2);
    }
    .thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .play-hint {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: rgb(0 0 0 / 0.35);
        opacity: 0;
        transition: opacity var(--fast);
    }
    .main:hover .play-hint,
    .main:focus-visible .play-hint {
        opacity: 1;
    }
    .progress {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 3px;
        background: rgb(255 255 255 / 0.25);
    }
    .progress span {
        display: block;
        height: 100%;
        background: var(--label);
    }
    .text {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
        padding: 2px 44px 2px 0;
    }
    .title {
        font-weight: 600;
    }
    .overview {
        font-size: 13px;
        line-height: 1.45;
        color: var(--label-2);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .meta {
        font-size: var(--text-caption);
        color: var(--label-2);
        display: flex;
        gap: 8px;
        align-items: center;
    }
    .upcoming {
        padding: 1px 7px;
        border-radius: 999px;
        background: var(--fill-hover);
        color: var(--label);
        font-weight: 600;
    }
    .watched {
        position: absolute;
        right: 12px;
        top: 50%;
        translate: 0 -50%;
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: 1px solid var(--separator);
        background: transparent;
        color: var(--label-3);
        cursor: pointer;
        transition:
            background var(--fast),
            color var(--fast);
    }
    .watched:hover {
        color: var(--label);
        background: var(--fill);
    }
    .watched.on {
        background: var(--label);
        border-color: var(--label);
        color: var(--bg);
    }
    @media (max-width: 640px) {
        .thumb {
            width: 120px;
        }
        .overview {
            display: none;
        }
    }
    /* Phones: the whole title page scrolls instead of this list. */
    @media (max-width: 700px) {
        .episodes {
            overflow: visible;
            mask-image: none;
            -webkit-mask-image: none;
        }
    }

    /* TV: the page scrolls, not the list (the remote moves through the
       episodes and the page follows), and rows are compact so more of them
       show at once. */
    :global(html.tv) .episodes {
        flex: none;
        overflow: visible;
        -webkit-mask-image: none;
        mask-image: none;
        gap: 6px;
    }
    :global(html.tv) .main {
        gap: 14px;
        padding: 8px 10px;
    }
    /* Both set: Chromium 69's stand-in for aspect-ratio is a fixed height. */
    :global(html.tv) .thumb {
        width: 136px;
        height: 77px;
    }
    :global(html.tv) .overview {
        -webkit-line-clamp: 1;
        line-clamp: 1;
    }
</style>
