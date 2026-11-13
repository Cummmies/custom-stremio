// Starts the app on the preview site (preview/README.md) as one device, with
// the sample data. Runs before tv/boot.js in the app's index.html; the app
// itself is the TV build, unchanged.
//
//   app/index.html?device=tv&size=medium#/title/series/tt9100001
//
//   device    tv | phone | tablet | desktop (default: tv)
//   size      TV screen size: small | medium | large (default: medium)
//   profiles  1: two saved profiles, so the app starts on Who's Watching
//   watching  1: a Continue Watching row (titles part-way through)
//   delay     catalogs take this long to arrive, in ms (a slow network)
//   at        player only: start this many seconds in
//
// Every load starts from the same state: what the app saved last time is
// cleared first.
//
// Plain ES2017: runs in the TV's old engine (Chromium 69) too.
(function () {
    'use strict';
    var q = new URLSearchParams(location.search);
    var device = q.get('device') || 'tv';
    var tv = device === 'tv';
    window.__preview = { device: device };

    // --- the same start every time ------------------------------------------
    try {
        localStorage.clear();
        if (tv) localStorage.setItem('tv.size', q.get('size') || 'medium');
        if (q.get('profiles') === '1') {
            localStorage.setItem('savedProfiles', JSON.stringify([
                { uid: 'preview-1', email: 'alex@example.com', key: 'preview', name: 'Alex', color: '#6d4af0', lastUsed: 2 },
                { uid: 'preview-2', email: 'sam@example.com', key: 'preview', name: 'Sam', color: '#e0457b', lastUsed: 1 },
            ]));
            localStorage.setItem('profilePrefs', JSON.stringify({ askOnLaunch: true }));
        }
        if (q.get('watching') === '1') seedLibrary();
    } catch (e) {
        /* storage blocked: the app's defaults */
    }

    /** Titles part-way through, as stremio-core stores its library. */
    function seedLibrary() {
        var F = window.PreviewFixtures;
        var items = {};
        [['movie', 2, 0.35], ['series', 1, 0.6], ['movie', 7, 0.8], ['series', 4, 0.2], ['movie', 11, 0.5]].forEach(function (t, i) {
            var p = F.preview(t[0], t[1]);
            var when = new Date(Date.UTC(2026, 8, 30 - i, 20)).toISOString();
            items[p.id] = {
                _id: p.id,
                name: p.name,
                type: p.type,
                poster: p.poster,
                posterShape: 'poster',
                removed: false,
                temp: false,
                _ctime: when,
                _mtime: when,
                state: {
                    lastWatched: when,
                    timeWatched: 1200000,
                    timeOffset: Math.round(5520000 * t[2]),
                    overallTimeWatched: 1200000,
                    timesWatched: 0,
                    flaggedWatched: 0,
                    duration: 5520000,
                    video_id: p.type === 'series' ? p.id + ':1:' + (i + 2) : p.id,
                    watched: null,
                    noNotif: false,
                },
                behaviorHints: { defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: false },
            };
        });
        // stremio-core's storage version when this was written: a newer core
        // migrates the library from it, as it would a real one.
        localStorage.setItem('schema_version', '25');
        localStorage.setItem('library_recent', JSON.stringify({ uid: null, items: items }));
        localStorage.setItem('library', JSON.stringify({ uid: null, items: {} }));
    }

    // --- the device ---------------------------------------------------------
    if (tv) {
        // The app knows a TV by its user agent (src/lib/platform.ts).
        var ua = navigator.userAgent.replace(/\)/, '; SMART-TV; Tizen 5.5)');
        try {
            Object.defineProperty(navigator, 'userAgent', { get: function () { return ua; } });
        } catch (e) {
            /* already a TV (the checks start the browser as one) */
        }
        installTizen();
        installPlayer();
        // A keyboard's Esc and Backspace are the remote's Back.
        window.addEventListener('keydown', function (e) {
            if (!e.isTrusted || (e.key !== 'Escape' && e.key !== 'Backspace')) return;
            var t = e.target;
            var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !t.readOnly && t.dataset.tvLocked === undefined;
            if (e.key === 'Backspace' && typing) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            var back = new KeyboardEvent('keydown', { key: 'XF86Back', bubbles: true, cancelable: true });
            Object.defineProperty(back, 'keyCode', { get: function () { return 10009; } });
            (document.activeElement || document.body).dispatchEvent(back);
        }, true);
    }

    // tv/boot.js makes every start a TV start; the other devices undo that
    // before the app runs.
    var tvBoot;
    Object.defineProperty(window, '__tvBoot', {
        configurable: true,
        set: function (v) { tvBoot = v; },
        get: function () {
            return function (doImport) {
                if (!tv) {
                    document.documentElement.classList.remove('tv', 'tv-legacy');
                    document.documentElement.style.removeProperty('--tv-zoom');
                }
                return serviceWorker().then(function () { return tvBoot(doImport); });
            };
        },
    });

    // --- sample data ----------------------------------------------------------
    /** The sample data's service worker (preview/sw.js) in control of the page. */
    function serviceWorker() {
        var sw = navigator.serviceWorker;
        if (!sw) return Promise.reject(new Error('This browser has no service workers: the preview can’t show its sample data.'));
        var delay = Number(q.get('delay')) || 0;
        function ready() {
            sw.controller.postMessage({ type: 'delay', ms: delay });
        }
        if (sw.controller) {
            ready();
            return Promise.resolve();
        }
        return sw.register('./sw.js').then(function () {
            return new Promise(function (resolve) {
                if (sw.controller) return resolve();
                sw.addEventListener('controllerchange', function () { resolve(); });
            });
        }).then(ready);
    }

    // --- the TV's own APIs ------------------------------------------------------
    function installTizen() {
        window.tizen = {
            tvinputdevice: { registerKey: function () {}, unregisterKey: function () {}, getSupportedKeys: function () { return []; } },
            application: { getCurrentApplication: function () { return { exit: function () { document.title = 'App closed (preview)'; } }; } },
        };
    }

    /**
     * Samsung's video player (webapis.avplay), pretend: plays a 92-minute
     * nothing and shows a still where the video would be.
     */
    function installPlayer() {
        var t = (Number(q.get('at')) || 0) * 1000;
        var state = 'NONE';
        var listener = {};
        var timer = null;
        var still = null;
        function show(on) {
            if (on && !still) {
                // The player's <object> (no plugin in a browser: a blank box).
                var o = document.getElementById('avplayer');
                if (o) o.style.visibility = 'hidden';
                still = document.createElement('div');
                still.setAttribute('style', 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:-1;background:linear-gradient(135deg,#2b3a55,#0d1117 60%,#3a2242);');
                document.body.appendChild(still);
            } else if (!on && still) {
                still.remove();
                still = null;
            }
        }
        function tick() {
            clearInterval(timer);
            timer = setInterval(function () {
                t += 500;
                if (listener.oncurrentplaytime) listener.oncurrentplaytime(t);
                if (t >= 5520000) {
                    clearInterval(timer);
                    state = 'IDLE';
                    if (listener.onstreamcompleted) listener.onstreamcompleted();
                }
            }, 500);
        }
        window.webapis = {
            avplay: {
                open: function () { state = 'IDLE'; },
                close: function () { state = 'NONE'; clearInterval(timer); show(false); },
                prepareAsync: function (ok) {
                    if (listener.onbufferingstart) listener.onbufferingstart();
                    setTimeout(function () {
                        state = 'READY';
                        show(true);
                        if (listener.onbufferingcomplete) listener.onbufferingcomplete();
                        if (ok) ok();
                    }, 300);
                },
                prepare: function () { state = 'READY'; show(true); },
                play: function () { state = 'PLAYING'; tick(); },
                pause: function () { state = 'PAUSED'; clearInterval(timer); },
                stop: function () { state = 'IDLE'; clearInterval(timer); },
                seekTo: function (ms, ok) {
                    t = ms;
                    if (ok) setTimeout(ok, 50);
                },
                jumpForward: function (ms) { t += ms; },
                jumpBackward: function (ms) { t = Math.max(0, t - ms); },
                getDuration: function () { return 5520000; },
                getCurrentTime: function () { return t; },
                getState: function () { return state; },
                setListener: function (l) { listener = l || {}; },
                setDisplayRect: function () {},
                setDisplayMethod: function () {},
                setStreamingProperty: function () {},
                getTotalTrackInfo: function () {
                    return [
                        { index: 0, type: 'AUDIO', extra_info: JSON.stringify({ language: 'eng', channels: 6 }) },
                        { index: 1, type: 'AUDIO', extra_info: JSON.stringify({ language: 'spa', channels: 2 }) },
                        { index: 2, type: 'TEXT', extra_info: JSON.stringify({ track_lang: 'eng' }) },
                    ];
                },
                getCurrentStreamInfo: function () { return []; },
                setSelectTrack: function () {},
                setSilentSubtitle: function () {},
                setSpeed: function () {},
                suspend: function () {},
                restore: function () {},
            },
        };
    }
})();
