// Addons the app installs for itself: its own Home rows (from the tracker,
// docs/lightboxd.md) and the settings sync (lib/cloudSync.svelte.ts). They're
// part of the app, not something to manage: the Addons page leaves them out,
// and the rows show without the tracker's name.

export const TRACKER_ROWS_ADDON = 'app.lightboxd.rows';
/** The rows' catalog type, which Stremio would show after their names. */
export const TRACKER_ROW_TYPE = 'Lightboxd';
const SYNC_ADDON = 'community.customstremio.sync';

export const isInternalAddon = (id: string | undefined) => id === TRACKER_ROWS_ADDON || id === SYNC_ADDON;

/** What each of the tracker's rows is, in Customize Home. */
export const TRACKER_ROW_DETAIL: Record<string, string> = {
    'lightboxd.recent': 'What you watched lately',
    'lightboxd.airing': 'What you track, airing this week',
    'lightboxd.new_seasons': 'New seasons of what you track',
    'lightboxd.for_you': 'Picked from what you like',
};
