// Skippable sections (intro, recap, credits, preview) for the playing video.
//
// Sources, best first:
//   1. The file's own chapter markers ("Intro", "Opening", "Credits"…): exact for this file.
//   2. TheIntroDB and IntroDB: crowdsourced timings looked up by IMDb id + season/episode.
import { invoke } from '@tauri-apps/api/core';
import type { RawChapter } from './backend';

export type SkipKind = 'intro' | 'recap' | 'credits' | 'preview';
export type Segment = { kind: SkipKind; start: number; end: number; source: string };

type Range = { start_ms?: number | null; end_ms?: number | null; start_sec?: number; end_sec?: number };

const MIN_LENGTH = 5; // seconds; shorter "segments" aren't worth a button

async function getJson(url: string): Promise<any | null> {
    try {
        const text = await invoke<string | null>('skip_lookup', { url });
        return text ? JSON.parse(text) : null;
    } catch {
        return null;
    }
}

function toSegment(kind: SkipKind, r: Range | null | undefined, duration: number, source: string): Segment | null {
    if (!r) return null;
    const start = r.start_sec ?? (r.start_ms != null ? r.start_ms / 1000 : 0);
    const end = r.end_sec ?? (r.end_ms != null ? r.end_ms / 1000 : duration);
    if (!(end - start >= MIN_LENGTH) || start >= duration) return null;
    return { kind, start, end: Math.min(end, duration), source };
}

async function fromTheIntroDB(imdb: string, season: number | null, episode: number | null, duration: number) {
    const q = new URLSearchParams({ imdb_id: imdb, duration_ms: String(Math.round(duration * 1000)) });
    if (season != null && episode != null) {
        q.set('season', String(season));
        q.set('episode', String(episode));
    }
    const data = await getJson(`https://api.theintrodb.org/v3/media?${q}`);
    if (!data || data.error) return [];
    const out: Segment[] = [];
    const map: [SkipKind, string][] = [['intro', 'intro'], ['recap', 'recap'], ['credits', 'credits'], ['preview', 'preview']];
    for (const [kind, key] of map) {
        for (const r of (data[key] as Range[] | undefined) ?? []) {
            const s = toSegment(kind, r, duration, 'TheIntroDB');
            if (s) out.push(s);
        }
    }
    return out;
}

async function fromIntroDB(imdb: string, season: number | null, episode: number | null, duration: number) {
    const q = new URLSearchParams({ imdb_id: imdb });
    if (season != null && episode != null) {
        q.set('season', String(season));
        q.set('episode', String(episode));
    } else {
        q.set('is_movie', 'true');
    }
    const data = await getJson(`https://api.introdb.app/segments?${q}`);
    if (!data || data.error) return [];
    return [
        toSegment('intro', data.intro, duration, 'IntroDB'),
        toSegment('recap', data.recap, duration, 'IntroDB'),
        toSegment('credits', data.outro, duration, 'IntroDB'),
    ].filter((s): s is Segment => !!s);
}

const CHAPTER_KINDS: [RegExp, SkipKind][] = [
    [/\b(intro|opening|op|opening credits|title sequence)\b/i, 'intro'],
    [/\b(recap|previously)\b/i, 'recap'],
    [/\b(credits|ending|ed|outro|end credits)\b/i, 'credits'],
    [/\b(preview|next episode|next time)\b/i, 'preview'],
];

/** A chapter mark for the seek bar. */
export type Chapter = { time: number; title: string };

/** The file's chapters (mpv's `chapter-list` property JSON), in order. */
export function parseChapters(list: RawChapter[]): Chapter[] {
    return list
        .filter((c) => Number.isFinite(c.time))
        .map((c) => ({ time: c.time, title: (c.title ?? '').trim() }))
        .sort((a, b) => a.time - b.time);
}

// Seek-bar names: only the intro and outro get one.
const SECTION_NAME: Record<SkipKind, string> = { intro: 'Intro', recap: '', credits: 'Outro', preview: '' };

/**
 * Seek-bar marks for the intro and the outro only: the bar splits where each
 * starts and ends, and nowhere else. Taken from the file's chapters when they
 * name them ("Opening", "Ending"…, or a generic chapter a known section
 * covers), otherwise from the known sections.
 *
 * Movies: only the end credits, labelled "Credits", from the known sections
 * (which for a movie are only ever the end credits).
 */
export function introOutroMarks(chapters: Chapter[], segments: Segment[], duration: number, movie = false): Chapter[] {
    type Section = { title: string; start: number; end: number };
    let sections: Section[] = [];
    if (movie) {
        sections = segments
            .filter((x) => x.kind === 'credits')
            .map((x) => ({ title: 'Credits', start: x.start, end: x.end }));
    } else if (chapters.length >= 2) {
        const named = nameChapters(chapters, segments, duration);
        sections = named
            .map((c, i) => ({ title: c.title, start: c.time, end: named[i + 1]?.time ?? duration }))
            .filter((x) => x.title);
    }
    if (!sections.length && !movie) {
        sections = segments
            .filter((x) => x.kind === 'intro' || x.kind === 'credits')
            .map((x) => ({ title: SECTION_NAME[x.kind], start: x.start, end: x.end }));
    }
    const out: Chapter[] = [];
    const push = (x: Section) => {
        if (out.at(-1)?.time === x.start) out.pop();
        out.push({ time: x.start, title: x.title });
        if (x.end < duration - 1) out.push({ time: x.end, title: '' });
    };
    let last: Section | null = null;
    for (const x of sections.sort((a, b) => a.start - b.start)) {
        // An intro split over two chapters is still one intro.
        if (last && last.title === x.title && x.start - last.end < 1) {
            last.end = Math.max(last.end, x.end);
            continue;
        }
        if (last) push(last);
        last = { ...x };
    }
    if (last) push(last);
    return out;
}

/**
 * Names a chapter "Intro" or "Outro" by its own title ("Opening", "ED"…) or when
 * a known section covers most of it; every other chapter gets no name.
 */
export function nameChapters(chapters: Chapter[], segments: Segment[], duration: number): Chapter[] {
    return chapters.map((c, i) => {
        const end = chapters[i + 1]?.time ?? duration;
        const len = Math.max(1, end - c.time);
        const kind =
            CHAPTER_KINDS.find(([re]) => re.test(c.title))?.[1] ??
            segments.find((s) => (Math.min(end, s.end) - Math.max(c.time, s.start)) / len >= 0.6)?.kind;
        return { time: c.time, title: kind ? SECTION_NAME[kind] : '' };
    });
}

/** Segments from the file's chapter markers. */
export function fromChapters(chapters: RawChapter[], duration: number): Segment[] {
    const out: Segment[] = [];
    chapters.forEach((c, i) => {
        const kind = CHAPTER_KINDS.find(([re]) => re.test(c.title ?? ''))?.[1];
        if (!kind) return;
        const end = chapters[i + 1]?.time ?? duration;
        if (end - c.time >= MIN_LENGTH) out.push({ kind, start: c.time, end, source: 'Chapters' });
    });
    return out;
}

/**
 * All known segments for a title. Chapters win (they match this exact file),
 * then TheIntroDB (consensus of several submissions), then IntroDB.
 */
export async function lookupSegments(opts: {
    imdb: string | null;
    season: number | null;
    episode: number | null;
    duration: number;
    chapters: Segment[];
    /** Movies: only the end credits. Their "intros" are opening credits or a title
     *  sequence (from chapter names or the databases), not something to skip. */
    movie?: boolean;
}): Promise<Segment[]> {
    const { imdb, season, episode, duration, chapters, movie = false } = opts;
    const [a, b] = imdb && /^tt\d+$/.test(imdb)
        ? await Promise.all([fromTheIntroDB(imdb, season, episode, duration), fromIntroDB(imdb, season, episode, duration)])
        : [[], []];
    const merged: Segment[] = [];
    for (const s of [...chapters, ...a, ...b].filter((s) => plausible(s, duration, movie))) {
        const clash = merged.some((m) => m.kind === s.kind && s.start < m.end && m.start < s.end);
        if (!clash) merged.push(s);
    }
    return merged.sort((x, y) => x.start - y.start);
}

/** Leaves out sections that can't be what they claim (bad chapter names, bad submissions). */
function plausible(s: Segment, duration: number, movie: boolean): boolean {
    const len = s.end - s.start;
    if (movie) return s.kind === 'credits' && s.start >= duration * 0.6;
    switch (s.kind) {
        // A TV intro is a short opening, somewhere in the first part of the episode.
        case 'intro':
            return len <= 180 && s.start <= Math.max(600, duration * 0.35);
        case 'recap':
            return len <= 300 && s.start <= Math.max(300, duration * 0.25);
        // Credits and previews come at the end.
        case 'credits':
        case 'preview':
            return s.start >= duration * 0.6;
    }
}

export const skipLabel: Record<SkipKind, string> = {
    intro: 'Skip Intro',
    recap: 'Skip Recap',
    credits: 'Skip Credits',
    preview: 'Skip Preview',
};
