// Your statuses (Plan to Watch, Watching, Completed, Dropped) and scores, by
// Stremio ID, kept with your Stremio account (the sync addon, cloudSync's
// "mine" part) so the app still follows them when it has only Stremio to go
// on (the tracker down):
//
//   * Continue Watching leaves out what you've dropped, what you plan to watch
//     and haven't started, and what you've completed (unless a new season is
//     out: Stremio lists it for its new episodes);
//   * the Calendar leaves out what you've dropped or completed, and the bell
//     what you've dropped, as the tracker's do;
//   * a title page shows your status and score, and lets you set a status:
//     it's sent to the tracker once it's back (until then it waits here, and
//     goes with the account to your other devices).
//
// A show you drop also has Stremio's own notifications for it turned off (the
// tracker does the same from its side, core/stremio_push.py), so no Stremio
// app lists its new episodes or brings it back to Continue Watching for them.
//
// Read from the tracker (GET /backup-state) whenever it's reachable.

import { untrack } from 'svelte';
import { app } from '$lib/app.svelte';
import { core } from '$lib/core';
import { tracker } from '$lib/tracker.svelte';
import type { LibraryItem } from '$lib/core/types';
import { lb, type Status } from '$lib/tracker/api';

/** A status set while the tracker couldn't be reached, to send once it's back. */
export type PendingStatus = { status: Status; type: string; name: string; at: number };
export type Mine = {
    statuses: Record<string, Status>;
    ratings: Record<string, number>;
    pending: Record<string, PendingStatus>;
    /** What Related lists (Settings' Related Titles). */
    relatedScope?: 'all' | 'main';
};

const EMPTY: Mine = { statuses: {}, ratings: {}, pending: {} };
const key = (uid: string) => `backup-state:${uid}`;
/** Read from the tracker again at most this often (and when it comes back). */
const REFRESH_MS = 10 * 60_000;

/** Same content, same text: keys in order, so two devices with the same data agree. */
function sorted<T>(o: Record<string, T>): Record<string, T> {
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
}

class BackupState {
    mine = $state<Mine>(EMPTY);
    #uid: string | null = null;
    #lastRefresh = 0;
    #refreshing = false;
    #started = false;

    start() {
        if (this.#started) return;
        this.#started = true;
        $effect.root(() => {
            $effect(() => {
                const uid = app.user?._id ?? null;
                untrack(() => this.#switchTo(uid));
            });
            // The tracker reachable (again): what's waiting goes, and the copy here catches up.
            $effect(() => {
                if (tracker.ready) untrack(() => void this.refresh(true));
            });
        });
        const recheck = () => void this.refresh();
        window.addEventListener('focus', recheck);
    }

    #switchTo(uid: string | null) {
        if (uid === this.#uid) return;
        // Read before switching: forSync gives this profile's copy until then.
        const next = uid ? this.forSync(uid) : EMPTY;
        this.#uid = uid;
        this.#lastRefresh = 0;
        this.mine = next;
        // Another profile: its own, from the tracker (once it's checked this one).
        if (uid) queueMicrotask(() => void this.refresh(true));
    }

    #set(next: Mine) {
        const tidy: Mine = { statuses: sorted(next.statuses), ratings: sorted(next.ratings), pending: sorted(next.pending) };
        if (next.relatedScope) tidy.relatedScope = next.relatedScope;
        this.mine = tidy;
        if (!this.#uid) return;
        try {
            localStorage.setItem(key(this.#uid), JSON.stringify(tidy));
        } catch {}
    }

    /**
     * As it goes into the account (cloudSync), for that profile: reactive. Read
     * from storage when this hasn't switched to it yet, so a profile's own copy
     * isn't mistaken for a change made here.
     */
    forSync(uid: string): Mine {
        if (uid === this.#uid) return this.mine;
        try {
            const v = JSON.parse(localStorage.getItem(key(uid)) ?? 'null');
            if (v && typeof v === 'object') return { statuses: v.statuses ?? {}, ratings: v.ratings ?? {}, pending: v.pending ?? {}, ...(v.relatedScope ? { relatedScope: v.relatedScope } : {}) };
        } catch {}
        return EMPTY;
    }

    /** The account's newer copy (cloudSync). */
    applySynced(uid: string, m: Partial<Mine> | null | undefined) {
        if (!m) return;
        this.#switchTo(uid);
        this.#set({ statuses: m.statuses ?? {}, ratings: m.ratings ?? {}, pending: m.pending ?? {}, relatedScope: m.relatedScope });
    }

    statusOf(id: string): Status | null {
        return this.mine.pending[id]?.status ?? this.mine.statuses[id] ?? null;
    }

    ratingOf(id: string): number | null {
        return this.mine.ratings[id] ?? null;
    }

    /** What's waiting to be sent, then the tracker's statuses and scores. */
    async refresh(force = false) {
        const uid = this.#uid;
        if (!uid || !tracker.ready || this.#refreshing) return;
        if (!force && Date.now() - this.#lastRefresh < REFRESH_MS) return;
        this.#refreshing = true;
        try {
            await this.#sendPending(uid);
            if (uid !== this.#uid) return;
            const res = await tracker.request<{ statuses: Record<string, Status>; ratings: Record<string, number>; related_scope?: 'all' | 'main' }>(
                '/backup-state',
                { timeout: 20_000 }
            );
            if (!res || uid !== this.#uid) return;
            this.#lastRefresh = Date.now();
            this.#set({ statuses: res.statuses ?? {}, ratings: res.ratings ?? {}, pending: this.mine.pending, relatedScope: res.related_scope ?? this.mine.relatedScope });
        } finally {
            this.#refreshing = false;
            // Switched profile meanwhile: that one's turn.
            if (uid !== this.#uid) void this.refresh(true);
        }
    }

    async #sendPending(uid: string) {
        for (const [id, p] of Object.entries(this.mine.pending)) {
            const res = await lb.addToWatchlist(id, p.type, p.name);
            const titleId = res?.titles[0]?.title_id;
            const done = titleId != null && (await lb.setStatus(titleId, p.status));
            if (uid !== this.#uid || !done) return;
            const { [id]: _sent, ...rest } = this.mine.pending;
            this.#set({ ...this.mine, statuses: { ...this.mine.statuses, [id]: p.status }, pending: rest });
        }
    }

    /** A status set with the tracker there (the title page): the copy here follows at once. */
    noteStatus(id: string, status: Status | null) {
        const before = this.statusOf(id);
        const statuses = { ...this.mine.statuses };
        if (status) statuses[id] = status;
        else delete statuses[id];
        const { [id]: _was, ...pending } = this.mine.pending;
        this.#set({ ...this.mine, statuses, pending });
        this.#stremioNotifications(id, before, status);
    }

    /** A status set while the tracker can't be reached: kept, and sent once it's back. */
    setOffline(id: string, type: string, name: string, status: Status) {
        const before = this.statusOf(id);
        this.#set({ ...this.mine, pending: { ...this.mine.pending, [id]: { status, type, name, at: Date.now() } } });
        this.#stremioNotifications(id, before, status);
    }

    /** Settings' Related Titles, set with the tracker there. */
    noteRelatedScope(scope: 'all' | 'main') {
        if (this.mine.relatedScope !== scope) this.#set({ ...this.mine, relatedScope: scope });
    }

    /** A score given with the tracker there: the copy here follows at once. */
    noteRating(id: string, rating: number | null) {
        const ratings = { ...this.mine.ratings };
        if (rating == null) delete ratings[id];
        else ratings[id] = rating;
        this.#set({ ...this.mine, ratings });
    }

    /** Dropping a show turns Stremio's notifications for it off; picking it up again, back on. */
    #stremioNotifications(id: string, before: Status | null, after: Status | null) {
        if ((before === 'dropped') === (after === 'dropped')) return;
        core.dispatch({ action: 'Ctx', args: { action: 'ToggleLibraryItemNotifications', args: [id, after === 'dropped'] } });
    }

    /**
     * Continue Watching with only Stremio's to go on: not what you've dropped,
     * nor what you plan to watch and haven't started, nor what you've completed
     * (unless Stremio has it for new episodes: a new season).
     */
    filterContinue(items: LibraryItem[]): LibraryItem[] {
        return items.filter((i) => {
            const s = this.statusOf(i._id);
            if (s === 'dropped') return false;
            if (s === 'plan_to_watch') return !!i.progress;
            if (s === 'completed') return !!i.notifications;
            return true;
        });
    }

    /** The Calendar with only Stremio's: not what you've dropped or completed. */
    inCalendar(id: string): boolean {
        const s = this.statusOf(id);
        return s !== 'dropped' && s !== 'completed';
    }

    /** The bell with only Stremio's: not what you've dropped (a completed show's new season still is news). */
    notifies(id: string): boolean {
        return this.statusOf(id) !== 'dropped';
    }
}

export const backupState = new BackupState();
