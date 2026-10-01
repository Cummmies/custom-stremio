// Starts the TV app: the installed copy, or a newer one downloaded over the air
// into the app's storage (src/lib/tv/webUpdate.ts). Runs in the installed
// index.html before SvelteKit (scripts/tv-boot.mjs puts it there), which calls
// window.__tvBoot() instead of importing its entry files itself.
//
// The page itself always stays the installed one (it keeps Samsung's APIs and
// permissions); only the app's code is imported from the downloaded copy. A
// copy that fails to load, or that loaded once and never confirmed it started,
// isn't used again.
//
// Plain ES2017: this must run on any TV.
(function () {
    'use strict';
    // The TV look and scale (src/lib/styles/tv.css) from the first frame.
    document.documentElement.classList.add('tv');
    // Engines without flex gap and aspect-ratio (Chromium 69) get stand-ins
    // for them (scripts/tv-legacy-css.mjs).
    if (!(window.CSS && CSS.supports && CSS.supports('aspect-ratio', '1 / 1'))) {
        document.documentElement.classList.add('tv-legacy');
    }

    // --- built-ins the TV's Chromium 69 lacks ------------------------------------
    // Needed while the app's modules load, so before them; the rest is in
    // src/lib/polyfills.ts.
    function define(target, name, value) {
        if (!(name in target)) Object.defineProperty(target, name, { value: value, writable: true, configurable: true });
    }
    if (typeof globalThis === 'undefined') window.globalThis = window;
    define(window, 'queueMicrotask', function (fn) {
        Promise.resolve().then(fn).catch(function (e) {
            setTimeout(function () {
                throw e;
            });
        });
    });
    define(Object, 'fromEntries', function (entries) {
        var out = {};
        Array.from(entries, function (kv) {
            out[kv[0]] = kv[1];
        });
        return out;
    });
    define(Object, 'hasOwn', function (o, k) {
        return Object.prototype.hasOwnProperty.call(o, k);
    });
    define(Promise, 'allSettled', function (items) {
        return Promise.all(Array.from(items, function (p) {
            return Promise.resolve(p).then(function (value) {
                return { status: 'fulfilled', value: value };
            }, function (reason) {
                return { status: 'rejected', reason: reason };
            });
        }));
    });
    define(Promise, 'any', function (items) {
        return new Promise(function (resolve, reject) {
            var list = Array.from(items);
            var left = list.length;
            if (!left) reject(new Error('All promises were rejected'));
            list.forEach(function (p) {
                Promise.resolve(p).then(resolve, function () {
                    if (--left === 0) reject(new Error('All promises were rejected'));
                });
            });
        });
    });
    define(String.prototype, 'replaceAll', function (search, replacement) {
        if (search instanceof RegExp) return this.replace(search, replacement);
        return this.split(search).join(typeof replacement === 'function' ? replacement(search) : replacement);
    });
    function at(i) {
        var n = Math.trunc(i) || 0;
        if (n < 0) n += this.length;
        return n < 0 || n >= this.length ? undefined : this[n];
    }
    define(Array.prototype, 'at', at);
    define(String.prototype, 'at', at);
    [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array].forEach(function (T) {
        define(T.prototype, 'at', at);
    });
    define(String.prototype, 'trimStart', String.prototype.trimLeft);
    define(String.prototype, 'trimEnd', String.prototype.trimRight);

    // --- start-up report -----------------------------------------------------
    // If the app hasn't started after a while, show what happened on screen (a
    // TV has no developer console): the steps, and any errors.
    var steps = [];
    var t0 = Date.now();
    function step(text) {
        steps.push(((Date.now() - t0) / 1000).toFixed(1) + 's  ' + text);
        if (reportEl) render();
    }
    window.__tvStep = step;
    window.addEventListener('error', function (e) {
        step('ERROR ' + (e.message || e) + (e.filename ? ' @ ' + e.filename.split('/').slice(-2).join('/') + ':' + e.lineno : ''));
    });
    window.addEventListener('unhandledrejection', function (e) {
        var r = e.reason;
        step('REJECTED ' + ((r && (r.stack || r.message)) || r));
    });
    var origError = console.error;
    console.error = function () {
        try {
            step('console.error ' + [].map.call(arguments, function (a) { return (a && (a.stack || a.message)) || String(a); }).join(' ').slice(0, 400));
        } catch (e) {
            /* never break logging */
        }
        return origError.apply(console, arguments);
    };

    var reportEl = null;
    function render() {
        reportEl.querySelector('pre').textContent = steps.join('\n');
    }
    function report(title) {
        if (reportEl || document.documentElement.getAttribute('data-started')) return;
        reportEl = document.createElement('div');
        reportEl.setAttribute('style', 'position:fixed;inset:40px;z-index:99999;background:#1b1b24;color:#eee;font:20px/1.4 sans-serif;padding:32px;border:3px solid #f87171;border-radius:16px;overflow:hidden');
        reportEl.innerHTML = '<h2 style="margin:0 0 12px;color:#f87171"></h2><pre style="white-space:pre-wrap;font:17px/1.35 monospace;margin:0 0 16px;max-height:780px;overflow:hidden"></pre>';
        reportEl.querySelector('h2').textContent = title + ' (version ' + chosen.version + (chosen === installed ? ', installed' : ', downloaded') + ')';
        var reload = document.createElement('button');
        reload.textContent = 'Reload';
        var useInstalled = document.createElement('button');
        useInstalled.textContent = 'Use Installed Version';
        [reload, useInstalled].forEach(function (b) {
            b.setAttribute('style', 'font:22px sans-serif;padding:12px 24px;margin-right:16px;border-radius:10px;border:3px solid transparent;background:#333;color:#fff');
            b.addEventListener('focus', function () { b.style.borderColor = '#fff'; });
            b.addEventListener('blur', function () { b.style.borderColor = 'transparent'; });
            reportEl.appendChild(b);
        });
        reload.onclick = function () { location.reload(); };
        useInstalled.onclick = function () {
            localStorage.removeItem('tv.bundle');
            location.reload();
        };
        document.body.appendChild(reportEl);
        render();
        reload.focus();
        document.addEventListener('keydown', function (e) {
            if (e.keyCode === 37 || e.keyCode === 39) (document.activeElement === reload ? useInstalled : reload).focus();
        });
    }
    setTimeout(function () { report('The app didn’t start'); }, 15000);
    window.__tvReport = report;

    // --- which copy to start ---------------------------------------------------
    var entry = window.__tvEntry;
    var installed = { version: entry.version, base: './', start: entry.start, app: entry.app, css: entry.css || [] };
    var chosen = installed;

    function failed(version) {
        try {
            localStorage.setItem('tv.bundle.failed', String(version));
        } catch (e) {
            /* storage full or off */
        }
    }

    try {
        var b = JSON.parse(localStorage.getItem('tv.bundle') || 'null');
        var trial = localStorage.getItem('tv.bundle.trial');
        var bad = localStorage.getItem('tv.bundle.failed');
        if (b && trial === String(b.version)) {
            // Started last time without confirming (it crashed or hung): drop it.
            failed(b.version);
            localStorage.removeItem('tv.bundle.trial');
        } else if (b && b.native <= entry.native && b.version > entry.version && String(b.version) !== bad) {
            chosen = b;
        }
    } catch (e) {
        chosen = installed;
    }

    window.__tvBundle = { version: chosen.version, downloaded: chosen !== installed };
    step('boot: version ' + chosen.version + (chosen === installed ? ' (installed)' : ' (downloaded)') + ', ' + navigator.userAgent);
    step('page: ' + location.href + '  base: ' + document.baseURI);
    // The newer engine (use.uwe in config.xml) reads ?. and class fields; the
    // TV's old one (Chromium 69) can't load the app.
    var modern = false;
    try {
        new Function('var a = null; return a?.b ?? 1; class A { #x = 1 }');
        modern = true;
    } catch (e) {
        modern = false;
    }
    step('engine: ' + (modern ? 'newer (reads ?. and class fields)' : 'OLD (no ?. or class fields): the app can’t run on it'));

    var importer = null;
    /**
     * A file of a copy as a full URL. On the TV, import() of a relative path
     * resolves against the filesystem root (file:///_app/…), not the page, so
     * everything is resolved against the page here first.
     */
    function url(b, path) {
        return new URL(b.base + path, location.href).href;
    }
    function load(b) {
        var links = [];
        function add(rel, path) {
            var l = document.createElement('link');
            l.rel = rel;
            l.href = url(b, path);
            document.head.appendChild(l);
            links.push(l);
        }
        (b.css || []).forEach(function (href) {
            add('stylesheet', href);
        });
        // As SvelteKit's own page has them: the TV fetches these reliably.
        add('modulepreload', b.start);
        add('modulepreload', b.app);
        step('importing ' + url(b, b.start));
        return Promise.all([importer(url(b, b.start)), importer(url(b, b.app))]).then(function (mods) {
            step('imported; starting SvelteKit');
            return mods;
        }, function (e) {
            step('import failed: ' + ((e && (e.stack || e.message)) || e));
            links.forEach(function (l) {
                l.remove();
            });
            throw e;
        });
    }

    /** `doImport` is import() from the page's inline script. */
    window.__tvBoot = function (doImport) {
        importer = doImport;
        if (chosen === installed) {
            return load(installed).catch(function (e) {
                report('The app couldn’t load');
                throw e;
            });
        }
        try {
            localStorage.setItem('tv.bundle.trial', String(chosen.version));
        } catch (e) {
            /* no storage: still try it */
        }
        return load(chosen).catch(function () {
            failed(chosen.version);
            localStorage.removeItem('tv.bundle.trial');
            window.__tvBundle = { version: installed.version, downloaded: false };
            return load(installed);
        });
    };
})();
