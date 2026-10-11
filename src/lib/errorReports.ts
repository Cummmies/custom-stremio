// Error reports: when something breaks in the app (an uncaught error or a
// promise nobody handled), what broke goes to the app's server (the tracker's
// POST /app-api/v1/errors, core/error_reports.py), so the person running it
// can see and fix it. Only the error itself, where in the app (the page, no
// query), the app's version and platform: nothing about the account or what's
// being watched. Settings turns it off (on this device). A few per launch at
// most, each distinct error once.

import { tracker } from '$lib/tracker.svelte';
import { isDesktop, isIOS, isTV } from '$lib/platform';

const OFF_KEY = 'error-reports-off';
const MAX_PER_LAUNCH = 10;
/** Noise browsers report that isn't the app's to fix. */
const IGNORE = [/ResizeObserver loop/i, /^Script error\.?$/i, /AbortError/i, /Load failed$/i, /Failed to fetch$/i, /NetworkError/i];

export function errorReportsOn(): boolean {
    try {
        return localStorage.getItem(OFF_KEY) !== '1';
    } catch {
        return true;
    }
}

export function setErrorReports(on: boolean) {
    try {
        if (on) localStorage.removeItem(OFF_KEY);
        else localStorage.setItem(OFF_KEY, '1');
    } catch {
        /* stays as it was */
    }
}

const platform = isIOS ? 'ios' : isTV ? 'tv' : isDesktop ? 'windows' : 'web';
const sent = new Set<string>();

function report(error: unknown) {
    if (import.meta.env.DEV || !errorReportsOn() || sent.size >= MAX_PER_LAUNCH) return;
    const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '')).trim().slice(0, 500);
    if (!message || IGNORE.some((re) => re.test(message)) || sent.has(message)) return;
    sent.add(message);
    const server = tracker.reportsServer;
    if (!server) return;
    // The page, never its query (it can hold a search) or a hash's.
    const where = isTV ? location.hash.replace(/^#/, '').split('?')[0] || '/' : location.pathname;
    void fetch(`${server}/app-api/v1/errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message,
            detail: error instanceof Error ? (error.stack ?? '').slice(0, 4000) : null,
            location: where,
            platform,
            app_version: String(import.meta.env.BUILD_TIME ?? ''),
        }),
        keepalive: true,
    }).catch(() => {});
}

let started = false;
export function startErrorReports() {
    if (started) return;
    started = true;
    window.addEventListener('error', (e) => report(e.error ?? e.message));
    window.addEventListener('unhandledrejection', (e) => report(e.reason));
}
