// Sharing a link (a title, a review, a list): the system's share sheet where
// there is one (iPhone), otherwise the link is copied, and the Undo bar says so.
import { isIOS } from '$lib/platform';
import { undo } from '$lib/undo.svelte';
import { tracker } from '$lib/tracker.svelte';

export const canShareSheet = isIOS && typeof navigator !== 'undefined' && 'share' in navigator;

export async function shareLink(url: string, title: string) {
    if (canShareSheet) {
        try {
            await navigator.share({ title, url });
        } catch {
            /* closed without sharing */
        }
        return;
    }
    undo.note((await copyText(url)) ? 'Link copied.' : 'Couldn’t copy the link.');
}

/** Copies text: the Clipboard API, else the older way (a focused, selected field). */
async function copyText(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const field = Object.assign(document.createElement('textarea'), { value: text });
        field.setAttribute('readonly', '');
        field.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.append(field);
        field.select();
        const ok = document.execCommand('copy');
        field.remove();
        return ok;
    }
}

/** A title's link: your tracker's page for it (poster, Open in Stremio), else Stremio's own web page. */
export function titleLink(type: string, id: string) {
    const server = tracker.saved?.server;
    const kind = type === 'movie' ? 'movie' : 'series';
    return server ? `${server.replace(/\/$/, '')}/t/${kind}/${encodeURIComponent(id)}` : `https://web.stremio.com/#/detail/${kind}/${encodeURIComponent(id)}`;
}
