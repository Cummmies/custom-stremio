// Stremio core gives every playable stream a deep link like
// "#/player/<stream>/<streamAddonUrl>/<metaAddonUrl>/<type>/<id>/<videoId>".
// We turn it into our own /player URL, keeping the pieces the Player model needs.

export type PlayerLink = {
    stream: string;
    streamTransportUrl: string | null;
    metaTransportUrl: string | null;
    type: string | null;
    id: string | null;
    videoId: string | null;
};

export function parsePlayerDeepLink(link: string): PlayerLink | null {
    const m = link.match(/#\/player\/(.+)$/);
    if (!m) return null;
    const [stream, st, mt, type, id, videoId] = m[1].split('/').map((p) => decodeURIComponent(p));
    if (!stream) return null;
    return {
        stream,
        streamTransportUrl: st || null,
        metaTransportUrl: mt || null,
        type: type || null,
        id: id || null,
        videoId: videoId || null,
    };
}

/** `url` is optional: the player works it out from the stream when it's missing. */
export function playerHref(link: PlayerLink, url?: string | null) {
    const p = new URLSearchParams({ stream: link.stream });
    if (url) p.set('url', url);
    if (link.streamTransportUrl) p.set('st', link.streamTransportUrl);
    if (link.metaTransportUrl) p.set('mt', link.metaTransportUrl);
    if (link.type) p.set('type', link.type);
    if (link.id) p.set('id', link.id);
    if (link.videoId) p.set('video', link.videoId);
    return `/player?${p}`;
}

/** Our /player URL for a core player deep link, or null if there isn't one. */
export function resumeHref(deepLink: string | null | undefined) {
    const link = deepLink ? parsePlayerDeepLink(deepLink) : null;
    return link ? playerHref(link) : null;
}

/** Where a stream actually plays from: its own URL, or the streaming server for torrents. */
export function streamUrl(
    stream: { url?: string; infoHash?: string; fileIdx?: number } | null,
    serverUrl: string | null | undefined
): string | null {
    if (stream?.url) return stream.url;
    if (stream?.infoHash && serverUrl) {
        const base = serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`;
        return `${base}${stream.infoHash}/${stream.fileIdx ?? -1}`;
    }
    return null;
}
