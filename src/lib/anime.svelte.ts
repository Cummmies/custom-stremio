// Is this title anime? Stremio's metadata doesn't say ("Animation" covers
// Western cartoons too), so we check the IMDb id against Fribb's anime-lists,
// which cross-reference MyAnimeList/AniList/Kitsu with IMDb. The list is
// downloaded at most once a week and only its IMDb ids are kept (~70 KB).
// Titles from anime addons (kitsu:, mal:…) are anime without asking.

const LIST_URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json';
const KEY = 'animeImdbIds';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ANIME_ID = /^(kitsu|mal|anilist|anidb):/i;

type Cached = { fetchedAt: number; ids: string[] };

class Anime {
    #ids: Set<string> | null = null;
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
        if (cached?.ids?.length) this.#set(cached.ids);
        if (!cached || Date.now() - cached.fetchedAt > MAX_AGE_MS) this.#loading = this.#refresh();
        else this.#loading = Promise.resolve();
    }

    async #refresh() {
        try {
            const res = await fetch(LIST_URL);
            if (!res.ok) return;
            const list: { imdb_id?: string | string[] }[] = await res.json();
            const ids = new Set<string>();
            for (const entry of list) {
                for (const id of [entry.imdb_id ?? []].flat()) if (/^tt\d+$/.test(id)) ids.add(id);
            }
            if (!ids.size) return;
            this.#set([...ids]);
            try {
                localStorage.setItem(KEY, JSON.stringify({ fetchedAt: Date.now(), ids: [...ids] } satisfies Cached));
            } catch {}
        } catch {
            // Offline: keep whatever we had; callers fall back to reading the sources.
        }
    }

    #set(ids: string[]) {
        this.#ids = new Set(ids);
        this.version++;
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
