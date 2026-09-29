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
    runtime?: string | null;
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
        settings: { streamingServerUrl: string };
    };
};

export type ServerStatus =
    | { state: 'starting' }
    | { state: 'ready'; url: string; source: 'external' | 'managed' }
    | { state: 'missing'; message: string }
    | { state: 'failed'; message: string };

export type LibraryItem = {
    _id: string;
    name: string;
    type: string;
    poster: string | null;
    posterShape: PosterShape;
    state: { timeOffset: number; duration: number; lastWatched: string | null };
};

export type ContinueWatchingPreview = {
    items: LibraryItem[];
};

export type Library = {
    catalog: LibraryItem[];
    selected: { request: { type: string | null; sort: string } } | null;
};
