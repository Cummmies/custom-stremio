// The TV player backend: Samsung's AVPlay (webapis.avplay) on Tizen TVs.
//
// AVPlay decodes in hardware and draws the video on a plane behind the web page
// (the player page is transparent, as with mpv). It plays what the TV plays:
// H.264, HEVC (HDR10/HLG/Dolby Vision, the TV switches modes itself), AV1 on
// newer models, MKV and MP4, AAC/AC-3/E-AC-3 (no DTS). See docs/samsung-tv.md.
//
// Unlike mpv it doesn't draw subtitles: the file's own subtitle tracks come in
// as text (onsubtitlechange), addon subtitles are fetched and timed here, and
// the player page shows `subtitleText`.
import { isTV } from '$lib/platform';
import { langKey } from './lang';
import { parseSubtitles, cueAt, cleanCueText, type Cue } from './subtitles';
import type { PlayerBackend, PlayerEvent, PlayerFeatures, RawChapter, StartSettings, Track } from './backend';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AVPlay = any;

/** Loads Samsung's webapis.js once (it defines webapis.avplay). */
let webapisLoad: Promise<void> | null = null;
function loadWebapis(): Promise<void> {
    if ((window as any).webapis?.avplay) return Promise.resolve();
    webapisLoad ??= new Promise((resolve, reject) => {
        const s = document.createElement('script');
        // $WEBAPIS is resolved by the TV's web runtime.
        s.src = '$WEBAPIS/webapis/webapis.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Samsung’s player isn’t available on this TV.'));
        document.head.appendChild(s);
    });
    return webapisLoad;
}

/** The element AVPlay needs on the page; the video shows through where it is. */
function ensurePlayerObject() {
    if (document.getElementById('avplayer')) return;
    const o = document.createElement('object');
    o.id = 'avplayer';
    o.type = 'application/avplayer';
    o.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:-1;pointer-events:none';
    document.body.appendChild(o);
}

/** Track info as AVPlay reports it: extra_info is a JSON string. */
type AVTrack = { index: number; type: 'VIDEO' | 'AUDIO' | 'TEXT'; extra_info: string };

function info(t: AVTrack): Record<string, string> {
    try {
        return JSON.parse(t.extra_info) ?? {};
    } catch {
        return {};
    }
}

/** Ids for addon subtitles, so they never clash with AVPlay's track indexes. */
const EXTERNAL_BASE = 10000;

type External = { id: number; url: string; title: string; lang?: string; cues: Cue[] | null };

class AVPlayBackend implements PlayerBackend {
    readonly features: PlayerFeatures = {
        upscaling: false,
        hdrPassthrough: false,
        audioPassthrough: false,
        thumbnails: false,
        silenceSkip: false,
    };

    running = $state(false);
    loaded = $state(false);
    time = $state(0);
    duration = $state<number | null>(null);
    paused = $state(false);
    buffering = $state(true);
    bufferingPercent = $state<number | null>(null);
    cacheTime = $state<number | null>(null);
    // The TV's own volume (remote) is the volume; the app doesn't change it.
    volume = $state(100);
    muted = $state(false);
    speed = $state(1);
    tracks = $state<Track[]>([]);
    aid = $state<string>('no');
    sid = $state<string>('no');
    width = $state<number | null>(null);
    height = $state<number | null>(null);
    hdr = $state(false);
    gamma = $state<string | null>(null);
    hwdec = $state<string | null>('AVPlay');
    ended = $state(false);
    error = $state<string | null>(null);
    subtitleText = $state('');

    audioTracks = $derived(this.tracks.filter((t) => t.type === 'audio'));
    subTracks = $derived(this.tracks.filter((t) => t.type === 'sub'));

    #listeners = new Set<(e: PlayerEvent) => void>();
    #settings: StartSettings = {};
    #externals: External[] = [];
    /** Text from the file's own subtitle track (AVPlay times it). */
    #embeddedText = '';
    #clock: ReturnType<typeof setInterval> | undefined;
    #generation = 0;
    #open = false;

    onEvent(fn: (e: PlayerEvent) => void) {
        this.#listeners.add(fn);
        return () => this.#listeners.delete(fn);
    }

    #emit(e: PlayerEvent) {
        this.#listeners.forEach((fn) => fn(e));
    }

    get #av(): AVPlay {
        return (window as any).webapis.avplay;
    }

    async start(settings: StartSettings) {
        if (!isTV) throw new Error('Playback needs the TV app.');
        await loadWebapis();
        ensurePlayerObject();
        this.#settings = settings;
        this.running = true;
        document.addEventListener('visibilitychange', this.#onVisibility);
    }

    // The TV suspends apps in the background; AVPlay has to let go and come back.
    #onVisibility = () => {
        if (!this.#open) return;
        try {
            if (document.hidden) this.#av.suspend();
            else this.#av.restore();
        } catch {
            /* not in a state that can suspend */
        }
    };

    async load(url: string, startSeconds = 0) {
        const generation = ++this.#generation;
        this.#close();
        this.loaded = false;
        this.buffering = true;
        this.bufferingPercent = null;
        this.ended = false;
        this.error = null;
        this.time = startSeconds;
        this.duration = null;
        this.paused = false;
        this.tracks = [];
        this.aid = 'no';
        this.sid = 'no';
        this.width = this.height = null;
        this.hdr = false;
        this.#externals = [];
        this.#embeddedText = '';
        this.subtitleText = '';

        const av = this.#av;
        av.open(url);
        this.#open = true;
        av.setDisplayRect(0, 0, 1920, 1080);
        try {
            av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
        } catch {
            /* older firmware */
        }
        av.setListener({
            onbufferingstart: () => {
                this.buffering = true;
                this.bufferingPercent = 0;
            },
            onbufferingprogress: (percent: number) => (this.bufferingPercent = percent),
            onbufferingcomplete: () => {
                this.buffering = false;
                this.bufferingPercent = null;
                this.#emit({ kind: 'playback-restart' });
            },
            oncurrentplaytime: (ms: number) => (this.time = ms / 1000),
            onstreamcompleted: () => {
                this.ended = true;
                this.#emit({ kind: 'end-file', reason: 'eof' });
            },
            onerror: (type: string) => {
                this.error = `This stream couldn’t be played (${type}).`;
                this.#emit({ kind: 'end-file', reason: 'error', error: this.error });
            },
            onsubtitlechange: (_duration: number, text: string) => {
                this.#embeddedText = cleanCueText(text ?? '');
                this.#updateSubtitle();
            },
            onevent: () => {},
        });

        await new Promise<void>((resolve, reject) =>
            av.prepareAsync(resolve, (e: unknown) => reject(new Error(`This stream couldn’t be opened (${String(e)}).`)))
        ).catch((e: Error) => {
            if (generation === this.#generation) {
                this.error = e.message;
                this.#emit({ kind: 'end-file', reason: 'error', error: e.message });
            }
            throw e;
        });
        if (generation !== this.#generation) return;

        this.duration = av.getDuration() / 1000 || null;
        this.#readTracks();
        this.#pickStartTracks();
        if (startSeconds > 0) {
            await new Promise<void>((resolve) => av.seekTo(Math.round(startSeconds * 1000), resolve, resolve));
        }
        av.play();
        this.loaded = true;
        this.#emit({ kind: 'file-loaded' });
        this.#startClock();
    }

    /** Polls the position (AVPlay's own time events are coarse) and times addon subtitles. */
    #startClock() {
        clearInterval(this.#clock);
        this.#clock = setInterval(() => {
            if (!this.#open) return;
            try {
                const ms = this.#av.getCurrentTime();
                if (typeof ms === 'number' && ms >= 0) this.time = ms / 1000;
                const state = this.#av.getState();
                this.paused = state === 'PAUSED';
            } catch {
                /* closed meanwhile */
            }
            this.#updateSubtitle();
        }, 200);
    }

    #readTracks() {
        let list: AVTrack[] = [];
        try {
            list = this.#av.getTotalTrackInfo() ?? [];
        } catch {
            list = [];
        }
        const tracks: Track[] = [];
        let firstAudio: number | null = null;
        for (const t of list) {
            const i = info(t);
            if (t.type === 'VIDEO') {
                this.width = Number(i.Width) || null;
                this.height = Number(i.Height) || null;
            } else if (t.type === 'AUDIO') {
                firstAudio ??= t.index;
                tracks.push({
                    id: t.index,
                    type: 'audio',
                    lang: i.language && i.language !== 'und' ? i.language : undefined,
                    codec: i.fourCC,
                    selected: false,
                    'audio-channels': Number(i.channels) || undefined,
                });
            } else if (t.type === 'TEXT') {
                tracks.push({
                    id: t.index,
                    type: 'sub',
                    lang: i.track_lang?.trim() || undefined,
                    codec: i.fourCC?.trim(),
                    selected: false,
                });
            }
        }
        this.tracks = [...tracks, ...this.#externalTracks()];
        // AVPlay starts on the file's first (default) audio track.
        if (firstAudio != null) this.#markAudio(firstAudio);
        try {
            const current = this.#av.getCurrentStreamInfo?.() as AVTrack[] | undefined;
            const audio = current?.find((t) => t.type === 'AUDIO');
            if (audio) this.#markAudio(audio.index);
        } catch {
            /* not reported */
        }
    }

    #externalTracks(): Track[] {
        return this.#externals.map((e) => ({
            id: e.id,
            type: 'sub' as const,
            title: e.title,
            lang: e.lang,
            selected: this.sid === String(e.id),
            external: true,
        }));
    }

    #markAudio(id: number) {
        this.aid = String(id);
        this.tracks = this.tracks.map((t) => (t.type === 'audio' ? { ...t, selected: t.id === id } : t));
    }

    #markSub(id: number | 'no') {
        this.sid = String(id);
        this.tracks = this.tracks.map((t) => (t.type === 'sub' ? { ...t, selected: t.id === id } : t));
    }

    /** Stremio's audio and subtitle languages decide the first tracks. */
    #pickStartTracks() {
        const { audioLanguage, subtitlesLanguage } = this.#settings;
        if (audioLanguage) {
            const want = langKey(audioLanguage);
            const t = this.audioTracks.find((a) => a.lang && langKey(a.lang) === want);
            if (t && String(t.id) !== this.aid) void this.selectAudio(t.id);
        }
        const want = subtitlesLanguage ? langKey(subtitlesLanguage) : null;
        const audioLang = this.audioTracks.find((a) => a.selected)?.lang;
        // No subtitles in the language you're already hearing.
        const sub = want && (!audioLang || langKey(audioLang) !== want)
            ? this.subTracks.find((s) => !s.external && s.lang && langKey(s.lang) === want)
            : undefined;
        void this.selectSubtitle(sub ? sub.id : 'no');
    }

    #updateSubtitle() {
        const ext = this.#externals.find((e) => String(e.id) === this.sid);
        this.subtitleText = ext ? (ext.cues ? cueAt(ext.cues, this.time) : '') : this.sid === 'no' ? '' : this.#embeddedText;
    }

    #close() {
        clearInterval(this.#clock);
        if (!this.#open) return;
        this.#open = false;
        try {
            this.#av.stop();
        } catch {
            /* not playing */
        }
        try {
            this.#av.close();
        } catch {
            /* already closed */
        }
    }

    async stop() {
        this.#generation++;
        this.#close();
        this.loaded = false;
        this.subtitleText = '';
        this.running = false;
        document.removeEventListener('visibilitychange', this.#onVisibility);
    }

    async togglePause() {
        return this.setPaused(!this.paused);
    }

    async setPaused(paused: boolean) {
        if (!this.#open) return;
        try {
            if (paused) this.#av.pause();
            else this.#av.play();
            this.paused = paused;
        } catch {
            /* not ready */
        }
    }

    seek(seconds: number) {
        const target = Math.max(0, this.duration ? Math.min(seconds, this.duration - 1) : seconds);
        this.time = target;
        if (!this.#open) return Promise.resolve();
        return new Promise<void>((resolve) => {
            try {
                this.#av.seekTo(Math.round(target * 1000), () => resolve(), () => resolve());
            } catch {
                resolve();
            }
        });
    }

    seekBy(delta: number) {
        return this.seek(this.time + delta);
    }

    async setVolume() {
        /* the TV's volume, on the remote */
    }

    async setMuted(muted: boolean) {
        this.muted = muted;
        try {
            const tv = (window as any).tizen?.tvaudiocontrol;
            tv?.setMute(muted);
        } catch {
            /* not allowed */
        }
    }

    async setSpeed(speed: number) {
        try {
            this.#av.setSpeed(speed);
            this.speed = speed;
        } catch {
            /* AVPlay only takes some speeds for some streams */
        }
    }

    async selectAudio(id: number) {
        try {
            this.#av.setSelectTrack('AUDIO', id);
            this.#markAudio(id);
        } catch {
            /* couldn't switch */
        }
    }

    async selectSubtitle(id: number | 'no') {
        const ext = typeof id === 'number' ? this.#externals.find((e) => e.id === id) : undefined;
        try {
            if (id === 'no' || ext) {
                // Off, or an addon subtitle (timed here): mute the file's own.
                this.#av.setSilentSubtitle(true);
            } else {
                this.#av.setSelectTrack('TEXT', id);
                this.#av.setSilentSubtitle(false);
            }
        } catch {
            /* no subtitle tracks in the file */
        }
        this.#embeddedText = '';
        this.#markSub(id);
        if (ext && !ext.cues) await this.#fetchCues(ext);
        this.#updateSubtitle();
    }

    async #fetchCues(ext: External) {
        try {
            const res = await fetch(ext.url);
            ext.cues = res.ok ? parseSubtitles(await res.text()) : [];
        } catch {
            ext.cues = [];
        }
    }

    async addSubtitle(url: string, opts: { select: boolean; title: string; lang?: string }) {
        const ext: External = { id: EXTERNAL_BASE + this.#externals.length, url, title: opts.title, lang: opts.lang, cues: null };
        this.#externals.push(ext);
        this.tracks = [...this.tracks.filter((t) => !t.external), ...this.#externalTracks()];
        if (opts.select) await this.selectSubtitle(ext.id);
    }

    async chapters(): Promise<RawChapter[]> {
        return [];
    }
}

export const avplay = new AVPlayBackend();
