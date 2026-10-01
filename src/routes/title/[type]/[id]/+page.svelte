<script lang="ts">
    import { goto } from '$lib/nav';
    import { page } from '$app/state';
    import { core } from '$lib/core';
    import type { ContinueWatchingPreview, MetaDetails, MetaItem, Video } from '$lib/core/types';
    import { backgroundOf, logoOf } from '$lib/core/art';
    import { titleHref } from '$lib/links';
    import { titleContext } from '$lib/contextmenu';
    import { cleanVideoId, resumeHref } from '$lib/player/deeplink';
    import { easyQueue, rankedPicks, type Like, type Pick } from '$lib/player/easy';
    import { looksLikeAnime } from '$lib/player/ranking';
    import { anime } from '$lib/anime.svelte';
    import { playerPrefs } from '$lib/player/prefs.svelte';
    import { canPlay } from '$lib/platform';
    import Icon from '$lib/components/Icon.svelte';
    import EmptyState from '$lib/components/EmptyState.svelte';
    import EpisodeList from '$lib/components/detail/EpisodeList.svelte';
    import SourcesSheet from '$lib/components/detail/SourcesSheet.svelte';
    import TrailerDialog from '$lib/components/detail/TrailerDialog.svelte';
    import DetailsPanel from '$lib/components/detail/DetailsPanel.svelte';

    const type = $derived(page.params.type ?? '');
    const id = $derived(page.params.id ?? '');
    const videoId = $derived(page.url.searchParams.get('video'));

    let details = $state<MetaDetails | null>(null);
    let season = $state(1);
    let seasonFor = '';
    let tab = $state<'episodes' | 'extras' | 'details'>('episodes');
    let trailer = $state<string | null>(null);
    let expanded = $state(false);
    let artReady = $state(false);
    let logoFailed = $state(false);

    $effect(() => core.watch<MetaDetails>('meta_details', (s) => (details = s)));
    $effect(() => () => core.dispatch({ action: 'Unload' }, 'meta_details'));

    // (Re)load whenever the title or the selected video changes. The stream path
    // asks every addon for sources of that one movie or episode.
    $effect(() => {
        core.dispatch(
            {
                action: 'Load',
                args: {
                    model: 'MetaDetails',
                    args: {
                        metaPath: { resource: 'meta', type, id, extra: [] },
                        streamPath: videoId ? { resource: 'stream', type, id: videoId, extra: [] } : null,
                        guessStream: true,
                    },
                },
            },
            'meta_details'
        );
    });

    // Reset per-title UI when moving to another title.
    $effect(() => {
        id;
        expanded = false;
        artReady = false;
        logoFailed = false;
    });

    const loadable = $derived(details?.selected?.metaPath.id === id ? details.metaItem?.content : undefined);
    const meta = $derived<MetaItem | null>(loadable?.type === 'Ready' ? loadable.content : null);
    const failed = $derived(loadable?.type === 'Err');

    const isSeries = $derived(!!meta && meta.videos.some((v) => v.season != null));
    const trailers = $derived((meta?.trailerStreams ?? []).filter((t) => t.ytId));
    const rating = $derived(meta?.links.find((l) => l.category === 'imdb')?.name ?? null);
    const genres = $derived(meta?.links.filter((l) => l.category === 'Genres').map((l) => l.name) ?? []);
    // Anime, from the anime list (or, when that can't tell, from the sources).
    const listSaysAnime = $derived(anime.isAnime(id));
    const isAnime = $derived(
        listSaysAnime ?? looksLikeAnime(details?.streams.flatMap((g) => (g.content.type === 'Ready' ? g.content.content : [])) ?? [])
    );
    const chips = $derived(
        [rating ? `★ ${rating}` : null, meta?.releaseInfo, meta?.runtime, listSaysAnime ? 'Anime' : null, ...genres.slice(0, 3)].filter(Boolean)
    );

    // Where "Play" goes: the episode you were on, else the first released episode.
    const resumeVideo = $derived.by((): Video | null => {
        if (!meta || !isSeries) return null;
        const lastId = cleanVideoId(details?.libraryItem?.state.video_id);
        const last = lastId ? meta.videos.find((v) => v.id === lastId) : null;
        if (last) return last;
        const regular = meta.videos
            .filter((v) => (v.season ?? 0) > 0 && !v.upcoming)
            .sort((a, b) => (a.season! - b.season!) || (a.episode ?? 0) - (b.episode ?? 0));
        return regular[0] ?? meta.videos[0] ?? null;
    });
    const resuming = $derived(!!details?.libraryItem?.state.timeOffset);
    const playLabel = $derived(
        resumeVideo
            ? `${resuming ? 'Resume' : 'Play'} S${resumeVideo.season} · E${resumeVideo.episode}`
            : resuming
              ? 'Resume'
              : 'Play'
    );

    // Pick the season to show once per title.
    $effect(() => {
        if (!meta || seasonFor === meta.id) return;
        seasonFor = meta.id;
        const fromUrl = videoId ? meta.videos.find((v) => v.id === videoId)?.season : undefined;
        season = fromUrl ?? resumeVideo?.season ?? meta.videos[0]?.season ?? 1;
        tab = isSeries ? 'episodes' : 'extras';
    });

    // The Details tab only exists on narrow windows; widening goes back to the main section.
    $effect(() => {
        const wide = matchMedia('(min-width: 1001px)');
        const onChange = () => {
            if (wide.matches && tab === 'details') tab = isSeries ? 'episodes' : 'extras';
        };
        wide.addEventListener('change', onChange);
        return () => wide.removeEventListener('change', onChange);
    });

    // Arriving from a Play button: jump straight to sources.
    $effect(() => {
        if (meta && page.url.searchParams.get('play')) play(true);
    });

    function openSources(target: string, replace = false) {
        goto(titleHref(type, id, { video: target }), { noScroll: true, keepFocus: true, replaceState: replace });
    }

    /** Play a movie/episode: Easy Mode picks the source, otherwise you do. */
    function playVideo(target: string, replace = false) {
        if (playerPrefs.easyMode && canPlay) {
            goto(titleHref(type, id, { video: target, auto: '1' }), { noScroll: true, keepFocus: true, replaceState: replace });
        } else {
            openSources(target, replace);
        }
    }

    // --- Easy Mode: choose a source as addons answer ------------------------
    const auto = $derived(!!page.url.searchParams.get('auto'));
    // Set by the player's Next Episode: keep to the same addon and quality.
    const like = $derived.by((): Like | null => {
        const addonUrl = page.url.searchParams.get('likeAddon');
        const res = Number(page.url.searchParams.get('likeRes'));
        return addonUrl ? { addonUrl, resolution: res || null } : null;
    });
    const easyNotice = $derived(
        page.url.searchParams.get('failed')
            ? 'Easy Mode couldn’t play any of the best sources for this one. Pick one below.'
            : page.url.searchParams.get('nomatch')
              ? 'No source matched your Easy Mode preferences. Pick one below.'
              : null
    );
    let autoStarted = 0;
    let autoTimer: ReturnType<typeof setTimeout> | undefined;

    $effect(() => {
        if (!auto || !videoId || !details) return;
        if (details.selected?.streamPath?.id !== videoId) return;
        if (!autoStarted) autoStarted = performance.now();

        const streams = details.streams;
        const pending = streams.some((g) => g.content.type === 'Loading');
        const { picks, top, anime: pickedAnime } = rankedPicks(streams, like, listSaysAnime);
        const elapsed = performance.now() - autoStarted;

        // A cached debrid source at your preferred quality is as good as it gets: go now.
        // Continuing an episode, it has to be from the addon you were watching (once it has answered).
        const likeAddonDone = !like?.addonUrl || !streams.some((g) => g.addon.transportUrl === like.addonUrl && g.content.type === 'Loading');
        const great = top && top.parsed.kind === 'debrid' && likeAddonDone && (!like?.addonUrl || top.addonUrl === like.addonUrl || !streams.some((g) => g.addon.transportUrl === like.addonUrl));
        clearTimeout(autoTimer);
        if (picks.length && (great || !pending || elapsed > 7000)) {
            startEasy(picks, pickedAnime);
        } else if (!pending && !picks.length) {
            autoStarted = 0;
            goto(titleHref(type, id, { video: videoId, nomatch: '1' }), { noScroll: true, keepFocus: true, replaceState: true });
        } else {
            // Re-check when the slowest addons time out.
            autoTimer = setTimeout(() => (details = details ? { ...details } : details), Math.max(250, 7000 - elapsed));
        }
    });

    function startEasy(picks: Pick[], isAnimeTitle: boolean) {
        autoStarted = 0;
        easyQueue.start(videoId!, picks, isAnimeTitle);
        goto(picks[0].href, { replaceState: true });
    }

    function chooseManually() {
        autoStarted = 0;
        clearTimeout(autoTimer);
        openSources(videoId!, true);
    }

    function closeSources() {
        goto(titleHref(type, id), { noScroll: true, keepFocus: true, replaceState: true });
    }

    async function play(replace = false) {
        if (!meta) return;
        const target = resumeVideo?.id ?? meta.id;

        // Resuming: reuse the stream you picked last time, if core remembers one.
        if (resuming && canPlay) {
            const cw = await core.getState<ContinueWatchingPreview>('continue_watching_preview').catch(() => null);
            const item = cw?.items.find((i) => i._id === meta!.id);
            const sameVideo = !isSeries || cleanVideoId(item?.state?.videoId) === target;
            const href = sameVideo ? resumeHref(item?.deepLinks?.player) : null;
            if (href) return goto(href, { replaceState: replace });
        }
        playVideo(target, replace);
    }

    function toggleLibrary() {
        if (!meta) return;
        core.dispatch({
            action: 'Ctx',
            args: meta.inLibrary ? { action: 'RemoveFromLibrary', args: meta.id } : { action: 'AddToLibrary', args: meta },
        });
    }

    function toggleWatched() {
        if (meta) core.dispatch({ action: 'MetaDetails', args: { action: 'MarkAsWatched', args: !meta.watched } });
    }

    function toggleEpisodeWatched(v: Video) {
        core.dispatch({
            action: 'MetaDetails',
            args: { action: 'MarkVideoAsWatched', args: [{ id: v.id, released: v.released }, !v.watched] },
        });
    }

    const selectedVideo = $derived(meta && videoId ? meta.videos.find((v) => v.id === videoId) ?? null : null);
    const sheetOpen = $derived(!!meta && !!videoId && !auto && (videoId === meta.id || !!selectedVideo));
    const sheetSubtitle = $derived(
        selectedVideo
            ? `S${selectedVideo.season} · E${selectedVideo.episode}${selectedVideo.title ? ` · ${selectedVideo.title}` : ''}`
            : (meta?.releaseInfo ?? null)
    );

    const back = () => (history.length > 1 ? history.back() : goto('/'));
    const art = $derived(meta ? backgroundOf(meta) : null);
    const logo = $derived(meta && !logoFailed ? logoOf(meta) : null);
</script>

<svelte:head><title>{meta?.name ?? 'Loading'} · Stremio</title></svelte:head>

{#if failed}
    <div class="error">
        <EmptyState icon="info" title="Couldn’t load this title">
            <p>The addon that provides it didn’t respond. Check your connection, then try again.</p>
            <button onclick={() => location.reload()}>Try Again</button>
        </EmptyState>
    </div>
{:else}
    <div class="art" aria-hidden="true">
        {#if art}
            <img src={art} alt="" decoding="async" class:show={artReady} onload={() => (artReady = true)} />
        {/if}
        <div class="scrim"></div>
    </div>

    <!-- The page fits the window; only the episode list (and details) scroll. -->
    <div class="screen">
    <header class="hero">
        <button class="back" onclick={back} aria-label="Back" title="Back">
            <Icon name="back" size={20} />
        </button>

        {#if meta}
            <div class="copy" use:titleContext={{ type: meta.type, id: meta.id, name: meta.name, preview: meta }}>
                {#if logo}
                    <img class="logo" src={logo} alt={meta.name} onerror={() => (logoFailed = true)} />
                {:else}
                    <h1>{meta.name}</h1>
                {/if}

                {#if chips.length}
                    <ul class="chips">
                        {#each chips as c}<li>{c}</li>{/each}
                    </ul>
                {/if}

                {#if meta.description}
                    <p class="description" class:expanded>{meta.description}</p>
                    {#if meta.description.length > 220}
                        <button class="more" onclick={() => (expanded = !expanded)}>{expanded ? 'Less' : 'More'}</button>
                    {/if}
                {/if}

                <div class="actions">
                    <button class="play" onclick={() => play()}>
                        <Icon name="play" size={16} filled />
                        {playLabel}
                    </button>
                    <button
                        class="round"
                        class:on={meta.inLibrary}
                        onclick={toggleLibrary}
                        aria-pressed={meta.inLibrary}
                        aria-label={meta.inLibrary ? 'Remove from Library' : 'Add to Library'}
                        title={meta.inLibrary ? 'In your Library' : 'Add to Library'}
                    >
                        <Icon name={meta.inLibrary ? 'check' : 'plus'} size={18} />
                    </button>
                    {#if trailers.length}
                        <button class="round" onclick={() => (trailer = trailers[0].ytId!)} aria-label="Play Trailer" title="Play Trailer">
                            <Icon name="film" size={18} />
                        </button>
                    {/if}
                    {#if !isSeries}
                        <button
                            class="round"
                            class:on={meta.watched}
                            onclick={toggleWatched}
                            aria-pressed={meta.watched}
                            aria-label={meta.watched ? 'Mark as Unwatched' : 'Mark as Watched'}
                            title={meta.watched ? 'Watched' : 'Mark as Watched'}
                        >
                            <Icon name="eye" size={18} />
                        </button>
                    {/if}
                </div>
            </div>
        {:else}
            <div class="copy skeleton" aria-busy="true" aria-label="Loading">
                <div class="sk-title"></div>
                <div class="sk-line"></div>
                <div class="sk-line short"></div>
            </div>
        {/if}
    </header>

    {#if meta}
        <div class="body">
            <!-- Sections bar: its rule runs the full width, and both columns start below it. -->
            {#if isSeries || trailers.length}
                <div class="bar">
                    <div class="tabs" role="tablist" aria-label="Sections">
                        {#if isSeries}
                            <button role="tab" aria-selected={tab === 'episodes'} class:on={tab === 'episodes'} onclick={() => (tab = 'episodes')}>Episodes</button>
                        {/if}
                        {#if trailers.length}
                            <button role="tab" aria-selected={tab === 'extras'} class:on={tab === 'extras'} onclick={() => (tab = 'extras')}>Trailers & Extras</button>
                        {/if}
                        <!-- Narrow windows have no room for the Details column: it becomes a tab. -->
                        <button class="narrow-only" role="tab" aria-selected={tab === 'details'} class:on={tab === 'details'} onclick={() => (tab = 'details')}>Details</button>
                    </div>
                </div>
            {/if}

            <div class="columns" class:single={!isSeries && !trailers.length}>
                {#if isSeries || trailers.length}
                    <section class="main" aria-label={tab === 'details' ? 'Details' : isSeries && tab === 'episodes' ? 'Episodes' : 'Trailers & Extras'}>
                        {#if tab === 'details'}
                            <div class="details-tab"><DetailsPanel {meta} /></div>
                        {:else if isSeries && tab === 'episodes'}
                            <EpisodeList
                                videos={meta.videos}
                                bind:season
                                selectedId={videoId}
                                currentId={resuming ? (resumeVideo?.id ?? null) : null}
                                onselect={(v) => playVideo(v.id)}
                                ontogglewatched={toggleEpisodeWatched}
                            />
                        {:else}
                            <ul class="extras">
                                {#each trailers as t, i (t.ytId)}
                                    <li>
                                        <button onclick={() => (trailer = t.ytId!)}>
                                            <span class="thumb">
                                                <img src={`https://i.ytimg.com/vi/${t.ytId}/hqdefault.jpg`} alt="" loading="lazy" />
                                                <span class="play-badge" aria-hidden="true"><Icon name="play" size={20} filled /></span>
                                            </span>
                                            <span class="extra-title">{i === 0 ? 'Trailer' : `Trailer ${i + 1}`}</span>
                                        </button>
                                    </li>
                                {/each}
                            </ul>
                        {/if}
                    </section>
                {/if}

                <div class="side">
                    <h2 class="side-title">Details</h2>
                    <DetailsPanel {meta} />
                </div>
            </div>
        </div>
    {/if}
    </div>
{/if}

{#if sheetOpen && meta && details}
    <SourcesSheet title={meta.name} subtitle={sheetSubtitle} streams={details.streams} anime={isAnime} notice={easyNotice} onclose={closeSources} />
{/if}

{#if auto && meta}
    <div class="finding" role="status" aria-live="polite">
        <div class="finding-card">
            <span class="finding-spinner" aria-hidden="true"></span>
            <div>
                <p class="finding-title">Finding the best source…</p>
                {#if sheetSubtitle}<p class="finding-sub">{sheetSubtitle}</p>{/if}
            </div>
            <button onclick={chooseManually}>Choose Manually</button>
        </div>
    </div>
{/if}

{#if trailer && meta}
    <TrailerDialog ytId={trailer} title={meta.name} onclose={() => (trailer = null)} />
{/if}

<style>
    .error {
        padding-top: var(--nav-h);
    }
    .finding {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: grid;
        place-items: center;
        background: rgb(0 0 0 / 0.45);
        animation: fade var(--fast) var(--ease);
    }
    @keyframes fade {
        from {
            opacity: 0;
        }
    }
    .finding-card {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 18px 18px 18px 22px;
        border-radius: var(--radius-l);
        background: rgb(31 31 40 / 0.92);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        border: 1px solid var(--separator);
        box-shadow: 0 24px 64px rgb(0 0 0 / 0.55);
    }
    .finding-spinner {
        flex: none;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        border: 3px solid rgb(255 255 255 / 0.2);
        border-top-color: white;
        animation: spin 0.9s linear infinite;
    }
    @keyframes spin {
        to {
            rotate: 360deg;
        }
    }
    .finding-title {
        margin: 0;
        font-weight: 600;
    }
    .finding-sub {
        margin: 2px 0 0;
        font-size: 13px;
        color: var(--label-2);
    }
    .finding-card button {
        margin-left: 12px;
        height: 34px;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: var(--fill-hover);
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
    }
    .finding-card button:hover {
        background: var(--label);
        color: var(--bg);
    }
    .art {
        position: absolute;
        inset: 0 0 auto 0;
        height: min(88vh, 820px);
        overflow: hidden;
        pointer-events: none;
    }
    .art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center 20%;
        opacity: 0;
        transition: opacity 600ms var(--ease);
    }
    .art img.show {
        opacity: 0.75;
    }
    .scrim {
        position: absolute;
        inset: 0;
        background:
            linear-gradient(to right, rgb(13 13 18 / 0.94) 0%, rgb(13 13 18 / 0.6) 40%, transparent 72%),
            linear-gradient(to top, var(--bg) 6%, rgb(13 13 18 / 0.6) 42%, transparent 72%),
            linear-gradient(to bottom, rgb(13 13 18 / 0.55), transparent 20%);
    }
    /* Window-height layout: header on top, body takes the rest. Very short
       windows get a sensible minimum instead of a squashed list. */
    .screen {
        position: relative;
        height: 100vh;
        min-height: 620px;
        display: flex;
        flex-direction: column;
    }
    .hero {
        position: relative;
        flex: none;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        padding: calc(var(--nav-h) + clamp(48px, 7vh, 96px)) var(--gutter) clamp(16px, 3vh, 28px);
    }
    .back {
        position: absolute;
        top: calc(var(--nav-h) + 12px);
        left: var(--gutter);
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 1px solid rgb(255 255 255 / 0.18);
        background: rgb(30 30 38 / 0.55);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        color: var(--label);
        cursor: pointer;
        transition: background var(--fast);
    }
    .back:hover {
        background: rgb(60 60 72 / 0.75);
    }
    .copy {
        max-width: 600px;
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
        max-width: min(440px, 80%);
        /* Shrinks on shorter windows so the episode list keeps its room. */
        max-height: clamp(64px, 14vh, 150px);
        object-fit: contain;
        object-position: left bottom;
        margin-bottom: clamp(10px, 2vh, 18px);
        filter: drop-shadow(0 4px 20px rgb(0 0 0 / 0.55));
    }
    h1 {
        margin: 0 0 14px;
        font-family: var(--font-display);
        font-size: clamp(34px, 4.4vw, 56px);
        font-weight: 700;
        letter-spacing: -0.025em;
        line-height: 1.05;
    }
    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        list-style: none;
        margin: 0 0 14px;
        padding: 0;
    }
    /* Outlined, nearly square tags (same as the Home banner). */
    .chips li {
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
        margin: 0;
        font-size: var(--text-callout);
        line-height: 1.55;
        color: rgb(244 244 246 / 0.85);
        display: -webkit-box;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .description.expanded {
        -webkit-line-clamp: unset;
        line-clamp: unset;
    }
    .more {
        margin-top: 4px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--label);
        font-weight: 600;
        cursor: pointer;
        border-radius: 4px;
    }
    .actions {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 22px;
    }
    .play {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 46px;
        padding: 0 26px 0 22px;
        border: 0;
        border-radius: 999px;
        background: var(--label);
        color: var(--bg);
        font-size: var(--text-callout);
        font-weight: 700;
        cursor: pointer;
        transition:
            transform var(--fast) var(--ease),
            background var(--fast);
    }
    .play:hover {
        background: white;
        transform: scale(1.03);
    }
    .round {
        display: grid;
        place-items: center;
        width: 46px;
        height: 46px;
        border-radius: 50%;
        border: 1px solid rgb(255 255 255 / 0.25);
        background: rgb(255 255 255 / 0.12);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        color: var(--label);
        cursor: pointer;
        transition: background var(--fast);
    }
    .round:hover {
        background: rgb(255 255 255 / 0.22);
    }
    .round.on {
        background: var(--label);
        color: var(--bg);
    }
    .skeleton .sk-title {
        width: 360px;
        max-width: 80%;
        height: 56px;
        border-radius: 8px;
        background: var(--elevated-2);
        margin-bottom: 18px;
    }
    .skeleton .sk-line {
        height: 14px;
        width: 520px;
        max-width: 90%;
        border-radius: 4px;
        background: var(--elevated-2);
        margin-bottom: 10px;
    }
    .skeleton .sk-line.short {
        width: 320px;
    }
    .body {
        position: relative;
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }
    /* Full-width sections bar, like a toolbar under the hero. */
    .bar {
        flex: none;
        padding: 0 var(--gutter);
        border-bottom: 1px solid var(--separator);
    }
    .columns {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 340px;
        grid-template-rows: minmax(0, 1fr);
        gap: 40px;
        padding: 20px var(--gutter) 0;
    }
    .columns.single {
        grid-template-columns: minmax(0, 720px);
    }
    /* Each column fills the remaining height and scrolls inside itself. */
    .main {
        display: flex;
        flex-direction: column;
        min-height: 0;
    }
    .side {
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding-bottom: 24px;
    }
    /* Same height as the season picker beside it, so the two columns line up. */
    .side-title {
        display: flex;
        align-items: center;
        min-height: 36px;
        margin: 0 0 14px;
        font-size: var(--text-title3);
        font-weight: 600;
    }
    .narrow-only {
        display: none;
    }
    .details-tab {
        min-height: 0;
        overflow-y: auto;
        max-width: 560px;
        padding-bottom: 24px;
    }
    @media (min-width: 1001px) {
        /* The Details tab's content lives in the side column at this width. */
        .details-tab {
            display: none;
        }
    }
    @media (max-width: 1000px) {
        .tabs .narrow-only {
            display: block;
        }
        .columns {
            grid-template-columns: minmax(0, 1fr);
        }
        .columns:not(.single) .side {
            display: none;
        }
    }
    .tabs {
        display: flex;
        gap: 28px;
    }
    .tabs button {
        position: relative;
        padding: 0 0 12px;
        border: 0;
        background: none;
        color: var(--label-2);
        font-size: var(--text-callout);
        font-weight: 600;
        cursor: pointer;
    }
    .tabs button:hover {
        color: var(--label);
    }
    .tabs button.on {
        color: var(--label);
    }
    .tabs button.on::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        bottom: -1px;
        height: 2px;
        border-radius: 2px;
        background: var(--label);
    }
    .extras {
        list-style: none;
        margin: 0;
        padding: 0 0 24px;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        align-content: start;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 16px;
    }
    .extras button {
        all: unset;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        border-radius: var(--radius);
    }
    .extras button:focus-visible {
        outline: 2px solid var(--accent-hover);
        outline-offset: 2px;
    }
    .thumb {
        position: relative;
        aspect-ratio: 16 / 9;
        border-radius: var(--radius);
        overflow: hidden;
        background: var(--elevated-2);
    }
    .thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .play-badge {
        position: absolute;
        inset: 0;
        margin: auto;
        width: 48px;
        height: 48px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: rgb(0 0 0 / 0.55);
        transition: transform var(--fast) var(--ease);
    }
    .extras button:hover .play-badge {
        transform: scale(1.1);
    }
    .extra-title {
        font-weight: 600;
    }

    /* Phones: art on top, title and buttons centered over its lower part, and
       the whole page scrolls (no fixed-height screen with inner scrolling). */
    @media (max-width: 700px) {
        .art {
            height: 62vh;
        }
        .art img {
            object-position: center 25%;
        }
        .art img.show {
            opacity: 0.9;
        }
        .scrim {
            background:
                linear-gradient(to top, var(--bg) 6%, rgb(13 13 18 / 0.7) 38%, transparent 70%),
                linear-gradient(to bottom, rgb(13 13 18 / 0.5), transparent 20%);
        }
        .screen {
            height: auto;
            min-height: 0;
        }
        .hero {
            padding: calc(var(--nav-h) + 30vh) var(--gutter) 12px;
        }
        /* The tab bar is the way back on phones. */
        .back {
            display: none;
        }
        .copy {
            max-width: none;
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
        }
        .logo {
            max-width: 72%;
            max-height: 96px;
            object-position: center bottom;
        }
        h1 {
            font-size: 30px;
        }
        .chips {
            justify-content: center;
        }
        .description {
            font-size: 15px;
        }
        .actions {
            width: 100%;
            margin-top: 18px;
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
        .columns {
            grid-template-rows: auto;
            padding-top: 12px;
        }
        .side,
        .details-tab,
        .extras {
            overflow: visible;
        }
    }
</style>
