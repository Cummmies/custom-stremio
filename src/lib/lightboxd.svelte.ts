// Lightboxd: your own movie, TV and anime tracker, running on a server of
// yours (docs/lightboxd.md). Each profile connects its own Lightboxd account,
// saved on this device.
//
// Connecting is pairing: Lightboxd gives this app a code, you approve it in a
// browser where you're signed in to Lightboxd, and the app gets a token of its
// own (never your password). Lightboxd can remove it in Settings > Devices.
//
// Lightboxd is optional and may be off or asleep: every call here gives up
// after a few seconds and returns null instead of throwing, and `ready` says
// whether Lightboxd features should show at all. They hide, never error.
//
// What you watch is sent as it happens (`track`, from the player): started,
// and finished at the credits. Events wait in a queue on this device while
// Lightboxd can't be reached, and go once it's back. Lightboxd applies each one
// once, whatever the app resends, and agrees with its own Stremio sync.
//
// The address (never the token) follows the profile to its other devices
// through the Settings sync addon (cloudSync.svelte.ts, part "lightboxd"), so
// a new device only has to approve its own code. A `localhost` address means
// nothing on another device, so it isn't shared.
//
// Lightboxd's rows (Recently Watched, Airing This Week) come as a Stremio
// addon Lightboxd serves, with a read-only link of this device's own. It's
// installed on connecting, so Customize Home treats them like any other row,
// and when Lightboxd is down their catalogs fail and Home leaves them out.
import { untrack } from 'svelte';
import { app } from '$lib/app.svelte';
import { core } from '$lib/core';
import { isDesktop, isIOS, isTV } from '$lib/platform';

/** What Lightboxd's Devices list calls this one ("Windows", "iPhone", "TV"). */
const PLATFORM = isDesktop ? 'windows' : isIOS ? 'ios' : isTV ? 'tv' : 'web';
/** What Lightboxd's Settings > Connected Accounts lists this device as. */
const DEVICE_NAME = isDesktop ? 'PC' : isIOS ? 'iPhone' : isTV ? 'TV' : 'Browser';
/** The Stremio account this device is signed in to (Lightboxd groups devices by it). */
const stremioAccount = () => app.ctx?.profile.auth?.user.email ?? null;
/**
 * Where Lightboxd usually is, tried in order when no address is given. Only
 * the PC can be running it itself; a phone or TV finds it on the network.
 */
const DEFAULT_SERVERS = isDesktop ? ['http://localhost:8000', 'http://lightboxd.local:8000'] : ['http://lightboxd.local:8000'];
const TIMEOUT_MS = 4000;
const POLL_MS = 2000;
/** Checked again this often while unreachable, and on focus at most this often. */
const RETRY_MS = 60_000;

export type LightboxdUser = { name: string; handle: string | null; avatar_url: string | null };
type Saved = {
    server: string;
    /** null once Lightboxd removed this device (the server is kept for reconnecting). */
    token: string | null;
    user?: LightboxdUser;
    /** This device's addon link for the rows, once made. */
    addonUrl?: string;
    /** Whether the rows are wanted (unset until first connected). */
    rows?: boolean;
};
type AddonDescriptor = { transportUrl: string; manifest: unknown; flags: { official: boolean; protected: boolean } };
export type Status = 'off' | 'checking' | 'ok' | 'unreachable' | 'removed';
export type Pairing = {
    server: string;
    code: string;
    pairUrl: string;
    state: 'waiting' | 'denied' | 'expired';
};

export type WatchEvent = {
    kind: 'started' | 'finished';
    type: 'movie' | 'series';
    /** The title: `tt…` or `kitsu:…`. */
    id: string;
    /** A series' episode: `tt…:season:episode` or `kitsu:…:episode`. */
    video_id?: string;
    name?: string;
    /** Stremio's count for a movie (the sync's ledger uses the same number). */
    times_watched?: number;
    /** When, as an ISO time. */
    at: string;
};
export type EventResult = {
    result: 'applied' | 'unchanged' | 'unmatched';
    title_id: number | null;
    note: string;
    log_id: number | null;
    needs_rating: boolean;
};

const storageKey = (uid: string) => `lightboxd:${uid}`;
const queueKey = (uid: string) => `lightboxd-queue:${uid}`;
const sharedKey = (uid: string) => `lightboxd-shared:${uid}`;

/** An address another device could reach (not this machine's loopback). */
export function shareableServer(server: string | null | undefined): string | null {
    if (!server) return null;
    try {
        const host = new URL(server).hostname;
        return /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/i.test(host) ? null : server;
    } catch {
        return null;
    }
}
/** Older events are dropped rather than logged weeks late; so is anything past this many. */
const QUEUE_MAX_AGE_MS = 30 * 86_400_000;
const QUEUE_MAX = 200;
/** An event may wait while Lightboxd adds a new title from TMDb. */
const EVENT_TIMEOUT_MS = 30_000;

/**
 * "lightboxd.local:8000", "http://192.168.1.5:8000/" → "http://…:8000".
 * null if it isn't an address.
 */
export function normalizeServer(input: string): string | null {
    let s = input.trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
    try {
        const u = new URL(s);
        return (u.origin + u.pathname).replace(/\/+$/, '');
    } catch {
        return null;
    }
}

type Result<T> = { ok: true; data: T } | { ok: false; status: number | null };

/** `url` with its scheme, host and port taken from `server` (the path kept). */
function onServer(url: string, server: string): string | null {
    try {
        const u = new URL(url);
        const base = new URL(server.endsWith('/') ? server : `${server}/`);
        // A Lightboxd under a path (reverse proxy) keeps its prefix.
        return new URL(u.pathname.replace(/^\//, '') + u.search, base).toString();
    } catch {
        return null;
    }
}

/** An addon's manifest, or null when it can't be had from there (a few seconds at most). */
async function fetchManifest(url: string): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const r = await fetch(url, { signal: ctrl.signal });
        const m = r.ok ? await r.json() : null;
        return m && typeof m === 'object' && 'id' in m ? m : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/** One request to Lightboxd. Never throws: `status` is null when it couldn't be reached. */
async function call<T>(
    server: string,
    path: string,
    opts: { method?: string; body?: unknown; token?: string; timeout?: number } = {}
): Promise<Result<T>> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? TIMEOUT_MS);
    try {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
        if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
        const res = await fetch(`${server}/app-api/v1${path}`, {
            method: opts.method ?? 'GET',
            headers,
            body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
            signal: ctrl.signal,
        });
        if (!res.ok) return { ok: false, status: res.status };
        return { ok: true, data: (await res.json()) as T };
    } catch {
        return { ok: false, status: null };
    } finally {
        clearTimeout(timer);
    }
}

class Lightboxd {
    #uid: string | null = null;
    saved = $state<Saved | null>(null);
    status = $state<Status>('off');
    pairing = $state<Pairing | null>(null);
    /** Why the last Connect didn't get a code. */
    error = $state<string | null>(null);
    connecting = $state(false);

    /** Connected and reachable: Lightboxd features show. */
    ready = $derived(this.status === 'ok');
    /** The rows' addon is installed in this profile. */
    rowsInstalled = $derived(!!this.saved?.addonUrl && !!this.#installedRows(this.saved.addonUrl));

    /** Bumped when a profile's shared address changes, so readers of sharedServerFor re-run. */
    #sharedVersion = $state(0);

    #started = false;
    #retry: ReturnType<typeof setInterval> | undefined;
    #poll: ReturnType<typeof setTimeout> | undefined;
    #lastCheck = 0;
    /** Bumped to cancel a pairing in progress (a new one, Cancel, or another profile). */
    #pairRun = 0;
    /** This profile's watch events not yet taken by Lightboxd, oldest first. */
    #queue: WatchEvent[] = [];
    #flushing = false;
    /**
     * New episodes for anime you're watching, by your sub/dub preference:
     * {stremio id: N}, zeros included (Lightboxd has the say for those; the
     * rest keep Stremio's count, which follows the Japanese release).
     */
    newEpisodes = $state<Record<string, number>>({});

    /** The last event Lightboxd applied (for the rating prompt, Phase 4). */
    lastResult = $state<{ event: WatchEvent; result: EventResult } | null>(null);

    start() {
        if (this.#started) return;
        this.#started = true;
        $effect.root(() => {
            $effect(() => {
                const uid = app.user?._id ?? null;
                untrack(() => this.#switchTo(uid));
            });
            // Once connected and the account's addons have loaded (they can
            // arrive after the connection check): move localhost rows over.
            $effect(() => {
                if (this.status === 'ok' && this.rowsInstalled) untrack(() => this.#uid && this.#moveRowsToShared(this.#uid));
            });
        });
        const recheck = () => {
            if (Date.now() - this.#lastCheck > RETRY_MS) this.check();
        };
        window.addEventListener('focus', recheck);
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && recheck());
    }

    #switchTo(uid: string | null) {
        if (uid === this.#uid) return;
        this.#uid = uid;
        this.cancelPairing();
        this.error = null;
        this.saved = uid ? this.#load(uid) : null;
        this.#queue = uid ? this.#loadQueue(uid) : [];
        this.lastResult = null;
        this.newEpisodes = {};
        this.#rowsMoveTried = false;
        this.check();
    }

    #loadQueue(uid: string): WatchEvent[] {
        try {
            const v = JSON.parse(localStorage.getItem(queueKey(uid)) ?? '[]');
            if (Array.isArray(v)) return v;
        } catch {}
        return [];
    }

    #saveQueue() {
        const uid = this.#uid;
        if (!uid) return;
        const cutoff = Date.now() - QUEUE_MAX_AGE_MS;
        this.#queue = this.#queue.filter((e) => Date.parse(e.at) > cutoff).slice(-QUEUE_MAX);
        try {
            if (this.#queue.length) localStorage.setItem(queueKey(uid), JSON.stringify(this.#queue));
            else localStorage.removeItem(queueKey(uid));
        } catch {}
    }

    #load(uid: string): Saved | null {
        try {
            const v = JSON.parse(localStorage.getItem(storageKey(uid)) ?? 'null');
            if (v && typeof v.server === 'string') return v;
        } catch {}
        return null;
    }

    #save(next: Saved | null) {
        this.saved = next;
        const uid = this.#uid;
        if (!uid) return;
        try {
            if (next) localStorage.setItem(storageKey(uid), JSON.stringify(next));
            else localStorage.removeItem(storageKey(uid));
        } catch {}
    }

    #setStatus(s: Status) {
        this.status = s;
        clearInterval(this.#retry);
        this.#retry = undefined;
        if (s === 'unreachable') this.#retry = setInterval(() => this.check(), RETRY_MS);
        if (s === 'ok') this.#flush();
    }

    /** Is Lightboxd there, and does it still know this device? */
    async check() {
        const saved = this.saved;
        const uid = this.#uid;
        this.#lastCheck = Date.now();
        if (!saved?.token) {
            this.#setStatus(saved ? 'removed' : 'off');
            return;
        }
        if (this.status !== 'ok') this.status = 'checking';
        const res = await call<{ user: LightboxdUser }>(saved.server, '/me', { token: saved.token });
        if (uid !== this.#uid || saved !== this.saved) return; // switched meanwhile
        if (res.ok) {
            const { name, handle, avatar_url } = res.data.user;
            this.#save({ ...saved, user: { name, handle, avatar_url } });
            // Connected, and the profile has no address for its other devices yet: this one.
            const shareable = shareableServer(saved.server);
            if (uid && shareable && !this.sharedServerFor(uid)) this.setSharedServer(uid, shareable);
            this.#setStatus('ok');
            this.#reportDevice(saved);
            this.#loadNewEpisodes();
            // Just connected: the rows go on Home.
            if (this.saved?.rows === undefined) this.setRows(true);
            else if (uid) this.#moveRowsToShared(uid);
        } else if (res.status === 401) {
            this.#forgetToken();
        } else {
            this.#setStatus('unreachable');
        }
    }

    /**
     * The address this profile uses for Lightboxd, as synced between its
     * devices (null when none). Reactive. Read per profile, so the Settings
     * sync can ask about the profile it's syncing before this switches to it.
     */
    sharedServerFor(uid: string): string | null {
        void this.#sharedVersion;
        try {
            return localStorage.getItem(sharedKey(uid)) || null;
        } catch {
            return null;
        }
    }

    /** Set by connecting here, or by the Settings sync bringing another device's. */
    setSharedServer(uid: string, server: string | null) {
        if (this.sharedServerFor(uid) === server) return;
        try {
            if (server) localStorage.setItem(sharedKey(uid), server);
            else localStorage.removeItem(sharedKey(uid));
        } catch {}
        this.#sharedVersion++;
    }

    /** What Settings fills the address field with: this device's, else the profile's shared one. */
    get suggestedServer(): string | null {
        return this.saved?.server ?? (this.#uid ? this.sharedServerFor(this.#uid) : null);
    }

    async #loadNewEpisodes() {
        const uid = this.#uid;
        const res = await this.request<{ counts: Record<string, number> }>('/new-episodes');
        if (res && uid === this.#uid) this.newEpisodes = res.counts ?? {};
    }

    /** Lightboxd removed this device: keep the address for reconnecting. */
    #forgetToken() {
        this.newEpisodes = {};
        // Its addon link went with it.
        this.#uninstallRows();
        if (this.saved) this.#save({ server: this.saved.server, token: null, user: this.saved.user });
        this.#setStatus('removed');
    }

    /**
     * An authenticated request for later phases (events, calendar, title info).
     * null when not connected, unreachable, or refused.
     */
    /** What Lightboxd last heard from this device, per token (sent again only when it changes). */
    #reported = new Map<string, string>();

    /** Tells Lightboxd which Stremio account this device is on, and its name. Best effort. */
    #reportDevice(saved: { server: string; token: string | null }) {
        if (!saved.token) return;
        const body = { stremio_account: stremioAccount(), name: DEVICE_NAME };
        const key = JSON.stringify(body);
        if (this.#reported.get(saved.token) === key) return;
        this.#reported.set(saved.token, key);
        const token = saved.token;
        call(saved.server, '/device', { method: 'POST', body, token }).then((res) => {
            if (!res.ok) this.#reported.delete(token);
        });
    }

    async request<T>(path: string, opts: { method?: string; body?: unknown; timeout?: number } = {}): Promise<T | null> {
        const res = await this.#send<T>(path, opts);
        return res?.ok ? res.data : null;
    }

    /** Like request, with the failure's HTTP status; null when not connected or switched meanwhile. */
    async #send<T>(path: string, opts: { method?: string; body?: unknown; timeout?: number }): Promise<Result<T> | null> {
        const saved = this.saved;
        if (!saved?.token || this.status === 'removed') return null;
        const res = await call<T>(saved.server, path, { ...opts, token: saved.token });
        if (saved !== this.saved) return null;
        if (res.ok) {
            if (this.status !== 'ok') this.#setStatus('ok');
        } else if (res.status === 401) this.#forgetToken();
        else if (res.status === null) this.#setStatus('unreachable');
        return res;
    }

    /** Something was started or finished: tell Lightboxd now, or once it's reachable. */
    track(event: WatchEvent) {
        if (!this.saved?.token) return; // not connected: nothing to tell
        this.#queue.push(event);
        this.#saveQueue();
        this.#flush();
    }

    /**
     * Answers the rating prompt for a log Lightboxd just made: a score out of 10
     * (with your review, if you wrote one), 'later' (it waits on Lightboxd's
     * Home instead) or 'skip' (never asked again).
     * 'saved' once Lightboxd has it; 'gone' when the log no longer needs a score
     * (rated in Lightboxd, or removed, meanwhile); false when it couldn't reach it.
     */
    async answerRating(logId: number, answer: number | 'later' | 'skip', review = ''): Promise<'saved' | 'gone' | false> {
        const res =
            typeof answer === 'number'
                ? await this.#send(`/ratings/${logId}`, { method: 'POST', body: { rating: answer, ...(review.trim() && { review: review.trim() }) } })
                : await this.#send(`/ratings/${logId}/${answer}`, { method: 'POST' });
        if (!res) return false;
        return res.ok ? 'saved' : res.status === 404 ? 'gone' : false;
    }

    #installedRows(url: string): AddonDescriptor | null {
        const addons = app.ctx?.profile.addons as AddonDescriptor[] | undefined;
        return addons?.find((a) => a.transportUrl === url) ?? null;
    }

    #uninstallRows() {
        const installed = this.saved?.addonUrl ? this.#installedRows(this.saved.addonUrl) : null;
        if (installed) core.dispatch({ action: 'Ctx', args: { action: 'UninstallAddon', args: installed } });
    }

    /**
     * Puts Lightboxd's rows on Home (a fresh addon link, installed) or takes
     * them off. False when Lightboxd couldn't be reached to make the link.
     */
    async setRows(on: boolean): Promise<boolean> {
        if (!on) {
            this.#uninstallRows();
            if (this.saved) this.#save({ ...this.saved, rows: false });
            return true;
        }
        const uid = this.#uid;
        const res = await this.request<{ manifest_url: string }>('/addon', { method: 'POST' });
        if (!res || uid !== this.#uid) return false;
        // The addon is saved in the Stremio account, so every device signed in
        // to it asks this address for the rows. Connected through localhost
        // (Lightboxd on this PC), that address means nothing elsewhere: use the
        // profile's shared one instead, when it serves this account's rows.
        let url = res.manifest_url;
        let manifest: unknown = null;
        const shared = uid ? this.sharedServerFor(uid) : null;
        if (shared && !shareableServer(url)) {
            const elsewhere = onServer(url, shared);
            manifest = elsewhere ? await fetchManifest(elsewhere) : null;
            if (manifest) url = elsewhere!;
        }
        manifest ??= await fetchManifest(url);
        if (!manifest || uid !== this.#uid || !this.saved?.token) return false;
        this.#uninstallRows(); // an older link of this device's
        this.#save({ ...this.saved, addonUrl: url, rows: true });
        const addon: AddonDescriptor = { transportUrl: url, manifest, flags: { official: false, protected: false } };
        core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: addon } });
        return true;
    }

    /** Rows installed through localhost before the profile had a shared address: moved over once. */
    #rowsMoveTried = false;
    #moveRowsToShared(uid: string) {
        const url = this.saved?.addonUrl;
        if (this.#rowsMoveTried || !url || !this.rowsInstalled || shareableServer(url) || !this.sharedServerFor(uid)) return;
        this.#rowsMoveTried = true;
        this.setRows(true);
    }

    /** Sends queued events in order; stops at the first that can't be sent now. */
    async #flush() {
        if (this.#flushing || this.status !== 'ok') return;
        const uid = this.#uid;
        this.#flushing = true;
        try {
            while (this.#queue.length && uid === this.#uid && this.status === 'ok') {
                const event = this.#queue[0];
                const res = await this.#send<EventResult>('/events', { method: 'POST', body: event, timeout: EVENT_TIMEOUT_MS });
                if (uid !== this.#uid) return;
                // Unreachable, busy (a Stremio sync is running) or signed out: try again later.
                if (!res || (!res.ok && (res.status === null || res.status === 401 || res.status === 503 || res.status >= 500))) {
                    if (res && !res.ok && res.status !== null && res.status >= 500) setTimeout(() => this.#flush(), 30_000);
                    return;
                }
                // Taken, or refused as malformed (it never will be taken): either way it's done.
                this.#queue.shift();
                this.#saveQueue();
                if (res.ok && res.data.result === 'applied') {
                    this.lastResult = { event, result: res.data };
                    // Watched an episode: its show's +N goes down now, not at the next check.
                    if (event.type === 'series' && event.kind === 'finished') this.#loadNewEpisodes();
                }
            }
        } finally {
            this.#flushing = false;
        }
    }

    /**
     * Gets a pairing code from the server at `address`, or, if that's empty,
     * from the first of the usual places that answers.
     */
    async connect(address: string) {
        this.cancelPairing();
        this.error = null;
        const given = address.trim();
        const server = given ? normalizeServer(given) : null;
        if (given && !server) {
            this.error = 'That isn’t a web address.';
            return;
        }
        const run = ++this.#pairRun;
        this.connecting = true;
        type Start = { code: string; poll_secret: string; expires_in: number; pair_url: string };
        let found: { server: string; start: Start } | null = null;
        let tooMany = false;
        for (const s of server ? [server] : DEFAULT_SERVERS) {
            const res = await call<Start>(s, '/pair/start', { method: 'POST', body: { name: DEVICE_NAME, platform: PLATFORM, stremio_account: stremioAccount() } });
            if (run !== this.#pairRun) return;
            if (res.ok) {
                found = { server: s, start: res.data };
                break;
            }
            if (res.status === 429) tooMany = true;
        }
        this.connecting = false;
        if (!found) {
            this.error = tooMany
                ? 'Too many tries. Wait a few minutes and try again.'
                : server
                  ? `Couldn’t reach Lightboxd at ${server.replace(/^https?:\/\//, '')}. Check that it’s running and the address is right.`
                  : isDesktop
                  ? 'Couldn’t find Lightboxd on this PC or at lightboxd.local. Enter its address.'
                  : 'Couldn’t find Lightboxd at lightboxd.local. Enter its address.';
            return;
        }
        const { server: at, start } = found;
        this.pairing = { server: at, code: start.code, pairUrl: start.pair_url, state: 'waiting' };
        this.#pollPairing(run, at, start.poll_secret, Date.now() + start.expires_in * 1000);
    }

    #pollPairing(run: number, server: string, secret: string, expiresAt: number) {
        type Status = { state: 'pending' | 'approved' | 'denied' | 'expired'; token?: string };
        const tick = async () => {
            if (run !== this.#pairRun) return;
            if (Date.now() > expiresAt) {
                if (this.pairing) this.pairing = { ...this.pairing, state: 'expired' };
                return;
            }
            const res = await call<Status>(server, '/pair/status', { method: 'POST', body: { poll_secret: secret } });
            if (run !== this.#pairRun || !this.pairing) return;
            const state = res.ok ? res.data.state : 'pending'; // unreachable for a moment: keep waiting
            if (state === 'approved' && res.ok && res.data.token) {
                this.pairing = null;
                this.#save({ server, token: res.data.token });
                // Just paired here: the profile's other devices get this address.
                const shareable = shareableServer(server);
                if (this.#uid && shareable) this.setSharedServer(this.#uid, shareable);
                await this.check();
                return;
            }
            if (state === 'denied' || state === 'expired') {
                this.pairing = { ...this.pairing, state };
                return;
            }
            this.#poll = setTimeout(tick, POLL_MS);
        };
        this.#poll = setTimeout(tick, POLL_MS);
    }

    cancelPairing() {
        this.#pairRun++;
        clearTimeout(this.#poll);
        this.pairing = null;
        this.connecting = false;
    }

    /** Disconnect: Lightboxd forgets this device (when it's reachable), and so does this profile. */
    async disconnect() {
        const saved = this.saved;
        this.cancelPairing();
        this.#uninstallRows();
        this.newEpisodes = {};
        this.#save(null);
        this.#setStatus('off');
        if (saved?.token) await call(saved.server, '/disconnect', { method: 'POST', token: saved.token });
    }
}

export const lightboxd = new Lightboxd();
