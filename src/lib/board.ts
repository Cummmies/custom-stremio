// Home's rows (the core's "board": every addon catalog, CatalogsWithExtra),
// shared by the pages that show them (Home, Customize Home). Each holds it
// while it's open; it's loaded when the first takes hold and unloaded once
// none do. Going from one of them to the other, the page leaving can let go
// after the page arriving has loaded it: unloading then would leave both
// with no rows, so it waits a moment to see whether another takes hold.

import { core } from '$lib/core';

let holders = 0;
let unloadTimer: ReturnType<typeof setTimeout> | undefined;

/** Holds the board loaded; call what it returns to let go. */
export function holdBoard(): () => void {
    holders++;
    clearTimeout(unloadTimer);
    if (holders === 1) core.dispatch({ action: 'Load', args: { model: 'CatalogsWithExtra', args: { extra: [] } } }, 'board');
    let released = false;
    return () => {
        if (released) return;
        released = true;
        holders--;
        if (holders > 0) return;
        clearTimeout(unloadTimer);
        unloadTimer = setTimeout(() => {
            if (holders === 0) core.dispatch({ action: 'Unload' }, 'board');
        }, 1000);
    };
}
