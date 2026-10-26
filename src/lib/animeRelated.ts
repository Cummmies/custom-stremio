// An anime's Related tab straight from AniList, for when the tracker can't be
// reached (or isn't connected): the same groups as the tracker's
// (core/app_library.py _anime_related). Watch Order is the main line of
// prequels and sequels (a TV season over a film or special at each step),
// Side Stories the rest, unless you chose Prequels & Sequels Only. Each entry
// opens where Stremio has it: as a season of its show (Fribb's anime-lists,
// $lib/anime.svelte.ts), else as a film or a Kitsu entry. AniList is asked by
// MyAnimeList id, needs no key, and answers are kept for a week.

import { anime } from '$lib/anime.svelte';
import type { RelatedGroup, RelatedItem, Status } from '$lib/tracker/api';

const API = 'https://graphql.anilist.co';
const CHAIN_HOPS = 10;
const CHAIN_FORMATS = ['TV', 'TV_SHORT', 'ONA'];
const FORMAT_LABELS: Record<string, string> = { MOVIE: 'Movie', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Special', TV_SHORT: 'Short', MUSIC: 'Music' };
const CACHE_KEY = 'anilist-relations';
const MAX_AGE_MS = 7 * 86_400_000;

type Node = {
    idMal: number | null;
    type: string;
    format: string | null;
    title: { english: string | null; romaji: string | null };
    startDate: { year: number | null; month: number | null; day: number | null };
    coverImage: { large: string | null } | null;
};
type Edge = { relationType: string; node: Node };
type Entry = { self: Node | null; edges: Edge[]; at: number };

const QUERY = `query ($mal: Int) { Media(idMal: $mal, type: ANIME) {
  idMal type format title { english romaji } startDate { year month day } coverImage { large }
  relations { edges { relationType node { idMal type format title { english romaji } startDate { year month day } coverImage { large } } } } } }`;

let cache: Record<number, Entry> | null = null;
function readCache(): Record<number, Entry> {
    if (cache) return cache;
    try {
        cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') ?? {};
    } catch {
        cache = {};
    }
    const now = Date.now();
    for (const [k, v] of Object.entries(cache!)) if (now - v.at > MAX_AGE_MS) delete cache![Number(k)];
    return cache!;
}
function writeCache() {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache ?? {}));
    } catch {}
}

/** One entry and its relations (anime only), or null when AniList can't be reached. */
async function relations(mal: number): Promise<Entry | null> {
    const c = readCache();
    if (c[mal]) return c[mal];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
        const res = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query: QUERY, variables: { mal } }),
            signal: ctrl.signal,
        });
        // Not on AniList: nothing related, and not asked again this week.
        if (res.status === 404) return (c[mal] = { self: null, edges: [], at: Date.now() });
        if (!res.ok) return null;
        const media = (await res.json())?.data?.Media;
        const edges: Edge[] = (media?.relations?.edges ?? []).filter((e: Edge) => e.node?.type === 'ANIME' && e.node.idMal);
        c[mal] = { self: media ? { ...media, relations: undefined } : null, edges, at: Date.now() };
        writeCache();
        return c[mal];
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

const dateKey = (n: Node) => {
    const d = n.startDate ?? {};
    return d.year ? `${d.year}-${String(d.month ?? 12).padStart(2, '0')}-${String(d.day ?? 31).padStart(2, '0')}` : '9999';
};

/** The main-line prequel or sequel of an entry (a TV season over a film or special). */
async function nextInChain(mal: number, relation: 'PREQUEL' | 'SEQUEL'): Promise<Node | null> {
    const entry = await relations(mal);
    const options = (entry?.edges ?? []).filter((e) => e.relationType === relation).map((e) => e.node);
    options.sort((a, b) => Number(!CHAIN_FORMATS.includes(a.format ?? '')) - Number(!CHAIN_FORMATS.includes(b.format ?? '')) || dateKey(a).localeCompare(dateKey(b)));
    return options[0] ?? null;
}

/**
 * The Related tab for an anime Stremio title (`season`: the one you're on),
 * or null when it isn't one AniList knows (or can't be reached).
 */
export async function animeRelated(
    id: string,
    season: number | null,
    opts: { sideStories: boolean; statusOf: (id: string) => Status | null }
): Promise<RelatedGroup[] | null> {
    await anime.ready();
    const here = anime.malOf(id, season ?? 1);
    if (!here) return null;
    const start = await relations(here);
    if (!start?.self) return null;
    const seen = new Set([here]);
    const before: Node[] = [];
    const after: Node[] = [];
    for (const [relation, out] of [['PREQUEL', before], ['SEQUEL', after]] as const) {
        let cur = here;
        for (let i = 0; i < CHAIN_HOPS; i++) {
            const next = await nextInChain(cur, relation);
            if (!next?.idMal || seen.has(next.idMal)) break;
            seen.add(next.idMal);
            out.push(next);
            cur = next.idMal;
        }
    }

    const card = (n: Node, isHere = false): RelatedItem | null => {
        const place = anime.placeOf(n.idMal!);
        let sid: string | null = null;
        let inSeason: number | null = null;
        // As part of its show on Stremio (the season on the show's page), not a Kitsu entry of its own.
        if (place?.imdb && (n.format === 'MOVIE' || place.season != null)) {
            sid = place.imdb;
            inSeason = n.format === 'MOVIE' ? null : place.season;
        } else if (place?.kitsu) sid = `kitsu:${place.kitsu}`;
        else if (isHere) sid = id;
        if (!sid) return null;
        return {
            id: sid,
            type: n.format === 'MOVIE' ? 'movie' : 'series',
            name: n.title?.english || n.title?.romaji || '',
            year: n.startDate?.year ? String(n.startDate.year) : null,
            kind: FORMAT_LABELS[n.format ?? ''] ?? null,
            poster: n.coverImage?.large ?? null,
            status: opts.statusOf(sid),
            here: isHere,
            season: inSeason,
        };
    };

    const groups: RelatedGroup[] = [];
    const chain = [...before.reverse(), start.self, ...after]
        .map((n) => card(n, n.idMal === here))
        .filter((c): c is RelatedItem => !!c);
    if (chain.length > 1) groups.push({ title: 'Watch Order', items: chain });
    if (opts.sideStories) {
        const extra = start.edges
            .filter((e) => e.relationType !== 'CHARACTER' && !seen.has(e.node.idMal!))
            .map((e) => card(e.node))
            .filter((c): c is RelatedItem => !!c);
        if (extra.length) groups.push({ title: 'Side Stories', items: extra });
    }
    return groups;
}
