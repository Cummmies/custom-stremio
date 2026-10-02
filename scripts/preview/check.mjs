#!/usr/bin/env node
// The preview site's checks (preview/README.md): screenshots of every screen on
// every device, and the TV remote's navigation walked screen by screen.
//
//   node scripts/preview/check.mjs SITE_DIR --tv69 PATH --tv94 PATH --chrome PATH [--only home,show]
//
// --tv69 / --tv94: Chromium 69 and 94, the two engines Samsung's TVs run the
//   app on; the TV screens are checked on each.
// --chrome: a current Chrome, for the phone, tablet and PC screens.
// Results go to SITE_DIR/report/ (results.json and the pictures), which the
// preview page shows. Exits 1 when the navigation has errors.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './cdp.mjs';
import { serve } from './serve.mjs';

const args = process.argv.slice(2);
const site = args[0] && !args[0].startsWith('--') ? args[0] : 'site';
const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? null : args[i + 1];
};
const only = opt('only')?.split(',') ?? null;
const config = JSON.parse(readFileSync(join(site, 'screens.json'), 'utf8'));
const audit = readFileSync(new URL('./audit.js', import.meta.url), 'utf8');
const out = join(site, 'report');
mkdirSync(join(out, 'shots'), { recursive: true });

const TV_UA = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) {v} TV Safari/537.36';
const engines = [
    { id: 'tv69', label: 'TV · Chromium 69 (built-in engine)', exe: opt('tv69'), headless: '--headless', ua: TV_UA.replace('{v}', '69.0.3497.106/5.5'), devices: ['tv'], nav: true },
    { id: 'tv94', label: 'TV · Chromium 94 (newer engine)', exe: opt('tv94'), headless: '--headless', ua: TV_UA.replace('{v}', '94.0.4606.31/6.5'), devices: ['tv', 'tv-small', 'tv-large'], nav: true },
    { id: 'chrome', label: 'Chrome', exe: opt('chrome'), headless: '--headless=new', devices: ['phone', 'tablet', 'desktop'] },
].filter((e) => e.exe);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await serve(site);
const base = `http://127.0.0.1:${server.address().port}/app/index.html`;
const results = {
    date: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? null,
    branch: process.env.GITHUB_REF_NAME ?? null,
    engines: engines.map(({ id, label }) => ({ id, label })),
    shots: [],
    nav: [],
    errors: [],
};
let run = 0;

for (const engine of engines) {
    const browser = await launch(engine.exe, { headless: engine.headless, userAgent: engine.ua });
    let pageErrors = [];
    browser.on((m) => {
        if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params.exceptionDetails;
            pageErrors.push((d.exception?.description ?? d.text ?? '').split('\n').slice(0, 2).join(' '));
        }
    });
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: audit });
    try {
        for (const deviceId of engine.devices) {
            const device = config.devices.find((d) => d.id === deviceId);
            await browser.send('Emulation.setDeviceMetricsOverride', {
                width: device.width,
                height: device.height,
                deviceScaleFactor: 1,
                mobile: !!device.mobile,
            });
            await browser.send('Emulation.setTouchEmulationEnabled', { enabled: !!device.mobile }).catch(() => {});
            for (const screen of config.screens) {
                if (only && !only.includes(screen.id)) continue;
                if (screen.tvOnly && !deviceId.startsWith('tv')) continue;
                pageErrors = [];
                const url = `${base}?${device.query}${screen.query ? '&' + screen.query : ''}&run=${++run}${screen.hash}`;
                const ok = await open(browser, url, screen);
                const file = `shots/${engine.id}-${deviceId}-${screen.id}.jpg`;
                writeFileSync(join(out, file), await browser.screenshot());
                results.shots.push({ engine: engine.id, device: deviceId, screen: screen.id, file });
                if (!ok) results.errors.push({ engine: engine.id, device: deviceId, screen: screen.id, message: 'The app didn’t start' });
                if (engine.nav && deviceId === 'tv' && ok && screen.nav !== false) {
                    const nav = await walk(browser, `${engine.id}-${screen.id}`);
                    results.nav.push({ engine: engine.id, screen: screen.id, ...nav });
                    console.log(`${engine.id} ${screen.id}: ${nav.moves} moves, ${nav.issues.filter((i) => i.level === 'error').length} errors, ${nav.issues.filter((i) => i.level === 'warning').length} warnings`);
                } else {
                    console.log(`${engine.id} ${deviceId} ${screen.id}: ${ok ? 'ok' : 'did not start'}`);
                }
                for (const message of new Set(pageErrors)) results.errors.push({ engine: engine.id, device: deviceId, screen: screen.id, message });
                writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
            }
        }
    } finally {
        await browser.close();
    }
}
server.close();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
const errors = results.nav.flatMap((n) => n.issues).filter((i) => i.level === 'error').length + results.errors.length;
console.log(`\n${results.shots.length} screenshots, ${errors} errors`);
process.exit(errors ? 1 : 0);

/** Opens a screen and waits until it's drawn: the app started, images loaded. */
async function open(browser, url, screen) {
    await browser.send('Page.navigate', { url });
    let started = false;
    for (let i = 0; i < 60 && !started; i++) {
        await sleep(250);
        started = await browser.eval(`document.documentElement.getAttribute('data-started') === '1'`).catch(() => false);
    }
    if (!started) return false;
    // Catalogs, then their images (a slow-network screen waits for its delay).
    const delay = Number(/delay=(\d+)/.exec(screen.query ?? '')?.[1] ?? 0);
    // (An "early" screen is walked while its catalogs are still arriving.)
    await sleep(screen.early ? 1200 : 1500 + delay * 1.5);
    // Then what the screen needs pressed (OK on a source to start the player).
    for (const step of screen.steps ?? []) {
        if (step.startsWith('wait:')) await sleep(Number(step.slice(5)));
        else {
            await browser.key(step);
            await sleep(150);
        }
    }
    for (let i = 0; i < 20; i++) {
        const done = await browser.eval(`[].every.call(document.images, function (i) { return i.complete; })`).catch(() => true);
        if (done) break;
        await sleep(250);
    }
    await sleep(400);
    return true;
}

/**
 * Walks the screen with the remote: from what has focus when it opens, presses
 * each arrow on every item reached (up to a limit) and checks each move.
 */
async function walk(browser, name) {
    const issues = [];
    const press = async (key) => {
        await browser.key(key);
        await sleep(90);
    };
    const A = (expr) => browser.eval(`window.__audit.${expr}`);
    const vp = await A('viewport()');
    const start = await A('active()');
    if (!start) issues.push({ level: 'error', kind: 'no-focus', text: 'Nothing has focus when the screen opens: the first press of the remote goes nowhere visible.' });
    else if (!start.inList) issues.push({ level: 'warning', kind: 'start-hidden', text: `Focus starts on “${start.label}”, which the remote can’t move to.` });
    else if (start.outside > 4) issues.push({ level: 'warning', kind: 'start-offscreen', text: `Focus starts on “${start.label}”, which is off the screen.` });

    const LIMIT = 45;
    const queue = start ? [start.id] : [];
    const seen = new Set(queue);
    const labels = new Map(start ? [[start.id, start.label]] : []);
    let moves = 0;
    let shots = 0;
    const DIRS = { ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right' };
    while (queue.length && seen.size <= LIMIT) {
        const id = queue.shift();
        for (const key of Object.keys(DIRS)) {
            if (!(await A(`focus(${JSON.stringify(id)})`))) break;
            await sleep(40);
            const before = await A('list()');
            const from = before.find((c) => c.id === id);
            if (!from) break;
            await press(key);
            moves++;
            let to = await A('active()');
            // A row still scrolling to it: measure where it ends up.
            if (to && to.outside > 8) {
                await sleep(450);
                to = await A('active()');
            }
            const dir = DIRS[key];
            const add = (level, kind, text) => {
                const issue = { level, kind, from: from.label, dir, to: to?.label ?? null, text };
                issues.push(issue);
                return issue;
            };
            if (!to) {
                const issue = add('error', 'lost', `${dir} from “${from.label}”: focus disappeared.`);
                if (shots++ < 6) issue.shot = await shot(browser, name, issues.length, id, null);
                continue;
            }
            if (to.id === id) continue; // the end of a row or the page: nothing to do
            labels.set(to.id, to.label);
            if (!seen.has(to.id)) {
                seen.add(to.id);
                queue.push(to.id);
            }
            const target = before.find((c) => c.id === to.id) ?? to;
            const problem = check(from, target, dir, before, vp);
            if (problem) {
                const issue = add(problem.level ?? 'error', problem.kind, problem.text);
                if (shots++ < 6) issue.shot = await shot(browser, name, issues.length, id, to.id);
            }
            if (to.outside > 8) add('warning', 'offscreen', `${dir} from “${from.label}” to “${to.label}”: it ends up ${Math.round(to.outside)}px off the screen.`);
            else if (to.covered) add('warning', 'covered', `${dir} from “${from.label}” to “${to.label}”: something is drawn over it.`);
        }
    }
    // Everything on the screen should be reachable (when the walk saw it all).
    if (seen.size <= LIMIT && start) {
        const all = await A('list()');
        const missed = all.filter((c) => !seen.has(c.id));
        for (const c of missed.slice(0, 8)) issues.push({ level: 'warning', kind: 'unreachable', from: c.label, text: `“${c.label}” can’t be reached with the arrows.` });
    }
    // The same problem from several items is one problem.
    const unique = [];
    const keys = new Set();
    for (const i of issues) {
        const k = `${i.kind}|${i.dir}|${i.to}`;
        if (i.kind !== 'unreachable' && keys.has(k)) continue;
        keys.add(k);
        unique.push(i);
    }
    return { start: start?.label ?? null, visited: seen.size, complete: seen.size <= LIMIT, moves, issues: unique };
}

/** Did a move from `a` to `b` skip something, or jump too far? */
function check(a, b, dir, all, vp) {
    const between = all.filter((c) => {
        if (c.id === a.id || c.id === b.id) return false;
        if (c.header && !a.header && !b.header) return false;
        const x = c.box;
        if (dir === 'down' || dir === 'up') {
            const [hi, lo] = dir === 'down' ? [a.box, b.box] : [b.box, a.box];
            const left = Math.min(a.box.left, b.box.left);
            const right = Math.max(a.box.right, b.box.right);
            return x.top >= hi.bottom - 2 && x.bottom <= lo.top + 2 && x.right > left + 8 && x.left < right - 8;
        }
        const [l, r] = dir === 'right' ? [a.box, b.box] : [b.box, a.box];
        const top = Math.max(a.box.top, b.box.top);
        const bottom = Math.min(a.box.bottom, b.box.bottom);
        return x.left >= l.right - 2 && x.right <= r.left + 2 && x.bottom > top + 8 && x.top < bottom - 8;
    });
    if (between.length) {
        const names = between.slice(0, 3).map((c) => `“${c.label}”`).join(', ');
        // Only small things (a row's See All) skipped: worth a look, not wrong.
        const area = (c) => c.box.width * c.box.height;
        const small = between.every((c) => area(c) < Math.min(area(a), area(b)) * 0.3);
        return { kind: 'skip', level: small ? 'warning' : 'error', text: `${dir} from “${a.label}” went to “${b.label}”, skipping ${between.length} item${between.length > 1 ? 's' : ''} in between: ${names}${between.length > 3 ? '…' : ''}` };
    }
    const gap = dir === 'down' ? b.box.top - a.box.bottom : dir === 'up' ? a.box.top - b.box.bottom : 0;
    if (gap > vp.height * 0.75) return { kind: 'jump', text: `${dir} from “${a.label}” jumped ${Math.round(gap / vp.height * 10) / 10} screens to “${b.label}”.` };
    return null;
}

async function shot(browser, name, n, fromId, toId) {
    await browser.eval(`window.__audit.mark(${JSON.stringify(fromId)}, ${JSON.stringify(toId)})`);
    await sleep(60);
    const file = `shots/nav-${name}-${n}.jpg`;
    writeFileSync(join(out, file), await browser.screenshot());
    await browser.eval('window.__audit.unmark()');
    return file;
}
