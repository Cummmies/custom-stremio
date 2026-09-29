<script lang="ts">
    // Full-window player. mpv draws the video underneath this transparent page;
    // everything you see here is the control layer on top of it.
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import { invoke } from '@tauri-apps/api/core';
    import { core } from '$lib/core';
    import { app } from '$lib/app.svelte';
    import { mpv, buildOptions, inTauri, type Track } from '$lib/player/mpv.svelte';
    import { playerPrefs, upscalerLabels, type Upscaler } from '$lib/player/prefs.svelte';
    import { cleanVideoId, parsePlayerDeepLink, playerHref, streamUrl } from '$lib/player/deeplink';
    import { easyQueue, type Pick } from '$lib/player/easy';
    import { prefetchPicks } from '$lib/player/prefetch';
    import { sameLanguage } from '$lib/player/lang';
    import { fromChapters, lookupSegments, skipLabel, type Segment } from '$lib/player/skips';
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
        nextVideo: { id: string; title: string; season?: number; episode?: number; deepLinks?: { player: string | null } } | null;
        subtitles: { id: string; lang: string; url?: string | null; label?: string | null }[];
        stream: { type: 'Ready'; content: { deepLinks?: { externalPlayer?: { streaming?: string | null } } } } | { type: string } | null;
        metaItem: { type: 'Ready'; content: { name: string; logo?: string | null } } | { type: string } | null;
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
    const metaName = $derived(model?.metaItem?.type === 'Ready' ? (model.metaItem as any).content.name : null);
    const heading = $derived(metaName ?? model?.title ?? 'Loading…');
    const subheading = $derived(
        model?.seriesInfo
            ? `S${model.seriesInfo.season} · E${model.seriesInfo.episode}${model.title && model.title !== metaName ? ` · ${model.title.replace(/^.*?:\s*/, '')}` : ''}`
            : null
    );
    const loadingVideo = $derived(!mpv.loaded || (mpv.buffering && !mpv.paused));
    const nextThreshold = $derived(((settings?.nextVideoNotificationDuration as number | undefined) ?? 35000) / 1000);

    // --- lifecycle ---------------------------------------------------------

    onMount(() => {
        document.documentElement.classList.add('player-active');
        const unwatch = core.watch<PlayerModel>('player', (s) => (model = s));
        const offEvents = mpv.onEvent(onMpvEvent);
        begin();
        return () => {
            unwatch();
            offEvents();
            document.documentElement.classList.remove('player-active', 'player-idle');
            clearTimeout(idleTimer);
            clearTimeout(watchdog);
            clearTimeout(stallTimer);
            cancelSilenceSkip();
            if (pip) invoke('set_pip', { enabled: false });
            if (fullscreen) invoke('set_fullscreen', { fullscreen: false });
            mpv.stop();
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
        const encoded = params.get('stream');
        if (!encoded) return (startError = 'Nothing to play.');

        const stream = await core.decodeStream(encoded).catch(() => null);
        if (!stream) return (startError = 'This stream link is broken.');

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
        thumbs = new Thumbnails(url, () => mpv.buffering || !mpv.loaded);

        // Easy Mode: if this source never shows a picture, move on to the next best.
        firstFrame = false;
        clearTimeout(watchdog);
        if (easyQueue.activeFor(videoId)) {
            const isTorrent = !!stream.infoHash && !stream.url;
            watchdog = setTimeout(() => !firstFrame && tryNextSource(), isTorrent ? 30000 : 15000);
        }
        try {
            await mpv.start(buildOptions(settings ?? {}));
            const start = await resumeFrom();
            // mpv.load clears the old file's state in the same tick, so `fileFor`
            // never pairs this video with the previous file's length or position.
            fileFor = `${id}|${videoId}`;
            await mpv.load(url, start);
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
    const fileReady = $derived(mpv.loaded && fileFor === `${id}|${videoId}`);

    async function tryNextSource() {
        clearTimeout(watchdog);
        clearTimeout(stallTimer);
        if (!easyQueue.activeFor(videoId)) return;
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
        if ((startError || mpv.error) && easyQueue.activeFor(videoId)) tryNextSource();
    });

    // Stuck buffering for 30s mid-episode → next source (it resumes at the same time).
    $effect(() => {
        const stuck = mpv.buffering && firstFrame && !mpv.paused;
        clearTimeout(stallTimer);
        if (stuck && easyQueue.activeFor(videoId)) stallTimer = setTimeout(tryNextSource, 30000);
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

    function onMpvEvent(e: { kind: string; reason?: string }) {
        if (e.kind === 'playback-restart') {
            firstFrame = true;
            firstFrameSeen = true;
            addToLibraryIfNeeded();
            clearTimeout(watchdog);
        }
        if (e.kind === 'file-loaded') {
            mpv.applyUpscaler(playerPrefs.upscaler);
            scheduleThumbnails();
        }
        if (e.kind === 'end-file' && e.reason === 'eof') {
            core.dispatch({ action: 'Player', args: { action: 'Ended' } }, 'player');
            if (settings?.bingeWatching && model?.nextVideo) playNext();
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
            const ahead = Number(await mpv.get('demuxer-cache-duration').catch(() => 0)) || 0;
            if (mpv.duration && firstFrame && mpv.time > 30 && ahead >= 45 && !mpv.buffering) t.warmUp(mpv.duration);
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
            const track = mpv.subTracks.find((t) => t.external && t.title === subtitleTitle(s));
            if (select && track) await mpv.set('sid', track.id);
            return;
        }
        addedSubs.set(s.url, true);
        await mpv.command('sub-add', s.url, select ? 'select' : 'auto', subtitleTitle(s), s.lang).catch(() => addedSubs.delete(s.url!));
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
            const builtIn = mpv.subTracks.some((t) => !t.external && sameLanguage(t.lang, pref));
            const match = subs.find((s) => sameLanguage(s.lang, pref) && s.url);
            if (!builtIn && match) addAddonSubtitle(match, mpv.sid === 'no');
        }, 3000);
    });

    // --- report progress to Stremio (drives Continue Watching) --------------

    $effect(() => {
        const t = mpv.time;
        if (!mpv.loaded || Math.abs(t - lastReported) < 1) return;
        lastReported = t;
        core.dispatch(
            {
                action: 'Player',
                args: { action: 'TimeChanged', args: { time: Math.round(t * 1000), duration: Math.round((mpv.duration ?? 0) * 1000), device: 'mpv' } },
            },
            'player'
        );
    });

    $effect(() => {
        const paused = mpv.paused;
        if (mpv.loaded) core.dispatch({ action: 'Player', args: { action: 'PausedChanged', args: { paused } } }, 'player');
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
        if (!fileReady || !mpv.duration || !id || segmentsFor === key) return;
        segmentsFor = key;
        loadSegments();
    });

    async function loadSegments() {
        const duration = mpv.duration;
        if (!duration) return;
        const forVideo = videoId;
        const parts = videoId?.split(':') ?? [];
        const season = model?.seriesInfo?.season ?? (parts.length >= 3 ? Number(parts[parts.length - 2]) : null);
        const episode = model?.seriesInfo?.episode ?? (parts.length >= 3 ? Number(parts[parts.length - 1]) : null);
        const chapters = fromChapters(await mpv.get('chapter-list').catch(() => null), duration);
        const found = await lookupSegments({
            imdb: id,
            season: type === 'series' ? season : null,
            episode: type === 'series' ? episode : null,
            duration,
            chapters,
        });
        if (import.meta.env.DEV) console.info('[skip] segments', { id, season, episode, duration, found });
        if (forVideo === videoId) segments = found;
    }

    // The section you're in right now (ends a moment early so the button doesn't flash at the edge).
    const currentSegment = $derived(segments.find((s) => mpv.time >= s.start && mpv.time < s.end - 0.75) ?? null);

    // The Skip button shows for 10s when a section starts, then gets out of the way
    // (it comes back while the controls are up, and Tab works throughout).
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

    function skip(s: Segment) {
        if (s.kind === 'credits' && model?.nextVideo) return playNext();
        mpv.seek(s.end);
    }

    // Optional: skip intros and recaps without asking (once each; seeking back in keeps it).
    $effect(() => {
        const s = currentSegment;
        if (!s || !playerPrefs.autoSkip || (s.kind !== 'intro' && s.kind !== 'recap')) return;
        const key = `${s.kind}:${s.start}`;
        if (autoSkipped.has(key)) return;
        autoSkipped.add(key);
        mpv.seek(s.end);
        note(s.kind === 'intro' ? 'Skipped intro' : 'Skipped recap');
    });

    /** Tab: skip the known section, otherwise look for the end of the intro by silence. */
    function tabSkip() {
        if (silenceSkipActive()) {
            cancelSilenceSkip();
            silenceSearching = false;
            return note(null);
        }
        if (currentSegment) return skip(currentSegment);
        silenceSearching = true;
        note('Looking for the end of the intro… Press Tab to cancel', 60000);
        startSilenceSkip((at) => {
            silenceSearching = false;
            note(at == null ? 'Couldn’t find the end of the intro' : null);
        });
    }

    // "Up next" card near the end of an episode.
    $effect(() => {
        const d = mpv.duration;
        // Also as soon as the credits start, when we know where they are.
        const inCredits = currentSegment?.kind === 'credits';
        showNext = !!model?.nextVideo && !!d && (inCredits || d - mpv.time <= nextThreshold) && !nextDismissed && !pip;
    });

    // Easy Mode: past halfway, quietly find sources for the next episode so the
    // Next button can start it straight away. (Not needed when core already
    // remembers a source for it.)
    let prefetched: { video: string; picks: Pick[] } | null = null;
    let prefetchFor: string | null = null;
    $effect(() => {
        const next = model?.nextVideo;
        const d = mpv.duration;
        if (!next || !d || !fileReady || !type || !id || next.id === videoId) return;
        if (!playerPrefs.easyMode || next.deepLinks?.player || prefetchFor === next.id || mpv.time < d / 2) return;
        prefetchFor = next.id;
        prefetchPicks(type, id, next.id).then((picks) => {
            if (picks.length) prefetched = { video: next.id, picks };
        });
    });

    async function playNext() {
        const next = model?.nextVideo;
        if (!next) return;
        core.dispatch({ action: 'Player', args: { action: 'NextVideo' } }, 'player');
        const link = next.deepLinks?.player ? parsePlayerDeepLink(next.deepLinks.player) : null;
        if (link) {
            await goto(playerHref(link), { replaceState: true });
            return begin();
        }
        if (playerPrefs.easyMode && prefetched?.video === next.id) {
            const { picks } = prefetched;
            prefetched = null;
            easyQueue.start(next.id, picks);
            await goto(picks[0].href, { replaceState: true });
            return begin();
        }
        // No remembered source for the next episode: Easy Mode picks one, otherwise you do.
        if (type && id) {
            const params: Record<string, string> = { video: next.id };
            if (playerPrefs.easyMode) params.auto = '1';
            goto(titleHref(type, id, params), { replaceState: true });
        }
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
            if (mpv.paused || menu.open) return poke();
            controlsVisible = false;
            document.documentElement.classList.add('player-idle');
        }, 2600);
    }

    async function toggleFullscreen() {
        if (pip) await togglePip();
        fullscreen = !fullscreen;
        await invoke('set_fullscreen', { fullscreen });
    }

    async function togglePip() {
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
            { label: 'Off', checked: mpv.sid === 'no', onselect: () => mpv.set('sid', 'no') },
            ...(mpv.subTracks.length ? [{ separator: true } as MenuEntry] : []),
            ...mpv.subTracks.map((t) => ({
                label: trackLabel(t) + (t.external ? '' : ' (built in)'),
                checked: String(t.id) === mpv.sid,
                onselect: () => mpv.set('sid', t.id),
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
            mpv.audioTracks.length
                ? mpv.audioTracks.map((t) => ({ label: trackLabel(t), checked: String(t.id) === mpv.aid, onselect: () => mpv.set('aid', t.id) }))
                : [{ label: 'No audio tracks', disabled: true }],
            'end'
        );
    }

    function settingsMenu(el: HTMLElement) {
        const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
        const info = [
            mpv.width && mpv.height ? `${mpv.width}×${mpv.height}` : null,
            mpv.hdr ? (mpv.gamma === 'hlg' ? 'HLG' : 'HDR10') : 'SDR',
            mpv.hwdec == null ? null : mpv.hwdec && mpv.hwdec !== 'no' ? `GPU decoding (${mpv.hwdec})` : 'CPU decoding',
        ].filter(Boolean);
        const setUpscaler = (u: Upscaler) => {
            const needsRestart = (u === 'rtx') !== (playerPrefs.upscaler === 'rtx');
            playerPrefs.upscaler = u;
            if (needsRestart) mpv.set('hwdec', u === 'rtx' ? 'd3d11va' : 'auto-safe').catch(() => {});
            mpv.applyUpscaler(u);
        };
        menu.toggleFor(
            el,
            [
                { header: 'Video', detail: info.join(' · ') },
                ...(type && id ? [{ label: 'Change Source…', icon: 'link', onselect: changeSource } as MenuEntry] : []),
                {
                    label: 'Speed',
                    submenu: speeds.map((s) => ({ label: s === 1 ? 'Normal' : `${s}×`, checked: mpv.speed === s, onselect: () => mpv.set('speed', s) })),
                },
                {
                    label: 'Upscaling',
                    submenu: (Object.keys(upscalerLabels) as Upscaler[]).map((u) => ({
                        label: upscalerLabels[u],
                        checked: playerPrefs.upscaler === u,
                        onselect: () => setUpscaler(u),
                    })),
                },
                { separator: true },
                {
                    label: 'HDR Passthrough',
                    checked: playerPrefs.hdrPassthrough,
                    onselect: () => {
                        playerPrefs.hdrPassthrough = !playerPrefs.hdrPassthrough;
                        mpv.set('target-colorspace-hint', playerPrefs.hdrPassthrough).catch(() => {});
                    },
                },
                {
                    label: 'Audio Passthrough (Atmos)',
                    checked: playerPrefs.audioPassthrough,
                    onselect: () => {
                        playerPrefs.audioPassthrough = !playerPrefs.audioPassthrough;
                        mpv.set('audio-spdif', playerPrefs.audioPassthrough ? 'ac3,eac3,dts,dts-hd,truehd' : '').catch(() => {});
                    },
                },
            ],
            'end'
        );
    }

    function onkeydown(e: KeyboardEvent) {
        if (menu.open || e.target instanceof HTMLInputElement) return;
        const k = e.key.toLowerCase();
        let handled = true;
        if (k === 'tab') tabSkip();
        else if (k === ' ' || k === 'k') mpv.togglePause();
        else if (k === 'arrowright') mpv.seekBy(e.shiftKey ? seekStep / 3 : seekStep);
        else if (k === 'arrowleft') mpv.seekBy(e.shiftKey ? -seekStep / 3 : -seekStep);
        else if (k === 'arrowup') mpv.setVolume(mpv.volume + 5);
        else if (k === 'arrowdown') mpv.setVolume(mpv.volume - 5);
        else if (k === 'm') mpv.set('mute', !mpv.muted);
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
        }
    }

    // Clicking empty video area toggles play; double-click toggles fullscreen.
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    function onsurfaceclick() {
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => mpv.togglePause(), 220);
    }
    function onsurfacedblclick() {
        clearTimeout(clickTimer);
        toggleFullscreen();
    }
    function onsurfacedown(e: PointerEvent) {
        // In picture-in-picture the whole video is a drag handle.
        if (pip && e.button === 0) invoke('start_dragging');
    }
</script>

<svelte:head><title>{heading} · Stremio</title></svelte:head>
<svelte:window {onkeydown} onpointermove={poke} />

<div class="player" class:hidden={!controlsVisible} class:pip>
    <!-- Transparent surface over the video that takes clicks. -->
    <button
        class="surface"
        aria-label={mpv.paused ? 'Play' : 'Pause'}
        onclick={onsurfaceclick}
        ondblclick={onsurfacedblclick}
        onpointerdown={onsurfacedown}
    ></button>

    {#if switching}
        <div class="switching" role="status">{switching}</div>
    {/if}

    {#if (startError || mpv.error) && !easyQueue.activeFor(videoId)}
        <div class="center-card" role="alert">
            <p class="err-title">Can’t play this stream</p>
            <p class="err-body">{startError ?? mpv.error}</p>
            <div class="err-actions">
                <button onclick={() => (type && id ? changeSource() : exit())}>Choose Another Source</button>
            </div>
        </div>
    {:else if loadingVideo}
        <div class="spinner" role="status" aria-label="Loading">
            <span></span>
            {#if mpv.bufferingPercent != null && mpv.bufferingPercent < 100}<em>{mpv.bufferingPercent}%</em>{/if}
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
        {#if mpv.hdr}<span class="badge">HDR</span>{/if}
        {#if pip}
            <button class="icon" onclick={togglePip} aria-label="Exit picture in picture" title="Exit Picture in Picture (P)"><Icon name="exitFullscreen" size={18} /></button>
        {/if}
    </header>

    {#if currentSegment && (skipPrompting || controlsVisible) && !(currentSegment.kind === 'credits' && showNext) && !silenceSearching}
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

    {#if showNext && model?.nextVideo}
        <aside class="next" aria-label="Up next">
            <span class="next-eyebrow">Up Next</span>
            <span class="next-title">
                {#if model.nextVideo.season != null}S{model.nextVideo.season} · E{model.nextVideo.episode} · {/if}{model.nextVideo.title}
            </span>
            <div class="next-actions">
                <button class="primary" onclick={playNext}><Icon name="play" size={14} filled /> Play Now</button>
                <button onclick={() => (nextDismissed = true)}>Dismiss</button>
            </div>
        </aside>
    {/if}

    <footer class="bottom">
        <SeekBar time={mpv.time} duration={mpv.duration} buffered={mpv.cacheTime} onseek={(s) => mpv.seek(s)}>
            {#snippet preview(t: number)}
                {#if thumbs && !pip}<SeekPreview {thumbs} time={t} />{/if}
            {/snippet}
        </SeekBar>

        <div class="bar">
            <div class="group">
                <button class="icon big" onclick={() => mpv.togglePause()} aria-label={mpv.paused ? 'Play' : 'Pause'} title={mpv.paused ? 'Play (Space)' : 'Pause (Space)'}>
                    <Icon name={mpv.paused ? 'play' : 'pause'} size={24} filled={mpv.paused} />
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
                        <button class="icon" onclick={() => mpv.set('mute', !mpv.muted)} aria-label={mpv.muted ? 'Unmute' : 'Mute'} title="Mute (M)">
                            <Icon name={mpv.muted || mpv.volume === 0 ? 'mute' : 'volume'} size={21} />
                        </button>
                        <input
                            type="range"
                            min="0"
                            max="130"
                            value={mpv.muted ? 0 : mpv.volume}
                            oninput={(e) => {
                                if (mpv.muted) mpv.set('mute', false);
                                mpv.setVolume(Number(e.currentTarget.value));
                            }}
                            aria-label="Volume"
                            style:--fill="{((mpv.muted ? 0 : mpv.volume) / 130) * 100}%"
                        />
                    </div>
                    <span class="time">{[fmtTime(mpv.time), mpv.duration ? fmtTime(mpv.duration) : null].filter(Boolean).join(' / ')}</span>
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
                <button class="icon" onclick={togglePip} aria-label={pip ? 'Exit picture in picture' : 'Picture in picture'} title="Picture in Picture (P)">
                    <Icon name="pip" size={20} />
                </button>
                {#if !pip}
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
        transition:
            background var(--fast),
            color var(--fast),
            bottom 240ms var(--ease);
    }
    .skip:hover {
        background: white;
        color: black;
    }
    .hidden .skip {
        bottom: 40px;
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
        width: 320px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 16px;
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
</style>
