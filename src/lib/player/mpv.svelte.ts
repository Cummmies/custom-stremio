// The mpv player backend: a thin, reactive client for embedded mpv. On the
// desktop that's libmpv in Rust (src-tauri/src/player.rs); on iOS it's MPVKit in
// a Swift plugin (src-tauri/plugins/mpv). Both take the same commands and send
// the same events, so only the transport below differs.
//
// Screens use it through `player` (player.ts) and the PlayerBackend interface;
// only mpv-specific extras (silence skip) use `mpv` and its raw get/set/command.
import { addPluginListener, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { inTauri, isIOS } from '$lib/platform';
import { playerPrefs, type Upscaler } from './prefs.svelte';
import { langKey } from './lang';
import type { PlayerBackend, PlayerEvent, PlayerFeatures, RawChapter, StartSettings, Track } from './backend';

export type { Track } from './backend';

/** mpv's sharper, heavier scalers (what its built-in "high-quality" profile uses). */
const HIGH_QUALITY: Record<string, string> = {
    scale: 'ewa_lanczossharp',
    cscale: 'ewa_lanczossharp',
    dscale: 'mitchell',
    deband: 'yes',
};

/** Same list the Rust side observes (src-tauri/src/player.rs, OBSERVED). */
const OBSERVED = [
    'time-pos', 'duration', 'pause', 'paused-for-cache', 'cache-buffering-state', 'demuxer-cache-time',
    'volume', 'mute', 'track-list', 'aid', 'sid', 'speed', 'video-params/gamma', 'video-params/w',
    'video-params/h', 'hwdec-current',
];

export { inTauri } from '$lib/platform';

type Prop = { name: string; value: string | null };

/** How commands reach mpv and how its events come back. */
type Transport = {
    start(options: Record<string, string>): Promise<void>;
    command(args: string[]): Promise<void>;
    set(name: string, value: string): Promise<void>;
    get(name: string): Promise<string | null>;
    stop(): Promise<void>;
    listen(onProp: (p: Prop) => void, onEvent: (e: PlayerEvent) => void): Promise<UnlistenFn[]>;
};

const desktop: Transport = {
    start: (options) => invoke('mpv_start', { options }),
    command: (args) => invoke('mpv_command', { args }),
    set: (name, value) => invoke('mpv_set', { name, value }),
    get: (name) => invoke<string | null>('mpv_get', { name }),
    stop: () => invoke('mpv_stop'),
    listen: async (onProp, onEvent) => [
        await listen<Prop>('mpv://prop', (e) => onProp(e.payload)),
        await listen<PlayerEvent>('mpv://event', (e) => onEvent(e.payload)),
    ],
};

const ios: Transport = {
    start: (options) => invoke('plugin:mpv|start', { options }),
    command: (args) => invoke('plugin:mpv|command', { args }),
    set: (name, value) => invoke('plugin:mpv|set', { name, value }),
    get: async (name) => (await invoke<{ value?: string | null }>('plugin:mpv|get', { name }))?.value ?? null,
    stop: () => invoke('plugin:mpv|stop'),
    listen: async (onProp, onEvent) => {
        const listeners = [await addPluginListener<Prop>('mpv', 'prop', onProp), await addPluginListener<PlayerEvent>('mpv', 'event', onEvent)];
        return listeners.map((l) => () => void l.unregister());
    },
};

const transport = isIOS ? ios : desktop;

const num = (v: string | null) => (v == null || v === '' ? null : Number(v));
const flag = (v: string | null) => v === 'yes';

class Mpv implements PlayerBackend {
    // iOS: no d3d11 upscalers or HDMI passthrough.
    readonly features: PlayerFeatures = {
        upscaling: !isIOS,
        hdrPassthrough: !isIOS,
        audioPassthrough: !isIOS,
        thumbnails: true,
        silenceSkip: true,
    };

    running = $state(false);
    loaded = $state(false);
    time = $state(0);
    duration = $state<number | null>(null);
    paused = $state(false);
    buffering = $state(true);
    bufferingPercent = $state<number | null>(null);
    cacheTime = $state<number | null>(null);
    volume = $state(100);
    muted = $state(false);
    speed = $state(1);
    tracks = $state<Track[]>([]);
    aid = $state<string>('no');
    sid = $state<string>('no');
    gamma = $state<string | null>(null);
    width = $state<number | null>(null);
    height = $state<number | null>(null);
    hwdec = $state<string | null>(null);
    ended = $state(false);
    error = $state<string | null>(null);

    hdr = $derived(this.gamma === 'pq' || this.gamma === 'hlg');
    audioTracks = $derived(this.tracks.filter((t) => t.type === 'audio'));
    subTracks = $derived(this.tracks.filter((t) => t.type === 'sub'));

    #unlisten: UnlistenFn[] = [];
    #scalerDefaults: Record<string, string> | null = null;
    #listeners = new Set<(e: PlayerEvent) => void>();

    onEvent(fn: (e: PlayerEvent) => void) {
        this.#listeners.add(fn);
        return () => this.#listeners.delete(fn);
    }

    #apply(name: string, v: string | null) {
        switch (name) {
            case 'time-pos': this.time = num(v) ?? this.time; break;
            case 'duration': this.duration = num(v); break;
            case 'pause': this.paused = flag(v); break;
            case 'paused-for-cache': this.buffering = flag(v); break;
            case 'cache-buffering-state': this.bufferingPercent = num(v); break;
            case 'demuxer-cache-time': this.cacheTime = num(v); break;
            case 'volume': this.volume = num(v) ?? this.volume; break;
            case 'mute': this.muted = flag(v); break;
            case 'speed': this.speed = num(v) ?? 1; break;
            case 'aid': this.aid = v ?? 'no'; break;
            case 'sid': this.sid = v ?? 'no'; break;
            case 'video-params/gamma': this.gamma = v; break;
            case 'video-params/w': this.width = num(v); break;
            case 'video-params/h': this.height = num(v); break;
            case 'hwdec-current': this.hwdec = v; break;
            case 'eof-reached': if (flag(v)) this.ended = true; break;
            case 'track-list':
                try {
                    this.tracks = v ? JSON.parse(v) : [];
                } catch {
                    this.tracks = [];
                }
                break;
        }
    }

    async start(settings: StartSettings) {
        const options = buildOptions(settings);
        this.#rtx = options.hwdec === 'd3d11va';
        if (!inTauri) throw new Error('Playback needs the app.');
        if (!this.#unlisten.length) {
            this.#unlisten.push(
                ...(await transport.listen(
                    (p) => this.#apply(p.name, p.value ?? null),
                    (ev) => {
                    if (ev.kind === 'file-loaded') {
                        this.loaded = true;
                        this.ended = false;
                        this.error = null;
                    } else if (ev.kind === 'playback-restart') {
                        this.buffering = false;
                    } else if (ev.kind === 'end-file' && ev.reason === 'error') {
                        this.error = ev.error ?? 'This stream couldn’t be played.';
                    } else if (ev.kind === 'shutdown') {
                        this.running = false;
                    }
                    this.#listeners.forEach((fn) => fn(ev));
                    }
                ))
            );
        }
        await transport.start(options);
        this.running = true;
        await this.sync();
    }

    /**
     * Reads every watched property once. mpv only reports changes, so a page that
     * (re)connects to an mpv that's already playing would otherwise show blanks.
     */
    async sync() {
        await Promise.all(
            OBSERVED.map(async (name) => {
                const v = await this.get(name).catch(() => null);
                if (v != null) this.#apply(name, v);
            })
        );
        if (this.duration) this.loaded = true;
    }

    async load(url: string, startSeconds = 0) {
        this.loaded = false;
        this.buffering = true;
        this.ended = false;
        this.error = null;
        this.time = startSeconds;
        this.duration = null;
        // Set `start` as a property so it works across mpv versions' loadfile syntax.
        await this.set('start', startSeconds > 0 ? String(startSeconds) : 'none');
        // mpv keeps `pause` from file to file: a new file plays (the one before may
        // have been paused on the way out, an addon's error clip or a source that
        // didn't work), as AVPlay's does.
        await this.set('pause', false);
        await this.command('loadfile', url, 'replace');
    }

    command(...args: string[]) {
        return transport.command(args);
    }

    set(name: string, value: string | number | boolean) {
        const v = typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
        return transport.set(name, v);
    }

    get(name: string) {
        return transport.get(name);
    }

    togglePause() {
        return this.set('pause', !this.paused);
    }

    setPaused(paused: boolean) {
        return this.set('pause', paused);
    }

    seek(seconds: number) {
        this.time = Math.max(0, seconds);
        return this.command('seek', String(Math.max(0, seconds)), 'absolute');
    }

    seekBy(delta: number) {
        return this.seek(this.time + delta);
    }

    setVolume(v: number) {
        const clamped = Math.max(0, Math.min(130, Math.round(v)));
        this.volume = clamped;
        playerPrefs.volume = clamped;
        return this.set('volume', clamped);
    }

    setMuted(muted: boolean) {
        return this.set('mute', muted);
    }

    setSpeed(speed: number) {
        return this.set('speed', speed);
    }

    selectAudio(id: number) {
        return this.set('aid', id);
    }

    selectSubtitle(id: number | 'no') {
        return this.set('sid', id);
    }

    addSubtitle(url: string, opts: { select: boolean; title: string; lang?: string }) {
        const args = ['sub-add', url, opts.select ? 'select' : 'auto', opts.title];
        if (opts.lang) args.push(opts.lang);
        return this.command(...args);
    }

    async chapters(): Promise<RawChapter[]> {
        try {
            const json = await this.get('chapter-list');
            const list = json ? JSON.parse(json) : [];
            return Array.isArray(list) ? list : [];
        } catch {
            return [];
        }
    }

    async fileNames() {
        const names = await Promise.all(['filename', 'media-title'].map((n) => this.get(n).catch(() => null)));
        return names.filter(Boolean).join('\n');
    }

    async nudgeSubtitles(change: { delay?: number; scale?: number }) {
        if (change.delay) await this.command('add', 'sub-delay', String(change.delay)).catch(() => {});
        if (change.scale) await this.command('add', 'sub-scale', String(change.scale)).catch(() => {});
        const delay = Number(await this.get('sub-delay').catch(() => 0)) || 0;
        const scale = Number(await this.get('sub-scale').catch(() => 1)) || 1;
        return { delay, scale };
    }

    async setHdrPassthrough(on: boolean) {
        await this.set('target-colorspace-hint', on);
    }

    async setAudioPassthrough(on: boolean) {
        await this.set('audio-spdif', on ? SPDIF : '');
    }

    /** Switches upscaler; RTX needs native d3d11 decoding, so switching to or from it changes the decoder. */
    async setUpscaler(kind: Upscaler) {
        if (!this.features.upscaling) return;
        const rtx = kind === 'rtx';
        if (rtx !== this.#rtx) {
            this.#rtx = rtx;
            await this.set('hwdec', rtx ? 'd3d11va' : 'auto-safe').catch(() => {});
        }
        await this.applyUpscaler(kind);
    }
    #rtx = false;

    /** Applies (or clears) the chosen upscaler for the current video. */
    async applyUpscaler(kind: Upscaler) {
        const displayHeight = Math.round(screen.height * devicePixelRatio);
        const factor = this.height ? displayHeight / this.height : 1;
        // Only worth doing when the video is meaningfully smaller than the screen.
        const needed = factor > 1.1;
        try {
            await this.set('vf', kind === 'rtx' && needed ? `d3d11vpp=scaling-mode=nvidia:scale=${Math.min(4, factor).toFixed(2)}` : '');

            // Remember mpv's own defaults once so "Off" can put them back.
            const keys = Object.keys(HIGH_QUALITY);
            if (!this.#scalerDefaults) {
                const values = await Promise.all(keys.map((k) => this.get(k)));
                this.#scalerDefaults = Object.fromEntries(keys.map((k, i) => [k, values[i] ?? '']));
            }
            const target = kind === 'high-quality' ? HIGH_QUALITY : this.#scalerDefaults;
            for (const k of keys) if (target[k]) await this.set(k, target[k]);
        } catch (e) {
            console.warn('Upscaler not applied:', e);
        }
    }

    async stop(): Promise<void> {
        this.loaded = false;
        await transport.stop().catch(() => {});
    }

    reset() {
        this.#unlisten.forEach((fn) => fn());
        this.#unlisten = [];
    }
}

export const mpv = new Mpv();

const SPDIF = 'ac3,eac3,dts,dts-hd,truehd';

/** mpv options from Stremio's synced settings plus this app's player prefs. */
function buildOptions(settings: StartSettings): Record<string, string> {
    const o: Record<string, string> = {
        // libplacebo renderer: better HDR handling and scaling than the legacy one.
        vo: 'gpu-next',
        'gpu-api': 'd3d11',
        // RTX VSR runs in the d3d11 video processor, which needs native (non-copy) d3d11 decoding.
        hwdec: settings.hardwareDecoding === false ? 'no' : playerPrefs.upscaler === 'rtx' ? 'd3d11va' : 'auto-safe',
        'target-colorspace-hint': playerPrefs.hdrPassthrough ? 'yes' : 'no',
        'tone-mapping': 'auto',
        cache: 'yes',
        'demuxer-max-bytes': '300MiB',
        'demuxer-max-back-bytes': '100MiB',
        'demuxer-readahead-secs': '60',
        'network-timeout': '30',
        volume: String(playerPrefs.volume),
        'volume-max': '130',
        'sub-auto': 'fuzzy',
        'sub-font-size': '44',
        'sub-border-size': '2.5',
        'sub-shadow-offset': '1',
        'sub-shadow-color': '#80000000',
        'sub-ass-override': 'scale',
    };
    // Files tag tracks "en" or "eng" (or "fre"/"fra"): list every spelling.
    if (settings.audioLanguage) o.alang = spellings(settings.audioLanguage);
    if (settings.subtitlesLanguage) o.slang = spellings(settings.subtitlesLanguage);
    // Don't turn on subtitles in the language you're already hearing (dubs). The
    // forced ones (signs and songs) are turned on by the player page instead, which
    // also knows them by name ("Signs & Songs"), as many anime releases don't flag them.
    o['subs-with-matching-audio'] = 'no';
    if (playerPrefs.audioPassthrough && !isIOS) o['audio-spdif'] = SPDIF;
    if (isIOS) Object.assign(o, iosOptions(settings));
    return o;
}

/**
 * iOS: Metal through MoltenVK (what MPVKit supports), VideoToolbox decoding, a
 * smaller cache for a phone's memory, and no desktop-only extras.
 */
function iosOptions(settings: StartSettings): Record<string, string> {
    const o: Record<string, string> = {
        'gpu-api': 'vulkan',
        'gpu-context': 'moltenvk',
        hwdec: settings.hardwareDecoding === false ? 'no' : 'videotoolbox',
        // HDR video in HDR: the iPhone screen's extended range (EDR), switched
        // on by mpv for HDR files only; SDR video is unaffected.
        'target-colorspace-hint': 'yes',
        'demuxer-max-bytes': '150MiB',
        'demuxer-max-back-bytes': '50MiB',
        // Phone screens are small and close: a slightly smaller subtitle size reads better.
        'sub-font-size': '40',
        // mpv's iOS audio otherwise mixes with other apps' (AVAudioSession's
        // mixWithOthers), and iOS leaves a mixing app out of Now Playing
        // (Control Center, the Lock Screen; MpvPlugin.swift). Like any video
        // app, it takes the audio: music playing elsewhere stops.
        'audio-exclusive': 'yes',
    };
    return o;
}

/** "eng" → "eng,en": the setting's code plus its 2-letter form. */
function spellings(code: string) {
    const short = langKey(code);
    return short && short !== code.toLowerCase() ? `${code},${short}` : code;
}
