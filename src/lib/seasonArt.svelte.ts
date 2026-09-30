// Artwork for the season you're on (Settings → Artwork):
//   • Fanart.tv: backgrounds tagged with a season number, and 16:9 "season
//     thumbs". Needs a free personal API key. Shows are found by TVDB id, from
//     the anime list (anime) or TMDB (everything else, so TMDB must be set up).
//   • AniList (anime, no key): each anime season is its own entry with its own
//     banner, matched by the anime list (split seasons included).
// Falls back to TMDB's backdrop, then Stremio's own artwork, in the callers.
import { anime } from './anime.svelte';
import { tmdb } from './tmdb.svelte';

const KEY_FANART = 'fanartKey';
const KEY_ANILIST = 'anilistArt';
const CACHE_FANART = 'fanartArt';
const CACHE_ANILIST = 'anilistBanners';
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

type FanartImage = { url: string; lang: string; likes: string; season?: string };
/** Per TVDB id: backgrounds by season ("all" or a number) and season thumbs by season. */
type FanartShow = { fetchedAt: number; backgrounds: [string, string][]; thumbs: [string, string][] };

function load<T>(key: string, fallback: T): T {
    try {
        return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
    } catch {
        return fallback;
    }
}
function store(key: string, value: unknown) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {}
}

class SeasonArt {
    fanartKey = $state<string>(load(KEY_FANART, ''));
    /** AniList banners for anime seasons (no key needed). */
    anilist = $state<boolean>(load(KEY_ANILIST, true));
    version = $state(0);

    #fanart: Record<string, FanartShow | null> = load(CACHE_FANART, {});
    #banners: Record<string, { at: number; url: string | null }> = load(CACHE_ANILIST, {});
    #fanartPending = new Set<number>();
    #anilistPending = new Set<number>();
    #anilistBatch: number[] = [];
    #anilistTimer: ReturnType<typeof setTimeout> | undefined;
    #saveTimer: ReturnType<typeof setTimeout> | undefined;

    setFanartKey(value: string) {
        this.fanartKey = value.trim();
        store(KEY_FANART, this.fanartKey);
        this.#fanart = {};
        this.#saveSoon();
        this.version++;
    }

    setAnilist(on: boolean) {
        this.anilist = on;
        store(KEY_ANILIST, on);
        this.version++;
    }

    /** Checks the Fanart.tv key with a known show. */
    async testFanart(): Promise<boolean> {
        if (!this.fanartKey) return false;
        try {
            const res = await fetch(`https://webservice.fanart.tv/v3/tv/121361?api_key=${encodeURIComponent(this.fanartKey)}`);
            return res.ok;
        } catch {
            return false;
        }
    }

    /** Full-screen background for a season (title page). */
    hero(imdbId: string | null | undefined, season: number | null, episode?: number | null): string | null {
        if (season == null || season < 1) return null;
        return this.#fanartImage(imdbId, season, 'background') ?? this.#anilistBanner(imdbId, season, episode);
    }

    /** 16:9 card art for a season (Continue Watching). */
    card(imdbId: string | null | undefined, season: number | null, episode?: number | null): string | null {
        if (season == null || season < 1) return null;
        return (
            this.#fanartImage(imdbId, season, 'background') ??
            this.#fanartImage(imdbId, season, 'thumb') ??
            this.#anilistBanner(imdbId, season, episode)
        );
    }

    // --- Fanart.tv ---------------------------------------------------------

    #fanartImage(imdbId: string | null | undefined, season: number, kind: 'background' | 'thumb'): string | null {
        this.version;
        if (!this.fanartKey) return null;
        const tvdb = anime.tvdbId(imdbId) ?? tmdb.tvdbId(imdbId);
        if (!tvdb) return null;
        const show = this.#fanart[tvdb];
        if (show === undefined || (show && Date.now() - show.fetchedAt > MAX_AGE_MS)) this.#fetchFanart(tvdb);
        const list = kind === 'background' ? show?.backgrounds : show?.thumbs;
        return list?.find(([s]) => s === String(season))?.[1] ?? null;
    }

    async #fetchFanart(tvdb: number) {
        if (this.#fanartPending.has(tvdb)) return;
        this.#fanartPending.add(tvdb);
        try {
            const res = await fetch(`https://webservice.fanart.tv/v3/tv/${tvdb}?api_key=${encodeURIComponent(this.fanartKey)}`);
            // 404: Fanart.tv has nothing for this show (remember that); other errors: try again later.
            if (res.status === 404) this.#fanart[tvdb] = null;
            else if (res.ok) {
                const data: { showbackground?: FanartImage[]; seasonthumb?: FanartImage[] } = await res.json();
                this.#fanart[tvdb] = {
                    fetchedAt: Date.now(),
                    // Text-free backgrounds first, then English; most liked first.
                    backgrounds: bestPerSeason(data.showbackground, ['', '00', 'en']),
                    thumbs: bestPerSeason(data.seasonthumb, ['en', '', '00']),
                };
            } else return;
            this.#saveSoon();
            this.version++;
        } catch {
            // offline
        } finally {
            this.#fanartPending.delete(tvdb);
        }
    }

    // --- AniList -----------------------------------------------------------

    #anilistBanner(imdbId: string | null | undefined, season: number, episode?: number | null): string | null {
        this.version;
        if (!this.anilist) return null;
        const id = anime.anilistId(imdbId, season, episode);
        if (!id) return null;
        const cached = this.#banners[id];
        if (!cached || Date.now() - cached.at > MAX_AGE_MS) this.#queueAnilist(id);
        return cached?.url ?? null;
    }

    /** AniList allows ~30 requests a minute, so ids are gathered and asked for 50 at a time. */
    #queueAnilist(id: number) {
        if (this.#anilistPending.has(id)) return;
        this.#anilistPending.add(id);
        this.#anilistBatch.push(id);
        clearTimeout(this.#anilistTimer);
        this.#anilistTimer = setTimeout(() => this.#flushAnilist(), 300);
    }

    async #flushAnilist() {
        const ids = this.#anilistBatch.splice(0, 50);
        if (!ids.length) return;
        if (this.#anilistBatch.length) this.#anilistTimer = setTimeout(() => this.#flushAnilist(), 2500);
        try {
            const res = await fetch('https://graphql.anilist.co', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    query: 'query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids) { id bannerImage } } }',
                    variables: { ids },
                }),
            });
            if (!res.ok) return;
            const data: { data?: { Page?: { media?: { id: number; bannerImage: string | null }[] } } } = await res.json();
            const found = new Map((data.data?.Page?.media ?? []).map((m) => [m.id, m.bannerImage]));
            for (const id of ids) this.#banners[id] = { at: Date.now(), url: found.get(id) ?? null };
            this.#saveSoon();
            this.version++;
        } catch {
            // offline
        } finally {
            for (const id of ids) this.#anilistPending.delete(id);
        }
    }

    #saveSoon() {
        clearTimeout(this.#saveTimer);
        this.#saveTimer = setTimeout(() => {
            store(CACHE_FANART, this.#fanart);
            store(CACHE_ANILIST, this.#banners);
        }, 500);
    }
}

/** For each season, the most-liked image, preferring the given languages in order. */
function bestPerSeason(list: FanartImage[] | undefined, langs: string[]): [string, string][] {
    const rank = (l: string) => {
        const i = langs.indexOf(l ?? '');
        return i < 0 ? langs.length : i;
    };
    const best = new Map<string, FanartImage>();
    for (const img of list ?? []) {
        const s = img.season ?? 'all';
        const cur = best.get(s);
        if (!cur || rank(img.lang) < rank(cur.lang) || (rank(img.lang) === rank(cur.lang) && Number(img.likes) > Number(cur.likes))) {
            best.set(s, img);
        }
    }
    return [...best].map(([s, img]) => [s, img.url]);
}

export const seasonArt = new SeasonArt();
