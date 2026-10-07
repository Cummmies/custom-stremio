// Is this title anime? Stremio's metadata doesn't say ("Animation" covers
// Western cartoons too), so we check the IMDb id against Fribb's anime-lists,
// which cross-reference MyAnimeList/AniList/Kitsu with IMDb. The list is
// downloaded at most once a week; kept are its IMDb ids, and which MyAnimeList
// entry each IMDb season (or Kitsu id) is, for AniSkip ($lib/player/skips.ts)
// (~500 KB). Titles from anime addons (kitsu:, mal:…) are anime without asking.

const LIST_URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json';
const KEY = 'animeImdbIds';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ANIME_ID = /^(kitsu|mal|anilist|anidb):/i;

/** An IMDb title's MyAnimeList entries: [TVDB season (-1: none given), episode offset, MAL id]. */
type Part = [number, number, number];
type Cached = { fetchedAt: number; ids: string[]; parts?: Record<string, Part[]>; kitsu?: Record<string, number> };
type Entry = {
    imdb_id?: string | string[];
    mal_id?: number;
    kitsu_id?: number;
    season?: { tvdb?: number } | null;
    episode_offset?: { tvdb?: number } | null;
};

class Anime {
    #ids: Set<string> | null = null;
    #parts: Record<string, Part[]> = {};
    #kitsu: Record<string, number> = {};
    /** Bumped when the list arrives, so screens re-check. */
    version = $state(0);
    #loading: Promise<void> | null = null;

    /** Load the cached list, and refresh it in the background when it's old. */
    start() {
        if (this.#loading) return;
        let cached: Cached | null = null;
        try {
            cached = JSON.parse(localStorage.getItem(KEY) ?? 'null');
        } catch {}
        if (cached?.ids?.length) this.#set(cached.ids, cached.parts, cached.kitsu);
        // Saved before the MyAnimeList ids were kept: fetched again for them.
        if (!cached || !cached.parts || Date.now() - cached.fetchedAt > MAX_AGE_MS) this.#loading = this.#refresh();
        else this.#loading = Promise.resolve();
    }

    async #refresh() {
        try {
            const res = await fetch(LIST_URL);
            if (!res.ok) return;
            const list: Entry[] = await res.json();
            const ids = new Set<string>();
            const parts: Record<string, Part[]> = {};
            const kitsu: Record<string, number> = {};
            for (const entry of list) {
                const mal = entry.mal_id;
                if (mal && entry.kitsu_id) kitsu[entry.kitsu_id] = mal;
                for (const id of [entry.imdb_id ?? []].flat()) {
                    if (!/^tt\d+$/.test(id)) continue;
                    ids.add(id);
                    if (mal) (parts[id] ??= []).push([entry.season?.tvdb ?? -1, entry.episode_offset?.tvdb ?? 0, mal]);
                }
            }
            if (!ids.size) return;
            this.#set([...ids], parts, kitsu);
            try {
                localStorage.setItem(KEY, JSON.stringify({ fetchedAt: Date.now(), ids: [...ids], parts, kitsu } satisfies Cached));
            } catch {}
        } catch {
            // Offline: keep whatever we had; callers fall back to reading the sources.
        }
    }

    #set(ids: string[], parts: Record<string, Part[]> = {}, kitsu: Record<string, number> = {}) {
        this.#ids = new Set(ids);
        this.#parts = parts;
        this.#kitsu = kitsu;
        this.version++;
    }

    /**
     * Which MyAnimeList entry, and which of its episodes, an episode is (for
     * AniSkip). `kitsu:12:5` and `mal:21:5` say so themselves; an IMDb episode
     * goes by the list's TVDB seasons, a season split over several entries
     * (Attack on Titan's third) by their episode offsets. null when unknown.
     */
    malEpisode(id: string, season: number | null, episode: number | null): { mal: number; episode: number } | null {
        if (episode == null || episode < 1) return null;
        const [kind, num] = id.split(':');
        if (kind === 'kitsu') return this.#kitsu[num] ? { mal: this.#kitsu[num], episode } : null;
        if (kind === 'mal') return Number(num) ? { mal: Number(num), episode } : null;
        if (!/^tt\d+$/.test(kind) || season == null) return null;
        const parts = this.#parts[kind] ?? [];
        // The entry for that season whose episodes this one falls in: the
        // latest-starting one before it.
        let best: Part | null = null;
        for (const p of parts) if (p[0] === season && p[1] < episode && (!best || p[1] > best[1])) best = p;
        // One entry with no seasons (a single-season show): season 1 is it.
        if (!best && season === 1 && parts.length === 1 && parts[0][0] === -1) best = parts[0];
        return best ? { mal: best[2], episode: episode - best[1] } : null;
    }

    /** true / false, or null when we can't tell yet (list not loaded, unknown id kind). */
    isAnime(id: string | null | undefined): boolean | null {
        this.version; // reactive dependency
        if (!id) return null;
        const base = id.split(':')[0];
        if (ANIME_ID.test(id)) return true;
        if (!/^tt\d+$/.test(base)) return null;
        return this.#ids ? this.#ids.has(base) : null;
    }
}

export const anime = new Anime();
