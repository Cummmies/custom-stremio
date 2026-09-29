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

export function playerHref(link: PlayerLink, url: string) {
    const p = new URLSearchParams({ stream: link.stream, url });
    if (link.streamTransportUrl) p.set('st', link.streamTransportUrl);
    if (link.metaTransportUrl) p.set('mt', link.metaTransportUrl);
    if (link.type) p.set('type', link.type);
    if (link.id) p.set('id', link.id);
    if (link.videoId) p.set('video', link.videoId);
    return `/player?${p}`;
}
