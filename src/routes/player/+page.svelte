<script module lang="ts">
    // "Still watching?": how many episodes in a row started by themselves (Up next
    // countdown or the end of the last one) with nobody touching anything. Kept
    // outside the page because moving to the next episode can reload it.
    const stillWatching = { autoEpisodes: 0 };
</script>

<script lang="ts">
    // Full-window player. mpv draws the video underneath this transparent page;
    // everything you see here is the control layer on top of it.
    import { onMount, untrack } from 'svelte';
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import { invoke } from '@tauri-apps/api/core';
    import { listen } from '@tauri-apps/api/event';
    import { getCurrentWindow } from '@tauri-apps/api/window';
    import { core } from '$lib/core';
    import { app } from '$lib/app.svelte';
    import { player, type Track } from '$lib/player/player';
    import { inTauri } from '$lib/player/mpv.svelte';
    import { isDesktop, isIOS } from '$lib/platform';
    import { playerPrefs, upscalerLabels, type Upscaler } from '$lib/player/prefs.svelte';
    import { cleanVideoId, parsePlayerDeepLink, playerHref, streamUrl } from '$lib/player/deeplink';
    import { easyQueue, type Like, type Pick } from '$lib/player/easy';
    import { prefetchPicks } from '$lib/player/prefetch';
    import { anime } from '$lib/anime.svelte';
    import { parseStream } from '$lib/player/ranking';
    import type { Stream } from '$lib/core/types';
    import { langKey, sameLanguage } from '$lib/player/lang';
    import { fromChapters, introOutroMarks, lookupSegments, parseChapters, skipLabel, type Chapter, type Segment } from '$lib/player/skips';
    import { fade } from 'svelte/transition';
    import { cancelSilenceSkip, silenceSkipActive, startSilenceSkip } from '$lib/player/silenceSkip';
    import { fmtTime } from '$lib/player/format';
    import { titleHref } from '$lib/links';
    import { menu, type MenuEntry } from '$lib/menu.svelte';
    import SeekBar from '$lib/player/SeekBar.svelte';
    import SeekPreview from '$lib/player/SeekPreview.svelte';
    import { Thumbnails } from '$lib/player/thumbnails';
    import Icon from '$lib/components/Icon.svelte';

    type PlayerModel = {
        title: string | null;
        seriesInfo: { season: number; episode: number } | null;
        nextVideo: {
            id: string;
            title: string;
            season?: number;
            episode?: number;
            thumbnail?: string | null;
            deepLinks?: { player: string | null };
        } | null;
        subtitles: { id: string; lang: string; url?: string | null; label?: string | null }[];
        stream: { type: 'Ready'; content: { deepLinks?: { externalPlayer?: { streaming?: string | null } } } } | { type: string } | null;
        metaItem:
            | {
                  type: 'Ready';
                  content: {
                      name: string;
                      logo?: string | null;
                      poster?: string | null;
                      background?: string | null;
                      videos?: { id: string; title: string; thumbnail: string | null }[];
                  };
              }
            | { type: string }
            | null;
    };

    const params = $derived(page.url.searchParams);
    const type = $derived(params.get('type'));
    const id = $derived(params.get('id'));
    const videoId = $derived(cleanVideoId(params.get('video')));

    let model = $state<PlayerModel | null>(null);
    let thumbs = $state<Thumbnails | null>(null);
    let controlsVisible = $state(true);
    let fullscreen = $state(false);
    let pip = $state(false);
    let showNext = $state(false);
    let nextDismissed = $state(false);
    let startError = $state<string | null>(null);
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let lastReported = 0;
    let subtitlesAdded = false;

    const settings = $derived(app.ctx?.profile.settings ?? null);
    const seekStep = $derived(((settings?.seekTimeDuration as number | undefined) ?? 10000) / 1000);
    const meta = $derived(
        model?.metaItem?.type === 'Ready' ? (model.metaItem as Extract<PlayerModel['metaItem'], { content: unknown }>).content : null
    );
    const metaName = $derived(meta?.name ?? null);
    const episodeVideo = $derived(videoId ? (meta?.videos?.find((v) => v.id === videoId) ?? null) : null);
    const heading = $derived(metaName ?? model?.title ?? 'Loading…');
    // The episode's own title from the show's episode list; the player's title can
    // be the show name again, or "Show - S01E03 - …".
    const episodeTitle = $derived.by(() => {
        if (episodeVideo?.title) return episodeVideo.title;
        const t = model?.title?.replace(/^.*?:\s*/, '');
        return t && t !== metaName && !(metaName && t.startsWith(metaName)) ? t : null;
    });
    const subheading = $derived(
        model?.seriesInfo ? `S${model.seriesInfo.season} · E${model.seriesInfo.episode}${episodeTitle ? ` · ${episodeTitle}` : ''}` : null
    );
    const loadingVideo = $derived(!player.loaded || (player.buffering && !player.paused));
    const nextThreshold = $derived(((settings?.nextVideoNotificationDuration as number | undefined) ?? 35000) / 1000);

    // --- lifecycle ---------------------------------------------------------

    onMount(() => {
        document.documentElement.classList.add('player-active');
        // iPhone: landscape while watching, back to portrait after.
        if (isIOS) invoke('plugin:mpv|orientation', { landscape: true }).catch(() => {});
        const unwatch = core.watch<PlayerModel>('player', (s) => (model = s));
        const offEvents = player.onEvent(onPlayerEvent);
        // Play/pause from the Windows media overlay or the keyboard's media keys.
        const offMedia = isDesktop
            ? listen<string>('media://button', (e) => {
                  markActive();
                  player.setPaused(e.payload === 'pause');
              })
            : Promise.resolve(() => {});
        // Pause on minimize / on switching to another window (Settings → Playback).
        const win = isDesktop ? getCurrentWindow() : null;
        const pauseNow = () => {
            if (player.loaded && !player.paused) player.setPaused(true);
        };
        const offWindow = win
            ? Promise.all([
                  win.onResized(async () => {
                      if (playerPrefs.pauseOnMinimize && (await win.isMinimized())) pauseNow();
                  }),
                  win.onFocusChanged(({ payload: focused }) => {
                      if (!focused && playerPrefs.pauseOnLostFocus && !pip) pauseNow();
                  }),
              ])
            : Promise.resolve([]);
        begin();
        return () => {
            unwatch();
            offEvents();
            offMedia.then((off) => off());
            offWindow.then((offs) => offs.forEach((off) => off()));
            if (isIOS) invoke('plugin:mpv|orientation', { landscape: false }).catch(() => {});
            if (isDesktop) invoke('media_clear').catch(() => {});
            if (isDesktop) invoke('discord_clear').catch(() => {});
            document.documentElement.classList.remove('player-active', 'player-idle');
            clearTimeout(idleTimer);
            clearTimeout(watchdog);
            clearTimeout(stallTimer);
            clearInterval(stillTimer);
            cancelSilenceSkip();
            if (pip) invoke('set_pip', { enabled: false });
            if (fullscreen) invoke('set_fullscreen', { fullscreen: false });
            player.stop();
            thumbs?.close();
            core.dispatch({ action: 'Unload' }, 'player');
        };
    });

    async function begin() {
        startError = null;
        fileFor = null;
        subtitlesAdded = false;
        firstFrameSeen = false;
        segments = [];
        segmentsFor = null;
        autoSkipped.clear();
        cancelSilenceSkip();
        addedSubs.clear();
        nextDismissed = false;
        showNext = false;
        stillAsk = null;
        activeThisEpisode = false;
        nextCardAt = null;
        autoplayFired = false;
        nextThumbFailed = false;
        const encoded = params.get('stream');
        if (!encoded) return (startError = 'Nothing to play.');

        const stream = await core.decodeStream(encoded).catch(() => null);
        if (!stream) return (startError = 'This stream link is broken.');
        playingStream = stream;

        const st = params.get('st');
        const mt = params.get('mt');
        await core.dispatch(
            {
                action: 'Load',
                args: {
                    model: 'Player',
                    args: {
                        stream,
                        streamRequest: st && type && videoId ? { base: st, path: { resource: 'stream', type, id: videoId, extra: [] } } : null,
                        metaRequest: mt && type && id ? { base: mt, path: { resource: 'meta', type, id, extra: [] } } : null,
                        subtitlesPath: type && videoId ? { resource: 'subtitles', type, id: videoId, extra: [] } : null,
                    },
                },
            },
            'player'
        );

        const url = params.get('url') ?? streamUrl(stream, settings?.streamingServerUrl ?? 'http://127.0.0.1:11470/');
        if (!url) return (startError = 'This stream has no playable address.');
        if (!inTauri) return (startError = 'Playback runs in the desktop app.');

        thumbs?.close();
        // Background thumbnail work steps aside whenever the main video is buffering.
        thumbs = player.features.thumbnails ? new Thumbnails(url, () => player.buffering || !player.loaded) : null;

        // Easy Mode: if this source never shows a picture, move on to the next best.
        firstFrame = false;
        clearTimeout(watchdog);
        if (easyQueue.activeFor(videoId)) {
            const isTorrent = !!stream.infoHash && !stream.url;
            watchdog = setTimeout(() => !firstFrame && tryNextSource(), isTorrent ? 30000 : 15000);
        }
        try {
            await player.start(settings ?? {});
            const start = await resumeFrom();
            // player.load clears the old file's state in the same tick, so `fileFor`
            // never pairs this video with the previous file's length or position.
            fileFor = `${id}|${videoId}`;
            await player.load(url, start);
        } catch (e) {
            startError = String(e);
        }
    }

    // --- Easy Mode fallback -------------------------------------------------
    let firstFrame = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let switching = $state<string | null>(null);
    /** Reactive twin of firstFrame, for effects that wait on playback starting. */
    let firstFrameSeen = $state(false);
    /** Which video mpv's current file belongs to. The URL changes first when moving to
     *  the next episode, while mpv still reports the previous file's length and time. */
    let fileFor = $state<string | null>(null);
    const fileReady = $derived(player.loaded && fileFor === `${id}|${videoId}`);
    let playingStream: Stream | null = null;

    /** Easy Mode can step in: it picked this source, or it's on and can take over. */
    const easyCanAct = () =>
        easyQueue.activeFor(videoId) || (playerPrefs.easyMode && !!type && !!id && !!videoId && easyQueue.handPicked !== videoId);

    // Easy Mode is on, but this source was remembered rather than picked by it
    // (resuming, a next episode Stremio had a source for): rank the sources now,
    // leaving out this one, so there's something to fall back on.
    let adopting = $state(false);
    async function adoptQueue(): Promise<boolean> {
        if (easyQueue.activeFor(videoId)) return true;
        if (!easyCanAct() || !type || !id || !videoId || adopting) return false;
        adopting = true;
        switching = 'Finding another source…';
        const forVideo = videoId;
        const { picks, anime: isAnime } = await prefetchPicks(type, id, forVideo, likeThis()).catch(() => ({ picks: [], anime: false }));
        adopting = false;
        if (forVideo !== videoId || !picks.length) {
            switching = null;
            return false;
        }
        easyQueue.adopt(forVideo, picks, location.pathname + location.search, isAnime);
        return true;
    }

    async function tryNextSource() {
        clearTimeout(watchdog);
        clearTimeout(stallTimer);
        if (!(await adoptQueue())) return;
        const next = easyQueue.next();
        if (next) {
            switching = 'That source didn’t work. Trying the next best one…';
            await goto(next.href, { replaceState: true });
            await begin();
            setTimeout(() => (switching = null), 2500);
        } else {
            // Out of good options: hand the choice back.
            const target = videoId ?? id;
            easyQueue.clear();
            if (type && id && target) goto(titleHref(type, id, { video: target, failed: '1' }), { replaceState: true });
        }
    }

    // A hard error on an auto-picked source → next source.
    $effect(() => {
        if ((startError || player.error) && easyCanAct()) tryNextSource();
    });

    // Stuck buffering for 30s mid-episode → next source (it resumes at the same time).
    $effect(() => {
        const stuck = player.buffering && firstFrame && !player.paused;
        clearTimeout(stallTimer);
        if (stuck && easyCanAct()) stallTimer = setTimeout(tryNextSource, 30000);
    });

    // Pick up where you left off. The Player model carries the stored library
    // record (position in ms and which episode it belongs to).
    async function resumeFrom() {
        const state = await core
            .getState<{ libraryItem: { state?: { timeOffset?: number; video_id?: string | null } } | null }>('player')
            .catch(() => null);
        const saved = state?.libraryItem?.state;
        if (!saved?.timeOffset) return 0;
        const sameVideo = type === 'movie' || !saved.video_id || cleanVideoId(saved.video_id) === videoId;
        return sameVideo ? Math.floor(saved.timeOffset / 1000) : 0;
    }

    function onPlayerEvent(e: { kind: string; reason?: string }) {
        if (e.kind === 'playback-restart') {
            seeks++;
            firstFrame = true;
            firstFrameSeen = true;
            addToLibraryIfNeeded();
            clearTimeout(watchdog);
        }
        if (e.kind === 'file-loaded') {
            player.setUpscaler?.(playerPrefs.upscaler);
            scheduleThumbnails();
        }
        if (e.kind === 'end-file' && e.reason === 'eof') {
            // An addon's error clip ending isn't the episode ending.
            if (player.duration != null && player.duration < ERROR_CLIP_MAX_S) return;
            core.dispatch({ action: 'Player', args: { action: 'Ended' } }, 'player');
            // Unless you cancelled the countdown on the Up next card.
            if (settings?.bingeWatching && model?.nextVideo && !nextDismissed && !autoplayFired) autoPlayNext();
        }
    }

    // Starting to watch something saves it to your library (once it actually plays).
    function addToLibraryIfNeeded() {
        const meta = model?.metaItem?.type === 'Ready' ? (model.metaItem as { content: { id?: string } }).content : null;
        if (meta?.id && !app.inLibrary(meta.id)) app.addToLibrary(meta);
    }

    // The meta item can arrive after playback starts.
    $effect(() => {
        if (firstFrameSeen && model?.metaItem?.type === 'Ready') addToLibraryIfNeeded();
    });

    // Seek-bar thumbnails open a second connection and decode frames, so they wait
    // until playback has settled: 30s in, with a healthy buffer ahead.
    function scheduleThumbnails() {
        const t = thumbs;
        const check = async () => {
            if (t !== thumbs || !t) return;
            const ahead = await player.bufferedAhead().catch(() => 0);
            if (player.duration && firstFrame && player.time > 30 && ahead >= 45 && !player.buffering) t.warmUp(player.duration);
            else setTimeout(check, 5000);
        };
        setTimeout(check, 30000);
    }

    // --- addon subtitles: listed in the menu, downloaded only when needed ------
    // Loading dozens of subtitle files at start stalls playback (mpv fetches each
    // one before continuing), so only your preferred language is added, once the
    // video is running; the rest download when you pick them.
    const addedSubs = new Map<string, true>();

    async function addAddonSubtitle(s: { url?: string | null; lang: string; label?: string | null }, select: boolean) {
        if (!s.url) return;
        if (addedSubs.has(s.url)) {
            const track = player.subTracks.find((t) => t.external && t.title === subtitleTitle(s));
            if (select && track) await player.selectSubtitle(track.id);
            return;
        }
        addedSubs.set(s.url, true);
        await player
            .addSubtitle(s.url, { select, title: subtitleTitle(s), lang: s.lang })
            .catch(() => addedSubs.delete(s.url!));
    }

    const subtitleTitle = (s: { lang: string; label?: string | null }) => s.label || langName(s.lang);

    // Preferred subtitle language: if the file has none built in, add the first
    // matching addon subtitle a few seconds after playback starts.
    $effect(() => {
        const pref = settings?.subtitlesLanguage as string | null | undefined;
        if (!pref || !firstFrameSeen || !model?.subtitles.length || subtitlesAdded) return;
        subtitlesAdded = true;
        const subs = model.subtitles;
        // Decide after a short delay, once mpv has reported the file's own tracks.
        setTimeout(() => {
            // Listening in that language already (e.g. an English dub): no subtitles needed.
            const audio = player.audioTracks.find((t) => t.selected);
            if (audio && sameLanguage(audio.lang, pref)) return;
            const builtIn = player.subTracks.some((t) => !t.external && sameLanguage(t.lang, pref));
            const match = subs.find((s) => sameLanguage(s.lang, pref) && s.url);
            if (!builtIn && match) addAddonSubtitle(match, player.sid === 'no');
        }, 3000);
    });

    // Addons answer a debrid failure with a short video of the error (Torrentio's
    // orange "An unexpected error occurred, please try again later"). It plays
    // fine, so nothing else notices. No movie or episode is that short.
    const ERROR_CLIP_MAX_S = 90;
    const errorClip = $derived(fileReady && !!player.duration && player.duration < ERROR_CLIP_MAX_S);
    let errorClipHandled: string | null = null;
    $effect(() => {
        const key = `${videoId}|${params.get('stream')}`;
        if (!errorClip || errorClipHandled === key) return;
        errorClipHandled = key;
        if (easyCanAct()) {
            player.setPaused(true);
            tryNextSource();
        } else {
            note('This looks like an error message from the addon, not the video. Try another source.', 8000);
        }
    });

    // No audio in your language in this file (e.g. an anime episode with no dub yet).
    // With Easy Mode on, try other cached sources that look like they have that
    // language (dual audio, dubs), and come back here if none does. Otherwise say so.
    let audioChecked: string | null = null;
    $effect(() => {
        const key = `${videoId}|${params.get('stream')}`;
        if (!fileReady || !player.duration || errorClip || audioChecked === key || !player.audioTracks.length) return;
        audioChecked = key;
        const auto = easyCanAct();
        const pref = (auto ? playerPrefs.easyLanguage : null) ?? (settings?.audioLanguage as string | null | undefined);
        if (!pref) return;
        const name = langName(langKey(pref) ?? pref);
        const inPref = (t: Track) => sameLanguage(t.lang, pref) || (!!t.title && t.title.toLowerCase().includes(name.toLowerCase()));
        // An untagged track could be anything: don't guess.
        if (player.audioTracks.some((t) => inPref(t) || !t.lang)) return;
        // Only anime: elsewhere the original audio is what you want (a Korean film stays Korean).
        if (auto && anime.isAnime(id) !== false) {
            findLanguage(name);
            return;
        }
        note(`No ${name} audio in this source`, 5000);
    });

    async function findLanguage(name: string) {
        const step = (await adoptQueue()) && easyQueue.anime ? easyQueue.nextForLanguage() : null;
        if (step) return switchForLanguage(step.pick.href, step.returning, name);
        switching = null;
        note(`No ${name} audio in this source`, 5000);
    }

    async function switchForLanguage(href: string, returning: boolean, name: string) {
        clearTimeout(watchdog);
        switching = returning
            ? `Couldn’t find ${name} audio for this one. Going back to the first source…`
            : `No ${name} audio in this source. Trying another…`;
        await goto(href, { replaceState: true });
        await begin();
        setTimeout(() => (switching = null), 3000);
    }

    // --- Windows media overlay: show name, "S1 · E3 · Episode", play/pause ---
    $effect(() => {
        if (!isDesktop || !player.loaded || !model) return;
        const image = episodeVideo?.thumbnail || meta?.background || meta?.poster || null;
        invoke('media_update', { title: heading, subtitle: subheading ?? '', image, paused: player.paused }).catch(() => {});
    });

    // --- Discord: "Watching <show> · S3 · E7" with time left (Settings, off by default) ---
    /** Bumped when playback restarts after a seek, so Discord's progress bar is redone. */
    let seeks = $state(0);
    $effect(() => {
        if (!isDesktop) return;
        if (!playerPrefs.discordPresence) {
            invoke('discord_clear').catch(() => {});
            return;
        }
        if (!fileReady || !model || errorClip) return;
        seeks;
        const presence = {
            title: heading,
            subtitle: subheading ?? '',
            image: episodeVideo?.thumbnail || meta?.poster || meta?.background || null,
            // Read without subscribing: the time ticks constantly; seeks and pauses re-run this.
            position: untrack(() => player.time),
            duration: player.duration,
            paused: player.paused,
        };
        invoke('discord_set', { presence }).catch(() => {});
    });

    // --- report progress to Stremio (drives Continue Watching) --------------

    $effect(() => {
        const t = player.time;
        // Not while an addon's error clip plays: it would overwrite where you left off.
        if (!player.loaded || !player.duration || player.duration < ERROR_CLIP_MAX_S || Math.abs(t - lastReported) < 1) return;
        lastReported = t;
        core.dispatch(
            {
                action: 'Player',
                args: { action: 'TimeChanged', args: { time: Math.round(t * 1000), duration: Math.round((player.duration ?? 0) * 1000), device: 'mpv' } },
            },
            'player'
        );
    });

    $effect(() => {
        const paused = player.paused;
        if (player.loaded) core.dispatch({ action: 'Player', args: { action: 'PausedChanged', args: { paused } } }, 'player');
    });

    // --- skip intro / recap / credits ---------------------------------------
    let segments = $state<Segment[]>([]);
    const autoSkipped = new Set<string>();
    let silenceSearching = $state(false);
    let skipNote = $state<string | null>(null);
    let skipNoteTimer: ReturnType<typeof setTimeout> | undefined;

    function note(text: string | null, ms = 2500) {
        clearTimeout(skipNoteTimer);
        skipNote = text;
        if (text) skipNoteTimer = setTimeout(() => (skipNote = null), ms);
    }

    // Look them up once per video, as soon as its length is known (it isn't yet
    // when the file first opens, and the databases match on length).
    let segmentsFor: string | null = null;
    $effect(() => {
        const key = `${id}|${videoId}`;
        if (!fileReady || !player.duration || !id || segmentsFor === key) return;
        segmentsFor = key;
        loadSegments();
    });

    async function loadSegments() {
        const duration = player.duration;
        if (!duration) return;
        const forVideo = videoId;
        const parts = videoId?.split(':') ?? [];
        const season = model?.seriesInfo?.season ?? (parts.length >= 3 ? Number(parts[parts.length - 2]) : null);
        const episode = model?.seriesInfo?.episode ?? (parts.length >= 3 ? Number(parts[parts.length - 1]) : null);
        const chapters = fromChapters(await player.chapters(), duration);
        const found = await lookupSegments({
            imdb: id,
            season: type === 'series' ? season : null,
            episode: type === 'series' ? episode : null,
            duration,
            chapters,
            movie: type === 'movie',
        });
        if (import.meta.env.DEV) console.info('[skip] segments', { id, season, episode, duration, found });
        if (forVideo === videoId) segments = found;
    }

    // The file's chapters, for the intro/outro marks on the seek bar.
    let fileChapters = $state<Chapter[]>([]);
    let chaptersFor: string | null = null;
    $effect(() => {
        const key = `${videoId}|${params.get('stream')}`;
        if (!fileReady || chaptersFor === key) return;
        chaptersFor = key;
        fileChapters = [];
        player
            .chapters()
            .then((list) => {
                if (chaptersFor === key) fileChapters = parseChapters(list);
            })
            .catch(() => {});
    });
    // Only the intro and outro split the bar; movies only split off their end credits.
    const seekChapters = $derived(
        !player.duration ? [] : introOutroMarks(fileChapters, segments, player.duration, type === 'movie')
    );

    // The section you're in right now (ends a moment early so the button doesn't flash at the edge).
    const currentSegment = $derived(segments.find((s) => player.time >= s.start && player.time < s.end - 0.75) ?? null);

    // The Skip button shows for 10s when a section starts, then gets out of the way
    // (it comes back while the controls are up, and S works throughout).
    const SKIP_PROMPT_MS = 10000;
    const segmentKey = $derived(currentSegment ? `${currentSegment.kind}:${currentSegment.start}` : null);
    let skipPromptExpired = $state<string | null>(null);
    $effect(() => {
        const key = segmentKey;
        skipPromptExpired = null;
        if (!key) return;
        const t = setTimeout(() => (skipPromptExpired = key), SKIP_PROMPT_MS);
        return () => clearTimeout(t);
    });
    const skipPrompting = $derived(!!segmentKey && skipPromptExpired !== segmentKey);
    const skipVisible = $derived(
        !!currentSegment && (skipPrompting || controlsVisible) && !(currentSegment.kind === 'credits' && showNext) && !silenceSearching
    );

    function skip(s: Segment) {
        if (s.kind === 'credits' && model?.nextVideo) return playNext();
        player.seek(s.end);
    }

    // Optional: skip intros and recaps without asking (once each; seeking back in keeps it).
    $effect(() => {
        const s = currentSegment;
        if (!s || !playerPrefs.autoSkip || (s.kind !== 'intro' && s.kind !== 'recap')) return;
        const key = `${s.kind}:${s.start}`;
        if (autoSkipped.has(key)) return;
        autoSkipped.add(key);
        player.seek(s.end);
        note(s.kind === 'intro' ? 'Skipped intro' : 'Skipped recap');
    });

    /** S (or Tab while the Skip button shows): skip the known section, otherwise look for the end of the intro by silence. */
    function tabSkip() {
        if (silenceSkipActive()) {
            cancelSilenceSkip();
            silenceSearching = false;
            return note(null);
        }
        if (currentSegment) return skip(currentSegment);
        // Known timings beat guessing: an intro or recap coming up next skips straight past it.
        const upcoming = segments.find((s) => (s.kind === 'intro' || s.kind === 'recap') && s.start > player.time);
        if (upcoming) return skip(upcoming);
        if (!player.features.silenceSkip) return note('No intro timings for this episode');
        silenceSearching = true;
        note('Looking for the end of the intro… Press S to cancel', 60000);
        startSilenceSkip((at) => {
            silenceSearching = false;
            note(at == null ? 'Couldn’t find the end of the intro' : null);
        });
    }

    // "Up next" card near the end of an episode.
    $effect(() => {
        const d = player.duration;
        // Also as soon as the credits start, when we know where they are.
        const inCredits = currentSegment?.kind === 'credits';
        showNext = !!model?.nextVideo && !!d && (inCredits || d - player.time <= nextThreshold) && !nextDismissed && !pip;
    });

    // With "Play next episode automatically" on, the card counts down and starts the
    // next episode when it runs out: `nextThreshold` seconds after the card appears,
    // or at the end if that's sooner. Counted in video time, so pausing pauses it.
    let nextCardAt = $state<number | null>(null);
    let autoplayFired = false;
    let nextThumbFailed = $state(false);
    $effect(() => {
        if (!showNext) nextCardAt = null;
        else if (nextCardAt == null) nextCardAt = player.time;
    });
    const autoplayIn = $derived.by(() => {
        if (!settings?.bingeWatching || !showNext || nextCardAt == null || !player.duration) return null;
        return Math.max(0, Math.min(player.duration, nextCardAt + nextThreshold) - player.time);
    });
    const autoplayTotal = $derived(player.duration && nextCardAt != null ? Math.min(player.duration, nextCardAt + nextThreshold) - nextCardAt : 0);
    $effect(() => {
        if (autoplayIn == null || autoplayIn > 0.25 || autoplayFired) return;
        autoplayFired = true;
        autoPlayNext();
    });

    // A minute before the "Up next" card appears, quietly find sources for the next
    // episode so the Next button can start it straight away. (Not needed when core
    // already remembers a source for it.)
    let prefetched: { video: string; picks: Pick[]; anime: boolean } | null = null;
    let prefetchFor: string | null = null;
    const PREFETCH_LEAD = 60;
    $effect(() => {
        const next = model?.nextVideo;
        const d = player.duration;
        if (!next || !d || !fileReady || !type || !id || next.id === videoId) return;
        if (next.deepLinks?.player || prefetchFor === next.id) return;
        // The card shows at the credits (when known) or `nextThreshold` before the end.
        const credits = segments.find((s) => s.kind === 'credits');
        const cardAt = Math.min(credits?.start ?? d, d - nextThreshold);
        if (player.time < cardAt - PREFETCH_LEAD) return;
        prefetchFor = next.id;
        prefetchPicks(type, id, next.id, likeThis()).then(({ picks, anime: isAnime }) => {
            if (picks.length) prefetched = { video: next.id, picks, anime: isAnime };
        });
    });

    // --- still watching? ----------------------------------------------------
    // Someone clicked, pressed a key or a media key: they're awake.
    let activeThisEpisode = false;
    let stillAsk = $state<{ left: number } | { paused: true } | null>(null);
    let stillTimer: ReturnType<typeof setInterval> | undefined;

    function markActive() {
        activeThisEpisode = true;
        stillWatching.autoEpisodes = 0;
        if (stillAsk) {
            clearInterval(stillTimer);
            stillAsk = null;
        }
    }

    /** The next episode starting by itself (not you pressing Next). */
    function autoPlayNext() {
        stillWatching.autoEpisodes = activeThisEpisode ? 1 : stillWatching.autoEpisodes + 1;
        playNext();
    }

    // Two episodes in a row started by themselves and nobody has touched anything
    // through either one's intro: once this one's intro is over (or 3 minutes in,
    // when its timing isn't known), ask, and pause if there's no answer in 15s.
    $effect(() => {
        if (!playerPrefs.askStillWatching || stillAsk || activeThisEpisode || stillWatching.autoEpisodes < 2) return;
        if (!fileReady || player.paused || errorClip) return;
        const intro = segments.find((s) => s.kind === 'intro');
        if (player.time < (intro ? intro.end + 5 : 180)) return;
        stillAsk = { left: 15 };
        clearInterval(stillTimer);
        stillTimer = setInterval(() => {
            if (!stillAsk || !('left' in stillAsk)) return clearInterval(stillTimer);
            if (stillAsk.left > 1) stillAsk = { left: stillAsk.left - 1 };
            else {
                clearInterval(stillTimer);
                player.setPaused(true);
                stillAsk = { paused: true };
            }
        }, 1000);
    });

    function keepWatching() {
        const wasPaused = !!stillAsk && 'paused' in stillAsk;
        markActive();
        if (wasPaused) player.setPaused(false);
    }

    async function playNext() {
        const next = model?.nextVideo;
        if (!next) return;
        core.dispatch({ action: 'Player', args: { action: 'NextVideo' } }, 'player');
        const link = next.deepLinks?.player ? parsePlayerDeepLink(next.deepLinks.player) : null;
        if (link) {
            await goto(playerHref(link), { replaceState: true });
            return begin();
        }
        // Stremio found no source for the next episode in the same "binge group" as this one
        // (many addons don't tag them). Like Stremio, don't make you choose again: pick the
        // best source, preferring the addon and quality you were just watching. Usually
        // that's already been done in the background (above).
        if (prefetched?.video === next.id) {
            const { picks, anime: isAnime } = prefetched;
            prefetched = null;
            easyQueue.start(next.id, picks, isAnime);
            await goto(picks[0].href, { replaceState: true });
            return begin();
        }
        if (type && id) {
            const q: Record<string, string> = { video: next.id, auto: '1' };
            const like = likeThis();
            if (like.addonUrl) q.likeAddon = like.addonUrl;
            if (like.resolution) q.likeRes = String(like.resolution);
            goto(titleHref(type, id, q), { replaceState: true });
        }
    }

    /** The addon and quality of what's playing, for choosing the next episode's source. */
    function likeThis(): Like {
        return { addonUrl: params.get('st'), resolution: playingStream ? parseStream(playingStream).resolution : null };
    }

    function changeSource() {
        easyQueue.clear();
        const target = videoId ?? id;
        if (type && id && target) goto(titleHref(type, id, { video: target }));
    }

    // --- controls ----------------------------------------------------------

    function poke() {
        controlsVisible = true;
        document.documentElement.classList.remove('player-idle');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            if (player.paused || menu.open) return poke();
            controlsVisible = false;
            document.documentElement.classList.add('player-idle');
        }, 2600);
    }

    // Desktop windows only; on iOS the player is always full screen.
    async function toggleFullscreen() {
        if (!isDesktop) return;
        if (pip) await togglePip();
        fullscreen = !fullscreen;
        await invoke('set_fullscreen', { fullscreen });
    }

    async function togglePip() {
        if (!isDesktop) return;
        pip = !pip;
        if (pip) fullscreen = false;
        await invoke('set_pip', { enabled: pip });
    }

    function exit() {
        if (history.length > 1) history.back();
        else goto(type && id ? titleHref(type, id) : '/');
    }

    const langName = (code?: string) => {
        if (!code) return 'Unknown';
        try {
            return new Intl.DisplayNames(undefined, { type: 'language' }).of(code) ?? code;
        } catch {
            return code;
        }
    };

    const trackLabel = (t: Track) => {
        const parts = [t.title, t.lang ? langName(t.lang) : null].filter(Boolean);
        const channels = t['demux-channel-count'] ?? t['audio-channels'];
        if (t.type === 'audio' && channels) parts.push(channels >= 8 ? '7.1' : channels >= 6 ? '5.1' : channels === 2 ? 'Stereo' : `${channels}ch`);
        if (t.type === 'audio' && t.codec) parts.push(t.codec.toUpperCase());
        return parts.join(' · ') || `Track ${t.id}`;
    };

    function subtitlesMenu(el: HTMLElement) {
        const entries: MenuEntry[] = [
            { label: 'Off', checked: player.sid === 'no', onselect: () => player.selectSubtitle('no') },
            ...(player.subTracks.length ? [{ separator: true } as MenuEntry] : []),
            ...player.subTracks.map((t) => ({
                label: trackLabel(t) + (t.external ? '' : ' (built in)'),
                checked: String(t.id) === player.sid,
                onselect: () => player.selectSubtitle(t.id),
            })),
        ];

        // Addon subtitles not loaded yet, grouped by language (preferred language first).
        const pending = (model?.subtitles ?? []).filter((s) => s.url && !addedSubs.has(s.url));
        if (pending.length) {
            const pref = settings?.subtitlesLanguage as string | null | undefined;
            const byLang = new Map<string, typeof pending>();
            for (const s of pending) byLang.set(s.lang, [...(byLang.get(s.lang) ?? []), s]);
            const langs = [...byLang.keys()].sort((a, b) =>
                a === pref ? -1 : b === pref ? 1 : langName(a).localeCompare(langName(b))
            );
            entries.push(
                { separator: true },
                {
                    label: 'From Addons',
                    submenu: langs.map((lang) => {
                        const subs = byLang.get(lang)!;
                        return subs.length === 1
                            ? { label: langName(lang), onselect: () => addAddonSubtitle(subs[0], true) }
                            : {
                                  label: `${langName(lang)} (${subs.length})`,
                                  submenu: subs.map((s, i) => ({
                                      label: s.label || `${langName(lang)} ${i + 1}`,
                                      onselect: () => addAddonSubtitle(s, true),
                                  })),
                              };
                    }),
                }
            );
        }
        menu.toggleFor(el, entries, 'end');
    }

    function audioMenu(el: HTMLElement) {
        menu.toggleFor(
            el,
            player.audioTracks.length
                ? player.audioTracks.map((t) => ({ label: trackLabel(t), checked: String(t.id) === player.aid, onselect: () => player.selectAudio(t.id) }))
                : [{ label: 'No audio tracks', disabled: true }],
            'end'
        );
    }

    function settingsMenu(el: HTMLElement) {
        const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
        const info = [
            player.width && player.height ? `${player.width}×${player.height}` : null,
            player.hdr ? (player.gamma === 'hlg' ? 'HLG' : 'HDR10') : 'SDR',
            player.hwdec == null ? null : player.hwdec && player.hwdec !== 'no' ? `GPU decoding (${player.hwdec})` : 'CPU decoding',
        ].filter(Boolean);
        const setUpscaler = (u: Upscaler) => {
            playerPrefs.upscaler = u;
            player.setUpscaler?.(u);
        };
        const entries: MenuEntry[] = [{ header: 'Video', detail: info.join(' · ') }];
        if (type && id) entries.push({ label: 'Change Source…', icon: 'link', onselect: changeSource });
        entries.push({
            label: 'Speed',
            submenu: speeds.map((s) => ({ label: s === 1 ? 'Normal' : `${s}×`, checked: player.speed === s, onselect: () => player.setSpeed(s) })),
        });
        // Desktop-only extras, where the player can do them.
        const { upscaling, hdrPassthrough, audioPassthrough } = player.features;
        if (upscaling) {
            entries.push({
                label: 'Upscaling',
                submenu: (Object.keys(upscalerLabels) as Upscaler[]).map((u) => ({
                    label: upscalerLabels[u],
                    checked: playerPrefs.upscaler === u,
                    onselect: () => setUpscaler(u),
                })),
            });
        }
        if (hdrPassthrough || audioPassthrough) entries.push({ separator: true });
        if (hdrPassthrough) {
            entries.push({
                label: 'HDR Passthrough',
                checked: playerPrefs.hdrPassthrough,
                onselect: () => {
                    playerPrefs.hdrPassthrough = !playerPrefs.hdrPassthrough;
                    player.setHdrPassthrough?.(playerPrefs.hdrPassthrough).catch(() => {});
                },
            });
        }
        if (audioPassthrough) {
            entries.push({
                label: 'Audio Passthrough (Atmos)',
                checked: playerPrefs.audioPassthrough,
                onselect: () => {
                    playerPrefs.audioPassthrough = !playerPrefs.audioPassthrough;
                    player.setAudioPassthrough?.(playerPrefs.audioPassthrough).catch(() => {});
                },
            });
        }
        menu.toggleFor(el, entries, 'end');
    }

    function onkeydown(e: KeyboardEvent) {
        if (menu.open || e.target instanceof HTMLInputElement) return;
        const k = e.key.toLowerCase();
        let handled = true;
        // Tab skips while the Skip button is up; otherwise it moves between controls as usual.
        if (k === 'tab' && !e.shiftKey && skipVisible) tabSkip();
        else if (k === 's') tabSkip();
        else if (k === ' ' || k === 'k') player.togglePause();
        else if (k === 'arrowright') player.seekBy(e.shiftKey ? seekStep / 3 : seekStep);
        else if (k === 'arrowleft') player.seekBy(e.shiftKey ? -seekStep / 3 : -seekStep);
        else if (k === 'arrowup') player.setVolume(player.volume + 5);
        else if (k === 'arrowdown') player.setVolume(player.volume - 5);
        else if (k === 'm') player.setMuted(!player.muted);
        else if (k === 'f') toggleFullscreen();
        else if (k === 'p') togglePip();
        else if (k === 'n' && model?.nextVideo) playNext();
        else if (k === 'escape') {
            if (pip) togglePip();
            else if (fullscreen) toggleFullscreen();
            else exit();
        } else handled = false;
        if (handled) {
            e.preventDefault();
            poke();
            markActive();
        }
    }

    // Touch screens (no hover): tap shows or hides the controls, double-tap a side
    // skips 10s (keep tapping to skip more), big buttons sit in the middle.
    let touchUI = $state(false);
    $effect(() => {
        const mq = matchMedia('(hover: none) and (pointer: coarse)');
        touchUI = mq.matches;
        const on = () => (touchUI = mq.matches);
        mq.addEventListener('change', on);
        return () => mq.removeEventListener('change', on);
    });
    const TAP_MS = 280;
    let lastTap: { at: number; side: -1 | 0 | 1 } | null = null;
    let tapTimer: ReturnType<typeof setTimeout> | undefined;
    /** Seconds skipped by the current run of double-taps, for the side indicator. */
    let tapSkip = $state<{ side: -1 | 1; total: number; key: number } | null>(null);
    let tapSkipTimer: ReturnType<typeof setTimeout> | undefined;
    let lastPointerType = '';

    function onsurfaceup(e: PointerEvent) {
        lastPointerType = e.pointerType;
        if (e.pointerType !== 'touch' || pip) return;
        const w = window.innerWidth;
        const side = e.clientX < w / 3 ? -1 : e.clientX > (w * 2) / 3 ? 1 : 0;
        const now = performance.now();
        const again = lastTap && now - lastTap.at < TAP_MS && lastTap.side === side;
        // Already skipping on this side: every tap adds 10s more.
        const skipping = tapSkip && side === tapSkip.side;
        if ((again || skipping) && side !== 0) {
            clearTimeout(tapTimer);
            lastTap = { at: now, side };
            tapBy(side as -1 | 1);
            return;
        }
        lastTap = { at: now, side };
        clearTimeout(tapTimer);
        tapTimer = setTimeout(() => {
            lastTap = null;
            toggleControls();
        }, TAP_MS);
    }
    function toggleControls() {
        if (controlsVisible) {
            clearTimeout(idleTimer);
            controlsVisible = false;
            document.documentElement.classList.add('player-idle');
        } else {
            poke();
        }
    }
    function tapBy(side: -1 | 1) {
        player.seekBy(side * 10);
        const total = tapSkip?.side === side ? tapSkip.total + 10 : 10;
        tapSkip = { side, total, key: Date.now() };
        clearTimeout(tapSkipTimer);
        tapSkipTimer = setTimeout(() => (tapSkip = null), 700);
    }

    // Clicking empty video area toggles play; double-click toggles fullscreen.
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    function onsurfaceclick() {
        if (lastPointerType === 'touch') return; // handled in onsurfaceup
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => player.togglePause(), 220);
    }
    function onsurfacedblclick() {
        if (lastPointerType === 'touch') return;
        clearTimeout(clickTimer);
        toggleFullscreen();
    }
    function onsurfacedown(e: PointerEvent) {
        // In picture-in-picture the whole video is a drag handle.
        if (pip && e.button === 0) invoke('start_dragging');
    }
</script>

<svelte:head><title>{heading} · Stremio</title></svelte:head>
<svelte:window {onkeydown} onpointermove={(e) => e.pointerType !== 'touch' && poke()} onpointerdown={(e) => !(e.target as Element | null)?.closest?.('.still') && markActive()} />

<div class="player" class:hidden={!controlsVisible} class:pip class:touch={touchUI}>
    <!-- Transparent surface over the video that takes clicks. -->
    <button
        class="surface"
        aria-label={player.paused ? 'Play' : 'Pause'}
        onclick={onsurfaceclick}
        ondblclick={onsurfacedblclick}
        onpointerdown={onsurfacedown}
        onpointerup={onsurfaceup}
    ></button>

    {#if tapSkip}
        {#key tapSkip.key}
            <div class="tap-skip" class:right={tapSkip.side > 0} aria-hidden="true">
                <Icon name={tapSkip.side > 0 ? 'forward' : 'replay'} size={26} />
                <span>{tapSkip.total}s</span>
            </div>
        {/key}
    {/if}

    {#if touchUI && !pip && !loadingVideo && !startError && !player.error}
        <div class="center-controls">
            <button class="icon ten" onclick={() => (player.seekBy(-10), poke())} aria-label="Back 10 seconds">
                <Icon name="replay" size={34} /><span>10</span>
            </button>
            <button class="icon huge" onclick={() => (player.togglePause(), poke())} aria-label={player.paused ? 'Play' : 'Pause'}>
                <Icon name={player.paused ? 'play' : 'pause'} size={38} filled />
            </button>
            <button class="icon ten" onclick={() => (player.seekBy(10), poke())} aria-label="Forward 10 seconds">
                <Icon name="forward" size={34} /><span>10</span>
            </button>
        </div>
    {/if}

    {#if switching}
        <div class="switching" role="status">{switching}</div>
    {/if}

    {#if (startError || player.error) && !easyQueue.activeFor(videoId) && !adopting}
        <div class="center-card" role="alert">
            <p class="err-title">Can’t play this stream</p>
            <p class="err-body">{startError ?? player.error}</p>
            <div class="err-actions">
                <button onclick={() => (type && id ? changeSource() : exit())}>Choose Another Source</button>
            </div>
        </div>
    {:else if loadingVideo}
        <div class="spinner" role="status" aria-label="Loading">
            <span></span>
            {#if player.bufferingPercent != null && player.bufferingPercent < 100}<em>{player.bufferingPercent}%</em>{/if}
        </div>
    {/if}

    <header class="top">
        {#if !pip}
            <button class="icon" onclick={exit} aria-label="Back" title="Back (Esc)"><Icon name="back" size={22} /></button>
        {/if}
        <div class="titles">
            <h1>{heading}</h1>
            {#if subheading}<p>{subheading}</p>{/if}
        </div>
        {#if player.hdr}<span class="badge">HDR</span>{/if}
        {#if pip}
            <button class="icon" onclick={togglePip} aria-label="Exit picture in picture" title="Exit Picture in Picture (P)"><Icon name="exitFullscreen" size={18} /></button>
        {/if}
    </header>

    {#if skipVisible && currentSegment}
        <button
            class="skip"
            onclick={() => skip(currentSegment!)}
            title={`${skipLabel[currentSegment.kind]} (Tab)`}
            out:fade={{ duration: 200 }}
        >
            {skipLabel[currentSegment.kind]}
            <Icon name="next" size={15} />
        </button>
    {/if}

    {#if skipNote}
        <div class="switching" role="status">{skipNote}</div>
    {/if}

    {#if stillAsk}
        <div class="still" role="alertdialog" aria-labelledby="still-title" aria-describedby="still-sub">
            <p id="still-title" class="still-title">Are you still watching?</p>
            <p class="still-show">{heading}{#if subheading} · {subheading}{/if}</p>
            <button class="still-button" onclick={keepWatching}>
                <Icon name="play" size={14} filled /> Continue Watching
            </button>
            <p id="still-sub" class="still-sub" aria-live="polite">
                {#if 'left' in stillAsk}Pausing in {stillAsk.left}s{:else}Paused{/if}
            </p>
        </div>
    {/if}

    {#if showNext && model?.nextVideo}
        <aside class="next" aria-label="Up next">
            {#if model.nextVideo.thumbnail && !nextThumbFailed}
                <img class="next-thumb" src={model.nextVideo.thumbnail} alt="" onerror={() => (nextThumbFailed = true)} />
            {/if}
            <div class="next-body">
                <span class="next-eyebrow">
                    Up Next{#if autoplayIn != null}<span class="next-countdown"> · Playing in {Math.ceil(autoplayIn)}s</span>{/if}
                </span>
                <span class="next-title">
                    {#if model.nextVideo.season != null}S{model.nextVideo.season} · E{model.nextVideo.episode} · {/if}{model.nextVideo.title}
                </span>
                <div class="next-actions">
                    <button
                        class="primary"
                        class:counting={autoplayIn != null}
                        style:--left={autoplayIn != null && autoplayTotal > 0 ? autoplayIn / autoplayTotal : 0}
                        onclick={playNext}
                    >
                        <Icon name="play" size={14} filled /> Play Now
                    </button>
                    <button onclick={() => (nextDismissed = true)}>{autoplayIn != null ? 'Cancel' : 'Dismiss'}</button>
                </div>
            </div>
        </aside>
    {/if}

    <!-- Touch: keep the controls up while dragging the seek bar. -->
    <footer class="bottom" onpointerdown={poke} onpointermove={poke}>
        <SeekBar time={player.time} duration={player.duration} buffered={player.cacheTime} chapters={seekChapters} onseek={(s) => player.seek(s)}>
            {#snippet preview(t: number)}
                {#if thumbs && !pip}<SeekPreview {thumbs} time={t} />{/if}
            {/snippet}
        </SeekBar>

        <div class="bar">
            <div class="group">
                <button class="icon big" onclick={() => player.togglePause()} aria-label={player.paused ? 'Play' : 'Pause'} title={player.paused ? 'Play (Space)' : 'Pause (Space)'}>
                    <Icon name={player.paused ? 'play' : 'pause'} size={24} filled={player.paused} />
                </button>
                {#if !pip}
                    <!-- Skipping by seconds lives on ←/→; the bar keeps the episode control. -->
                    {#if type === 'series'}
                        <button
                            class="icon"
                            onclick={playNext}
                            disabled={!model?.nextVideo}
                            aria-label="Next episode"
                            title={model?.nextVideo ? 'Next Episode (N)' : 'No next episode'}
                        >
                            <Icon name="next" size={20} />
                        </button>
                    {/if}
                    <div class="volume">
                        <button class="icon" onclick={() => player.setMuted(!player.muted)} aria-label={player.muted ? 'Unmute' : 'Mute'} title="Mute (M)">
                            <Icon name={player.muted || player.volume === 0 ? 'mute' : 'volume'} size={21} />
                        </button>
                        <input
                            type="range"
                            min="0"
                            max="130"
                            value={player.muted ? 0 : player.volume}
                            oninput={(e) => {
                                if (player.muted) player.setMuted(false);
                                player.setVolume(Number(e.currentTarget.value));
                            }}
                            aria-label="Volume"
                            style:--fill="{((player.muted ? 0 : player.volume) / 130) * 100}%"
                        />
                    </div>
                    <span class="time">{[fmtTime(player.time), player.duration ? fmtTime(player.duration) : null].filter(Boolean).join(' / ')}</span>
                {/if}
            </div>

            <div class="group">
                {#if !pip}
                    <button class="icon" aria-haspopup="menu" aria-expanded="false" aria-label="Subtitles" title="Subtitles" onclick={(e) => subtitlesMenu(e.currentTarget)}>
                        <Icon name="captions" size={21} />
                    </button>
                    <button class="icon" aria-haspopup="menu" aria-expanded="false" aria-label="Audio" title="Audio" onclick={(e) => audioMenu(e.currentTarget)}>
                        <Icon name="audio" size={20} />
                    </button>
                    <button class="icon" aria-haspopup="menu" aria-expanded="false" aria-label="Playback settings" title="Settings" onclick={(e) => settingsMenu(e.currentTarget)}>
                        <Icon name="gear" size={20} />
                    </button>
                {/if}
                {#if isDesktop}
                <button class="icon" onclick={togglePip} aria-label={pip ? 'Exit picture in picture' : 'Picture in picture'} title="Picture in Picture (P)">
                    <Icon name="pip" size={20} />
                </button>
                {/if}
                {#if !pip && isDesktop}
                    <button class="icon" onclick={toggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title="Full Screen (F)">
                        <Icon name={fullscreen ? 'exitFullscreen' : 'fullscreen'} size={20} />
                    </button>
                {/if}
            </div>
        </div>
    </footer>
</div>

<style>
    /* The page must be see-through so mpv's video shows. */
    :global(html.player-active),
    :global(html.player-active body) {
        background: transparent !important;
    }
    :global(html.player-idle),
    :global(html.player-idle *) {
        cursor: none !important;
    }

    .player {
        position: fixed;
        inset: 0;
        color: white;
        user-select: none;
    }
    .surface {
        all: unset;
        position: absolute;
        inset: 0;
        cursor: default;
    }
    .top,
    .bottom,
    .next {
        transition:
            opacity 240ms var(--ease),
            transform 240ms var(--ease);
    }
    .hidden .top {
        opacity: 0;
        transform: translateY(-8px);
        pointer-events: none;
    }
    .hidden .bottom {
        opacity: 0;
        transform: translateY(8px);
        pointer-events: none;
    }

    .top {
        position: absolute;
        inset: 0 0 auto 0;
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 18px 24px 48px;
        background: linear-gradient(to bottom, rgb(0 0 0 / 0.7), transparent);
    }
    .titles {
        flex: 1;
        min-width: 0;
    }
    h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: 20px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-shadow: 0 1px 8px rgb(0 0 0 / 0.5);
    }
    .titles p {
        margin: 2px 0 0;
        font-size: 13px;
        color: rgb(255 255 255 / 0.75);
    }
    .badge {
        padding: 3px 8px;
        border-radius: 5px;
        border: 1px solid rgb(255 255 255 / 0.6);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
    }

    .bottom {
        position: absolute;
        inset: auto 0 0 0;
        padding: 64px 24px 16px;
        background: linear-gradient(to top, rgb(0 0 0 / 0.78), transparent);
    }
    .bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 6px;
    }
    .group {
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .icon {
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: white;
        cursor: pointer;
        transition: background var(--fast);
    }
    .icon:hover:not(:disabled) {
        background: rgb(255 255 255 / 0.14);
    }
    .icon:disabled {
        opacity: 0.35;
        cursor: default;
    }
    .icon.big {
        width: 46px;
        height: 46px;
    }
    .time {
        margin-left: 10px;
        font-size: 13px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: rgb(255 255 255 / 0.9);
    }
    .volume {
        display: flex;
        align-items: center;
    }
    .volume input {
        appearance: none;
        width: 0;
        height: 4px;
        border-radius: 999px;
        background: linear-gradient(to right, white var(--fill), rgb(255 255 255 / 0.25) var(--fill));
        opacity: 0;
        transition:
            width var(--slow) var(--ease),
            opacity var(--fast);
        cursor: pointer;
    }
    .volume:hover input,
    .volume:focus-within input {
        width: 96px;
        opacity: 1;
        margin: 0 6px;
    }
    .volume input::-webkit-slider-thumb {
        appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: white;
    }

    /* Skip Intro / Recap / Credits: stays visible even when the controls fade. */
    .skip {
        position: absolute;
        right: 24px;
        bottom: 118px;
        /* Above the controls' gradient, which otherwise covers it and eats the hover. */
        z-index: 3;
        display: flex;
        align-items: center;
        gap: 8px;
        height: 44px;
        padding: 0 18px 0 22px;
        border: none;
        border-radius: 999px;
        background: rgb(20 20 26 / 0.72);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        color: white;
        font-size: var(--text-callout);
        font-weight: 700;
        cursor: pointer;
        animation: rise var(--slow) var(--ease);
        /* Never moves: sliding it when the controls appear pulled it out from under the cursor. */
        transition:
            background var(--fast),
            color var(--fast);
    }
    .skip:hover {
        background: white;
        color: black;
    }
    .pip .skip {
        right: 10px;
        bottom: 56px;
        height: 34px;
        padding: 0 12px 0 14px;
        font-size: 13px;
    }
    .switching {
        position: absolute;
        top: 80px;
        left: 50%;
        translate: -50% 0;
        padding: 10px 16px;
        border-radius: 999px;
        background: rgb(24 24 32 / 0.9);
        font-size: 13px;
        font-weight: 600;
        pointer-events: none;
        animation: rise var(--slow) var(--ease);
    }
    .spinner {
        position: absolute;
        top: 50%;
        left: 50%;
        translate: -50% -50%;
        display: grid;
        place-items: center;
        pointer-events: none;
    }
    .spinner span {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        border: 3px solid rgb(255 255 255 / 0.2);
        border-top-color: white;
        animation: spin 0.9s linear infinite;
    }
    .spinner em {
        position: absolute;
        font-style: normal;
        font-size: 11px;
        font-weight: 600;
    }
    @keyframes spin {
        to {
            rotate: 360deg;
        }
    }

    .center-card {
        position: absolute;
        top: 50%;
        left: 50%;
        translate: -50% -50%;
        width: min(420px, calc(100% - 48px));
        padding: 24px;
        border-radius: var(--radius-l);
        background: rgb(24 24 32 / 0.92);
        text-align: center;
    }
    .err-title {
        margin: 0 0 6px;
        font-size: var(--text-title3);
        font-weight: 600;
    }
    .err-body {
        margin: 0 0 18px;
        color: rgb(255 255 255 / 0.7);
        font-size: 13px;
        overflow-wrap: anywhere;
    }
    .err-actions button,
    .next-actions button {
        height: 34px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        background: rgb(255 255 255 / 0.14);
        color: white;
        font-weight: 600;
        cursor: pointer;
    }
    .err-actions button {
        background: white;
        color: black;
    }

    .next {
        position: absolute;
        right: 24px;
        bottom: 120px;
        width: 340px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border-radius: var(--radius-l);
        background: rgb(24 24 32 / 0.9);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgb(255 255 255 / 0.1);
        animation: rise var(--slow) var(--ease);
    }
    @keyframes rise {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
    }
    .next-thumb {
        display: block;
        width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        background: rgb(255 255 255 / 0.06);
    }
    .next-body {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 14px 16px 16px;
    }
    .next-countdown {
        color: white;
    }
    .next-eyebrow {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgb(255 255 255 / 0.6);
    }
    .next-title {
        font-weight: 600;
    }
    .next-actions {
        display: flex;
        gap: 8px;
        margin-top: 6px;
    }
    .next-actions .primary {
        display: flex;
        align-items: center;
        gap: 6px;
        background: white;
        color: black;
    }
    /* Counting down: the button fills from the left as the time runs out. */
    .next-actions .primary.counting {
        background: linear-gradient(to right, white calc((1 - var(--left)) * 100%), rgb(255 255 255 / 0.72) 0);
    }

    /* Still watching? */
    .still {
        position: absolute;
        top: 50%;
        left: 50%;
        translate: -50% -50%;
        z-index: 4;
        width: min(420px, calc(100% - 48px));
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 26px 24px 22px;
        border-radius: var(--radius-l);
        background: rgb(24 24 32 / 0.9);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgb(255 255 255 / 0.1);
        text-align: center;
        animation: rise var(--slow) var(--ease);
    }
    .still-title {
        margin: 0;
        font-size: var(--text-title3);
        font-weight: 600;
    }
    .still-show {
        max-width: 100%;
        margin: 0 0 14px;
        font-size: 13px;
        color: rgb(255 255 255 / 0.7);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .still-sub {
        margin: 6px 0 0;
        font-size: 12px;
        color: rgb(255 255 255 / 0.55);
        font-variant-numeric: tabular-nums;
    }
    .still-button {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 38px;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: white;
        color: black;
        font-weight: 600;
        cursor: pointer;
    }

    /* Reduce Motion: things fade in and out, but don't slide. */
    @media (prefers-reduced-motion: reduce) {
        .top,
        .bottom,
        .next {
            transition: opacity 240ms var(--ease);
        }
        .hidden .top,
        .hidden .bottom {
            transform: none;
        }
        .skip,
        .switching,
        .next,
        .still {
            animation: fade-in var(--slow) var(--ease);
        }
        .volume input {
            transition: opacity var(--fast);
        }
    }
    @keyframes fade-in {
        from {
            opacity: 0;
        }
    }

    /* Picture in picture: just the essentials, sized for a small window. */
    .pip .top {
        padding: 8px 10px 24px;
    }
    .pip h1 {
        font-size: 13px;
    }
    .pip .titles p {
        display: none;
    }
    .pip .bottom {
        padding: 24px 10px 6px;
    }
    .pip .icon {
        width: 32px;
        height: 32px;
    }

    /* Touch screens: big middle controls, slimmer bottom bar, notch-safe edges. */
    .center-controls {
        position: absolute;
        top: 50%;
        left: 50%;
        translate: -50% -50%;
        display: flex;
        align-items: center;
        gap: 40px;
        transition: opacity 240ms var(--ease);
    }
    .hidden .center-controls {
        opacity: 0;
        pointer-events: none;
    }
    .center-controls .huge {
        width: 76px;
        height: 76px;
    }
    /* Plain glyphs over the video (no discs behind them), shadowed to read on
       bright frames. */
    .center-controls .icon {
        background: none;
        filter: drop-shadow(0 1px 8px rgb(0 0 0 / 0.55));
    }
    .center-controls .ten {
        position: relative;
        width: 56px;
        height: 56px;
    }
    .center-controls .ten span {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        font-size: 10px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: -0.02em;
        text-box: trim-both cap alphabetic;
    }
    .tap-skip {
        position: absolute;
        top: 50%;
        left: 12%;
        translate: -50% -50%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        width: 96px;
        height: 96px;
        justify-content: center;
        filter: drop-shadow(0 1px 8px rgb(0 0 0 / 0.6));
        font-size: 13px;
        font-weight: 700;
        pointer-events: none;
        animation: tap-pop 700ms var(--ease) forwards;
    }
    .tap-skip.right {
        left: 88%;
    }
    @keyframes tap-pop {
        0% {
            opacity: 0;
            scale: 0.8;
        }
        15% {
            opacity: 1;
            scale: 1;
        }
        75% {
            opacity: 1;
        }
        100% {
            opacity: 0;
        }
    }
    .touch .top {
        padding: max(12px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 40px max(16px, env(safe-area-inset-left));
    }
    .touch .bottom {
        padding: 48px max(16px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    }
    /* The middle has play/pause and ±10s; the phone's buttons do volume. */
    .touch .bar .big,
    .touch .volume {
        display: none;
    }
    /* Without the controls, Skip sits near the bottom instead of floating
       where the bar would be. */
    .touch .skip {
        right: max(20px, env(safe-area-inset-right));
        transition: bottom 240ms var(--ease);
    }
    .touch.hidden .skip {
        bottom: max(24px, calc(env(safe-area-inset-bottom) + 12px));
    }
    /* iOS keeps :hover on a tapped button, which would leave a grey disc. */
    .touch .icon:hover:not(:disabled) {
        background: transparent;
    }
    .touch .time {
        margin-left: 4px;
    }
    .touch .icon {
        width: 44px;
        height: 44px;
    }
</style>
