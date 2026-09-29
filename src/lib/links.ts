// URLs for in-app navigation, and opening links outside the app.
import { openUrl as tauriOpenUrl } from '@tauri-apps/plugin-opener';

export function titleHref(type: string, id: string, params?: Record<string, string>) {
    const qs = params ? `?${new URLSearchParams(params)}` : '';
    return `/title/${encodeURIComponent(type)}/${encodeURIComponent(id)}${qs}`;
}

/** Opens a URL in the default browser / app (Tauri), or a new tab in a plain browser. */
export async function openExternal(url: string) {
    if ('__TAURI_INTERNALS__' in window) await tauriOpenUrl(url);
    else window.open(url, '_blank', 'noopener');
}
