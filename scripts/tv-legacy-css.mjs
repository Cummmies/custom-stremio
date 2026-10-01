// @ts-nocheck: a build step, checked by building the TV app (it is plain JS like scripts/tv-boot.mjs).
// PostCSS plugin for the TV build: CSS the TV's built-in engine (Chromium 69)
// can read. Newer engines keep using the original CSS.
//
// - :where(X) → X and :is(A, B) → two selectors. Chromium 69 drops a whole rule
//   when one selector in it is unknown, and Svelte scopes every component
//   selector with :where().
// - :focus-visible → :focus (on a TV focus only ever moves by remote).
// - min() / max() / clamp() (Chromium 79): a fallback declaration first, with
//   the value worked out for the TV's screen.
// - translate / scale / rotate properties (Chromium 104, so the newer engine
//   lacks them too): rewritten as transform.
// - flex gap (Chromium 84) and aspect-ratio (Chromium 88): extra rules under
//   html.tv-legacy, which tv/boot.js sets on engines without aspect-ratio.

// The TV lays out a 1920 × 1080 screen zoomed 1.35× by default
// (src/lib/styles/tv.css); fixed values are worked out for that.
const VW = 1920 / 1.35 / 100;
const VH = 1080 / 1.35 / 100;

/** Splits on top-level commas. */
function splitTop(s) {
    const out = [];
    let depth = 0, start = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === ',' && depth === 0) {
            out.push(s.slice(start, i).trim());
            start = i + 1;
        }
    }
    out.push(s.slice(start).trim());
    return out;
}

/** Index of the parenthesis closing the one opened just before `from`. */
function closing(s, from) {
    let depth = 1;
    for (let i = from; i < s.length; i++) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')' && --depth === 0) return i;
    }
    return -1;
}

/** One selector → the selectors it stands for, without :is() / :where(). */
function expand(sel) {
    const m = /:(?:is|where|-webkit-any)\(/.exec(sel);
    if (!m) return [sel];
    const open = m.index + m[0].length;
    const end = closing(sel, open);
    if (end < 0) return [sel];
    const before = sel.slice(0, m.index);
    const after = sel.slice(end + 1);
    return splitTop(sel.slice(open, end)).flatMap((inner) => expand(before + inner + after));
}

export function legacySelector(selector) {
    const all = splitTop(selector).flatMap(expand).map((s) => s.replace(/:focus-visible\b/g, ':focus'));
    return [...new Set(all)].join(',');
}

// --- min() / max() / clamp() --------------------------------------------------

/** Evaluates a length expression to px, or null. */
function evaluate(expr) {
    let s = expr
        .replace(/var\(\s*--tv-vw\s*,\s*1vw\s*\)/g, `${VW}px`)
        .replace(/var\(\s*--tv-vh\s*,\s*1vh\s*\)/g, `${VH}px`)
        .replace(/env\([^()]*\)/g, '0px')
        .replace(/(-?[\d.]+)[dsl]?vw\b/g, (_, n) => `${n * VW}px`)
        .replace(/(-?[\d.]+)[dsl]?vh\b/g, (_, n) => `${n * VH}px`);
    // Innermost functions first.
    for (let guard = 0; guard < 50; guard++) {
        const m = /(calc|min|max|clamp|)\(([^()]*)\)/.exec(s);
        if (!m) break;
        let v;
        if (m[1] === '' || m[1] === 'calc') v = arith(m[2]);
        else {
            const args = m[2].split(',').map(arith);
            if (args.some((a) => a == null)) return null;
            v = m[1] === 'min' ? Math.min(...args) : m[1] === 'max' ? Math.max(...args) : Math.min(Math.max(args[1], args[0]), args[2]);
        }
        if (v == null) return null;
        s = s.slice(0, m.index) + `${v}px` + s.slice(m.index + m[0].length);
    }
    return arith(s);
}

/** "a + b * 2 - c" over px lengths and plain numbers → px, or null. */
function arith(s) {
    const tokens = s.trim().match(/-?[\d.]+(?:px)?|[-+*/]/g);
    if (!tokens || tokens.join('').replace(/\s/g, '') !== s.replace(/\s/g, '')) return null;
    // Tokens alternate value, operator; * and / first.
    const vals = [], ops = [];
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (i % 2 === 0) vals.push(parseFloat(t));
        else ops.push(t);
    }
    if (vals.length !== ops.length + 1 || vals.some(Number.isNaN)) return null;
    for (let i = 0; i < ops.length; ) {
        if (ops[i] === '*' || ops[i] === '/') {
            vals.splice(i, 2, ops[i] === '*' ? vals[i] * vals[i + 1] : vals[i] / vals[i + 1]);
            ops.splice(i, 1);
        } else i++;
    }
    let v = vals[0];
    for (let i = 0; i < ops.length; i++) v = ops[i] === '+' ? v + vals[i + 1] : v - vals[i + 1];
    return v;
}

const MATH = /(?<![\w-])(min|max|clamp)\(/;

/** The value with each min()/max()/clamp() replaced by a fixed length. */
function mathFallback(value) {
    let s = value;
    for (let guard = 0; guard < 20; guard++) {
        const m = MATH.exec(s);
        if (!m) return s;
        const open = m.index + m[0].length;
        const end = closing(s, open);
        if (end < 0) return null;
        const args = splitTop(s.slice(open, end));
        const px = args.map(evaluate);
        let pick;
        if (m[1] === 'clamp') {
            pick = px.every((v) => v != null) ? `${round(Math.min(Math.max(px[1], px[0]), px[2]))}px` : args[1];
        } else {
            // Percentages and the like can't be known here; on a TV screen the
            // fixed lengths are the ones that win in practice.
            const known = px.filter((v) => v != null);
            pick = known.length ? `${round(m[1] === 'min' ? Math.min(...known) : Math.max(...known))}px` : args[0];
        }
        s = s.slice(0, m.index) + pick + s.slice(end + 1);
    }
    return null;
}

const round = (v) => Math.round(v * 100) / 100;

// --- individual transforms ----------------------------------------------------

function transformOf(prop, value) {
    const v = value.trim();
    if (v === 'none') return 'none';
    const parts = v.split(/\s+/);
    if (prop === 'translate') return `translate(${parts.slice(0, 2).join(', ')})`;
    if (prop === 'scale') return `scale(${parts.slice(0, 2).join(', ')})`;
    return `rotate(${v})`;
}

// --- the plugin ---------------------------------------------------------------

export default function tvLegacyCss() {
    return {
        postcssPlugin: 'tv-legacy-css',
        OnceExit(root, { rule: newRule }) {
            /** Selector → flex direction, for rules that set gap apart from display. */
            const flex = new Map();
            /** Selector → its last gap. */
            const gaps = new Map();
            const extra = [];

            root.walkRules((rule) => {
                const inKeyframes = rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name);
                if (!inKeyframes && /:(is|where|-webkit-any)\(|:focus-visible/.test(rule.selector)) {
                    rule.selector = legacySelector(rule.selector);
                }

                // Individual transforms → one transform.
                const parts = [];
                let at = null;
                rule.each((d) => {
                    if (d.type === 'decl' && /^(translate|scale|rotate)$/.test(d.prop)) {
                        parts.push(transformOf(d.prop, d.value));
                        at ??= d;
                        if (d !== at) d.remove();
                    }
                });
                if (at) {
                    const hasTransform = rule.some((d) => d.type === 'decl' && d.prop === 'transform');
                    if (hasTransform) at.remove();
                    else {
                        const real = parts.filter((p) => p !== 'none');
                        at.replaceWith(at.clone({ prop: 'transform', value: real.length ? real.join(' ') : 'none' }));
                    }
                }

                // min() / max() / clamp() fallbacks.
                rule.each((d) => {
                    if (d.type !== 'decl' || !MATH.test(d.value)) return;
                    const fallback = mathFallback(d.value);
                    if (!fallback || fallback === d.value) return;
                    if (!d.prop.startsWith('--')) d.cloneBefore({ value: fallback });
                    else if (!inKeyframes) {
                        // A custom property takes any value, so the later one
                        // would win: the fallback goes in a rule of its own.
                        const r = newRule({
                            selector: splitTop(rule.selector)
                                .map((s) => (s === ':root' || s === 'html' ? 'html.tv-legacy' : `html.tv-legacy ${s}`))
                                .join(','),
                        });
                        r.append({ prop: d.prop, value: fallback });
                        extra.push([rule, r]);
                    }
                });

                if (inKeyframes) return;
                const decl = (prop) => {
                    let found;
                    rule.each((d) => {
                        if (d.type === 'decl' && d.prop === prop) found = d.value;
                    });
                    return found;
                };
                const selectors = splitTop(rule.selector);

                // Flex gap → margins between children.
                const display = decl('display');
                const direction = decl('flex-direction');
                for (const s of selectors) {
                    if (display) {
                        if (/flex/.test(display)) flex.set(s, direction ?? flex.get(s) ?? 'row');
                        else flex.delete(s);
                    } else if (direction && flex.has(s)) flex.set(s, direction);
                }
                const gap = decl('gap');
                if (gap || (direction && selectors.some((s) => flex.has(s)))) {
                    for (const s of selectors) {
                        if (!flex.has(s)) continue;
                        const g = gap ?? gaps.get(s);
                        if (!g) continue;
                        const [rowGap, colGap = rowGap] = splitTop(g.replace(/\s+(?![^(]*\))/g, ',')).filter(Boolean);
                        const dir = flex.get(s);
                        const column = /column/.test(dir);
                        const reverse = /reverse/.test(dir);
                        const side = column ? (reverse ? 'bottom' : 'top') : reverse ? 'right' : 'left';
                        const r = newRule({ selector: `html.tv-legacy ${s}>*+*` });
                        r.append({ prop: `margin-${side}`, value: column ? rowGap : colGap });
                        extra.push([rule, r]);
                    }
                }
                if (gap) for (const s of selectors) gaps.set(s, gap);

                // aspect-ratio → a fixed height when the width is known, else a
                // floated spacer that props the box open.
                const ratio = decl('aspect-ratio');
                if (ratio && !decl('height')) {
                    const [w, h] = ratio.split('/').map((n) => parseFloat(n));
                    if (w && h) {
                        const widthValue = decl('width');
                        const width = widthValue ? evaluate(mathFallback(widthValue) ?? '') : null;
                        const legacy = selectors.map((s) => `html.tv-legacy ${s}`);
                        if (width != null) {
                            const r = newRule({ selector: legacy.join(',') });
                            r.append({ prop: 'height', value: `${round((width * h) / w)}px` });
                            extra.push([rule, r]);
                        } else {
                            const spacer = newRule({ selector: legacy.map((s) => `${s}:before`).join(',') });
                            spacer.append(
                                { prop: 'content', value: "''" },
                                { prop: 'float', value: 'left' },
                                { prop: 'padding-top', value: `${round((h / w) * 100)}%` },
                            );
                            const clear = newRule({ selector: legacy.map((s) => `${s}:after`).join(',') });
                            clear.append({ prop: 'content', value: "''" }, { prop: 'display', value: 'table' }, { prop: 'clear', value: 'both' });
                            // Images fill the box rather than sizing it.
                            const img = newRule({ selector: legacy.map((s) => `${s}>img`).join(',') });
                            img.append({ prop: 'position', value: 'absolute' }, { prop: 'top', value: '0' }, { prop: 'left', value: '0' });
                            extra.push([rule, spacer], [rule, clear], [rule, img]);
                        }
                    }
                }
            });

            for (const [after, r] of extra.reverse()) after.after(r);
        },
    };
}
tvLegacyCss.postcss = true;
