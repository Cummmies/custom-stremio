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

    function load(b) {
        var links = [];
        (b.css || []).forEach(function (href) {
            var l = document.createElement('link');
            l.rel = 'stylesheet';
            l.href = b.base + href;
            document.head.appendChild(l);
            links.push(l);
        });
        return Promise.all([import(b.base + b.start), import(b.base + b.app)]).catch(function (e) {
            links.forEach(function (l) {
                l.remove();
            });
            throw e;
        });
    }

    window.__tvBoot = function () {
        if (chosen === installed) return load(installed);
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
