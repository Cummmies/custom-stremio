// Artwork helpers. Catalog previews often omit backgrounds and logos; for IMDb
// ids, Stremio's own image service (metahub) has them.
import type { MetaItemPreview } from './types';

const isImdb = (id: string) => /^tt\d+$/.test(id);

export function backgroundOf(item: MetaItemPreview): string | null {
    if (item.background) return item.background;
    return isImdb(item.id) ? `https://images.metahub.space/background/medium/${item.id}/img` : null;
}

export function logoOf(item: MetaItemPreview): string | null {
    if (item.logo) return item.logo;
    return isImdb(item.id) ? `https://images.metahub.space/logo/medium/${item.id}/img` : null;
}
