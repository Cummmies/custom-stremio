// What the player screen needs from a video player, whatever plays the video.
//
// Today there is one backend, embedded mpv on the desktop (mpv.svelte.ts).
// Other platforms get their own implementation of this same interface, e.g.
// MPVKit on iOS or Samsung's AVPlay on Tizen TVs, and the player screen, Easy
// Mode, skips and Up Next work unchanged on top of it.
//
// State fields are reactive ($state) in implementations, so screens can read
// them directly (`player.time`, `player.paused`…).
import type { Upscaler } from './prefs.svelte';

export type Track = {
    id: number;
    type: 'video' | 'audio' | 'sub';
    title?: string;
    lang?: string;
    codec?: string;
    selected: boolean;
    /** Added from outside the file (an addon's subtitles). */
    external?: boolean;
    'demux-channel-count'?: number;
    'audio-channels'?: number;
};

export type EndReason = 'eof' | 'stop' | 'quit' | 'error' | 'other';

export type PlayerEvent =
    | { kind: 'file-loaded' }
    /** Playback (re)started after loading or seeking: the first frame is up. */
    | { kind: 'playback-restart' }
    | { kind: 'shutdown' }
    | { kind: 'end-file'; reason: EndReason; error?: string };

/** A chapter marker in the file (the time is in seconds). */
export type RawChapter = { title?: string; time: number };

/** Stremio's synced settings that decide how a video starts. */
export type StartSettings = {
    hardwareDecoding?: boolean;
    audioLanguage?: string | null;
    subtitlesLanguage?: string | null;
};

/**
 * Extras only some players can do. The player screen hides the matching
 * controls when one is missing.
 */
export type PlayerFeatures = {
    /** Upscaling modes (Settings → Playback and the player's settings menu). */
    upscaling: boolean;
    hdrPassthrough: boolean;
    audioPassthrough: boolean;
    /** Seek-bar preview thumbnails. */
    thumbnails: boolean;
    /** Finding where an intro ends by listening for silence (the S key). */
    silenceSkip: boolean;
};

export interface PlayerBackend {
    readonly features: PlayerFeatures;

    // --- state ---
    /** The player is up (it may not have a file yet). */
    readonly running: boolean;
    /** The current file has opened and its length is known. */
    readonly loaded: boolean;
    readonly time: number;
    readonly duration: number | null;
    readonly paused: boolean;
    readonly buffering: boolean;
    /** How full the buffer is while buffering, 0–100, when the player says. */
    readonly bufferingPercent: number | null;
    /** How far ahead is buffered, in seconds of the video (for the seek bar). */
    readonly cacheTime: number | null;
    readonly volume: number;
    readonly muted: boolean;
    readonly speed: number;
    readonly tracks: Track[];
    readonly audioTracks: Track[];
    readonly subTracks: Track[];
    /** Selected audio / subtitle track id as a string, or 'no'. */
    readonly aid: string;
    readonly sid: string;
    /** Video size and picture info for the settings menu (null when unknown). */
    readonly width: number | null;
    readonly height: number | null;
    readonly hdr: boolean;
    /** 'pq' (HDR10) or 'hlg' when the video is HDR. */
    readonly gamma: string | null;
    /** Hardware decoder in use, 'no' for software, null when unknown. */
    readonly hwdec: string | null;
    readonly ended: boolean;
    readonly error: string | null;

    onEvent(fn: (e: PlayerEvent) => void): () => void;

    // --- lifecycle ---
    start(settings: StartSettings): Promise<void>;
    load(url: string, startSeconds?: number): Promise<void>;
    stop(): Promise<void>;

    // --- controls ---
    togglePause(): Promise<void>;
    setPaused(paused: boolean): Promise<void>;
    seek(seconds: number): Promise<void>;
    seekBy(delta: number): Promise<void>;
    setVolume(v: number): Promise<void>;
    setMuted(muted: boolean): Promise<void>;
    setSpeed(speed: number): Promise<void>;
    selectAudio(id: number): Promise<void>;
    /** A track id, or 'no' for subtitles off. */
    selectSubtitle(id: number | 'no'): Promise<void>;
    addSubtitle(url: string, opts: { select: boolean; title: string; lang?: string }): Promise<void>;

    // --- about the file ---
    chapters(): Promise<RawChapter[]>;
    /** Seconds buffered ahead of the playhead. */
    bufferedAhead(): Promise<number>;

    // --- optional extras (see `features`) ---
    setUpscaler?(kind: Upscaler): Promise<void>;
    setHdrPassthrough?(on: boolean): Promise<void>;
    setAudioPassthrough?(on: boolean): Promise<void>;
}
