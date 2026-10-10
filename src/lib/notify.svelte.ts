// Notifications: new episodes and movies once they're out, new seasons and
// replies to your reviews (Lightboxd's, /app-api/v1/notifications), listed
// under the bell, and shown by the system too:
//
// - PC: a Windows notification for each new one, while the app is running
//   (it looks every few minutes, and when the window comes back).
// - iPhone: the app can't be woken by a server (that needs a paid Apple
//   developer account), so it schedules a local notification for each
//   episode or movie you track, at the time it airs (the calendar's), the
//   next two weeks, redone whenever it looks. Those then aren't announced
//   again when they reach the list.
//
// Everything is per account (the Stremio account signed in). Turning system
// notifications on asks the system's permission (iPhone; Windows doesn't
// ask). An app built before the notification plugin existed shows the list
// only (`systemAvailable` is false).

import { invoke } from '@tauri-apps/api/core';
import { untrack } from 'svelte';
import { app } from '$lib/app.svelte';
import { lightboxd } from '$lib/lightboxd.svelte';
import { goto } from '$lib/nav';
import { titleHref } from '$lib/links';
import { inTauri, isIOS, isTV } from '$lib/platform';

export type NotificationKind = 'episode' | 'movie' | 'season' | 'reply';
export type AppNotification = {
    id: number;
    kind: NotificationKind;
    /** The title's name. */
    title: string;
    text: string;
    /** When it was made (server time, ISO). */
    date: string | null;
    unread: boolean;
    stremio_id: string | null;
    type: 'movie' | 'series';
    poster: string | null;
    season: number | null;
    episode: number | null;
    track: 'sub' | 'dub' | null;
};

type CalendarEvent = {
    date: string;
    datetime: string | null;
    name: string;
    id: string | null;
    type: 'movie' | 'series';
    season: number | null;
    episode: number | null;
    kind: string | null;
    track: 'sub' | 'dub' | null;
};

export type NotifyPrefs = {
    /** System notifications (the list is always there). */
    system: boolean;
    /** New episodes and movies. */
    episodes: boolean;
    seasons: boolean;
    replies: boolean;
};
const PREFS_KEY = 'notify-prefs';
const DEFAULT_PREFS: NotifyPrefs = { system: true, episodes: true, seasons: true, replies: true };

/** How often it looks while the app is open. */
const POLL_MS = 5 * 60_000;
/** More new at once than this: one notification saying so, not one each. */
const BATCH = 3;
/** iOS keeps 64 pending; the rest of the app may want a few. */
const MAX_SCHEDULED = 48;
/** A release with a date but no time is announced at this hour, that day. */
const DATE_ONLY_HOUR = 9;
const SCHEDULE_DAYS = 14;

/** What this device remembers per account: so nothing is announced twice. */
type Delivery = {
    /** The newest notification already announced (or there when it first looked). */
    seen: number | null;
    /** Scheduled releases (iPhone): their key → when (ms). */
    scheduled: Record<string, number>;
    /** The scheduled notifications' IDs, to replace them. */
    ids: number[];
};
const deliveryKey = (uid: string) => `notify:${uid}`;

function read<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
    } catch {
        return fallback;
    }
}
function write(key: string, value: unknown) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* storage full or blocked: it just may announce again */
    }
}

/** One key for a release, from the list or the calendar. */
const releaseKey = (id: string | null, season: number | null, episode: number | null) =>
    id ? (season != null && episode != null ? `${id}:${season}:${episode}` : id) : null;

/** A notification ID from a key (the plugin wants a 32-bit number). */
function idFor(key: string) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
    return Math.abs(h) || 1;
}

/** Worded as the server words its list (core/app_notifications.py). */
function releaseText(e: CalendarEvent) {
    if (e.type === 'movie' || e.season == null || e.episode == null) return 'Out now.';
    if (e.track) return `Episode ${e.episode} (${e.track === 'dub' ? 'Dub' : 'Sub'}) is out.`;
    return `Season ${e.season}, Episode ${e.episode} is out.`;
}

class Notify {
    items = $state<AppNotification[]>([]);
    unread = $state(0);
    /** The list has come back at least once (for this account). */
    loaded = $state(false);
    /** The last look failed. */
    failed = $state(false);
    prefs = $state<NotifyPrefs>(DEFAULT_PREFS);
    /** This app has the notification plugin (null: not known yet). */
    systemAvailable = $state<boolean | null>(null);
    /** The system's answer: granted, denied, or not asked yet. */
    permission = $state<'granted' | 'denied' | 'default' | null>(null);

    #uid: string | null = null;
    #started = false;
    #timer: ReturnType<typeof setInterval> | undefined;
    #busy = false;
    /** Asked to look while already looking (another account, say): looks again after. */
    #again = false;

    /** System notifications will actually show. */
    get systemOn() {
        return this.systemAvailable === true && this.prefs.system && this.permission === 'granted';
    }

    start() {
        if (this.#started || isTV) return;
        this.#started = true;
        this.prefs = read(PREFS_KEY, DEFAULT_PREFS);
        void this.#probe();
        $effect.root(() => {
            // A new account (or none): its own list; looks once connected.
            $effect(() => {
                const uid = app.user?._id ?? null;
                const ready = lightboxd.ready;
                untrack(() => {
                    if (uid !== this.#uid) {
                        this.#uid = uid;
                        this.items = [];
                        this.unread = 0;
                        this.loaded = false;
                        this.failed = false;
                    }
                    if (uid && ready) void this.refresh();
                });
            });
        });
        this.#timer = setInterval(() => document.visibilityState === 'visible' && this.refresh(), POLL_MS);
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.refresh());
        void this.#listenForTaps();
    }

    /** Whether the plugin's here, and what the system says. */
    async #probe() {
        if (!inTauri) {
            this.systemAvailable = false;
            return;
        }
        try {
            const granted = await invoke<boolean | null>('plugin:notification|is_permission_granted');
            this.systemAvailable = true;
            // null: not asked yet (Windows never asks: always granted).
            this.permission = granted === true ? 'granted' : granted === false ? 'denied' : 'default';
        } catch {
            this.systemAvailable = false;
        }
    }

    /** Asks the system (iPhone shows its prompt once; after that, only Settings can change it). */
    async askPermission(): Promise<boolean> {
        if (!this.systemAvailable) return false;
        try {
            const answer = await invoke<string>('plugin:notification|request_permission');
            this.permission = answer === 'granted' ? 'granted' : answer === 'denied' ? 'denied' : 'default';
        } catch {
            this.permission = 'denied';
        }
        if (this.permission === 'granted') void this.#schedule();
        return this.permission === 'granted';
    }

    setPrefs(change: Partial<NotifyPrefs>) {
        this.prefs = { ...this.prefs, ...change };
        write(PREFS_KEY, this.prefs);
        if (change.system && this.permission !== 'granted') void this.askPermission();
        void this.#schedule();
    }

    async refresh() {
        const uid = this.#uid;
        if (!uid || !lightboxd.ready) return;
        if (this.#busy) {
            this.#again = true;
            return;
        }
        this.#busy = true;
        try {
            const res = await lightboxd.request<{ notifications: AppNotification[]; unread: number }>('/notifications?limit=50');
            if (uid !== this.#uid) return;
            if (!res) {
                this.failed = true;
                return;
            }
            this.failed = false;
            this.items = res.notifications;
            this.unread = res.unread;
            this.loaded = true;
            this.#announce(uid, res.notifications);
            await this.#schedule();
        } finally {
            this.#busy = false;
            if (this.#again) {
                this.#again = false;
                void this.refresh();
            }
        }
    }

    #allowed(kind: NotificationKind) {
        return kind === 'episode' || kind === 'movie' ? this.prefs.episodes : kind === 'season' ? this.prefs.seasons : this.prefs.replies;
    }

    /** New ones since the last look, as system notifications. */
    #announce(uid: string, list: AppNotification[]) {
        const state = read<Delivery>(deliveryKey(uid), { seen: null, scheduled: {}, ids: [] });
        const newest = list.reduce((m, n) => Math.max(m, n.id), 0);
        // The first look on this device: what's there already isn't news.
        if (state.seen == null) {
            write(deliveryKey(uid), { ...state, seen: newest });
            return;
        }
        const now = Date.now();
        const fresh = list.filter((n) => {
            if (!n.unread || n.id <= (state.seen ?? 0) || !this.#allowed(n.kind)) return false;
            // Already announced at its air time (iPhone's schedule).
            const key = releaseKey(n.stremio_id, n.season, n.episode);
            return !(key && state.scheduled[key] && state.scheduled[key] <= now);
        });
        write(deliveryKey(uid), { ...state, seen: Math.max(state.seen, newest) });
        if (!fresh.length || !this.systemOn) return;
        void this.#show(fresh);
    }

    async #show(fresh: AppNotification[]) {
        const { sendNotification } = await import('@tauri-apps/plugin-notification');
        if (fresh.length > BATCH) {
            const names = [...new Set(fresh.map((n) => n.title))];
            const shown = names.slice(0, 2).join(', ');
            sendNotification({
                title: `${fresh.length} New Notifications`,
                body: names.length > 2 ? `${shown} and ${names.length - 2} more` : shown,
                extra: { href: '/notifications' },
            });
            return;
        }
        for (const n of fresh) {
            sendNotification({
                title: n.title,
                body: n.text,
                extra: { href: n.stremio_id ? titleHref(n.type, n.stremio_id) : '/notifications' },
            });
        }
    }

    /** iPhone: each tracked release in the next two weeks, at the time it airs. */
    async #schedule() {
        const uid = this.#uid;
        if (!isIOS || !uid || !this.systemAvailable) return;
        const state = read<Delivery>(deliveryKey(uid), { seen: null, scheduled: {}, ids: [] });
        const plugin = await import('@tauri-apps/plugin-notification').catch(() => null);
        if (!plugin) return;
        // What was scheduled before goes: what's still coming is scheduled again below.
        if (state.ids.length) await plugin.cancel(state.ids).catch(() => {});
        const now = Date.now();
        // Releases already announced stay remembered for a week (so the list doesn't announce them again).
        const kept = Object.fromEntries(Object.entries(state.scheduled).filter(([, at]) => at <= now && at > now - 7 * 86_400_000));
        if (!this.systemOn || !this.prefs.episodes) {
            write(deliveryKey(uid), { ...state, scheduled: kept, ids: [] });
            return;
        }
        const res = await lightboxd.request<{ events: CalendarEvent[] }>(`/calendar?days=${SCHEDULE_DAYS}`);
        if (!res || uid !== this.#uid) return;
        const upcoming = res.events
            .map((e) => {
                const at = e.datetime ? new Date(e.datetime) : new Date(`${e.date}T${String(DATE_ONLY_HOUR).padStart(2, '0')}:00:00`);
                return { e, at, key: releaseKey(e.id, e.season, e.episode) };
            })
            .filter((x) => x.key && !isNaN(x.at.getTime()) && x.at.getTime() > now)
            .sort((a, b) => a.at.getTime() - b.at.getTime())
            .slice(0, MAX_SCHEDULED);
        const scheduled = { ...kept };
        const ids: number[] = [];
        for (const { e, at, key } of upcoming) {
            const id = idFor(key!);
            plugin.sendNotification({
                id,
                title: e.name,
                body: releaseText(e),
                schedule: plugin.Schedule.at(at),
                extra: { href: e.id ? titleHref(e.type, e.id) : '/calendar' },
            });
            scheduled[key!] = at.getTime();
            ids.push(id);
        }
        write(deliveryKey(uid), { ...state, scheduled, ids });
    }

    /** Tapping a notification (iPhone) opens what it's about. */
    async #listenForTaps() {
        if (!isIOS || !inTauri) return;
        try {
            const { onAction } = await import('@tauri-apps/plugin-notification');
            await onAction((n) => {
                const href = (n.extra as { href?: string } | undefined)?.href;
                if (href) goto(href);
            });
        } catch {
            /* an app without the plugin */
        }
    }

    // --- The list ---

    async markRead(n: AppNotification) {
        if (!n.unread) return;
        n.unread = false;
        this.unread = Math.max(0, this.unread - 1);
        await lightboxd.request(`/notifications/${n.id}/read`, { method: 'POST' });
    }

    async markAllRead() {
        for (const n of this.items) n.unread = false;
        this.unread = 0;
        await lightboxd.request('/notifications/read', { method: 'POST' });
    }

    async dismiss(n: AppNotification) {
        this.items = this.items.filter((x) => x.id !== n.id);
        if (n.unread) this.unread = Math.max(0, this.unread - 1);
        await lightboxd.request(`/notifications/${n.id}`, { method: 'DELETE' });
    }

    async clear() {
        this.items = [];
        this.unread = 0;
        await lightboxd.request('/notifications', { method: 'DELETE' });
    }

    /** Opens what a notification is about (and marks it read). */
    open(n: AppNotification) {
        void this.markRead(n);
        if (n.stremio_id) goto(titleHref(n.type, n.stremio_id));
    }

    stop() {
        clearInterval(this.#timer);
    }
}

export const notify = new Notify();
