// How subtitles look, chosen in Settings > Subtitle Style (the style choices of
// Apple's Subtitles & Captioning settings). One style for every device: mpv
// draws it on the PC and iPhone (`mpvSubtitleOptions`), the player page on the
// TV, whose player leaves subtitles to the app (`subtitleCss`), and Settings'
// preview the same way. Styled subtitles (ASS, common in anime) keep their own
// look; this applies to plain ones (SRT, WebVTT).

export type SubSize = 'small' | 'medium' | 'large' | 'xlarge';
export type SubFont = 'default' | 'serif' | 'mono';
export type SubColor = 'white' | 'yellow' | 'cyan' | 'green';
export type SubEdge = 'shadow' | 'outline' | 'none';

export type SubStyle = {
    size: SubSize;
    font: SubFont;
    color: SubColor;
    edge: SubEdge;
    /** A translucent box behind each line. */
    background: boolean;
    /** How far up from the bottom of the picture, in % of its height. */
    position: number;
};

/** Clean and minimal: white, medium weight, a soft shadow, nothing around it. */
export const DEFAULT_SUB_STYLE: SubStyle = { size: 'medium', font: 'default', color: 'white', edge: 'shadow', background: false, position: 5 };

export type SubPreset = 'default' | 'large' | 'classic' | 'outline';
export const SUB_PRESETS: Record<SubPreset, { label: string; style: SubStyle }> = {
    default: { label: 'Default', style: DEFAULT_SUB_STYLE },
    large: { label: 'Large Text', style: { ...DEFAULT_SUB_STYLE, size: 'xlarge' } },
    classic: { label: 'Classic', style: { ...DEFAULT_SUB_STYLE, font: 'mono', edge: 'none', background: true } },
    outline: { label: 'Outline Text', style: { ...DEFAULT_SUB_STYLE, edge: 'outline' } },
};

/** The preset a style is, or null for one of your own ("Custom"). */
export function presetOf(s: SubStyle): SubPreset | null {
    const key = JSON.stringify(normalizeSubStyle(s));
    return (Object.keys(SUB_PRESETS) as SubPreset[]).find((p) => JSON.stringify(SUB_PRESETS[p].style) === key) ?? null;
}

export const SUB_SIZES: Record<SubSize, string> = { small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'Extra Large' };
export const SUB_FONTS: Record<SubFont, string> = { default: 'Default', serif: 'Serif', mono: 'Monospaced' };
export const SUB_COLORS: Record<SubColor, string> = { white: 'White', yellow: 'Yellow', cyan: 'Cyan', green: 'Green' };
export const SUB_EDGES: Record<SubEdge, string> = { shadow: 'Drop Shadow', outline: 'Outline', none: 'None' };
export const SUB_POSITION_MAX = 30;

/** Text height in pixels of a 720-pixel-tall picture (mpv's sub-font-size scale). */
const SIZE_720: Record<SubSize, number> = { small: 34, medium: 40, large: 48, xlarge: 58 };
const HEX: Record<SubColor, string> = { white: '#FFFFFF', yellow: '#FFE14D', cyan: '#5CE1FF', green: '#7CF29A' };

/** A stored style with anything missing or unknown put back to the default. */
export function normalizeSubStyle(s: Partial<SubStyle> | null | undefined): SubStyle {
    const d = DEFAULT_SUB_STYLE;
    const pos = Number(s?.position);
    return {
        size: s?.size && s.size in SIZE_720 ? s.size : d.size,
        font: s?.font && s.font in SUB_FONTS ? s.font : d.font,
        color: s?.color && s.color in HEX ? s.color : d.color,
        edge: s?.edge && s.edge in SUB_EDGES ? s.edge : d.edge,
        background: typeof s?.background === 'boolean' ? s.background : d.background,
        position: Number.isFinite(pos) ? Math.max(0, Math.min(SUB_POSITION_MAX, Math.round(pos))) : d.position,
    };
}

// --- mpv (PC, iPhone) -------------------------------------------------------------

/** Font families libass finds: Windows' (DirectWrite) or iOS's (Core Text). */
function mpvFont(font: SubFont, ios: boolean): string {
    if (ios) return font === 'serif' ? 'Georgia' : font === 'mono' ? 'Menlo' : 'Helvetica Neue';
    return font === 'serif' ? 'Georgia' : font === 'mono' ? 'Consolas' : 'Segoe UI Semibold';
}

/** mpv's colours are #AARRGGBB. */
const argb = (alpha: number, rgb: string) => `#${Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase()}${rgb.slice(1)}`;

/** The mpv options for a style (phones read a little smaller, as they're held close). */
export function mpvSubtitleOptions(style: SubStyle, ios = false): Record<string, string> {
    const s = normalizeSubStyle(style);
    const size = Math.round(SIZE_720[s.size] * (ios ? 0.92 : 1));
    const o: Record<string, string> = {
        'sub-font': mpvFont(s.font, ios),
        'sub-font-size': String(size),
        'sub-bold': 'no',
        'sub-color': HEX[s.color],
        // From the bottom of the picture (720-pixel scale), never right on the edge.
        'sub-margin-y': String(Math.max(12, Math.round((s.position / 100) * 720))),
        'sub-blur': '0',
    };
    if (s.background) {
        Object.assign(o, {
            'sub-border-style': 'background-box',
            'sub-back-color': argb(0.62, '#000000'),
            'sub-border-size': '6', // the box's padding
            'sub-shadow-offset': '0',
        });
    } else {
        Object.assign(o, { 'sub-border-style': 'outline-and-shadow', 'sub-back-color': '#00000000' });
        if (s.edge === 'shadow') {
            // Soft: a blurred dark halo and a shadow under it, no hard outline,
            // readable over bright scenes too.
            Object.assign(o, {
                'sub-border-size': '1.6',
                'sub-border-color': argb(0.7, '#000000'),
                'sub-shadow-offset': '1.2',
                'sub-shadow-color': argb(0.75, '#000000'),
                'sub-blur': '1.2',
            });
        } else if (s.edge === 'outline') {
            Object.assign(o, { 'sub-border-size': '2.6', 'sub-border-color': '#FF000000', 'sub-shadow-offset': '0' });
        } else {
            Object.assign(o, { 'sub-border-size': '0', 'sub-shadow-offset': '0' });
        }
    }
    return o;
}

// --- CSS (TV, Settings' preview) ------------------------------------------------

const CSS_FONT: Record<SubFont, string> = {
    default: 'var(--font)',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'Consolas, Menlo, "Courier New", monospace',
};

/** The text's style for a picture `frameHeight` pixels tall. */
export function subtitleCss(style: SubStyle, frameHeight: number): string {
    const s = normalizeSubStyle(style);
    const px = (n: number) => `${((n / 720) * frameHeight).toFixed(2)}px`;
    const parts = [
        `font-family: ${CSS_FONT[s.font]}`,
        `font-size: ${px(SIZE_720[s.size])}`,
        `font-weight: ${s.font === 'default' ? 600 : 400}`,
        `color: ${HEX[s.color]}`,
    ];
    if (s.background) {
        parts.push('background: rgb(0 0 0 / 0.62)', `padding: ${px(3)} ${px(8)}`, `border-radius: ${px(4)}`, 'text-shadow: none');
    } else if (s.edge === 'shadow') {
        parts.push(`text-shadow: 0 0 ${px(2.5)} rgb(0 0 0 / 0.75), 0 0 ${px(1)} rgb(0 0 0 / 0.6), 0 ${px(1.2)} ${px(3)} rgb(0 0 0 / 0.75)`);
    } else if (s.edge === 'outline') {
        const w = px(2);
        parts.push(`text-shadow: ${w} 0 0 #000, -${w} 0 0 #000, 0 ${w} 0 #000, 0 -${w} 0 #000, ${w} ${w} 0 #000, -${w} -${w} 0 #000, ${w} -${w} 0 #000, -${w} ${w} 0 #000`);
    } else {
        parts.push('text-shadow: none');
    }
    return parts.join('; ');
}

/** How far up the text sits, as a CSS length for that picture. */
export function subtitleBottom(style: SubStyle): string {
    return `${Math.max(2, normalizeSubStyle(style).position)}%`;
}
