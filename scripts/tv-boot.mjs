#!/usr/bin/env node
// After the TV build (TV_BUILD=1 npm run build): makes build/ the installed TV
// app and its over-the-air update bundle.
//
//   node scripts/tv-boot.mjs build VERSION
//
// - index.html: paths relative to the file (the app opens from a local file),
//   no modulepreload links, and SvelteKit's start goes through tv/boot.js
//   (window.__tvBoot), which picks the installed or a downloaded copy.
// - tv-boot.js: tv/boot.js.
// - _app/immutable/tv/app.HASH.js: the app as one classic script. The TV's
//   built-in Chromium 69 won't run JavaScript modules from files (it wants a
//   JavaScript MIME type, and a file has none), so the TV loads this instead
//   of SvelteKit's modules. Each module's import.meta.url becomes its own
//   address (window.__tvUrl, set by tv/boot.js for the copy that starts), so
//   the core's worker and WebAssembly and each page's CSS are found as before.
// - tv-web.json: the update manifest: version, native API level, entry files
//   and every file under _app/ (what an update downloads). tv.yml adds the
//   commit the files can be fetched from.
import { readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, rmSync, renameSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { rolldown } from 'rolldown';

const [dir = 'build', versionArg] = process.argv.slice(2);
const version = Number(versionArg ?? Math.floor(Date.now() / 1000));
const native = Number(readFileSync('tv/wgt/native-api.txt', 'utf8').trim());

let html = readFileSync(join(dir, 'index.html'), 'utf8');
html = html.replace(/"\/_app\//g, '"./_app/').replace(/href="\/favicon/g, 'href="./favicon');

const start = /import\("\.\/(_app\/immutable\/entry\/start\.[^"]+\.js)"\)/.exec(html)?.[1];
const app = /import\("\.\/(_app\/immutable\/entry\/app\.[^"]+\.js)"\)/.exec(html)?.[1];
if (!start || !app) throw new Error('index.html: SvelteKit entry imports not found');

const boot = /Promise\.all\(\[\s*import\("[^"]+"\),\s*import\("[^"]+"\)\s*\]\)/;
if (!boot.test(html)) throw new Error('index.html: SvelteKit start not found');
// The import()s stay in the page's own inline script, as SvelteKit wrote them
// (what's known to load on the TV); tv/boot.js only picks the paths.
html = html.replace(boot, 'window.__tvBoot(function (url) { return import(url); })');
// Errors from SvelteKit's start show in the start-up report (tv/boot.js).
if (!html.includes('kit.start(app, element);')) throw new Error('index.html: kit.start not found');
html = html.replace(
    'kit.start(app, element);',
    "window.__tvStep('kit.start'); Promise.resolve(kit.start(app, element)).then(function () { window.__tvStep('kit started'); }, function (e) { window.__tvStep('kit.start failed: ' + (e && (e.stack || e.message) || e)); window.__tvReport('The app couldn’t start'); });"
);
html = html.replace(/[ \t]*<link href="[^"]*" rel="modulepreload">\n?/g, '');
// The first stylesheets come from whichever copy starts (tv/boot.js adds them).
const css = [...html.matchAll(/<link href="\.\/(_app\/[^"]+\.css)" rel="stylesheet">/g)].map((m) => m[1]);
html = html.replace(/[ \t]*<link href="\.\/_app\/[^"]+\.css" rel="stylesheet">\n?/g, '');
// SvelteKit's settings object (its base path), set by the page, has a name
// that changes with every build. A downloaded copy runs on the installed
// page, so the script first finds the page's object under its own name.
const kitGlobal = /(__sveltekit_[a-z0-9]+) = \{/.exec(html)?.[1];
if (!kitGlobal) throw new Error('index.html: SvelteKit settings object not found');
const script = await bundle();
html = html.replace(
    /<meta charset="utf-8" \/>/,
    `<meta charset="utf-8" />\n    <script>window.__tvEntry = ${JSON.stringify({ version, native, start, app, css, script })};</script>\n    <script src="./tv-boot.js"></script>`
);
writeFileSync(join(dir, 'index.html'), html);
copyFileSync('tv/boot.js', join(dir, 'tv-boot.js'));

function walk(d) {
    return readdirSync(d).flatMap((name) => {
        const p = join(d, name);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
}
const files = walk(join(dir, '_app')).map((p) => ({ path: relative(dir, p).split('\\').join('/'), size: statSync(p).size }));
writeFileSync(join(dir, 'tv-web.json'), JSON.stringify({ version, native, start, app, css, script, files }, null, 1));
console.log(`TV boot: version ${version}, native ${native}, ${files.length} files, entry ${start}, script ${script}`);

/** SvelteKit's entry modules and everything they import, as one classic script. */
async function bundle() {
    const root = resolve(dir);
    const entry = join(root, '_app/tv-entry.js');
    const alias = join(root, '_app/tv-alias.js');
    writeFileSync(
        alias,
        `var own = ${JSON.stringify(kitGlobal)};\nif (!window[own]) for (var k in window) if (/^__sveltekit_/.test(k) && window[k] && 'base' in window[k]) { window[own] = window[k]; break; }\n`
    );
    writeFileSync(
        entry,
        `import './tv-alias.js';\nimport * as kit from './${start.slice('_app/'.length)}';\nimport * as app from './${app.slice('_app/'.length)}';\nwindow.__tvApp = { kit, app };\n`
    );
    const out = join(root, '_app/immutable/tv/app.js');
    const b = await rolldown({
        input: entry,
        logLevel: 'warn',
        // Chromium 69 (the minifier would otherwise write ?. and the like).
        transform: { target: 'chrome69' },
        plugins: [
            {
                name: 'tv-import-meta',
                transform(code, id) {
                    // Vite preloads a page's JavaScript files as modules; here
                    // they're all in this script already, so only CSS is left.
                    code = code.replace('=>i.map(i=>d[i])', '=>i.map(i=>d[i]).filter(function(x){return /\\.css$/.test(x)})');
                    if (!code.includes('import.meta')) return code;
                    const rel = JSON.stringify(relative(root, id).split('\\').join('/'));
                    return code.replace(/import\.meta\.url/g, `window.__tvUrl(${rel})`).replace(/import\.meta\.resolve/g, '(void 0)');
                },
            },
        ],
    });
    await b.write({ file: out, format: 'iife', codeSplitting: false, minify: true });
    await b.close();
    if (readFileSync(out, 'utf8').includes('import.meta')) throw new Error('tv bundle: import.meta left in the classic script');
    const hash = createHash('sha256').update(readFileSync(out)).digest('hex').slice(0, 10);
    const name = `_app/immutable/tv/app.${hash}.js`;
    renameSync(out, join(root, name));
    // Not part of the app: only the bundle's input.
    rmSync(entry);
    rmSync(alias);
    return name;
}
