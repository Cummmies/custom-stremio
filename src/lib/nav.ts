// In-app navigation. Use `goto` from here, not '$app/navigation'.
//
// The TV app opens from a local file, so its build routes by hash
// (`#/title/…`, see svelte.config.js) and an app path like `/title/…` has to
// become `#/title/…` there. Everywhere else this is SvelteKit's own goto.
import { goto as kitGoto } from '$app/navigation';
import { isTV } from '$lib/platform';

type GotoOptions = Parameters<typeof kitGoto>[1];

/** An app path as a link target on this platform. */
export function appHref(path: string): string {
    return isTV && path.startsWith('/') ? '#' + path : path;
}

/**
 * The app's own address: path and query. On the TV the page's address is the
 * installed file and the route lives in its hash (`#/title/…?video=…`), so
 * `page.url.pathname` and `page.url.searchParams` say nothing there.
 * Use `appUrl(page.url)` for them.
 */
export function appUrl(url: URL): URL {
    if (!isTV) return url;
    const route = url.hash.replace(/^#/, '').split('#')[0] || '/';
    return new URL(route.startsWith('/') ? route : '/' + route, 'http://app.invalid');
}

export function goto(url: string | URL, opts?: GotoOptions) {
    return kitGoto(typeof url === 'string' ? appHref(url) : url, opts);
}

/**
 * TV: links to app paths (`<a href="/library">`) would leave the app under hash
 * routing, so route them here; in-page anchors (`#section`) just scroll.
 */
export function installHashLinks() {
    document.addEventListener(
        'click',
        (e) => {
            if (e.defaultPrevented || e.button) return;
            const a = (e.target as Element | null)?.closest?.('a[href]');
            if (!a || a.getAttribute('target') === '_blank') return;
            const href = a.getAttribute('href') ?? '';
            if (href.startsWith('/') && !href.startsWith('//')) {
                e.preventDefault();
                void goto(href);
            } else if (href.startsWith('#') && !href.startsWith('#/')) {
                e.preventDefault();
                document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: 'smooth' });
            }
        },
        // Before SvelteKit's own link handling.
        { capture: true }
    );
}
