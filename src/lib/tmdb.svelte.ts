// Artwork from TMDB (Settings → Artwork): season posters for the season you're
// on, and TMDB's backdrops for backgrounds. Off until you paste a TMDB "API Read
// Access Token" (or the older "API Key") in Settings.
//
// Each show is looked up once by its IMDb id and remembered for two weeks.
// Screens ask synchronously (`backdrop`, `seasonPoster`) and get null until the
// answer arrives; `version` makes them re-render when it does.

const CRED_KEY = 'tmdbCredential';
const CACHE_KEY = 'tmdbArt';
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const PARALLEL = 4;

type SeasonArt = { n: number; air: string | null; poster: string | null };
type ShowArt = { fetchedAt: number; backdrop: string | null; poster: string | null; seasons: SeasonArt[]; tvdb?: number | null };

function load<T>(key: string, fallback: T): T {
    try {
        return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
    } catch {
        return fallback;
    }
}

class Tmdb {
    credential = $state<string>(load(CRED_KEY, ''));
    /** Bumped when artwork arrives, so screens re-check. */
    version = $state(0);
    #cache: Record<string, ShowArt | null> = load(CACHE_KEY, {});
    #pending = new Set<string>();
    #queue: string[] = [];
    #running = 0;
    #saveTimer: ReturnType<typeof setTimeout> | undefined;

    get enabled() {
        return this.credential.trim().length > 0;
    }

    setCredential(value: string) {
        this.credential = value.trim();
        try {
            localStorage.setItem(CRED_KEY, JSON.stringify(this.credential));
        } catch {}
        // Different account: look everything up again.
        this.#cache = {};
        this.#save();
        this.version++;
    }

    /** Checks the saved token/key against TMDB. */
    async test(): Promise<boolean> {
        return !!(await this.#get('/configuration'));
    }

    /** Wide background for a title (TMDB backdrop, text-free when there is one). */
    backdrop(imdbId: string | null | undefined, size: 'w780' | 'w1280' | 'original' = 'w1280'): string | null {
        const art = this.#art(imdbId);
        return art?.backdrop ? `${IMG}/${size}${art.backdrop}` : null;
    }

    /**
     * The poster for `season`. Anime seasons are sometimes numbered differently on
     * TMDB, so when the season's first air date is known, the TMDB season that
     * started closest to it wins over the one with the same number.
     */
    seasonPoster(imdbId: string | null | undefined, season: number | null, firstAired?: string | null): string | null {
        const art = this.#art(imdbId);
        if (!art) return null;
        const match = season != null && season > 0 ? matchSeason(art.seasons, season, firstAired ?? null) : null;
        const path = match?.poster ?? art.poster;
        return path ? `${IMG}/w500${path}` : null;
    }

    /** The show's TVDB id (for Fanart.tv). */
    tvdbId(imdbId: string | null | undefined): number | null {
        return this.#art(imdbId)?.tvdb ?? null;
    }

    #art(imdbId: string | null | undefined): ShowArt | null {
        this.version; // reactive dependency
        const id = imdbId?.split(':')[0];
        if (!this.enabled || !id || !/^tt\d+$/.test(id)) return null;
        const cached = this.#cache[id];
        // Entries saved before the TVDB id was kept are refreshed once.
        if (cached === undefined || (cached && (Date.now() - cached.fetchedAt > MAX_AGE_MS || !('tvdb' in cached)))) this.#enqueue(id);
        return cached ?? null;
    }

    #enqueue(id: string) {
        if (this.#pending.has(id)) return;
        this.#pending.add(id);
        this.#queue.push(id);
        this.#pump();
    }

    #pump() {
        while (this.#running < PARALLEL && this.#queue.length) {
            const id = this.#queue.shift()!;
            this.#running++;
            this.#fetchShow(id)
                .then((art) => {
                    // A failed request isn't remembered, so it's tried again later.
                    if (art !== undefined) {
                        this.#cache[id] = art;
                        this.#save();
                        this.version++;
                    }
                })
                .finally(() => {
                    this.#pending.delete(id);
                    this.#running--;
                    this.#pump();
                });
        }
    }

    /** undefined = couldn't ask (offline, bad token); null = TMDB doesn't know it. */
    async #fetchShow(imdbId: string): Promise<ShowArt | null | undefined> {
        const found = await this.#get(`/find/${imdbId}?external_source=imdb_id`);
        if (!found) return undefined;
        const tv = found.tv_results?.[0];
        const movie = found.movie_results?.[0];
        if (!tv && !movie) return null;
        const path = tv ? `/tv/${tv.id}` : `/movie/${movie.id}`;
        const details = await this.#get(`${path}?append_to_response=images,external_ids&include_image_language=en,null`);
        if (!details) return undefined;
        return {
            fetchedAt: Date.now(),
            backdrop: pickBackdrop(details.images?.backdrops) ?? details.backdrop_path ?? null,
            poster: details.poster_path ?? null,
            tvdb: details.external_ids?.tvdb_id ?? null,
            seasons: (details.seasons ?? [])
                .filter((s: { season_number: number }) => s.season_number > 0)
                .map((s: { season_number: number; air_date?: string | null; poster_path?: string | null }) => ({
                    n: s.season_number,
                    air: s.air_date ?? null,
                    poster: s.poster_path ?? null,
                })),
        };
    }

    async #get(path: string): Promise<any | null> {
        if (!this.enabled) return null;
        const cred = this.credential;
        // A Read Access Token is a long JWT ("eyJ…"); an API Key is 32 hex characters.
        const bearer = cred.startsWith('eyJ');
        const url = `${API}${path}${bearer ? '' : `${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(cred)}`}`;
        try {
            const res = await fetch(url, { headers: bearer ? { Authorization: `Bearer ${cred}`, accept: 'application/json' } : {} });
            return res.ok ? await res.json() : null;
        } catch {
            return null;
        }
    }

    #save() {
        clearTimeout(this.#saveTimer);
        this.#saveTimer = setTimeout(() => {
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify(this.#cache));
            } catch {}
        }, 500);
    }
}

type Image = { file_path: string; iso_639_1: string | null; vote_average: number; width: number };

/** The best-rated backdrop without text on it (the title logo goes on top), else the best-rated. */
function pickBackdrop(list: Image[] | undefined): string | null {
    if (!list?.length) return null;
    const byVotes = [...list].sort((a, b) => b.vote_average - a.vote_average || b.width - a.width);
    return (byVotes.find((i) => !i.iso_639_1) ?? byVotes[0]).file_path;
}

function matchSeason(seasons: SeasonArt[], season: number, firstAired: string | null): SeasonArt | null {
    const same = seasons.find((s) => s.n === season) ?? null;
    const aired = firstAired ? Date.parse(firstAired) : NaN;
    if (Number.isNaN(aired)) return same;
    const days = (s: SeasonArt) => (s.air ? Math.abs(Date.parse(s.air) - aired) / 86_400_000 : Infinity);
    // Same number and started within a month of it: that's the one.
    if (same && days(same) <= 31) return same;
    const closest = [...seasons].sort((a, b) => days(a) - days(b))[0];
    return closest && days(closest) <= 31 ? closest : same;
}

export const tmdb = new Tmdb();
