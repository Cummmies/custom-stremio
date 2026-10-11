// The server's own identifiers, as it sends them: kept exactly, since installed
// rows and saved Home layouts (and the server's network name) depend on them.
// Nothing here is ever shown. Everything else in the app calls the server "the
// tracker" (docs/tracker.md).
//
// Also: the addons the app installs for itself (its Home rows and the settings
// sync, lib/cloudSync.svelte.ts) are part of the app, not something to manage:
// the Addons page leaves them out, and the rows show by their own names.

/** The rows addon's id. */
export const TRACKER_ROWS_ADDON = 'app.lightboxd.rows';
/** The rows' catalog type, which Stremio would show after their names. */
export const TRACKER_ROW_TYPE = 'Lightboxd';
/** The rows' catalog ids. */
export const TRACKER_ROW = {
    recent: 'lightboxd.recent',
    airing: 'lightboxd.airing',
    newSeasons: 'lightboxd.new_seasons',
    forYou: 'lightboxd.for_you',
} as const;
/** The server's name on a home network (it announces itself by mDNS). */
export const TRACKER_LOCAL_HOST = 'lightboxd.local';

const SYNC_ADDON = 'community.customstremio.sync';

export const isInternalAddon = (id: string | undefined) => id === TRACKER_ROWS_ADDON || id === SYNC_ADDON;

/** What each of the tracker's rows is, in Customize Home. */
export const TRACKER_ROW_DETAIL: Record<string, string> = {
    [TRACKER_ROW.recent]: 'What you watched lately',
    [TRACKER_ROW.airing]: 'What you track, airing this week',
    [TRACKER_ROW.newSeasons]: 'New seasons of what you track',
    [TRACKER_ROW.forYou]: 'Picked from what you like',
};

/**
 * What this device and the settings sync called the tracker before it was
 * renamed: its sign-in and synced settings are read under the old name once
 * and kept under the new one, so nobody is signed out.
 */
export const NAME_BEFORE = 'lightboxd';
