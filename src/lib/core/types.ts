// Subset of stremio-core's model types (see stremio-web src/core/types for the full set).

export type Loadable<T> =
    | { type: 'Loading' }
    | { type: 'Ready'; content: T }
    | { type: 'Err'; content: string | { type: string; content: { code: number; message: string } } };

export type PosterShape = 'poster' | 'landscape' | 'square';

export type MetaItemPreview = {
    id: string;
    type: string;
    name: string;
    description: string | null;
    poster: string | null;
    background: string | null;
    logo: string | null;
    posterShape: PosterShape;
    releaseInfo: string | null;
    /** When it came out (an ISO date-time); Lightboxd's Airing This Week puts the air moment here. */
    released?: string | null;
    runtime?: string | null;
    imdbRating?: string | null;
    genres?: string[];
};

export type Catalog = {
    name?: string;
    type?: string;
    content: Loadable<MetaItemPreview[]> | null;
};

export type Board = {
    catalogs: Catalog[] | null;
};

export type Ctx = {
    profile: {
        auth: { key: string; user: { _id: string; email: string; avatar: string } } | null;
        settings: Settings;
        addons: import('$lib/components/addons/AddonCard.svelte').AddonDescriptor[];
    };
    /** New episodes core found, by title then episode id. */
    notifications?: { items: Record<string, Record<string, { videoReleased?: string | null }>> };
};

export type Settings = {
    streamingServerUrl: string;
    audioLanguage: string | null;
    subtitlesLanguage: string | null;
    bingeWatching: boolean;
    hardwareDecoding: boolean;
    [key: string]: unknown;
};

export type ServerStatus =
    | { state: 'starting' }
    | { state: 'ready'; url: string; source: 'external' | 'managed' }
    | { state: 'missing'; message: string }
    | { state: 'failed'; message: string };

/** A library entry as the Library and Continue Watching models send it (a slim view). */
export type LibraryItem = {
    _id: string;
    name: string;
    type: string;
    poster: string | null;
    posterShape: PosterShape;
    /** Percent watched, 0–100. */
    progress: number;
    watched?: boolean;
    /** Episodes released since you last watched (core's notifications for a series). */
    notifications?: number;
    /** Continue Watching only: the episode to resume. */
    state?: { videoId?: string | null };
    /** `player` is set when core remembers the stream you last used for it. */
    deepLinks?: { player?: string | null; metaDetailsStreams?: string | null };
};

/** The full stored library record (MetaDetails and Player models). Times are in ms. */
export type LibraryRecord = {
    _id: string;
    type: string;
    state: { timeOffset: number; duration: number; video_id: string | null };
};

export type ContinueWatchingPreview = {
    items: LibraryItem[];
};

export type Library = {
    catalog: LibraryItem[];
    selected: { request: { type: string | null; sort: string } } | null;
};

export type Link = { name: string; category: string; url: string };

export type TrailerStream = { ytId?: string; description?: string };

export type Stream = {
    name?: string;
    title?: string;
    description?: string;
    url?: string;
    ytId?: string;
    infoHash?: string;
    fileIdx?: number;
    externalUrl?: string;
    behaviorHints?: { bingeGroup?: string; filename?: string; videoSize?: number };
    deepLinks?: {
        player: string | null;
        externalPlayer: { streaming: string | null; download: string | null; playlist: string | null } | null;
    };
};

export type Video = {
    id: string;
    title: string;
    overview: string | null;
    released: string | null;
    thumbnail: string | null;
    season?: number;
    episode?: number;
    watched: boolean;
    progress: number | null;
    upcoming: boolean;
};

export type MetaItem = MetaItemPreview & {
    released: string | null;
    links: Link[];
    trailerStreams: TrailerStream[];
    videos: Video[];
    inLibrary: boolean;
    watched: boolean;
};

export type Addon = { transportUrl?: string; manifest: { id: string; name: string; logo?: string | null } };

export type MetaDetails = {
    metaItem: { addon: Addon; content: Loadable<MetaItem> } | null;
    libraryItem: LibraryRecord | null;
    selected: { metaPath: { id: string; type: string }; streamPath: { id: string } | null } | null;
    streams: { addon: Addon; content: Loadable<Stream[]> }[];
};
