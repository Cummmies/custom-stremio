#!/usr/bin/env node
// Makes the preview site (preview/README.md) from a TV build:
//
//   node scripts/preview/make-site.mjs BUILD_DIR SITE_DIR
//
// SITE_DIR/app/        the TV build as is, plus the sample data (preview/sw.js,
//                      fixtures.js) and preview/boot.js, run first.
// SITE_DIR/index.html  the device preview page (preview/index.html).
import { cpSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [build = 'build', site = 'site'] = process.argv.slice(2);
rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });
const app = join(site, 'app');
cpSync(build, app, { recursive: true });
for (const f of ['sw.js', 'fixtures.js', 'boot.js']) copyFileSync(join('preview', f), join(app, f === 'boot.js' ? 'preview-boot.js' : f));

const index = join(app, 'index.html');
let html = readFileSync(index, 'utf8');
const tvBoot = '<script src="./tv-boot.js"></script>';
if (!html.includes(tvBoot)) throw new Error('app/index.html: tv-boot.js not found (not a TV build?)');
html = html.replace(tvBoot, `<script src="./fixtures.js"></script>\n    <script src="./preview-boot.js"></script>\n    ${tvBoot}`);
writeFileSync(index, html);

copyFileSync('preview/index.html', join(site, 'index.html'));
copyFileSync('preview/screens.json', join(site, 'screens.json'));
console.log(`preview site: ${site}`);
