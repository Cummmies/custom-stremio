// Which app this is: the desktop app (Windows), the iOS app, the Samsung TV app,
// or a plain browser (the dev server). Decides the player backend and hides what a
// platform lacks.

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** iPhone or iPad (iPadOS reports itself as a Mac, but with touch). */
export const isIOS =
    inTauri &&
    typeof navigator !== 'undefined' &&
    (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

/** The desktop app: streaming server, Discord, window modes, updater, media overlay. */
export const isDesktop = inTauri && !isIOS;

/**
 * A Samsung TV (Tizen), running the installed TV app: remote control, AVPlay,
 * no streaming server (see docs/samsung-tv.md).
 */
export const isTV = !inTauri && typeof navigator !== 'undefined' && /Tizen/i.test(navigator.userAgent);

/** Whether this app can play video at all (the plain browser dev build can't). */
export const canPlay = inTauri || isTV;
