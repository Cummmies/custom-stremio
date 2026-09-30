// Customize Home: the order of Home's rows, which are hidden, their names, and
// rows merged from several catalogs. Saved per profile on this PC.
//
// Row keys:
//   "cw"                      Continue Watching
//   "cat:<addon>/<type>/<id>" one addon catalog (e.g. cat:com.linvo.cinemeta/movie/top)
//   "merge:<id>"              a merged row; its catalogs are in `merges`
// Rows the layout doesn't know yet (a new addon) are added at the end, shown.
import { app } from '$lib/app.svelte';
import type { Catalog } from '$lib/core/types';

export type RowEntry = { key: string; hidden?: boolean; name?: string };
export type Merge = { name: string; parts: string[] };
/** `dismissed`: combine suggestions the person said no to. */
type Layout = { order: RowEntry[]; merges: Record<string, Merge>; dismissed?: string[] };

export type SpecialKey = 'cw';
export const SPECIAL_NAMES: Record<SpecialKey, string> = { cw: 'Continue Watching' };

/** A catalog as the board lists it (id, type and addon come from core). */
export type BoardCatalog = Catalog & { id?: string; addon?: { manifest?: { id?: string; name?: string } } };

export const catalogKey = (c: BoardCatalog) => `cat:${c.addon?.manifest?.id ?? '?'}/${c.type ?? '?'}/${c.id ?? c.name ?? '?'}`;

/** What the Home page (and Customize Home) show, in order. */
export type ResolvedRow = {
    key: string;
    kind: 'special' | 'catalog' | 'merge';
    name: string;
    /** The name it would have without renaming. */
    defaultName: string;
    hidden: boolean;
    renamed: boolean;
    /** Catalog keys it draws from (one for a catalog row, several for a merge). */
    parts: string[];
};

const EMPTY: Layout = { order: [], merges: {} };

function storageKey(uid: string | null) {
    return `homeLayout:${uid ?? 'guest'}`;
}

function load(uid: string | null): Layout {
    try {
        const v = JSON.parse(localStorage.getItem(storageKey(uid)) ?? 'null');
        if (v && Array.isArray(v.order) && v.merges) return v;
    } catch {}
    return structuredClone(EMPTY);
}

class HomeLayout {
    #uid: string | null = null;
    layout = $state<Layout>(structuredClone(EMPTY));
    /** The layout before the last change, for Undo. */
    #undo: Layout | null = null;
    /** What Undo would undo, e.g. `Hid "Popular · Movie"`. */
    undoLabel = $state<string | null>(null);

    /** Follow the signed-in profile: each has its own Home. */
    #loaded = false;
    sync() {
        const uid = app.user?._id ?? null;
        if (this.#loaded && uid === this.#uid) return;
        this.#loaded = true;
        this.#uid = uid;
        this.layout = load(uid);
        this.#undo = null;
        this.undoLabel = null;
    }

    #save() {
        try {
            localStorage.setItem(storageKey(this.#uid), JSON.stringify(this.layout));
        } catch {}
    }

    #change(label: string, fn: (l: Layout) => void) {
        this.#undo = structuredClone($state.snapshot(this.layout));
        const next = structuredClone($state.snapshot(this.layout));
        fn(next);
        this.layout = next;
        this.undoLabel = label;
        this.#save();
    }

    undo() {
        if (!this.#undo) return;
        this.layout = this.#undo;
        this.#undo = null;
        this.undoLabel = null;
        this.#save();
    }

    dismissUndo() {
        this.undoLabel = null;
    }

    /**
     * The rows, in order: saved ones first (dropping catalogs that no longer
     * exist), then anything new. Catalogs inside a merge don't appear on their own.
     */
    resolve(catalogs: BoardCatalog[], names: Map<string, string>): ResolvedRow[] {
        const available = new Set(catalogs.map(catalogKey));
        const merges = this.layout.merges;
        const merged = new Set(Object.values(merges).flatMap((m) => m.parts));
        const rows: ResolvedRow[] = [];
        const seen = new Set<string>();

        const make = (entry: RowEntry): ResolvedRow | null => {
            const { key } = entry;
            let kind: ResolvedRow['kind'];
            let defaultName: string;
            let parts: string[] = [];
            if (key === 'cw') {
                kind = 'special';
                defaultName = SPECIAL_NAMES[key];
            } else if (key.startsWith('merge:')) {
                const m = merges[key];
                parts = (m?.parts ?? []).filter((p) => available.has(p));
                if (!m || !parts.length) return null;
                kind = 'merge';
                defaultName = m.name;
            } else {
                if (!available.has(key) || merged.has(key)) return null;
                kind = 'catalog';
                parts = [key];
                defaultName = names.get(key) ?? key;
            }
            return {
                key,
                kind,
                name: entry.name || defaultName,
                defaultName,
                hidden: !!entry.hidden,
                renamed: !!entry.name,
                parts,
            };
        };

        for (const entry of this.layout.order) {
            const row = make(entry);
            if (row && !seen.has(row.key)) {
                rows.push(row);
                seen.add(row.key);
            }
        }
        // New rows: the built-in ones first (their usual place), then catalogs in addon order.
        const fresh = ['cw', ...catalogs.map(catalogKey)].filter((k) => !seen.has(k));
        for (const key of fresh) {
            const row = make({ key });
            if (!row) continue;
            if (key === 'cw' && !this.layout.order.length) rows.unshift(row);
            else rows.push(row);
            seen.add(key);
        }
        return rows;
    }

    /** Saves the current resolved order (so later changes have something to work on). */
    #materialize(l: Layout, rows: ResolvedRow[]) {
        const byKey = new Map(l.order.map((e) => [e.key, e]));
        l.order = rows.map((r) => byKey.get(r.key) ?? { key: r.key });
    }

    move(rows: ResolvedRow[], from: number, to: number) {
        if (from === to || to < 0 || to >= rows.length) return;
        const name = rows[from].name;
        this.#change(`Moved “${name}”`, (l) => {
            this.#materialize(l, rows);
            const [e] = l.order.splice(from, 1);
            l.order.splice(to, 0, e);
        });
    }

    setHidden(rows: ResolvedRow[], key: string, hidden: boolean) {
        const row = rows.find((r) => r.key === key);
        this.#change(hidden ? `Removed “${row?.name ?? ''}” from Home` : `Added “${row?.name ?? ''}” to Home`, (l) => {
            this.#materialize(l, rows);
            const e = l.order.find((x) => x.key === key);
            if (e) e.hidden = hidden || undefined;
        });
    }

    rename(rows: ResolvedRow[], key: string, name: string) {
        const row = rows.find((r) => r.key === key);
        const clean = name.trim();
        if (!row || clean === row.name) return;
        this.#change(`Renamed “${row.name}”`, (l) => {
            this.#materialize(l, rows);
            const e = l.order.find((x) => x.key === key);
            if (!e) return;
            if (row.kind === 'merge') {
                l.merges[key].name = clean || row.defaultName;
                e.name = undefined;
            } else e.name = clean && clean !== row.defaultName ? clean : undefined;
        });
    }

    /** Merges catalog or merged rows into one, placed where the first of them was. */
    merge(rows: ResolvedRow[], keys: string[], name: string) {
        const picked = rows.filter((r) => keys.includes(r.key) && r.kind !== 'special');
        if (picked.length < 2) return;
        const id = `merge:${Date.now().toString(36)}`;
        this.#change(`Combined into “${name.trim() || picked[0].name}”`, (l) => {
            this.#materialize(l, rows);
            const parts = picked.flatMap((r) => r.parts);
            for (const r of picked) if (r.kind === 'merge') delete l.merges[r.key];
            l.merges[id] = { name: name.trim() || picked[0].name, parts };
            const at = l.order.findIndex((e) => e.key === picked[0].key);
            l.order = l.order.filter((e) => !keys.includes(e.key));
            l.order.splice(Math.max(0, Math.min(at, l.order.length)), 0, { key: id });
        });
    }

    /** Splits a merged row back into its catalogs, in its place. */
    unmerge(rows: ResolvedRow[], key: string) {
        const m = this.layout.merges[key];
        if (!m) return;
        this.#change(`Separated “${m.name}”`, (l) => {
            this.#materialize(l, rows);
            const at = l.order.findIndex((e) => e.key === key);
            const parts = l.merges[key].parts;
            delete l.merges[key];
            l.order.splice(at, 1, ...parts.map((p) => ({ key: p })));
        });
    }

    /** "Not now" on a combine suggestion: don't offer it again. */
    dismissSuggestion(id: string) {
        const next = structuredClone($state.snapshot(this.layout));
        next.dismissed = [...new Set([...(next.dismissed ?? []), id])];
        this.layout = next;
        this.#save();
    }

    isDismissed(id: string) {
        return !!this.layout.dismissed?.includes(id);
    }

    reset() {
        this.#change('Restored the default rows', (l) => {
            l.order = [];
            l.merges = {};
            l.dismissed = [];
        });
    }
}

export const homeLayout = new HomeLayout();

/** Interleaves several catalogs' titles (a, b, a, b…), without repeats. */
export function interleave<T extends { id: string }>(lists: T[][]): T[] {
    const out: T[] = [];
    const seen = new Set<string>();
    const longest = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < longest; i++) {
        for (const list of lists) {
            const item = list[i];
            if (item && !seen.has(item.id)) {
                seen.add(item.id);
                out.push(item);
            }
        }
    }
    return out;
}
