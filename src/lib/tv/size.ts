// How big the TV app is drawn: the whole app is zoomed (src/lib/styles/tv.css).
// tv/boot.js applies the saved size before the app starts, so the page doesn't
// jump; this changes it from Settings.
export type TvSize = 'small' | 'medium' | 'large';

export const tvSizes: Record<TvSize, { zoom: number; label: string }> = {
    small: { zoom: 1, label: 'Small (desktop size)' },
    medium: { zoom: 1.35, label: 'Medium' },
    large: { zoom: 1.75, label: 'Large' },
};

const KEY = 'tv.size';

export function getTvSize(): TvSize {
    try {
        const saved = localStorage.getItem(KEY);
        if (saved && saved in tvSizes) return saved as TvSize;
    } catch {
        /* storage blocked */
    }
    return 'medium';
}

export function setTvSize(size: TvSize) {
    try {
        localStorage.setItem(KEY, size);
    } catch {
        /* storage blocked: applies until the app closes */
    }
    document.documentElement.style.setProperty('--tv-zoom', String(tvSizes[size].zoom));
}
