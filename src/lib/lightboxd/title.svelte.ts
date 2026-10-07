// A title page's Lightboxd side: what you have for this Stremio title (your
// status, lists, watches, score), your lists to choose from, its reviews and
// related titles, and the actions on them. Loaded while Lightboxd is
// connected and reachable; everything stays empty (and the page falls back
// to Stremio alone) when it isn't.
//
// An anime can be several Lightboxd titles (its seasons share one IMDb ID);
// the first stands for the show, as Lightboxd's own Add to Watchlist does.

import { lightboxd } from '$lib/lightboxd.svelte';
import { lb, type ListInfo, type RelatedGroup, type Reviews, type Status, type Summary, type WatchFields } from './api';

/** Rated or logged elsewhere meanwhile (the website, another device): picked up this often. */
const REFRESH_MS = 60_000;

export class LightboxdTitle {
    /** This title's Lightboxd summaries; [] when Lightboxd doesn't have it, null until known. */
    titles = $state<Summary[] | null>(null);
    lists = $state<ListInfo[]>([]);
    reviews = $state<Reviews | null>(null);
    related = $state<RelatedGroup[] | null>(null);
    busy = $state(false);
    error = $state<string | null>(null);

    /** The Lightboxd title that stands for this one. */
    main = $derived<Summary | null>(this.titles?.[0] ?? null);
    /** Connected and reachable: Lightboxd's controls show (the summary fills in as it loads). */
    on = $derived(lightboxd.ready);

    #key = '';
    #title: { id: string; type: string; name: string } | null = null;
    #extrasFor: number | null = null;

    /** Load for a Stremio title (again only when it changes). */
    load(id: string, type: string, name: string) {
        this.#title = { id, type, name };
        if (!lightboxd.ready || this.#key === id) return;
        this.#key = id;
        this.titles = null;
        this.reviews = null;
        this.related = null;
        this.#extrasFor = null;
        this.error = null;
        lb.titles(id).then((res) => {
            if (this.#key !== id || !res) return;
            this.titles = res.titles;
            this.#loadExtras();
        });
        lb.lists().then((res) => {
            if (res) this.lists = res.lists;
        });
    }

    /** Reviews and related titles, once per Lightboxd title (both can be slow: they may ask TMDb or AniList). */
    #loadExtras() {
        const main = this.main;
        if (!main || this.#extrasFor === main.title_id) return;
        const titleId = main.title_id;
        this.#extrasFor = titleId;
        lb.reviews(titleId).then((res) => {
            if (this.#extrasFor === titleId) this.reviews = res ?? { aggregate: [], friends: [] };
        });
        lb.related(titleId).then((res) => {
            if (this.#extrasFor === titleId) this.related = res?.groups ?? [];
        });
    }

    /** Re-read the summary (not while something's being saved). */
    refresh() {
        const id = this.#key;
        if (!id || this.busy || !lightboxd.ready || document.visibilityState !== 'visible') return;
        lb.titles(id).then((res) => {
            if (this.#key === id && res && !this.busy) this.titles = res.titles;
        });
    }

    /** Keeps the summary fresh while the page is open: on focus, and every minute. */
    watchForChanges() {
        const tick = () => this.refresh();
        const timer = setInterval(tick, REFRESH_MS);
        window.addEventListener('focus', tick);
        document.addEventListener('visibilitychange', tick);
        return () => {
            clearInterval(timer);
            window.removeEventListener('focus', tick);
            document.removeEventListener('visibilitychange', tick);
        };
    }

    /** Lightboxd's title for this one, adding it (Plan to Watch) when it doesn't have it yet. */
    async #ensure(): Promise<Summary | null> {
        if (this.main) return this.main;
        const t = this.#title;
        if (!t) return null;
        const res = await lb.addToWatchlist(t.id, t.type, t.name);
        if (!res?.titles.length) {
            this.error = 'Couldn’t add it. Lightboxd may not know this title.';
            return null;
        }
        this.titles = res.titles;
        this.#loadExtras();
        return this.main;
    }

    #put(updated: Summary | null | undefined) {
        if (!updated || !this.titles) return;
        const at = this.titles.findIndex((s) => s.title_id === updated.title_id);
        this.titles = at === -1 ? [updated, ...this.titles] : this.titles.map((s, i) => (i === at ? updated : s));
    }

    async #do<T>(work: () => Promise<T>, failed: string): Promise<T | null> {
        this.busy = true;
        this.error = null;
        try {
            const out = await work();
            if (out == null) this.error = failed;
            return out;
        } finally {
            this.busy = false;
        }
    }

    /** Plan to Watch, Watching, Completed or Dropped. */
    setStatus(status: Status) {
        return this.#do(async () => {
            const main = await this.#ensure();
            if (!main) return null;
            const res = await lb.setStatus(main.title_id, status);
            this.#put(res?.title);
            return res;
        }, 'Couldn’t change the status.');
    }

    /** On or off one of your lists. */
    toggleList(listId: number) {
        return this.#do(async () => {
            const t = this.#title;
            if (!t) return null;
            const main = this.main;
            const res = main?.lists.includes(listId)
                ? await lb.removeFromList(listId, main.title_id)
                : await lb.addToList(listId, t.id, t.type, t.name);
            if (res && !this.titles?.length) this.titles = [res.title];
            else this.#put(res?.title);
            if (res) this.#bumpCount(listId, this.main?.lists.includes(listId) ? 1 : -1);
            return res;
        }, 'Couldn’t change the list.');
    }

    #bumpCount(listId: number, by: number) {
        this.lists = this.lists.map((l) => (l.id === listId ? { ...l, count: Math.max(0, l.count + by) } : l));
    }

    /** A new list, with this title on it. */
    newList(name: string) {
        return this.#do(async () => {
            const made = await lb.newList(name);
            if (!made) return null;
            this.lists = [made, ...this.lists];
            const t = this.#title;
            const res = t ? await lb.addToList(made.id, t.id, t.type, t.name) : null;
            if (res && !this.titles?.length) this.titles = [res.title];
            else this.#put(res?.title);
            if (res) this.#bumpCount(made.id, 1);
            return made;
        }, 'Couldn’t make the list.');
    }

    /** Out of Lightboxd: your status, watches and list entries for it. */
    remove() {
        return this.#do(async () => {
            const main = this.main;
            if (!main) return true;
            const res = await lb.remove(main.title_id);
            if (res) {
                this.titles = [];
                this.lists = this.lists.map((l) => (main.lists.includes(l.id) ? { ...l, count: Math.max(0, l.count - 1) } : l));
            }
            return res;
        }, 'Couldn’t remove it.');
    }

    /** Log a watch (every one after your first is a rewatch, as Lightboxd counts them). */
    addWatch(fields: WatchFields) {
        return this.#do(async () => {
            const main = await this.#ensure();
            if (!main) return null;
            const res = await lb.addWatch(main.title_id, fields);
            this.#put(res?.title);
            return res;
        }, 'Couldn’t log the watch.');
    }

    editWatch(logId: number, fields: WatchFields) {
        return this.#do(async () => {
            const res = await lb.editWatch(logId, fields);
            this.#put(res?.title);
            return res;
        }, 'Couldn’t save the watch.');
    }

    deleteWatch(logId: number) {
        return this.#do(async () => {
            const res = await lb.deleteWatch(logId);
            this.#put(res?.title);
            return res;
        }, 'Couldn’t delete the watch.');
    }
}
