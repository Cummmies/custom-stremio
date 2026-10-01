// Newer built-ins the app (and Svelte) use, for older browsers that lack them:
// the Samsung TV's engine is about Chromium 94. Each is only added when missing.
/* eslint-disable @typescript-eslint/no-explicit-any */

const define = (target: any, name: string, value: unknown) => {
    if (!(name in target)) Object.defineProperty(target, name, { value, writable: true, configurable: true });
};

// Chromium 98. Svelte's $state.snapshot uses it. Covers what app state holds:
// plain objects and arrays, Date, Map, Set, RegExp, typed arrays, cycles.
define(globalThis, 'structuredClone', function structuredClone(value: unknown) {
    const seen = new Map<unknown, unknown>();
    const clone = (v: any): any => {
        if (v === null || typeof v !== 'object') return v;
        if (seen.has(v)) return seen.get(v);
        let out: any;
        if (v instanceof Date) out = new Date(v.getTime());
        else if (v instanceof RegExp) out = new RegExp(v.source, v.flags);
        else if (ArrayBuffer.isView(v)) out = (v as any).slice();
        else if (v instanceof ArrayBuffer) out = v.slice(0);
        else if (v instanceof Map) {
            out = new Map();
            seen.set(v, out);
            v.forEach((val, key) => out.set(clone(key), clone(val)));
            return out;
        } else if (v instanceof Set) {
            out = new Set();
            seen.set(v, out);
            v.forEach((val) => out.add(clone(val)));
            return out;
        } else if (Array.isArray(v)) {
            out = new Array(v.length);
            seen.set(v, out);
            for (let i = 0; i < v.length; i++) out[i] = clone(v[i]);
            return out;
        } else {
            out = {};
            seen.set(v, out);
            for (const key of Object.keys(v)) out[key] = clone(v[key]);
            return out;
        }
        seen.set(v, out);
        return out;
    };
    return clone(value);
});

// Chromium 97.
define(Array.prototype, 'findLast', function (this: any[], fn: (v: any, i: number, a: any[]) => unknown, self?: unknown) {
    for (let i = this.length - 1; i >= 0; i--) if (fn.call(self, this[i], i, this)) return this[i];
    return undefined;
});
define(Array.prototype, 'findLastIndex', function (this: any[], fn: (v: any, i: number, a: any[]) => unknown, self?: unknown) {
    for (let i = this.length - 1; i >= 0; i--) if (fn.call(self, this[i], i, this)) return i;
    return -1;
});

// Chromium 110.
define(Array.prototype, 'toSorted', function (this: any[], cmp?: (a: any, b: any) => number) {
    return [...this].sort(cmp);
});
define(Array.prototype, 'toReversed', function (this: any[]) {
    return [...this].reverse();
});
define(Array.prototype, 'with', function (this: any[], index: number, value: unknown) {
    const copy = [...this];
    copy[index < 0 ? copy.length + index : index] = value;
    return copy;
});

// Chromium 117 / 119.
define(Object, 'groupBy', function (items: Iterable<any>, key: (v: any, i: number) => PropertyKey) {
    const out: Record<PropertyKey, any[]> = Object.create(null);
    let i = 0;
    for (const item of items) (out[key(item, i++)] ??= []).push(item);
    return out;
});
define(Promise, 'withResolvers', function () {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
    return { promise, resolve, reject };
});

// Chromium 103.
define(AbortSignal, 'timeout', function (ms: number) {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
    return c.signal;
});

export {};
