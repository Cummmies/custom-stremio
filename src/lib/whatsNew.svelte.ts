// What's New: the first time the app opens after an update (an over-the-air
// one included), what changed since the last time it was opened. The changes
// are the commits' subjects, built in by vite.config.js (BUILD_TIME, CHANGES).
// A first launch shows nothing; Settings > Updates shows the recent ones.
//
// Each channel's build lists its own branch's changes, so Beta shows what's
// new in Beta ("What's New in Beta"). A change already shown in Beta isn't
// shown again when it reaches Stable: the newest change seen is kept, never
// moved back by switching to an older build.

export type Change = { at: number; text: string };

const KEY = 'whatsNewSeen';
/** At most this many in one go: past it, "and more" is enough. */
const MAX = 12;

const buildTime: number = import.meta.env.BUILD_TIME ?? 0;
const changes: Change[] = import.meta.env.CHANGES ?? [];
/** This build's update channel. */
export const channel: 'stable' | 'beta' = import.meta.env.BUILD_CHANNEL === 'beta' ? 'beta' : 'stable';

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
            localStorage.setItem(KEY, String(Math.max(seen, buildTime)));
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

    /** "What's New", or "What's New in Beta". */
    get title() {
        return channel === 'beta' ? 'What’s New in Beta' : 'What’s New';
    }

    get available() {
        return changes.length > 0;
    }
}

export const whatsNew = new WhatsNew();
