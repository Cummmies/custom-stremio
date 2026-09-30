// Is this title anime? Stremio's metadata doesn't say ("Animation" covers
// Western cartoons too), so we check the IMDb id against Fribb's anime-lists,
// which cross-reference MyAnimeList/AniList/Kitsu/TVDB with IMDb. The list is
// downloaded at most once a week; we keep, per IMDb id, its TVDB id and which
// AniList entry covers which season (and from which episode), ~200 KB.
// Titles from anime addons (kitsu:, mal:…) are anime without asking.

const LIST_URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json';
const KEY = 'animeList';
const OLD_KEY = 'animeImdbIds';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ANIME_ID = /^(kitsu|mal|anilist|anidb):/i;

/** [season, first episode - 1, AniList id] */
type Part = [number, number, number];
type Entry = { tvdb: number | null; parts: Part[] };
type Cached = { fetchedAt: number; entries: Record<string, Entry> };

type ListEntry = {
    imdb_id?: string | string[];
    anilist_id?: number;
    tvdb_id?: number;
    type?: string;
    season?: { tvdb?: number };
    episode_offset?: { tvdb?: number } | null;
};

class Anime {
    #entries: Record<string, Entry> | null = null;
    /** Bumped when the list arrives, so screens re-check. */
    version = $state(0);
    #loading: Promise<void> | null = null;

    /** Load the cached list, and refresh it in the background when it's old. */
    start() {
        if (this.#loading) return;
        let cached: Cached | null = null;
        try {
            cached = JSON.parse(localStorage.getItem(KEY) ?? 'null');
            localStorage.removeItem(OLD_KEY); // the ids-only list this replaced
        } catch {}
        if (cached?.entries) this.#set(cached.entries);
        if (!cached || Date.now() - cached.fetchedAt > MAX_AGE_MS) this.#loading = this.#refresh();
        else this.#loading = Promise.resolve();
    }

    async #refresh() {
        try {
            const res = await fetch(LIST_URL);
            if (!res.ok) return;
            const list: ListEntry[] = await res.json();
            const entries: Record<string, Entry> = {};
            for (const e of list) {
                for (const id of [e.imdb_id ?? []].flat()) {
                    if (!/^tt\d+$/.test(id)) continue;
                    const entry = (entries[id] ??= { tvdb: null, parts: [] });
                    entry.tvdb ??= e.tvdb_id ?? null;
                    const season = e.season?.tvdb;
                    // Seasons of the series itself (not movies, specials or OVAs).
                    if (e.anilist_id && season != null && season > 0 && (e.type === 'TV' || e.type === 'ONA')) {
                        entry.parts.push([season, e.episode_offset?.tvdb ?? 0, e.anilist_id]);
                    }
                }
            }
            if (!Object.keys(entries).length) return;
            this.#set(entries);
            try {
                localStorage.setItem(KEY, JSON.stringify({ fetchedAt: Date.now(), entries } satisfies Cached));
            } catch {}
        } catch {
            // Offline: keep whatever we had; callers fall back to reading the sources.
        }
    }

    #set(entries: Record<string, Entry>) {
        this.#entries = entries;
        this.version++;
    }

    #entry(id: string | null | undefined): Entry | null {
        this.version; // reactive dependency
        const base = id?.split(':')[0];
        return base && this.#entries ? (this.#entries[base] ?? null) : null;
    }

    /** true / false, or null when we can't tell yet (list not loaded, unknown id kind). */
    isAnime(id: string | null | undefined): boolean | null {
        this.version;
        if (!id) return null;
        if (ANIME_ID.test(id)) return true;
        if (!/^tt\d+$/.test(id.split(':')[0])) return null;
        return this.#entries ? !!this.#entry(id) : null;
    }

    /** The show's TVDB id (for Fanart.tv), when it's anime. */
    tvdbId(id: string | null | undefined): number | null {
        return this.#entry(id)?.tvdb ?? null;
    }

    /**
     * The AniList entry for `season` (and `episode`, when a season is split into
     * parts: "season 2 from episode 13" is its own entry).
     */
    anilistId(id: string | null | undefined, season: number | null, episode?: number | null): number | null {
        const parts = this.#entry(id)?.parts.filter(([s]) => s === season);
        if (!parts?.length) return null;
        const sorted = [...parts].sort((a, b) => a[1] - b[1]);
        const ep = episode ?? 1;
        return (sorted.filter(([, offset]) => offset < ep).at(-1) ?? sorted[0])[2];
    }
}

export const anime = new Anime();
