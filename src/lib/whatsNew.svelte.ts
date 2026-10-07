// What's New: the first time the app opens after an update (an over-the-air
// one included), what changed since the last time it was opened. The changes
// are the commits' subjects, built in by vite.config.js (BUILD_TIME, CHANGES).
// A first launch shows nothing; Settings > Updates shows the recent ones.

export type Change = { at: number; text: string };

const KEY = 'whatsNewSeen';
/** At most this many in one go: past it, "and more" is enough. */
const MAX = 12;

const buildTime: number = import.meta.env.BUILD_TIME ?? 0;
const changes: Change[] = import.meta.env.CHANGES ?? [];

class WhatsNew {
    open = $state(false);
    items = $state<Change[]>([]);
    /** More changed than the list shows. */
    more = $state(false);

    /** On launch: anything new since this device last opened the app. */
    start() {
        if (import.meta.env.DEV || !buildTime) return;
        let seen = 0;
        try {
            seen = Number(localStorage.getItem(KEY)) || 0;
            localStorage.setItem(KEY, String(buildTime));
        } catch {
            return;
        }
        if (!seen || seen >= buildTime) return;
        this.#show(changes.filter((c) => c.at > seen && c.at <= buildTime));
    }

    /** Settings: the latest changes, whenever. */
    showRecent() {
        this.#show(changes);
    }

    #show(list: Change[]) {
        if (!list.length) return;
        this.items = list.slice(0, MAX);
        this.more = list.length > MAX;
        this.open = true;
    }

    get available() {
        return changes.length > 0;
    }
}

export const whatsNew = new WhatsNew();
