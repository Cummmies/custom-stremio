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
// - tv-web.json: the update manifest: version, native API level, entry files
//   and every file under _app/ (what an update downloads). tv.yml adds the
//   commit the files can be fetched from.
import { readFileSync, writeFileSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, relative } from 'node:path';

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
html = html.replace(
    /<meta charset="utf-8" \/>/,
    `<meta charset="utf-8" />\n    <script>window.__tvEntry = ${JSON.stringify({ version, native, start, app, css })};</script>\n    <script src="./tv-boot.js"></script>`
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
writeFileSync(join(dir, 'tv-web.json'), JSON.stringify({ version, native, start, app, css, files }, null, 1));
console.log(`TV boot: version ${version}, native ${native}, ${files.length} files, entry ${start}`);
