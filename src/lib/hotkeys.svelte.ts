// The player's keyboard shortcuts, remappable in Settings (as in stremio-native):
// each action has one key, with Ctrl/Alt/Shift/Meta as needed. Two actions
// can't share a key, and keys the system keeps for itself (Alt+F4…) can't be
// used. One action works on holding: Space plays at double speed while held,
// and a tap still plays/pauses. Kept on this device (keyboards are per device).
// The TV remote has its own keys (routes/player/+page.svelte, $lib/tv/remote.ts).

export type HotkeyAction =
    | 'toggle-pause'
    | 'hold-double-speed'
    | 'seek-forward'
    | 'seek-backward'
    | 'seek-forward-short'
    | 'seek-backward-short'
    | 'volume-up'
    | 'volume-down'
    | 'toggle-mute'
    | 'speed-up'
    | 'speed-down'
    | 'toggle-subtitles'
    | 'subtitle-delay-down'
    | 'subtitle-delay-up'
    | 'subtitle-size-down'
    | 'subtitle-size-up'
    | 'skip-segment'
    | 'next-episode'
    | 'toggle-fullscreen'
    | 'toggle-pip'
    | 'close';

/** A key as KeyboardEvent.key, lower-cased ("k", "arrowleft", "space", "["). */
export type Chord = { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean };

export type Binding = { action: HotkeyAction; chord: Chord };

/** Press: once (repeating while held, for seeking and volume). Hold: while held. */
export const HOLD_ACTIONS: ReadonlySet<HotkeyAction> = new Set(['hold-double-speed']);
const REPEATING: ReadonlySet<HotkeyAction> = new Set([
    'seek-forward',
    'seek-backward',
    'seek-forward-short',
    'seek-backward-short',
    'volume-up',
    'volume-down',
    'subtitle-delay-down',
    'subtitle-delay-up',
    'subtitle-size-down',
    'subtitle-size-up',
]);

/** In the order Settings lists them. `{seek}` and `{short}` are filled in with the seek steps. */
export const ACTIONS: { action: HotkeyAction; label: string; key: Chord }[] = [
    { action: 'toggle-pause', label: 'Play / Pause', key: { key: 'k' } },
    { action: 'hold-double-speed', label: 'Play / Pause, or double speed while held', key: { key: 'space' } },
    { action: 'seek-backward', label: 'Back {seek} seconds', key: { key: 'arrowleft' } },
    { action: 'seek-forward', label: 'Forward {seek} seconds', key: { key: 'arrowright' } },
    { action: 'seek-backward-short', label: 'Back {short} seconds', key: { key: 'arrowleft', shift: true } },
    { action: 'seek-forward-short', label: 'Forward {short} seconds', key: { key: 'arrowright', shift: true } },
    { action: 'volume-up', label: 'Volume up', key: { key: 'arrowup' } },
    { action: 'volume-down', label: 'Volume down', key: { key: 'arrowdown' } },
    { action: 'toggle-mute', label: 'Mute', key: { key: 'm' } },
    { action: 'speed-down', label: 'Slower', key: { key: '[' } },
    { action: 'speed-up', label: 'Faster', key: { key: ']' } },
    { action: 'toggle-subtitles', label: 'Subtitles on / off', key: { key: 'c' } },
    { action: 'subtitle-delay-down', label: 'Subtitles earlier', key: { key: 'g' } },
    { action: 'subtitle-delay-up', label: 'Subtitles later', key: { key: 'h' } },
    { action: 'subtitle-size-down', label: 'Smaller subtitles', key: { key: '-' } },
    { action: 'subtitle-size-up', label: 'Larger subtitles', key: { key: '=' } },
    { action: 'skip-segment', label: 'Skip intro, recap or credits (or find where the intro ends)', key: { key: 's' } },
    { action: 'next-episode', label: 'Next episode', key: { key: 'n' } },
    { action: 'toggle-fullscreen', label: 'Full screen', key: { key: 'f' } },
    { action: 'toggle-pip', label: 'Picture in picture', key: { key: 'p' } },
    { action: 'close', label: 'Exit full screen or picture in picture, then leave', key: { key: 'escape' } },
];

const KEY = 'hotkeys';
const VERSION = 1;

/** The chord of a key press (null for a lone modifier, which can't be bound). */
export function chordOf(e: KeyboardEvent): Chord | null {
    let key = e.key.toLowerCase();
    if (['control', 'alt', 'shift', 'meta', 'altgraph', 'capslock', 'dead', 'unidentified', 'process'].includes(key)) return null;
    if (key === ' ' || key === 'spacebar') key = 'space';
    if (key === 'esc') key = 'escape';
    return { key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
}

export function sameChord(a: Chord, b: Chord) {
    return a.key === b.key && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.meta === !!b.meta;
}

const NAMES: Record<string, string> = {
    space: 'Space',
    escape: 'Esc',
    arrowleft: '←',
    arrowright: '→',
    arrowup: '↑',
    arrowdown: '↓',
    enter: 'Enter',
    tab: 'Tab',
    backspace: 'Backspace',
    delete: 'Delete',
    home: 'Home',
    end: 'End',
    pageup: 'Page Up',
    pagedown: 'Page Down',
};

/** "Ctrl Shift ←", as the keys are shown in Settings. */
export function formatChord(c: Chord) {
    const key = NAMES[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key[0].toUpperCase() + c.key.slice(1));
    return [c.ctrl && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift', c.meta && 'Win', key].filter(Boolean).join(' ');
}

/** Keys the system keeps for itself. */
function reserved(c: Chord) {
    return (
        (c.alt && c.key === 'f4') ||
        (c.ctrl && c.alt && c.key === 'delete') ||
        (c.meta && ['l', 'd', 'tab', 'q'].includes(c.key)) ||
        (c.alt && c.key === 'tab')
    );
}

export function labelOf(action: HotkeyAction, seek: number, short: number) {
    const label = ACTIONS.find((a) => a.action === action)?.label ?? action;
    return label.replace('{seek}', String(seek)).replace('{short}', String(short));
}

function defaults(): Binding[] {
    return ACTIONS.map(({ action, key }) => ({ action, chord: { ...key } }));
}

function load(): Binding[] {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { version: number; bindings: Binding[] } | null;
        if (saved?.version === VERSION && Array.isArray(saved.bindings)) {
            // Actions added since keep their defaults; ones removed are dropped.
            const byAction = new Map(saved.bindings.map((b) => [b.action, b.chord]));
            const merged = defaults().map((d) => ({ action: d.action, chord: byAction.get(d.action) ?? d.chord }));
            if (!validate(merged)) return merged;
        }
    } catch {}
    return defaults();
}

/** Why these bindings can't be used, or null when they can. */
function validate(bindings: Binding[]): string | null {
    for (let i = 0; i < bindings.length; i++) {
        const b = bindings[i];
        if (!b.chord.key) return `${labelOf(b.action, 10, 3)} needs a key`;
        if (reserved(b.chord)) return `${formatChord(b.chord)} is kept by Windows`;
        const other = bindings.findIndex((o, j) => j !== i && sameChord(o.chord, b.chord));
        if (other >= 0) return `${formatChord(b.chord)} is already used for “${labelOf(bindings[other].action, 10, 3)}”`;
    }
    return null;
}

class Hotkeys {
    bindings = $state<Binding[]>(load());

    /** The action for a key press, if any. */
    match(e: KeyboardEvent): HotkeyAction | null {
        const chord = chordOf(e);
        if (!chord) return null;
        const hit = this.bindings.find((b) => sameChord(b.chord, chord));
        if (!hit) return null;
        // Held keys repeat only for actions that make sense held (seeking, volume…).
        if (e.repeat && !REPEATING.has(hit.action)) return null;
        return hit.action;
    }

    /** Some action has this key (held or not). */
    isBound(e: KeyboardEvent) {
        const chord = chordOf(e);
        return !!chord && this.bindings.some((b) => sameChord(b.chord, chord));
    }

    chordFor(action: HotkeyAction): Chord | undefined {
        return this.bindings.find((b) => b.action === action)?.chord;
    }

    /** Gives `action` this key; returns why not, if it can't have it. */
    rebind(action: HotkeyAction, chord: Chord): string | null {
        // Name the action that already has this key, not the one being changed.
        const owner = this.bindings.find((b) => b.action !== action && sameChord(b.chord, chord));
        if (owner) return `${formatChord(chord)} is already used for “${labelOf(owner.action, 10, 3)}”`;
        const next = this.bindings.map((b) => (b.action === action ? { action, chord } : b));
        const problem = validate(next);
        if (problem) return problem;
        this.#save(next);
        return null;
    }

    reset(action?: HotkeyAction) {
        const base = defaults();
        const next = action
            ? this.bindings.map((b) => (b.action === action ? base.find((d) => d.action === action)! : b))
            : base;
        // Resetting one action onto a key now used elsewhere: refuse quietly.
        if (!validate(next)) this.#save(next);
        return validate(next);
    }

    isDefault(action: HotkeyAction) {
        const def = ACTIONS.find((a) => a.action === action)?.key;
        const cur = this.chordFor(action);
        return !!def && !!cur && sameChord(def, cur);
    }

    #save(bindings: Binding[]) {
        this.bindings = bindings;
        try {
            localStorage.setItem(KEY, JSON.stringify({ version: VERSION, bindings }));
        } catch {}
    }
}

export const hotkeys = new Hotkeys();
