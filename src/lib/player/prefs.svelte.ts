// Player preferences that only matter to this app (not synced to Stremio).

export type Upscaler = 'off' | 'high-quality' | 'rtx';

export type Prefs = {
    upscaler: Upscaler;
    /** Send HDR to an HDR display instead of tone-mapping it down. */
    hdrPassthrough: boolean;
    /** Bitstream Dolby/DTS (incl. Atmos) to a receiver or soundbar. */
    audioPassthrough: boolean;
    volume: number;
    /** Easy Mode: pick and play the best source automatically. */
    easyMode: boolean;
    /** Preferred audio language (ISO 639-2), or null for "no preference". */
    easyLanguage: string | null;
    /** Highest resolution Easy Mode will pick: 2160, 1080 or 720. */
    maxResolution: number;
    /** Allow plain torrents as a last resort when no debrid source works. */
    allowTorrents: boolean;
    /** Jump past intros and recaps without pressing anything. */
    autoSkip: boolean;
    /** Pause when the window is minimized. */
    pauseOnMinimize: boolean;
    /** Pause when you switch to another window. */
    pauseOnLostFocus: boolean;
    /** After two episodes that started by themselves with nobody touching anything, ask. */
    askStillWatching: boolean;
    /** Show what's playing on your Discord profile. */
    discordPresence: boolean;
};

const KEY = 'playerPrefs';
const defaults: Prefs = {
    upscaler: 'off',
    hdrPassthrough: true,
    audioPassthrough: false,
    volume: 100,
    easyMode: false,
    easyLanguage: 'eng',
    maxResolution: 1080,
    allowTorrents: true,
    autoSkip: false,
    pauseOnMinimize: true,
    pauseOnLostFocus: false,
    askStillWatching: true,
    discordPresence: false,
};

function load(): Prefs {
    try {
        return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
    } catch {
        return { ...defaults };
    }
}

class PlayerPrefs {
    #p = $state<Prefs>(load());

    get upscaler() {
        return this.#p.upscaler;
    }
    set upscaler(v: Upscaler) {
        this.#save({ upscaler: v });
    }
    get hdrPassthrough() {
        return this.#p.hdrPassthrough;
    }
    set hdrPassthrough(v: boolean) {
        this.#save({ hdrPassthrough: v });
    }
    get audioPassthrough() {
        return this.#p.audioPassthrough;
    }
    set audioPassthrough(v: boolean) {
        this.#save({ audioPassthrough: v });
    }
    get volume() {
        return this.#p.volume;
    }
    set volume(v: number) {
        this.#save({ volume: v });
    }
    get easyMode() {
        return this.#p.easyMode;
    }
    set easyMode(v: boolean) {
        this.#save({ easyMode: v });
    }
    get easyLanguage() {
        return this.#p.easyLanguage;
    }
    set easyLanguage(v: string | null) {
        this.#save({ easyLanguage: v });
    }
    get maxResolution() {
        return this.#p.maxResolution;
    }
    set maxResolution(v: number) {
        this.#save({ maxResolution: v });
    }
    get allowTorrents() {
        return this.#p.allowTorrents;
    }
    set allowTorrents(v: boolean) {
        this.#save({ allowTorrents: v });
    }
    get autoSkip() {
        return this.#p.autoSkip;
    }
    set autoSkip(v: boolean) {
        this.#save({ autoSkip: v });
    }
    get pauseOnMinimize() {
        return this.#p.pauseOnMinimize;
    }
    set pauseOnMinimize(v: boolean) {
        this.#save({ pauseOnMinimize: v });
    }
    get pauseOnLostFocus() {
        return this.#p.pauseOnLostFocus;
    }
    set pauseOnLostFocus(v: boolean) {
        this.#save({ pauseOnLostFocus: v });
    }
    get askStillWatching() {
        return this.#p.askStillWatching;
    }
    set askStillWatching(v: boolean) {
        this.#save({ askStillWatching: v });
    }
    get discordPresence() {
        return this.#p.discordPresence;
    }
    set discordPresence(v: boolean) {
        this.#save({ discordPresence: v });
    }

    /** The account-level preferences (see SYNCED_PREFS). Reactive. */
    synced(): SyncedPrefs {
        return Object.fromEntries(SYNCED_PREFS.map((k) => [k, this.#p[k]])) as SyncedPrefs;
    }

    /** Takes account-level preferences from another device. */
    applySynced(p: Partial<SyncedPrefs>) {
        const patch: Partial<Prefs> = {};
        for (const k of SYNCED_PREFS) if (k in p) (patch as any)[k] = p[k];
        this.#save(patch);
    }

    /** This device's own preferences (see DEVICE_PREFS). Reactive. */
    device(): DevicePrefs {
        return Object.fromEntries(DEVICE_PREFS.map((k) => [k, this.#p[k]])) as DevicePrefs;
    }

    /** Takes device preferences saved by another device of the same kind. */
    applyDevice(p: Partial<DevicePrefs>) {
        const patch: Partial<Prefs> = {};
        for (const k of DEVICE_PREFS) if (k in p) (patch as any)[k] = p[k];
        this.#save(patch);
    }

    #save(patch: Partial<Prefs>) {
        this.#p = { ...this.#p, ...patch };
        try {
            localStorage.setItem(KEY, JSON.stringify(this.#p));
        } catch {}
    }
}

export const playerPrefs = new PlayerPrefs();

/**
 * Everything here follows your account (cloudSync.svelte.ts). These are the
 * same on every device; DEVICE_PREFS are kept per kind of device (desktop,
 * iPhone…) and only reach devices of that kind, since they're about its
 * screen, speakers and window.
 */
export const SYNCED_PREFS = ['easyMode', 'easyLanguage', 'maxResolution', 'allowTorrents', 'autoSkip', 'askStillWatching', 'discordPresence'] as const;
export type SyncedPrefs = Pick<Prefs, (typeof SYNCED_PREFS)[number]>;
export const DEVICE_PREFS = ['upscaler', 'hdrPassthrough', 'audioPassthrough', 'volume', 'pauseOnMinimize', 'pauseOnLostFocus'] as const;
export type DevicePrefs = Pick<Prefs, (typeof DEVICE_PREFS)[number]>;

export const upscalerLabels: Record<Upscaler, string> = {
    off: 'Off',
    'high-quality': 'High-Quality Scaling',
    rtx: 'NVIDIA RTX Video Super Resolution',
};
