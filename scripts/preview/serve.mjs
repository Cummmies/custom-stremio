#!/usr/bin/env node
// Serves the preview site locally: node scripts/preview/serve.mjs [SITE_DIR] [PORT]
// Then open http://localhost:PORT/ (service workers need localhost or https).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

export function serve(dir, port = 0) {
    const root = resolve(dir);
    const server = createServer(async (req, res) => {
        let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
        let file = join(root, path);
        if (!file.startsWith(root)) return res.writeHead(403).end();
        try {
            if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
            const body = await readFile(file);
            res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
            res.end(body);
        } catch {
            res.writeHead(404).end('not found');
        }
    });
    return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const server = await serve(process.argv[2] ?? 'site', Number(process.argv[3] ?? 4173));
    console.log(`preview: http://localhost:${server.address().port}/`);
}
