<script lang="ts">
    import DetailsPanel from '$lib/components/detail/DetailsPanel.svelte';
    import LogDialog, { type LogMode, type LogDraft } from '$lib/components/detail/LogDialog.svelte';
    import ReviewsTab from '$lib/components/detail/ReviewsTab.svelte';
    import ReviewPeek from '$lib/components/detail/ReviewPeek.svelte';
    import RelatedTab from '$lib/components/detail/RelatedTab.svelte';
    import NewListDialog from '$lib/components/NewListDialog.svelte';
    import { LightboxdTitle } from '$lib/lightboxd/title.svelte';
    import { STATUS_LABEL, day, lb, score, today, type EpisodeLog, type Status, type Summary } from '$lib/lightboxd/api';
    import { menu, type MenuEntry } from '$lib/menu.svelte';
    import { goto, appUrl } from '$lib/nav';
    import { page } from '$app/state';
    import { core } from '$lib/core';
    import type { ContinueWatchingPreview, MetaDetails, MetaItem, Video } from '$lib/core/types';
    import { backgroundOf, logoOf } from '$lib/core/art';
    import { titleHref } from '$lib/links';
    import { titleContext } from '$lib/contextmenu';
    import { cleanVideoId, resumeHref } from '$lib/player/deeplink';
    import { easyQueue, PICK_WAIT_MS, rankedPicks, readyToPick, type Like, type Pick } from '$lib/player/easy';
    import { looksLikeAnime } from '$lib/player/ranking';
    import { anime } from '$lib/anime.svelte';
    import { playerPrefs } from '$lib/player/prefs.svelte';
    import { canPlay, isTV } from '$lib/platform';
    import Icon from '$lib/components/Icon.svelte';
    import EmptyState from '$lib/components/EmptyState.svelte';
    import EpisodeList from '$lib/components/detail/EpisodeList.svelte';
    import SourcesSheet from '$lib/components/detail/SourcesSheet.svelte';
    import TrailerDialog from '$lib/components/detail/TrailerDialog.svelte';

    const type = $derived(page.params.type ?? '');
    const id = $derived(page.params.id ?? '');
    const videoId = $derived(appUrl(page.url).searchParams.get('video'));

    let details = $state<MetaDetails | null>(null);
    let season = $state(1);
    let seasonFor = '';
    let tab = $state<'episodes' | 'extras' | 'reviews' | 'related' | 'details'>('episodes');
    let trailer = $state<string | null>(null);
    let expanded = $state(false);
    // "More" shows when the summary is cut off (it's one to three lines, by the window's height).
    let descEl = $state<HTMLElement>();
    let clamped = $state(false);
    $effect(() => {
        const el = descEl;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const check = () => (clamped = el.scrollHeight > el.clientHeight + 1);
        const ro = new ResizeObserver(check);
        ro.observe(el);
        check();
        return () => ro.disconnect();
    });
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
        [meta?.releaseInfo, meta?.runtime, listSaysAnime ? 'Anime' : null, ...genres.slice(0, 3)].filter(Boolean)
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
        tab = firstTab();
    });

    // The Details tab only exists on narrow windows; widening goes back to the main section.
    $effect(() => {
        const wide = matchMedia('(min-width: 1001px)');
        const onChange = () => {
            if (wide.matches && tab === 'details') tab = firstTab();
        };
        wide.addEventListener('change', onChange);
        return () => wide.removeEventListener('change', onChange);
    });

    // Arriving from a Play button: jump straight to sources.
    $effect(() => {
        if (meta && appUrl(page.url).searchParams.get('play')) play(true);
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
    const auto = $derived(!!appUrl(page.url).searchParams.get('auto'));
    // Set by the player's Next Episode: keep to the same addon and quality.
    const like = $derived.by((): Like | null => {
        const addonUrl = appUrl(page.url).searchParams.get('likeAddon');
        const res = Number(appUrl(page.url).searchParams.get('likeRes'));
        return addonUrl ? { addonUrl, resolution: res || null } : null;
    });
    const easyNotice = $derived(
        appUrl(page.url).searchParams.get('failed')
            ? 'Easy Mode couldn’t play any of the best sources for this one. Pick one below.'
            : appUrl(page.url).searchParams.get('nomatch')
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
        const ranked = rankedPicks(streams, like, listSaysAnime, videoId, id);
        const { picks, anime: pickedAnime } = ranked;
        const elapsed = performance.now() - autoStarted;

        clearTimeout(autoTimer);
        if (readyToPick(streams, ranked, like, elapsed)) {
            startEasy(picks, pickedAnime);
        } else if (!pending && !picks.length) {
            autoStarted = 0;
            goto(titleHref(type, id, { video: videoId, nomatch: '1' }), { noScroll: true, keepFocus: true, replaceState: true });
        } else {
            // Re-check when the slowest addons time out.
            autoTimer = setTimeout(() => (details = details ? { ...details } : details), Math.max(250, PICK_WAIT_MS - elapsed));
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

    // --- Lightboxd --------------------------------------------------------------
    // With Lightboxd connected (docs/lightboxd.md), + sets your status and
    // lists there (and saves to Stremio's library too, a backup for its other
    // apps), ★ is your score, and a movie's eye logs your watches. Your score,
    // friends' and AniList's join IMDb's in the scores row, and Reviews and
    // Related are tabs. Without it, + and the eye are Stremio's, as before.
    const lbt = new LightboxdTitle();
    $effect(() => {
        if (meta) lbt.load(id, type, meta.name);
    });
    $effect(() => lbt.watchForChanges());
    const lbOn = $derived(lbt.on);
    const main = $derived(lbOn ? lbt.main : null);
    const related = $derived(lbOn ? (lbt.related ?? []) : []);
    const watches = $derived(main?.log ?? []);
    /** An anime that's several Lightboxd titles: each season is scored on its own. */
    const seasons = $derived(lbOn && (lbt.titles?.length ?? 0) > 1 ? lbt.titles! : []);
    const scoreOf = (t: Summary) => t.rating ?? t.earlier_rating;
    /** "Vinland Saga Season 2" → "Season 2", beside the first season's "Vinland Saga". */
    function seasonName(t: Summary) {
        const root = seasons[0]?.name ?? '';
        const rest = root && t.name !== root && t.name.startsWith(root) ? t.name.slice(root.length).replace(/^[\s:–—-]+/, '') : '';
        return rest || t.name;
    }
    /** Your score: your latest watch's, or (a rewatch not scored yet) the one before; for seasons, the one you rated last. */
    const myScore = $derived.by(() => {
        if (!seasons.length) return main ? scoreOf(main) : null;
        const rated = seasons.filter((t) => scoreOf(t) != null).sort((a, b) => (b.last_watched ?? '').localeCompare(a.last_watched ?? ''));
        return rated[0] ? scoreOf(rated[0]) : null;
    });
    const myReview = $derived(main?.review ?? null);
    const STATUSES: Status[] = ['plan_to_watch', 'watching', 'completed', 'dropped'];
    const saved = $derived(lbOn ? !!main && (main.status !== null || main.lists.length > 0) : !!meta?.inLibrary);

    function firstTab() {
        return isSeries ? 'episodes' : trailers.length ? 'extras' : 'reviews';
    }
    const hasTabs = $derived(isSeries || trailers.length > 0 || lbOn);

    // Stremio's library keeps a copy of what you save in Lightboxd.
    function addToStremio() {
        if (meta && !meta.inLibrary) core.dispatch({ action: 'Ctx', args: { action: 'AddToLibrary', args: meta } });
    }
    function removeFromStremio() {
        if (meta?.inLibrary) core.dispatch({ action: 'Ctx', args: { action: 'RemoveFromLibrary', args: meta.id } });
    }

    let newListOpen = $state(false);
    async function createList(name: string) {
        addToStremio();
        if (await lbt.newList(name)) newListOpen = false;
    }

    function toggleLibrary(e: MouseEvent) {
        if (!meta) return;
        if (!lbOn) {
            core.dispatch({
                action: 'Ctx',
                args: meta.inLibrary ? { action: 'RemoveFromLibrary', args: meta.id } : { action: 'AddToLibrary', args: meta },
            });
            return;
        }
        const button = e.currentTarget as HTMLElement;
        const status = main?.status ?? null;
        const entries: MenuEntry[] = [
            { header: 'Status' },
            ...STATUSES.map((st) => ({
                label: STATUS_LABEL[st],
                checked: status === st,
                onselect: () => {
                    addToStremio();
                    lbt.setStatus(st);
                },
            })),
            { separator: true },
            { header: 'Lists' },
            ...lbt.lists.map((l) => ({
                label: l.name,
                checked: !!main?.lists.includes(l.id),
                onselect: () => {
                    addToStremio();
                    lbt.toggleList(l.id);
                },
            })),
            { label: 'New List…', icon: 'plus', onselect: () => (newListOpen = true) },
        ];
        if (saved) {
            entries.push({ separator: true }, { label: 'Remove from Library…', icon: 'trash', destructive: true, onselect: () => confirmRemove(button) });
        }
        menu.toggleFor(button, entries);
    }

    /** Removing takes your watches, score and list entries with it: asked once more. */
    function confirmRemove(button: HTMLElement) {
        setTimeout(() =>
            menu.toggleFor(button, [
                { header: `Remove ${meta?.name ?? 'this'} from your library?`, detail: 'Your watches, score and lists for it go too.' },
                {
                    label: 'Remove',
                    icon: 'trash',
                    destructive: true,
                    onselect: async () => {
                        if (await lbt.remove()) removeFromStremio();
                    },
                },
                { label: 'Cancel' },
            ])
        );
    }

    // The rate / log dialog: ★, Log a Watch… and Edit Watch… all open it.
    // `titleId`: the season it's for (null: the title itself, added to Lightboxd if needed).
    type Log = { mode: LogMode; id: number | null; rewatch: boolean; initial: LogDraft; titleId: number | null; name: string | null; earliest: string | null };
    let log = $state<Log | null>(null);
    /** Your score for this title, or for one of its seasons. */
    function openRate(target: Summary | null = main) {
        const w = target?.log[0];
        const base = {
            titleId: seasons.length ? (target?.title_id ?? null) : null,
            name: seasons.length && target ? target.name : null,
            earliest: target?.earliest_watch_date ?? null,
        };
        // Lightboxd puts a score on your latest watch; with none yet, rating logs one.
        log = w
            ? { ...base, mode: 'rate', id: w.id, rewatch: w.rewatch, initial: { score: w.rating ?? target?.earlier_rating ?? 5, date: w.date, review: w.review ?? '' } }
            : { ...base, mode: 'watch', id: null, rewatch: false, initial: { score: 5, date: null, review: '' } };
    }
    /** ★: straight to your score, or for an anime in seasons, which season first. */
    function rateButton(e: MouseEvent) {
        if (!seasons.length) return openRate();
        menu.toggleFor(e.currentTarget as HTMLElement, [
            { header: 'Score Which Season?' },
            ...seasons.map((t) => {
                const s = scoreOf(t);
                return { label: `${seasonName(t)}${s != null ? ` · ${score(s)}` : ''}`, onselect: () => openRate(t) };
            }),
        ]);
    }
    function openLog() {
        // As Lightboxd: a first watch starts unscored; a rewatch from your last score (else IMDb's, else 8.5).
        const rewatch = watches.length > 0;
        const imdb = Number(main?.scores.imdb ?? rating);
        log = {
            mode: 'watch',
            id: null,
            rewatch,
            initial: { score: rewatch ? (myScore ?? (imdb || 8.5)) : null, date: null, review: '' },
            titleId: null,
            name: null,
            earliest: main?.earliest_watch_date ?? null,
        };
    }
    function openEdit(watchId: number) {
        // The watch may be any season's.
        const owner = lbt.titles?.find((t) => t.log.some((x) => x.id === watchId)) ?? main;
        const w = owner?.log.find((x) => x.id === watchId);
        if (w)
            log = {
                mode: 'edit',
                id: w.id,
                rewatch: w.rewatch,
                initial: { score: w.rating, date: w.date, review: w.review ?? '' },
                titleId: seasons.length ? (owner?.title_id ?? null) : null,
                name: seasons.length && owner ? owner.name : null,
                earliest: owner?.earliest_watch_date ?? null,
            };
    }
    async function saveLog(d: LogDraft) {
        if (!log) return;
        const fields = { rating: d.score, review: d.review, watch_date: d.date };
        const ok = log.id != null ? await lbt.editWatch(log.id, fields) : await lbt.addWatch(fields, log.titleId ?? undefined);
        if (!ok) return;
        if (log.id == null) {
            addToStremio();
            markStremioWatched();
        }
        log = null;
    }
    async function deleteLog() {
        if (log?.id != null && (await lbt.deleteWatch(log.id))) log = null;
    }
    function markStremioWatched() {
        if (meta && !isSeries && !meta.watched) core.dispatch({ action: 'MetaDetails', args: { action: 'MarkAsWatched', args: true } });
    }

    function toggleWatched(e: MouseEvent) {
        if (!meta) return;
        if (!lbOn) {
            core.dispatch({ action: 'MetaDetails', args: { action: 'MarkAsWatched', args: !meta.watched } });
            return;
        }
        menu.toggleFor(e.currentTarget as HTMLElement, [
            {
                label: watches.length ? 'Rewatched Today' : 'Watched Today',
                icon: 'eye',
                onselect: async () => {
                    if (await lbt.addWatch({ watch_date: today() })) {
                        addToStremio();
                        markStremioWatched();
                    }
                },
            },
            { label: watches.length ? 'Log a Rewatch…' : 'Log a Watch…', icon: 'calendar', onselect: openLog },
            ...(watches.length
                ? ([
                      { separator: true },
                      { header: 'Your Watches' },
                      ...watches.map((w) => ({
                          label: `${day(w.date) ?? 'Date unknown'}${w.rating != null ? ` · ${score(w.rating)}` : ''}`,
                          onselect: () => openEdit(w.id),
                      })),
                  ] as MenuEntry[])
                : []),
        ]);
    }

    // Details' Status and Lists rows.
    const statusLine = $derived.by(() => {
        const s = main?.status;
        if (!main || !s) return null;
        if (s === 'watching') return main.episodes ? `Watching · ${main.progress ?? 0} of ${main.episodes} episodes` : 'Watching';
        if (s === 'completed') return [main.watches > 1 ? `Watched ${main.watches} times` : 'Watched', day(main.last_watched)].filter(Boolean).join(' · ');
        return STATUS_LABEL[s];
    });
    const listNames = $derived(main ? lbt.lists.filter((l) => main.lists.includes(l.id)).map((l) => l.name) : []);

    // Scores row: yours, friends', AniList's (anime) and IMDb's.
    const scoreRow = $derived([
        ...(myScore != null ? [{ label: 'You', value: score(myScore) }] : []),
        ...(main?.scores.friends != null ? [{ label: 'Friends', value: score(main.scores.friends) }] : []),
        ...(main?.scores.anilist ? [{ label: 'AniList', value: `${main.scores.anilist}%` }] : []),
        ...((main?.scores.imdb ?? rating) ? [{ label: 'IMDb', value: (main?.scores.imdb ?? rating)! }] : []),
    ]);

    // Episodes on their own (with the tracker): marked watched and scored,
    // by Stremio's episode IDs.
    let episodeLogs = $state<Record<string, EpisodeLog>>({});
    /** Only which show (not every update of its details) brings them again. */
    const episodeShowId = $derived(isSeries && lbOn ? (meta?.id ?? null) : null);
    $effect(() => {
        const showId = episodeShowId;
        episodeLogs = {};
        if (!showId) return;
        lb.episodes(showId).then((res) => {
            if (res && episodeShowId === showId) episodeLogs = Object.fromEntries(res.episodes.map((e) => [e.video_id, e]));
        });
    });
    function keepEpisodeLog(entry: EpisodeLog) {
        episodeLogs = { ...episodeLogs, [entry.video_id]: entry };
    }
    function forgetEpisodeLog(videoId: string) {
        const { [videoId]: _gone, ...rest } = episodeLogs;
        episodeLogs = rest;
    }

    function toggleEpisodeWatched(v: Video) {
        core.dispatch({
            action: 'MetaDetails',
            args: { action: 'MarkVideoAsWatched', args: [{ id: v.id, released: v.released }, !v.watched] },
        });
        if (!lbOn || !meta) return;
        // Your history follows: watched is logged, unwatched leaves it.
        const logged = episodeLogs[v.id];
        if (!v.watched && !logged) {
            lb.logEpisode(meta.id, v.id, meta.name).then((res) => res && keepEpisodeLog(res.episode));
        } else if (v.watched && logged) {
            lb.removeEpisode(logged.log_id).then((res) => res && forgetEpisodeLog(v.id));
        }
    }

    // Rate Episode: the same dialog as a whole title's, for one episode.
    let episodeRate = $state<{ video: Video; entry: EpisodeLog | null } | null>(null);
    let episodeBusy = $state(false);
    let episodeError = $state<string | null>(null);
    /** The day an episode came out, as the dialog's earliest date (Stremio's dates are calendar days). */
    function episodeDay(v: Video): string | null {
        if (!v.released) return null;
        const d = new Date(v.released);
        if (isNaN(d.getTime())) return null;
        return d.getUTCHours() === 0 ? v.released.slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    function rateEpisode(v: Video) {
        episodeError = null;
        episodeRate = { video: v, entry: episodeLogs[v.id] ?? null };
    }
    async function saveEpisode(d: LogDraft) {
        if (!episodeRate || !meta) return;
        const v = episodeRate.video;
        episodeBusy = true;
        episodeError = null;
        const res = await lb.logEpisode(meta.id, v.id, meta.name, { rating: d.score, review: d.review, watch_date: d.date });
        episodeBusy = false;
        if (!res) {
            episodeError = 'Couldn’t save. Try again in a moment.';
            return;
        }
        keepEpisodeLog(res.episode);
        if (!v.watched) core.dispatch({ action: 'MetaDetails', args: { action: 'MarkVideoAsWatched', args: [{ id: v.id, released: v.released }, true] } });
        episodeRate = null;
    }
    async function removeEpisodeWatch() {
        const entry = episodeRate?.entry;
        if (!episodeRate || !entry) return;
        episodeBusy = true;
        const res = await lb.removeEpisode(entry.log_id);
        episodeBusy = false;
        if (!res) {
            episodeError = 'Couldn’t remove it. Try again in a moment.';
            return;
        }
        forgetEpisodeLog(episodeRate.video.id);
        episodeRate = null;
    }

    const selectedVideo = $derived(meta && videoId ? meta.videos.find((v) => v.id === videoId) ?? null : null);
    const sheetOpen = $derived(!!meta && !!videoId && !auto && (videoId === meta.id || !!selectedVideo));
    const sheetSubtitle = $derived(
        selectedVideo
            ? `S${selectedVideo.season} · E${selectedVideo.episode}${selectedVideo.title ? ` · ${selectedVideo.title}` : ''}`
            : (meta?.releaseInfo ?? null)
    );

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
                    <!-- More sits at the end of the summary's line, not on a line of its own. -->
                    <div class="desc-row">
                        <p class="description" class:expanded bind:this={descEl}>{meta.description}</p>
                        {#if expanded || clamped}
                            <button class="more" onclick={() => (expanded = !expanded)}>{expanded ? 'Less' : 'More'}</button>
                        {/if}
                    </div>
                {/if}

                <div class="actions">
                    <button class="play" data-tv-focus onclick={() => play()}>
                        <Icon name="play" size={16} filled />
                        {playLabel}
                    </button>
                    {#if lbOn}
                        <button class="round" class:on={saved} onclick={toggleLibrary} aria-haspopup="menu" aria-label="Status and Lists" title={saved ? 'Saved' : 'Save'}>
                            <Icon name={saved ? 'check' : 'plus'} size={18} />
                        </button>
                        <button
                            class="round"
                            class:on={myScore != null}
                            onclick={rateButton}
                            aria-haspopup={seasons.length ? 'menu' : undefined}
                            aria-label={myScore != null ? `Your Score ${score(myScore)}, Edit` : 'Rate'}
                            title={myScore != null ? `Your score: ${score(myScore)}` : 'Rate'}
                        >
                            <Icon name="star" size={18} filled={myScore != null} />
                        </button>
                    {:else}
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
                    {/if}
                    {#if trailers.length}
                        <button class="round" onclick={() => (trailer = trailers[0].ytId!)} aria-label="Play Trailer" title="Play Trailer">
                            <Icon name="film" size={18} />
                        </button>
                    {/if}
                    {#if !isSeries}
                        <button
                            class="round"
                            class:on={lbOn ? watches.length > 0 : meta.watched}
                            onclick={toggleWatched}
                            aria-haspopup={lbOn ? 'menu' : undefined}
                            aria-pressed={lbOn ? undefined : meta.watched}
                            aria-label={lbOn ? 'Your Watches' : meta.watched ? 'Mark as Unwatched' : 'Mark as Watched'}
                            title={lbOn ? (watches.length ? `Watched ${watches.length === 1 ? 'once' : `${watches.length} times`}` : 'Mark as Watched') : meta.watched ? 'Watched' : 'Mark as Watched'}
                        >
                            <Icon name="eye" size={18} />
                        </button>
                    {/if}
                </div>
                {#if lbt.error && !log && !newListOpen}<p class="lb-error" role="alert">{lbt.error}</p>{/if}
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
            {#if meta}
                <div class="bar">
                    <div class="tabs" role="tablist" aria-label="Sections">
                        {#if isSeries}
                            <button role="tab" aria-selected={tab === 'episodes'} class:on={tab === 'episodes'} onclick={() => (tab = 'episodes')}>Episodes</button>
                        {/if}
                        {#if trailers.length}
                            <!-- TV: alone (a movie's), it's a heading, not a stop for the remote. -->
                            <button role="tab" aria-selected={tab === 'extras'} class:on={tab === 'extras'} tabindex={isTV && !isSeries ? -1 : undefined} onclick={() => (tab = 'extras')}><span class="wide-label">{'Trailers & '}</span>Extras</button>
                        {/if}
                        {#if lbOn}
                            <button role="tab" aria-selected={tab === 'reviews'} class:on={tab === 'reviews'} onclick={() => (tab = 'reviews')}>Reviews</button>
                        {/if}
                        {#if related.length}
                            <button role="tab" aria-selected={tab === 'related'} class:on={tab === 'related'} onclick={() => (tab = 'related')}>Related</button>
                        {/if}
                        <!-- Narrow windows have no room for the Details column: it becomes a tab. -->
                        <button class="narrow-only" role="tab" aria-selected={tab === 'details'} class:on={tab === 'details'} onclick={() => (tab = 'details')}>Details</button>
                    </div>
                    <!-- Scores sit over the Details column, on every tab (phones: in Reviews). -->
                    <dl class="bar-scores" aria-label="Scores">
                        {#each scoreRow as sc (sc.label)}
                            <div><dd>{sc.value}</dd><dt>{sc.label}</dt></div>
                        {/each}
                    </dl>
                </div>
            {/if}

            <div class="columns" class:single={!hasTabs}>
                {#if hasTabs}
                    <section class="main" aria-label={tab === 'details' ? 'Details' : tab === 'reviews' ? 'Reviews' : tab === 'related' ? 'Related' : isSeries && tab === 'episodes' ? 'Episodes' : 'Trailers & Extras'}>
                        {#if tab === 'related'}
                            <RelatedTab groups={related} />
                        {:else if tab === 'reviews'}
                            <ReviewsTab
                                name={meta.name}
                                scores={scoreRow}
                                reviews={lbt.reviews}
                                {myScore}
                                {myReview}
                                {watches}
                                seasons={seasons.map((t) => ({ titleId: t.title_id, name: seasonName(t), score: scoreOf(t), review: t.review, watches: t.log }))}
                                onrate={(titleId) => openRate(lbt.titles?.find((t) => t.title_id === titleId) ?? main)}
                                oneditwatch={openEdit}
                            />
                        {:else if tab === 'details'}
                            <div class="details-tab"><DetailsPanel {meta} status={statusLine} lists={listNames} /></div>
                        {:else if isSeries && tab === 'episodes'}
                            <EpisodeList
                                videos={meta.videos}
                                bind:season
                                selectedId={videoId}
                                currentId={resuming ? (resumeVideo?.id ?? null) : null}
                                onselect={(v) => (v.upcoming ? openSources(v.id) : playVideo(v.id))}
                                ontogglewatched={toggleEpisodeWatched}
                                logs={episodeLogs}
                                onrate={lbOn ? rateEpisode : undefined}
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
                    <DetailsPanel {meta} status={statusLine} lists={listNames} />
                    {#if lbOn && tab !== 'reviews' && lbt.reviews}<ReviewPeek reviews={lbt.reviews} onseeall={() => (tab = 'reviews')} />{/if}
                </div>
            </div>
        </div>
    {/if}
    </div>
{/if}

{#if sheetOpen && meta && details}
    <SourcesSheet
        title={meta.name}
        subtitle={sheetSubtitle}
        streams={details.streams}
        anime={isAnime}
        notice={easyNotice}
        {videoId}
        titleId={id}
        onclose={closeSources}
    />
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

{#if log && meta}
    <LogDialog
        mode={log.mode}
        rewatch={log.rewatch}
        name={log.name ?? meta.name}
        year={log.name ? null : (meta.releaseInfo ?? null)}
        poster={meta.poster ?? null}
        earliest={log.earliest}
        initial={log.initial}
        busy={lbt.busy}
        error={lbt.error}
        onsave={saveLog}
        ondelete={deleteLog}
        onclose={() => (log = null)}
    />
{/if}

{#if episodeRate && meta}
    {@const v = episodeRate.video}
    <LogDialog
        mode={episodeRate.entry ? 'edit' : 'rate'}
        title={episodeRate.entry ? 'Edit Episode Rating' : 'Rate Episode'}
        name={`S${v.season} · E${v.episode}${v.title ? ` · ${v.title}` : ''}`}
        year={null}
        poster={meta.poster ?? null}
        earliest={episodeDay(v)}
        initial={{ score: episodeRate.entry?.rating ?? null, date: episodeRate.entry?.date ?? today(), review: episodeRate.entry?.review ?? '' }}
        busy={episodeBusy}
        error={episodeError}
        onsave={saveEpisode}
        ondelete={episodeRate.entry ? removeEpisodeWatch : undefined}
        onclose={() => (episodeRate = null)}
    />
{/if}

{#if newListOpen}
    <NewListDialog busy={lbt.busy} error={lbt.error} oncreate={createList} onclose={() => (newListOpen = false)} />
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
        /* Proportions (as Home's): the header is only as tall as it must be, so
           the episodes (3 to 6, by the window's height) and the whole Details
           column (details and cast) fit below it without scrolling. */
        padding: calc(var(--nav-h) + 40px) var(--gutter) clamp(24px, 4vh, 40px);
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
        max-height: clamp(52px, 10vh, 130px);
        object-fit: contain;
        object-position: left bottom;
        margin-bottom: clamp(8px, 1.6vh, 16px);
        filter: drop-shadow(0 4px 20px rgb(0 0 0 / 0.55));
    }
    h1 {
        margin: 0 0 14px;
        font-family: var(--font-display);
        font-size: clamp(30px, min(4.4vw, 6vh), 56px);
        font-weight: 700;
        letter-spacing: -0.025em;
        line-height: 1.05;
    }
    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        list-style: none;
        margin: 0 0 10px;
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
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    /* Tall windows have room for a third line. */
    @media (min-height: 1000px) {
        .description {
            -webkit-line-clamp: 3;
            line-clamp: 3;
        }
    }
    /* Short windows (a laptop's 768 px less the taskbar): a smaller logo and one
       line of the summary (More shows the rest), so 3 episodes and the Details
       column still fit. */
    @media (max-height: 760px) and (min-width: 701px) {
        :global(html:not(.tv)) .logo {
            max-height: 50px;
            margin-bottom: 8px;
        }
        :global(html:not(.tv)) .chips {
            margin-bottom: 8px;
        }
        :global(html:not(.tv)) .description:not(.expanded) {
            -webkit-line-clamp: 1;
            line-clamp: 1;
        }
        :global(html:not(.tv)) .actions {
            margin-top: 10px;
        }
        :global(html:not(.tv)) .hero {
            padding-top: calc(var(--nav-h) + 16px);
        }
    }
    @media (min-width: 701px) and (min-height: 820px) {
        :global(html:not(.tv)) .hero {
            min-height: min(50vh, 600px);
        }
    }
    .description.expanded {
        -webkit-line-clamp: unset;
        line-clamp: unset;
    }
    .desc-row {
        display: flex;
        align-items: flex-end;
        gap: 10px;
    }
    .desc-row .description {
        flex: 1;
        min-width: 0;
    }
    .more {
        flex: none;
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
        margin-top: clamp(12px, 2vh, 20px);
    }
    .play {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 44px;
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
        transform: translateZ(0);
        isolation: isolate;
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
        contain: paint;
        flex: none;
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 40px;
        padding: 0 var(--gutter);
        border-bottom: 1px solid var(--separator);
    }
    /* As wide as the Details column below it. */
    .bar-scores {
        flex: none;
        width: 340px;
        display: flex;
        justify-content: flex-end;
        gap: 36px;
        margin: 0;
        padding-bottom: 10px;
        text-shadow: 0 1px 8px rgb(0 0 0 / 0.6);
    }
    .bar-scores dd {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-title3);
        font-weight: 700;
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
    }
    .bar-scores dt {
        font-size: 11px;
        color: var(--label-2);
    }
    @media (max-width: 1000px) {
        .bar-scores {
            display: none;
        }
    }
    .columns {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 340px;
        grid-template-rows: minmax(0, 1fr);
        gap: 40px;
        padding: 16px var(--gutter) 0;
    }
    .columns.single {
        grid-template-columns: minmax(0, 720px);
    }
    .lb-error {
        margin: 10px 0 0;
        font-size: 13px;
        color: var(--bad);
    }
    /* Each column fills the remaining height and scrolls inside itself. */
    .main {
        display: flex;
        flex-direction: column;
        min-height: 0;
    }
    .side {
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding-bottom: 12px;
    }
    /* Same height as the season picker beside it, so the two columns line up. */
    .side-title {
        display: flex;
        align-items: center;
        min-height: 36px;
        margin: 0 0 10px;
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
        white-space: nowrap;
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
        .desc-row {
            flex-direction: column;
            align-items: center;
            gap: 4px;
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
        /* Four tabs on a phone: shorter labels, closer together, and the bar
           scrolls sideways if it still doesn't fit. */
        .tabs {
            gap: 22px;
            overflow-x: auto;
            scrollbar-width: none;
        }
        .wide-label {
            display: none;
        }
        .tabs button.on::after {
            bottom: 0;
        }
        .side,
        .details-tab,
        .extras {
            overflow: visible;
        }
    }

    /* TV: the whole page scrolls (the remote moves through the episodes and
       the page follows), instead of one-screen columns that each scroll
       inside themselves, which the remote can't do for Details and Cast.
       Details and Cast stay in view beside the episodes as you go. */
    :global(html.tv) .screen {
        height: auto;
        min-height: calc(100 * var(--tv-vh, 1vh));
    }
    :global(html.tv) .columns {
        grid-template-rows: auto;
        align-items: start;
        padding-bottom: 48px;
    }
    :global(html.tv) .main {
        min-height: auto;
    }
    :global(html.tv) .side {
        overflow: visible;
        position: -webkit-sticky;
        position: sticky;
        top: calc(var(--nav-h) + 16px);
        padding-bottom: 0;
    }
</style>
