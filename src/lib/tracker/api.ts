// The tracker's app API for the Library and Lists tabs and the title page
// (docs/tracker.md). Every call goes through tracker.request, so it's
// null when the tracker isn't connected, can't be reached, or refused.

import { tracker } from '$lib/tracker.svelte';

export type Status = 'plan_to_watch' | 'watching' | 'completed' | 'dropped';

export type Watch = { id: number; date: string | null; rating: number | null; review: string | null; rewatch: boolean };

export type FriendScore = {
    friend_name: string;
    friend_handle: string;
    friend_avatar: string;
    rating: number | null;
    review: string | null;
    watch_date: string | null;
};

/** What you have in the tracker for one of its titles (an anime's seasons are one each). */
export type Summary = {
    title_id: number;
    name: string;
    kind: 'movie' | 'show';
    year: string | null;
    status: Status | null;
    progress: number | null;
    episodes: number | null;
    /** Your latest watch's score and review. */
    rating: number | null;
    review: string | null;
    /** A rewatch not scored yet: your score from before. */
    earlier_rating: number | null;
    watches: number;
    last_watched: string | null;
    can_rate: boolean;
    friends: FriendScore[];
    /** Every watch, newest first. */
    log: Watch[];
    /** Your lists it's on. */
    lists: number[];
    /** The earliest a watch of it can be dated (yyyy-mm-dd). */
    earliest_watch_date: string | null;
    /** IMDb out of 10, AniList out of 100, your friends' average out of 10. */
    scores: { imdb: string | null; anilist: string | null; friends: number | null };
};

export type LibraryItem = {
    id: string;
    type: string;
    name: string;
    poster: string | null;
    year: string | null;
    title_id: number;
    status?: Status | null;
    progress?: number;
    log_id?: number;
    date?: string | null;
    rating?: number | null;
    rewatch?: boolean;
    /** Titles: how many times you've watched it. */
    watches?: number;
    /** Titles: when it went on your watchlist (or was first logged). */
    added?: string | null;
    /** Titles: every season's episodes, when known. */
    episodes?: number | null;
    anime?: boolean;
};

export type ListInfo = { id: number; name: string; description: string | null; count: number; posters: string[] };
export type ListDetail = {
    id: number;
    name: string;
    description: string | null;
    items: LibraryItem[];
    /** Its link, while it's shared with anyone who has it. */
    share_url: string | null;
};

export type AggregateReview = { author: string; source: string; body: string; rating: number | null; date: string | null; url: string | null };
export type FriendReview = { name: string; handle: string; avatar: string | null; rating: number | null; review: string | null; date: string | null };
export type Reviews = { aggregate: AggregateReview[]; friends: FriendReview[] };

export type RelatedItem = {
    id: string;
    type: string;
    name: string;
    year: string | null;
    kind: string | null;
    poster: string | null;
    status: Status | null;
    here: boolean;
};
export type RelatedGroup = { title: string; items: RelatedItem[] };

/** A title whose status or progress here differs from a backup's (from an import). */
export type BackupConflict = { title_id: number; title_name: string; imported: Record<string, unknown> };

/** One episode you've marked watched or scored (by Stremio's episode ID). */
export type EpisodeLog = { video_id: string; log_id: number; rating: number | null; review: string | null; date: string | null };

/** A watch to log or change: only what's set is sent on an edit. */
export type WatchFields = { rating?: number | null; review?: string; watch_date?: string | null };

const enc = encodeURIComponent;

export const lb = {
    titles: (id: string) => tracker.request<{ titles: Summary[] }>(`/titles/${enc(id)}`),
    /** Plan to Watch (importing it into the tracker if it isn't there yet). */
    addToWatchlist: (id: string, type: string, name: string) =>
        tracker.request<{ titles: Summary[] }>('/watchlist', { method: 'POST', body: { id, type, name }, timeout: 30_000 }),
    setStatus: (titleId: number, status: Status) =>
        tracker.request<{ title: Summary }>(`/titles/${titleId}/status`, { method: 'POST', body: { status } }),
    remove: (titleId: number) => tracker.request<{ status: string }>(`/titles/${titleId}`, { method: 'DELETE' }),
    addWatch: (titleId: number, fields: WatchFields) =>
        tracker.request<{ title: Summary }>(`/titles/${titleId}/watches`, { method: 'POST', body: fields }),
    editWatch: (logId: number, fields: WatchFields) =>
        tracker.request<{ title: Summary }>(`/watches/${logId}`, { method: 'PUT', body: fields }),
    deleteWatch: (logId: number) => tracker.request<{ title: Summary }>(`/watches/${logId}`, { method: 'DELETE' }),
    /** What you're watching and what's next, and what you've finished (for Continue Watching). */
    continueWatching: () => tracker.request<import('$lib/continueWatching').TrackerContinue>('/continue'),
    /** A show's episodes you've marked watched or scored. */
    episodes: (id: string) => tracker.request<{ episodes: EpisodeLog[] }>(`/episodes?id=${enc(id)}`),
    /** Marks an episode watched (counting it) and sets what's in `fields`. */
    logEpisode: (id: string, videoId: string, name: string, fields: WatchFields = {}) =>
        tracker.request<{ episode: EpisodeLog }>('/episodes', { method: 'POST', body: { id, video_id: videoId, name, ...fields }, timeout: 30_000 }),
    removeEpisode: (logId: number) => tracker.request<{ status: string }>(`/episodes/${logId}`, { method: 'DELETE' }),
    reviews: (titleId: number) => tracker.request<Reviews>(`/titles/${titleId}/reviews`, { timeout: 30_000 }),
    related: (titleId: number) => tracker.request<{ groups: RelatedGroup[] }>(`/titles/${titleId}/related`, { timeout: 30_000 }),

    /** A Library section; Titles can be just one status. */
    library: (section: 'titles' | 'watched' | 'ratings', status?: Status | null) =>
        tracker.request<{ items: LibraryItem[] }>(`/library?section=${section}${status ? `&status=${status}` : ''}`),
    lists: () => tracker.request<{ lists: ListInfo[] }>('/lists'),
    list: (listId: number) => tracker.request<ListDetail>(`/lists/${listId}`),
    newList: (name: string) => tracker.request<ListInfo>('/lists', { method: 'POST', body: { name } }),
    addToList: (listId: number, id: string, type: string, name: string) =>
        tracker.request<{ title: Summary }>(`/lists/${listId}/titles`, { method: 'POST', body: { id, type, name }, timeout: 30_000 }),
    /** A link anyone can open to see the list (the same one each time, until sharing stops). */
    shareList: (listId: number) => tracker.request<{ share_url: string }>(`/lists/${listId}/share`, { method: 'POST' }),
    unshareList: (listId: number) => tracker.request<{ share_url: null }>(`/lists/${listId}/share`, { method: 'DELETE' }),
    removeFromList: (listId: number, titleId: number) =>
        tracker.request<{ title: Summary }>(`/lists/${listId}/titles/${titleId}`, { method: 'DELETE' }),

    /** Your data as a backup file's contents. */
    backup: () => tracker.request<Record<string, unknown>>('/backup', { timeout: 60_000 }),
    /** Adds what's in a backup; what clashes comes back, for resolveBackup. */
    importBackup: (contents: unknown) =>
        tracker.request<{ applied_count: number; conflicts: BackupConflict[] }>('/backup/import', { method: 'POST', body: contents, timeout: 120_000 }),
    /** One choice for every clash: keep what's here, or use the backup's. */
    resolveBackup: (decision: 'keep_local' | 'use_imported', conflicts: BackupConflict[]) =>
        tracker.request<{ resolved_count: number }>('/backup/resolve', { method: 'POST', body: { decision, conflicts }, timeout: 120_000 }),
};

// --- Wording, shared by the screens ---------------------------------------------

export const STATUS_LABEL: Record<Status, string> = {
    plan_to_watch: 'Plan to Watch',
    watching: 'Watching',
    completed: 'Completed',
    dropped: 'Dropped',
};

/** How a status reads under a poster. */
export const STATUS_SHORT: Record<Status, string> = {
    plan_to_watch: 'On Watchlist',
    watching: 'Watching',
    completed: 'Watched',
    dropped: 'Dropped',
};

/** 8 stays 8, 8.5 stays 8.5 (the tracker scores in tenths). */
export const score = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** "Sep 30, 2026" for a yyyy-mm-dd (read as that calendar day, here). */
export function day(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }) {
    if (!iso) return null;
    const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
    return isNaN(d.getTime()) ? null : d.toLocaleDateString([], opts);
}

/** Today in this device's time zone, yyyy-mm-dd. */
export function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
