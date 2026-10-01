// Subtitle files (SRT and WebVTT) for players that leave drawing subtitles to
// the app (AVPlay on TVs): parse once, then look up the line for a time.

export type Cue = { start: number; end: number; text: string };

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function seconds(t: string): number | null {
    const m = TIME.exec(t);
    if (!m) return null;
    return (Number(m[1] ?? 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

/** Plain text of a cue: no HTML-ish tags, no ASS override blocks. */
export function cleanCueText(text: string): string {
    return text
        .replace(/\{\\[^}]*\}/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\\N/g, '\n')
        .trim();
}

/** Cues from an SRT or WebVTT file, sorted by start time. */
export function parseSubtitles(source: string): Cue[] {
    const cues: Cue[] = [];
    const blocks = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
    for (const block of blocks) {
        const lines = block.split('\n');
        const at = lines.findIndex((l) => l.includes('-->'));
        if (at < 0) continue;
        const [from, to] = lines[at].split('-->');
        const start = seconds(from);
        const end = seconds(to);
        if (start == null || end == null) continue;
        const text = cleanCueText(lines.slice(at + 1).join('\n'));
        if (text) cues.push({ start, end, text });
    }
    return cues.sort((a, b) => a.start - b.start);
}

/** The text showing at `time` (overlapping cues are joined), or ''. */
export function cueAt(cues: Cue[], time: number): string {
    // Binary search for the last cue starting at or before `time`.
    let lo = 0;
    let hi = cues.length - 1;
    let last = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cues[mid].start <= time) {
            last = mid;
            lo = mid + 1;
        } else hi = mid - 1;
    }
    const out: string[] = [];
    // A few earlier cues may still be on screen (long cues overlapping).
    for (let i = last; i >= 0 && i > last - 8; i--) {
        if (cues[i].end > time) out.unshift(cues[i].text);
    }
    return out.join('\n');
}
