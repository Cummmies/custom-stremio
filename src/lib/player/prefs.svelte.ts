// Player preferences that only matter to this app (not synced to Stremio).

export type Upscaler = 'off' | 'high-quality' | 'rtx';

type Prefs = {
    upscaler: Upscaler;
    /** Send HDR to an HDR display instead of tone-mapping it down. */
    hdrPassthrough: boolean;
    /** Bitstream Dolby/DTS (incl. Atmos) to a receiver or soundbar. */
    audioPassthrough: boolean;
    volume: number;
};

const KEY = 'playerPrefs';
const defaults: Prefs = { upscaler: 'off', hdrPassthrough: true, audioPassthrough: false, volume: 100 };

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
