// Whether this screen shows HDR right now. Windows: only while HDR is turned on
// in Windows' display settings (an HDR video on an SDR screen is tone-mapped, and
// looks flatter than a plain release). iPhone: its screen. TV: what the TV says
// (Samsung's webapis.avinfo), assumed yes until it answers.
import { isDesktop, isTV } from '$lib/platform';
import { playerPrefs } from './prefs.svelte';
import { loadWebapis } from './avplay.svelte';

class DisplayHdr {
    supported = $state(true);

    constructor() {
        if (typeof window === 'undefined') return;
        if (isTV) {
            this.#askTv();
            return;
        }
        if (typeof matchMedia !== 'function') return;
        const query = matchMedia('(dynamic-range: high)');
        this.supported = query.matches;
        query.addEventListener?.('change', (e) => (this.supported = e.matches));
    }

    async #askTv() {
        await loadWebapis().catch(() => {});
        const avinfo = (window as any).webapis?.avinfo;
        try {
            if (avinfo?.isHdrTvSupport) this.supported = !!avinfo.isHdrTvSupport();
        } catch {}
    }
}

export const displayHdr = new DisplayHdr();

/**
 * HDR sources are hidden (and Easy Mode passes them over) on this screen: it isn't
 * showing HDR, or (Windows) HDR passthrough is off, so HDR would be tone-mapped anyway.
 */
export function hidesHdr(): boolean {
    return playerPrefs.hideHdrOnSdr && (!displayHdr.supported || (isDesktop && !playerPrefs.hdrPassthrough));
}
