// Which app this is: the desktop app (Windows), the iOS app, or a plain browser
// (the dev server). Decides the player backend and hides what a platform lacks.

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** iPhone or iPad (iPadOS reports itself as a Mac, but with touch). */
export const isIOS =
    inTauri &&
    typeof navigator !== 'undefined' &&
    (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

/** The desktop app: streaming server, Discord, window modes, updater, media overlay. */
export const isDesktop = inTauri && !isIOS;
