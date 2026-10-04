// stremio:// addon install links, as addon websites' "Install" buttons open them.

/**
 * The manifest address a stremio:// link stands for: https, or http for an addon
 * running on this computer or the local network (which has no certificate).
 */
export function addonLinkUrl(link: string): string {
    if (!/^stremio:\/\//i.test(link)) return link;
    const rest = link.replace(/^stremio:\/\//i, '');
    const host = rest.split(/[/:?#]/)[0].toLowerCase();
    const local =
        host === 'localhost' ||
        host.endsWith('.local') ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    return `${local ? 'http' : 'https'}://${rest}`;
}

// Windows: whether you turned on "Open addon install links in this app" (Settings),
// so the app can point the link handler back at itself after an update or a move.
const KEY = 'stremio-links';

export function linkHandlingWanted(): boolean {
    try {
        return localStorage.getItem(KEY) === '1';
    } catch {
        return false;
    }
}

export function setLinkHandlingWanted(on: boolean) {
    try {
        if (on) localStorage.setItem(KEY, '1');
        else localStorage.removeItem(KEY);
    } catch {}
}
