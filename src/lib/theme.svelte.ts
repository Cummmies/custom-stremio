// Settings → Appearance: the accent color, the background and the poster size,
// kept with the account (the player prefs' synced part, cloudSync), so every
// device looks the same. Applied to the page's root: the background and poster
// size as attributes tokens.css styles, the accent as its four tokens.
//
// Any color can be the accent, so it's made to work: dark enough that white
// text on it reads (4.5:1), and a lighter one for text in that color on the
// background (4.5:1 against it).
import { playerPrefs } from '$lib/player/prefs.svelte';

/** Presets, the first being the app's own violet (no accent saved). */
export const ACCENTS: { name: string; color: string }[] = [
    { name: 'Violet', color: '#6d4af0' },
    { name: 'Blue', color: '#2d7cf0' },
    { name: 'Teal', color: '#14a3a3' },
    { name: 'Green', color: '#2fa865' },
    { name: 'Orange', color: '#e8772e' },
    { name: 'Red', color: '#e5484d' },
    { name: 'Pink', color: '#d6409f' },
    { name: 'Graphite', color: '#6b6b78' },
];
export const DEFAULT_ACCENT = ACCENTS[0].color;

type Rgb = [number, number, number];

function parse(hex: string): Rgb | null {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const hex = (c: Rgb) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

function luminance([r, g, b]: Rgb) {
    const ch = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
function contrast(a: Rgb, b: Rgb) {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
}
/** Toward white (amount > 0) or black (< 0), 0..1. */
function mix(c: Rgb, amount: number): Rgb {
    const to = amount > 0 ? 255 : 0;
    const t = Math.abs(amount);
    return c.map((v) => v + (to - v) * t) as Rgb;
}

const WHITE: Rgb = [255, 255, 255];
const BACKGROUNDS: Record<'dark' | 'black', Rgb> = { dark: [13, 13, 18], black: [0, 0, 0] };

/** The accent's tokens for a color, on a background. */
export function accentTokens(color: string, background: 'dark' | 'black') {
    let base = parse(color) ?? parse(DEFAULT_ACCENT)!;
    // White text on it must read: darken until it does.
    for (let i = 0; i < 20 && contrast(base, WHITE) < 4.5; i++) base = mix(base, -0.06);
    let text = base;
    const bg = BACKGROUNDS[background];
    for (let i = 0; i < 30 && contrast(text, bg) < 4.5; i++) text = mix(text, 0.08);
    // A plain grey has no hue to brighten: lift it for text anyway.
    return { accent: hex(base), hover: hex(mix(base, 0.1)), text: hex(mix(text, 0.15)), ring: `${hex(base)}59` };
}

let started = false;

/** Keeps the page's look in step with the settings (from app start). */
export function startTheme() {
    if (started || typeof document === 'undefined') return;
    started = true;
    $effect.root(() => {
        $effect(() => {
            const root = document.documentElement;
            const background = playerPrefs.background === 'black' ? 'black' : 'dark';
            if (background === 'black') root.dataset.background = 'black';
            else delete root.dataset.background;

            const size = playerPrefs.posterSize;
            if (size === 'small' || size === 'large') root.dataset.posterSize = size;
            else delete root.dataset.posterSize;

            const color = playerPrefs.accent;
            const props = ['--accent', '--accent-hover', '--accent-text', '--accent-ring'];
            if (!color || color.toLowerCase() === DEFAULT_ACCENT) {
                for (const p of props) root.style.removeProperty(p);
                return;
            }
            const t = accentTokens(color, background);
            root.style.setProperty('--accent', t.accent);
            root.style.setProperty('--accent-hover', t.hover);
            root.style.setProperty('--accent-text', t.text);
            root.style.setProperty('--accent-ring', t.ring);
        });
    });
}
