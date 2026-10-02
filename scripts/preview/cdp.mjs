// A small Chrome DevTools Protocol client: starts a Chrome (any version from
// 69, the TV's old engine, on) and drives its one page. Node 22's WebSocket.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(exe, { port = 9300 + Math.floor(Math.random() * 500), headless = '--headless', userAgent } = {}) {
    const profile = mkdtempSync(join(tmpdir(), 'preview-chrome-'));
    const args = [
        headless,
        '--no-sandbox',
        '--disable-gpu',
        '--no-first-run',
        '--hide-scrollbars',
        '--mute-audio',
        `--remote-debugging-port=${port}`,
        '--window-size=1920,1080',
        `--user-data-dir=${profile}`,
        ...(userAgent ? [`--user-agent=${userAgent}`] : []),
        'about:blank',
    ];
    const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
    let targets = null;
    for (let i = 0; i < 100 && !targets; i++) {
        await sleep(200);
        try {
            const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
            if (list.some((t) => t.type === 'page')) targets = list;
        } catch {
            /* still starting */
        }
    }
    if (!targets) {
        proc.kill();
        throw new Error(`${exe} didn't start:\n${stderr}`);
    }
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((ok, fail) => {
        ws.addEventListener('open', ok);
        ws.addEventListener('error', fail);
    });
    let id = 0;
    const pending = new Map();
    const handlers = [];
    ws.addEventListener('message', (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id && pending.has(msg.id)) {
            const { ok, fail } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) fail(new Error(`${msg.error.message} ${msg.error.data ?? ''}`));
            else ok(msg.result);
            return;
        }
        for (const h of handlers) h(msg);
    });
    const send = (method, params = {}) =>
        new Promise((ok, fail) => {
            const i = ++id;
            pending.set(i, { ok, fail });
            ws.send(JSON.stringify({ id: i, method, params }));
        });

    const browser = {
        send,
        on: (h) => handlers.push(h),
        async eval(expression) {
            const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
            return r.result.value;
        },
        /** JPEG: a tenth of a PNG's size, for the hundreds the checks take. */
        async screenshot(format = 'jpeg') {
            const r = await send('Page.captureScreenshot', format === 'png' ? { format } : { format, quality: 82 });
            return Buffer.from(r.data, 'base64');
        },
        async key(key) {
            const codes = { ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Escape: 27 };
            for (const type of ['rawKeyDown', 'keyUp']) {
                await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: codes[key], nativeVirtualKeyCode: codes[key] });
            }
        },
        async close() {
            try {
                ws.close();
            } catch {
                /* gone */
            }
            proc.kill('SIGKILL');
            await sleep(300);
            rmSync(profile, { recursive: true, force: true });
        },
    };
    await send('Runtime.enable');
    await send('Page.enable');
    return browser;
}
