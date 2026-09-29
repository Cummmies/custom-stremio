<script lang="ts">
    import type { Video } from '$lib/core/types';
    import Icon from '../Icon.svelte';

    let {
        videos,
        season = $bindable(),
        selectedId,
        onselect,
        ontogglewatched,
    }: {
        videos: Video[];
        season: number;
        selectedId: string | null;
        onselect: (video: Video) => void;
        ontogglewatched: (video: Video) => void;
    } = $props();

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
        <label class="season-picker">
            <span class="sr-only">Season</span>
            <select bind:value={season}>
                {#each seasons as s (s)}
                    <option value={s}>{s === 0 ? 'Specials' : `Season ${s}`}</option>
                {/each}
            </select>
            <Icon name="chevronRight" size={14} />
        </label>
    {:else}
        <h3>{season === 0 ? 'Specials' : `Season ${season}`}</h3>
    {/if}
    <span class="count">{episodes.length} {episodes.length === 1 ? 'episode' : 'episodes'}</span>
</div>

<ol class="episodes">
    {#each episodes as ep (ep.id)}
        {@const progress = ep.progress && ep.progress > 0 ? Math.min(ep.progress, 100) : 0}
        <li class:selected={ep.id === selectedId}>
            <button class="main" onclick={() => onselect(ep)} disabled={ep.upcoming} aria-label={`Episode ${ep.episode}: ${ep.title}${ep.watched ? ', watched' : ''}`}>
                <div class="thumb">
                    {#if ep.thumbnail}
                        <img src={ep.thumbnail} alt="" loading="lazy" decoding="async" width="176" height="99" />
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
            {#if !ep.upcoming}
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
            {/if}
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
    .season-picker {
        position: relative;
        display: inline-flex;
        align-items: center;
    }
    select {
        appearance: none;
        height: 34px;
        padding: 0 34px 0 14px;
        border-radius: 999px;
        border: 1px solid var(--separator);
        background: var(--fill);
        color: var(--label);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
    }
    select:hover {
        background: var(--fill-hover);
    }
    .season-picker :global(svg) {
        position: absolute;
        right: 12px;
        transform: rotate(90deg);
        pointer-events: none;
        color: var(--label-2);
    }
    option {
        background: var(--elevated-2);
    }
    .count {
        font-size: 13px;
        color: var(--label-2);
    }
    .episodes {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    li {
        position: relative;
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
    .main:disabled {
        cursor: default;
        opacity: 0.6;
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
</style>
