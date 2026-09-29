// Skippable sections (intro, recap, credits, preview) for the playing video.
//
// Sources, best first:
//   1. The file's own chapter markers ("Intro", "Opening", "Credits"…): exact for this file.
//   2. TheIntroDB and IntroDB: crowdsourced timings looked up by IMDb id + season/episode.
import { invoke } from '@tauri-apps/api/core';

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
export function parseChapters(chapterListJson: string | null): Chapter[] {
    try {
        const list: { title?: string; time: number }[] = chapterListJson ? JSON.parse(chapterListJson) : [];
        return list
            .filter((c) => Number.isFinite(c.time))
            .map((c) => ({ time: c.time, title: (c.title ?? '').trim() }))
            .sort((a, b) => a.time - b.time);
    } catch {
        return [];
    }
}

/** Seek-bar marks from known sections, for files without chapters of their own. */
export function chaptersFromSegments(segments: Segment[], duration: number): Chapter[] {
    const name: Record<SkipKind, string> = { intro: 'Intro', recap: 'Recap', credits: 'Credits', preview: 'Preview' };
    const out: Chapter[] = [];
    for (const s of [...segments].sort((a, b) => a.start - b.start)) {
        out.push({ time: s.start, title: name[s.kind] });
        if (s.end < duration - 1) out.push({ time: s.end, title: '' });
    }
    return out;
}

/** Segments from the file's chapter list (mpv's `chapter-list` property JSON). */
export function fromChapters(chapterListJson: string | null, duration: number): Segment[] {
    let chapters: { title?: string; time: number }[] = [];
    try {
        chapters = chapterListJson ? JSON.parse(chapterListJson) : [];
    } catch {
        return [];
    }
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
}): Promise<Segment[]> {
    const { imdb, season, episode, duration, chapters } = opts;
    const [a, b] = imdb && /^tt\d+$/.test(imdb)
        ? await Promise.all([fromTheIntroDB(imdb, season, episode, duration), fromIntroDB(imdb, season, episode, duration)])
        : [[], []];
    const merged: Segment[] = [];
    for (const s of [...chapters, ...a, ...b]) {
        const clash = merged.some((m) => m.kind === s.kind && s.start < m.end && m.start < s.end);
        if (!clash) merged.push(s);
    }
    return merged.sort((x, y) => x.start - y.start);
}

export const skipLabel: Record<SkipKind, string> = {
    intro: 'Skip Intro',
    recap: 'Skip Recap',
    credits: 'Skip Credits',
    preview: 'Skip Preview',
};
