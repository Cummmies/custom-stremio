// Player preferences that only matter to this app (not synced to Stremio).

export type Upscaler = 'off' | 'high-quality' | 'rtx';

type Prefs = {
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

    #save(patch: Partial<Prefs>) {
        this.#p = { ...this.#p, ...patch };
        try {
            localStorage.setItem(KEY, JSON.stringify(this.#p));
        } catch {}
    }
}

export const playerPrefs = new PlayerPrefs();

export const upscalerLabels: Record<Upscaler, string> = {
    off: 'Off',
    'high-quality': 'High-Quality Scaling',
    rtx: 'NVIDIA RTX Video Super Resolution',
};
