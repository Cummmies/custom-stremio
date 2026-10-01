// Custom Stremio TV test. Written for old Chromium (Tizen 5.5 = Chromium 69):
// no optional chaining, no ??, no class fields. Newer syntax is only tested
// inside new Function(...), where a failure can't break this file.
(function () {
    'use strict';

    // --- where files are ---------------------------------------------------------
    // Under TizenBrew the page is http://127.0.0.1:8081/module/<gh%2F...>/app/index.html;
    // jsDelivr serves the same files directly (with Range requests and CORS).
    // In the test app (.wgt) the page is a local file, or served by our own
    // service on 127.0.0.1:8090; the media then comes from jsDelivr too.
    var JSD_APP = 'https://cdn.jsdelivr.net/gh/Cummmies/custom-stremio/tv/app/';
    var moduleMatch = location.pathname.match(/\/module\/([^/]+)\/(.*\/)?[^/]*$/);
    var packaged = location.protocol === 'file:';
    var servedByUs = location.host === '127.0.0.1:8090' || location.host === '127.0.0.1:8091';
    // A copy of this page in the app's own storage (button 8), not the installed files.
    var fromStorage = packaged && location.pathname.indexOf('/res/wgt/') < 0;
    var CDN_BASE = moduleMatch
        ? 'https://cdn.jsdelivr.net/' + decodeURIComponent(moduleMatch[1]) + '/' + (moduleMatch[2] || '')
        : packaged || servedByUs ? JSD_APP : new URL('./', location.href).href;
    var CORE_WASM = 'https://cdn.jsdelivr.net/npm/@stremio/stremio-core-web@0.63.2/stremio_core_web_bg.wasm';
    var SERVICE = 'http://127.0.0.1:8090';
    var SERVICE_ALT = 'http://127.0.0.1:8091';

    // --- results -----------------------------------------------------------------
    var cols = document.getElementById('cols');
    var sections = {};
    var pass = 0, fail = 0;

    function section(title) {
        if (sections[title]) return sections[title];
        var s = document.createElement('section');
        var h = document.createElement('h2');
        h.textContent = title;
        s.appendChild(h);
        cols.appendChild(s);
        sections[title] = s;
        return s;
    }

    /** value: true/false → ✓/✗, string → shown as is. cls overrides the color. */
    function row(title, key, value, cls) {
        var s = section(title);
        var r = document.createElement('div');
        r.className = 'row';
        var k = document.createElement('span');
        k.className = 'k';
        k.textContent = key;
        var v = document.createElement('span');
        v.className = 'v';
        if (value === true) { v.textContent = '✓'; v.className += ' ok'; pass++; }
        else if (value === false) { v.textContent = '✗'; v.className += ' no'; fail++; }
        else { v.textContent = String(value); if (cls) v.className += ' ' + cls; }
        r.appendChild(k);
        r.appendChild(v);
        s.appendChild(r);
        updateSummary();
        return v;
    }

    function setRow(v, value, cls) {
        v.className = 'v';
        if (value === true) { v.textContent = '✓'; v.className += ' ok'; pass++; }
        else if (value === false) { v.textContent = '✗'; v.className += ' no'; fail++; }
        else { v.textContent = String(value); if (cls) v.className += ' ' + cls; }
        updateSummary();
    }

    function updateSummary() {
        document.getElementById('summary').textContent = pass + ' ✓  ' + fail + ' ✗';
    }

    var logEl = document.getElementById('log');
    function log(msg) {
        var line = new Date().toTimeString().slice(0, 8) + '  ' + msg;
        logEl.textContent = (line + '\n' + logEl.textContent).slice(0, 3000);
    }
    window.addEventListener('error', function (e) { log('JS error: ' + e.message); });

    function syntax(src) {
        try { new Function(src); return true; } catch (e) { return false; }
    }
    function run(fn) {
        try { return !!fn(); } catch (e) { return false; }
    }
    function timeout(ms) {
        return new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, ms); });
    }
    function short(e) {
        return String((e && e.message) || e).slice(0, 60);
    }

    // --- device --------------------------------------------------------------------
    var ua = navigator.userAgent;
    var chrome = (ua.match(/Chrome\/(\d+)/) || [])[1];
    var tizenVer = (ua.match(/Tizen (\d+(\.\d+)?)/) || [])[1];
    row('Device', 'Chromium', chrome || '?', chrome && +chrome >= 85 ? 'ok' : 'warn');
    row('Device', 'Tizen (from UA)', tizenVer || '?');
    row('Device', 'Screen', screen.width + '×' + screen.height + ' @' + window.devicePixelRatio);
    row('Device', 'Window', window.innerWidth + '×' + window.innerHeight);
    row('Device', 'Running as', moduleMatch ? 'TizenBrew module' : fromStorage ? 'App, page from storage' : packaged ? 'Installed app' : servedByUs ? 'App, page from service' : 'Browser', 'ok');
    row('Device', 'Memory (deviceMemory)', navigator.deviceMemory ? navigator.deviceMemory + ' GB' : 'n/a', 'dim');
    row('Device', 'CPU threads', navigator.hardwareConcurrency || 'n/a', 'dim');

    // --- Samsung APIs ------------------------------------------------------------
    var hasTizen = typeof window.tizen !== 'undefined';
    var hasWebapis = typeof window.webapis !== 'undefined';
    row('Samsung APIs', 'tizen', hasTizen);
    row('Samsung APIs', 'tizen.tvinputdevice', run(function () { return tizen.tvinputdevice; }));
    row('Samsung APIs', 'tizen.systeminfo', run(function () { return tizen.systeminfo; }));
    row('Samsung APIs', 'webapis (webapis.js)', hasWebapis);
    row('Samsung APIs', 'webapis.avplay', run(function () { return webapis.avplay && webapis.avplay.open; }));
    row('Samsung APIs', 'webapis.productinfo', run(function () { return webapis.productinfo; }));
    try { row('Samsung APIs', 'Model', webapis.productinfo.getRealModel()); } catch (e) { /* no productinfo */ }
    try { row('Samsung APIs', 'Firmware', webapis.productinfo.getFirmware()); } catch (e) { /* no productinfo */ }
    try { row('Samsung APIs', 'UHD panel', webapis.productinfo.isUdPanelSupported()); } catch (e) { /* none */ }
    try { row('Samsung APIs', 'HDR TV', webapis.avinfo.isHdrTvSupport()); } catch (e) { /* none */ }
    try {
        tizen.systeminfo.getPropertyValue('BUILD', function (b) {
            row('Samsung APIs', 'Build', b.buildVersion || b.model || '?');
        });
    } catch (e) { /* none */ }
    try {
        row('Samsung APIs', 'Platform version', tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version'));
    } catch (e) { /* none */ }

    // --- JavaScript ----------------------------------------------------------------
    var JS = 'JavaScript';
    row(JS, 'async/await', syntax('async function f(){await 1}'));
    row(JS, 'Object spread', syntax('var a={...{}}'));
    row(JS, 'Optional chaining ?.', syntax('var a; a?.b'));
    row(JS, 'Nullish ??', syntax('var a = null ?? 1'));
    row(JS, 'Class fields', syntax('class A { x = 1 }'));
    row(JS, 'Private #fields', syntax('class A { #x = 1; f(){ return this.#x } }'));
    row(JS, 'Static blocks', syntax('class A { static { } }'));
    row(JS, 'Logical assign ||=', syntax('var a; a ||= 1'));
    row(JS, 'BigInt', typeof BigInt === 'function');
    row(JS, 'globalThis', typeof globalThis !== 'undefined');
    row(JS, 'Array.flat', typeof [].flat === 'function');
    row(JS, 'Object.fromEntries', typeof Object.fromEntries === 'function');
    row(JS, 'Promise.allSettled', typeof Promise.allSettled === 'function');
    row(JS, 'String.replaceAll', typeof ''.replaceAll === 'function');
    row(JS, 'Array.at', typeof [].at === 'function');
    row(JS, 'structuredClone', typeof structuredClone === 'function');
    row(JS, 'Intl.RelativeTimeFormat', typeof Intl.RelativeTimeFormat === 'function');
    row(JS, 'ResizeObserver', typeof ResizeObserver === 'function');
    row(JS, 'AbortController', typeof AbortController === 'function');
    row(JS, 'TextEncoder', typeof TextEncoder === 'function');
    row(JS, 'localStorage', run(function () { localStorage.setItem('probe', '1'); return localStorage.getItem('probe') === '1'; }));
    row(JS, 'indexedDB', typeof indexedDB !== 'undefined');
    var importRow = row(JS, 'import()', '…');
    try {
        new Function('u', 'return import(u)')(new URL('module-test.js', location.href).href)
            .then(function () { setRow(importRow, true); }, function (e) { setRow(importRow, 'fails: ' + short(e), 'no'); });
    } catch (e) { setRow(importRow, false); }
    var moduleRow = row(JS, '<script type=module>', '…');
    window.addEventListener('load', function () {
        setTimeout(function () { setRow(moduleRow, !!window.__moduleScriptRan); }, 500);
    });

    // Workers: Stremio's core runs in one.
    var workerRow = row(JS, 'Web Worker', '…');
    try {
        var w = new Worker('worker-test.js');
        w.onmessage = function (e) { setRow(workerRow, !!e.data.ran); w.terminate(); };
        w.onerror = function (e) { setRow(workerRow, 'error', 'no'); };
        w.postMessage(1);
    } catch (e) { setRow(workerRow, 'fails: ' + short(e), 'no'); }
    var mworkerRow = row(JS, 'Module Worker', '…');
    try {
        var mw = new Worker('module-worker-test.js', { type: 'module' });
        var mwTimer = setTimeout(function () { setRow(mworkerRow, false); }, 4000);
        mw.onmessage = function () { clearTimeout(mwTimer); setRow(mworkerRow, true); mw.terminate(); };
        mw.onerror = function () { clearTimeout(mwTimer); setRow(mworkerRow, false); };
        mw.postMessage(1);
    } catch (e) { setRow(mworkerRow, false); }

    // --- CSS -----------------------------------------------------------------------
    var CSSs = 'CSS';
    function supports(p, v) { return run(function () { return CSS.supports(p, v); }); }
    // Flex gap can't be asked with CSS.supports (grid gap answers for it); measure it.
    row(CSSs, 'Flex gap', (function () {
        var f = document.createElement('div');
        f.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
        f.appendChild(document.createElement('div'));
        f.appendChild(document.createElement('div'));
        document.body.appendChild(f);
        var ok = f.scrollHeight === 1;
        document.body.removeChild(f);
        return ok;
    })());
    row(CSSs, 'Grid', supports('display', 'grid'));
    row(CSSs, 'Custom properties', supports('--a', '0'));
    row(CSSs, 'position: sticky', supports('position', 'sticky'));
    row(CSSs, 'aspect-ratio', supports('aspect-ratio', '1'));
    row(CSSs, 'inset', supports('inset', '0'));
    row(CSSs, 'clamp() / min()', supports('width', 'clamp(1px, 2px, 3px)'));
    row(CSSs, 'backdrop-filter', supports('backdrop-filter', 'blur(1px)') || supports('-webkit-backdrop-filter', 'blur(1px)'));
    row(CSSs, ':focus-visible', run(function () { document.querySelector(':focus-visible'); return true; }));
    row(CSSs, ':is() / :where()', run(function () { document.querySelector(':is(body)'); return true; }));
    row(CSSs, 'scroll-snap', supports('scroll-snap-type', 'x mandatory'));
    row(CSSs, 'object-fit', supports('object-fit', 'cover'));

    // --- WebAssembly -------------------------------------------------------------
    var WA = 'WebAssembly';
    var hasWasm = typeof WebAssembly === 'object';
    row(WA, 'WebAssembly', hasWasm);
    var wasmTests = {
        'MVP (2017)': 'AGFzbQEAAAABBQFgAAF/AwIBAAoGAQQAQQEL',
        'Sign extension': 'AGFzbQEAAAABBgFgAX8BfwMCAQAKBwEFACAAwAs=',
        'Mutable globals': 'AGFzbQEAAAACCAEBYQFiA38B',
        'Non-trapping float→int': 'AGFzbQEAAAABBgFgAX0BfwMCAQAKCAEGACAA/AAL',
        'Bulk memory': 'AGFzbQEAAAABBAFgAAADAgEABQMBAAEKDgEMAEEAQQBBAPwKAAAL',
        'Reference types': 'AGFzbQEAAAABBgFgAW8BbwMCAQAKBgEEACAACw==',
        'Multi-value': 'AGFzbQEAAAABBgFgAAJ/fwMCAQAKCAEGAEEAQQAL',
        'SIMD': 'AGFzbQEAAAABBQFgAAF7AwIBAAoIAQYAQQD9Dws='
    };
    Object.keys(wasmTests).forEach(function (name) {
        row(WA, name, hasWasm && run(function () {
            var bin = atob(wasmTests[name]);
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return WebAssembly.validate(bytes);
        }));
    });
    var coreRow = row(WA, 'Stremio core', hasWasm ? 'loading…' : false, 'dim');
    if (hasWasm) {
        var t0 = Date.now();
        Promise.race([fetch(CORE_WASM), timeout(60000)])
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
            .then(function (buf) { return WebAssembly.compile(buf); })
            .then(function () { setRow(coreRow, '✓ compiled in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s', 'ok'); pass++; })
            .catch(function (e) { fail++; setRow(coreRow, '✗ ' + short(e), 'no'); log('core: ' + ((e && e.message) || e)); });
    }

    // --- video formats -------------------------------------------------------------
    var VF = 'Video formats (HTML5)';
    var v = document.createElement('video');
    var types = {
        'MP4 H.264': 'video/mp4; codecs="avc1.640028"',
        'MP4 HEVC': 'video/mp4; codecs="hvc1.2.4.L153.B0"',
        'MP4 AV1': 'video/mp4; codecs="av01.0.08M.10"',
        'WebM VP9': 'video/webm; codecs="vp9"',
        'MKV': 'video/x-matroska',
        'AAC': 'audio/mp4; codecs="mp4a.40.2"',
        'AC-3': 'audio/mp4; codecs="ac-3"',
        'E-AC-3': 'audio/mp4; codecs="ec-3"',
        'DTS': 'audio/mp4; codecs="dtsc"',
        'Opus': 'audio/webm; codecs="opus"',
        'FLAC': 'audio/flac'
    };
    Object.keys(types).forEach(function (k) {
        var r = v.canPlayType(types[k]);
        var mse = run(function () { return MediaSource.isTypeSupported(types[k]); });
        row(VF, k, (r || 'no') + (mse ? ' · MSE' : ''), r ? 'ok' : 'no');
    });

    // --- network -------------------------------------------------------------------
    var NET = 'Network (from page)';
    function netTest(name, url, opts) {
        var r = row(NET, name, '…');
        Promise.race([fetch(url, opts), timeout(15000)])
            .then(function (res) { setRow(r, res.ok ? true : 'HTTP ' + res.status, res.ok ? '' : 'warn'); })
            .catch(function (e) { setRow(r, '✗ ' + short(e), 'no'); fail++; });
    }
    netTest('Cinemeta addon', 'https://v3-cinemeta.strem.io/manifest.json');
    netTest('Stremio API', 'https://api.strem.io/api/getUser', { method: 'POST', body: '{}' });
    netTest('TheIntroDB (CORS?)', 'https://api.theintrodb.org/v3/media?tmdb_id=1396&season=1&episode=1');
    netTest('IntroDB (CORS?)', 'https://api.introdb.app/segments?imdb_id=tt0903747&season=1&episode=1');

    // --- TizenBrew service ---------------------------------------------------------
    if (packaged || servedByUs) {
        try {
            ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
                'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue'].forEach(function (k) {
                tizen.tvinputdevice.registerKey(k);
            });
        } catch (e) { log('registerKey: ' + e.message); }
    }
    if (packaged || servedByUs) {
        try {
            tizen.messageport.requestLocalMessagePort('cs-log').addMessagePortListener(function (data) {
                for (var i = 0; i < data.length; i++) log('service: ' + data[i].value);
            });
        } catch (e) { log('message port: ' + e.message); }
    }
    if (packaged) {
        try {
            var pkgId = tizen.application.getCurrentApplication().appInfo.packageId;
            tizen.application.launchAppControl(
                new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service'),
                pkgId + '.Service',
                function () { log('Service launched'); },
                function (e) { log('Service launch failed: ' + e.message); }
            );
        } catch (e) { log('Service launch: ' + e.message); }
    }

    var SV = 'Node.js service';
    var svcRow = row(SV, 'Running', '…');
    (function poll(tries) {
        Promise.race([fetch(SERVICE + '/info'), timeout(3000)])
            .catch(function () {
                return Promise.race([fetch(SERVICE_ALT + '/info'), timeout(3000)]).then(function (r) {
                    SERVICE = SERVICE_ALT;
                    return r;
                });
            })
            .then(function (r) { return r.json(); })
            .then(function (info) {
                setRow(svcRow, true);
                row(SV, 'Answered by', (info.owner || '?') + ' on ' + SERVICE.slice(-4));
                row(SV, 'Node', info.node);
                row(SV, 'V8', (info.versions && info.versions.v8) || '?', 'dim');
                row(SV, 'Free memory', info.freeMemMB + '/' + info.totalMemMB + ' MB');
                row(SV, 'CPUs', info.cpus);
                row(SV, 'WebAssembly in Node', !!info.hasWebAssembly);
                var p = row(SV, 'Proxy (TheIntroDB)', '…');
                Promise.race([fetch(SERVICE + '/proxy?url=' + encodeURIComponent('https://api.theintrodb.org/v3/media?tmdb_id=1396&season=1&episode=1')), timeout(15000)])
                    .then(function (res) { setRow(p, res.status < 500 ? true : 'HTTP ' + res.status); })
                    .catch(function (e) { setRow(p, '✗ ' + short(e), 'no'); });
            })
            .catch(function () {
                if (tries > 0) return setTimeout(function () { poll(tries - 1); }, 2000);
                setRow(svcRow, false);
            });
    })(20);

    // --- keys ----------------------------------------------------------------------
    var KEY_NAMES = {
        37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down', 13: 'Enter', 10009: 'Back',
        10252: 'Play/Pause', 415: 'Play', 19: 'Pause', 413: 'Stop', 417: 'Fast-forward', 412: 'Rewind',
        403: 'Red', 404: 'Green', 405: 'Yellow', 406: 'Blue', 427: 'Channel up', 428: 'Channel down', 457: 'Info'
    };
    var buttons = [].slice.call(document.querySelectorAll('button'));
    buttons[0].focus();
    document.addEventListener('keydown', function (e) {
        document.getElementById('lastkey').textContent = (KEY_NAMES[e.keyCode] || e.key || '?') + ' (' + e.keyCode + ')';
        var i = buttons.indexOf(document.activeElement);
        if (e.keyCode === 40) { buttons[Math.min(buttons.length - 1, i + 1)].focus(); e.preventDefault(); }
        else if (e.keyCode === 38) { buttons[Math.max(0, i - 1)].focus(); e.preventDefault(); }
        else if (e.keyCode === 10009) {
            e.preventDefault();
            if (video || avplayOpen) return stopAll();
            if (servedByUs || fromStorage) return history.back();
            if (packaged) { try { tizen.application.getCurrentApplication().exit(); } catch (err) { /* stay */ } }
        }
        else if (e.keyCode === 10252 || e.keyCode === 415 || e.keyCode === 19) { togglePause(); }
        else if (e.keyCode === 417) { seekBy(10); }
        else if (e.keyCode === 412) { seekBy(-10); }
    });
    buttons.forEach(function (b) {
        b.addEventListener('click', function () { runTest(b.getAttribute('data-test')); });
    });

    // --- playback tests ------------------------------------------------------------
    var stage = document.getElementById('stage');
    var subEl = document.getElementById('sub');
    var thumb = document.getElementById('thumb');
    var video = null;
    var avObject = null;
    var avplayOpen = false;

    function stopAll() {
        if (video) { video.pause(); video.removeAttribute('src'); video.load(); stage.removeChild(video); video = null; }
        if (avplayOpen) { try { webapis.avplay.stop(); webapis.avplay.close(); } catch (e) { /* ignore */ } avplayOpen = false; }
        if (avObject) { stage.removeChild(avObject); avObject = null; }
        document.body.className = '';
        subEl.textContent = '';
        thumb.style.display = 'none';
    }

    function togglePause() {
        if (video) { if (video.paused) video.play(); else video.pause(); return; }
        if (avplayOpen) {
            try {
                if (webapis.avplay.getState() === 'PLAYING') webapis.avplay.pause(); else webapis.avplay.play();
            } catch (e) { log('pause: ' + e.message); }
        }
    }

    function seekBy(s) {
        if (video) { video.currentTime = Math.max(0, video.currentTime + s); return; }
        if (avplayOpen) {
            try { webapis.avplay.seekTo(Math.max(0, webapis.avplay.getCurrentTime() + s * 1000)); } catch (e) { log('seek: ' + e.message); }
        }
    }

    function html5(file, withThumb) {
        stopAll();
        video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.autoplay = true;
        video.src = CDN_BASE + 'media/' + file;
        var track = document.createElement('track');
        track.kind = 'subtitles';
        track.src = CDN_BASE + 'media/subs.vtt';
        track.default = true;
        video.appendChild(track);
        stage.insertBefore(video, stage.firstChild);
        var started = Date.now();
        video.addEventListener('playing', function () {
            log('HTML5 ' + file + ': playing after ' + (Date.now() - started) + ' ms, ' + video.videoWidth + '×' + video.videoHeight);
            var a = video.audioTracks, t = video.textTracks;
            log('  audioTracks: ' + (a ? a.length : 'n/a') + ', textTracks: ' + (t ? t.length : 'n/a'));
            if (withThumb) setTimeout(grabThumb, 1500);
        });
        video.addEventListener('error', function () {
            var err = video && video.error;
            log('HTML5 ' + file + ': error ' + (err ? err.code + ' ' + (err.message || '') : '?'));
        });
    }

    function grabThumb() {
        if (!video) return;
        try {
            var ctx = thumb.getContext('2d');
            ctx.drawImage(video, 0, 0, 160, 90);
            var px = ctx.getImageData(80, 45, 1, 1).data;
            thumb.style.display = 'block';
            var blank = px[0] === 0 && px[1] === 0 && px[2] === 0;
            log('Thumbnail grab: ' + (blank ? 'drew a BLACK frame (no thumbnails)' : 'works, pixel ' + px[0] + ',' + px[1] + ',' + px[2]));
        } catch (e) {
            log('Thumbnail grab: fails, ' + e.message);
        }
    }

    function avplay(file) {
        stopAll();
        if (!run(function () { return webapis.avplay; })) {
            // Maybe it only appears once a player element exists.
            var o = document.createElement('object');
            o.type = 'application/avplayer';
            stage.appendChild(o);
            var hasNow = run(function () { return webapis.avplay; });
            stage.removeChild(o);
            if (!hasNow) {
                var keys = [];
                try { for (var k in webapis) keys.push(k); } catch (e) { /* none */ }
                log('AVPlay: not available here. webapis: ' + keys.join(', '));
                return;
            }
            log('AVPlay: appeared after adding the player element');
        }
        avObject = document.createElement('object');
        avObject.type = 'application/avplayer';
        stage.appendChild(avObject);
        document.body.className = 'video-on';
        var started = Date.now();
        try {
            var av = webapis.avplay;
            av.open(CDN_BASE + 'media/' + file);
            avplayOpen = true;
            var rect = stage.getBoundingClientRect();
            av.setDisplayRect(Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height));
            av.setListener({
                onbufferingcomplete: function () { log('AVPlay: buffered'); },
                onstreamcompleted: function () { log('AVPlay: ended'); },
                onerror: function (e) { log('AVPlay error: ' + e); },
                onevent: function (type, data) { log('AVPlay event ' + type + ' ' + data); },
                onsubtitlechange: function (duration, text) { subEl.textContent = text; setTimeout(function () { if (subEl.textContent === text) subEl.textContent = ''; }, +duration || 3000); }
            });
            av.prepareAsync(function () {
                log('AVPlay ' + file + ': ready after ' + (Date.now() - started) + ' ms, duration ' + Math.round(av.getDuration() / 1000) + ' s');
                try {
                    var info = av.getTotalTrackInfo();
                    for (var i = 0; i < info.length; i++) {
                        log('  track ' + info[i].index + ' ' + info[i].type + ' ' + info[i].extra_info);
                    }
                } catch (e) { log('  getTotalTrackInfo: ' + e.message); }
                try {
                    av.setExternalSubtitlePath(CDN_BASE + 'media/subs.srt');
                    log('  external subtitle (URL): accepted');
                } catch (e) { log('  external subtitle (URL): ' + e.message); }
                av.play();
            }, function (e) {
                log('AVPlay ' + file + ': prepare failed: ' + e);
            });
        } catch (e) {
            log('AVPlay ' + file + ': ' + e.message);
        }
    }

    function avplayAudio2() {
        if (!avplayOpen) { log('Start test 4 first'); return; }
        try {
            var info = webapis.avplay.getTotalTrackInfo();
            var audio = info.filter(function (t) { return t.type === 'AUDIO'; });
            if (audio.length < 2) { log('Only ' + audio.length + ' audio track(s)'); return; }
            webapis.avplay.setSelectTrack('AUDIO', audio[1].index);
            log('Switched to audio track ' + audio[1].index + ' (should sound higher)');
        } catch (e) { log('switch audio: ' + e.message); }
    }

    // Button 8: what an update would do. Download the page's files into the
    // app's private storage, then open that copy.
    var PAGE_FILES = ['index.html', 'probe.js', 'module-test.js', 'worker-test.js', 'module-worker-test.js'];
    function copyToStorage() {
        if (fromStorage) return log('Already the copy in storage');
        if (!run(function () { return tizen.filesystem; })) return log('No tizen.filesystem here');
        var t0 = Date.now();
        Promise.all(PAGE_FILES.map(function (f) {
            return fetch(JSD_APP + f + '?t=' + t0).then(function (r) {
                if (!r.ok) throw new Error(f + ': HTTP ' + r.status);
                return r.text();
            });
        })).then(function (texts) {
            log('Downloaded ' + texts.length + ' files in ' + (Date.now() - t0) + ' ms');
            tizen.filesystem.resolve('wgt-private', function (dir) {
                var i = 0;
                (function next() {
                    if (i === PAGE_FILES.length) {
                        var url = dir.toURI().replace(/\/$/, '') + '/index.html';
                        log('Opening ' + url);
                        location.href = url;
                        return;
                    }
                    var name = PAGE_FILES[i], text = texts[i];
                    i++;
                    var file;
                    try { file = dir.resolve(name); } catch (e) { file = dir.createFile(name); }
                    file.openStream('w', function (stream) {
                        stream.write(text);
                        stream.close();
                        next();
                    }, function (e) { log('write ' + name + ': ' + e.message); }, 'UTF-8');
                })();
            }, function (e) { log('storage: ' + e.message); }, 'rw');
        }).catch(function (e) { log('download: ' + e.message); });
    }

    function runTest(name) {
        if (name === 'html5-h264') html5('h264.mp4', true);
        else if (name === 'html5-hevc') html5('hevc-hdr10.mkv', false);
        else if (name === 'avplay-h264') avplay('h264.mp4');
        else if (name === 'avplay-hevc') avplay('hevc-hdr10.mkv');
        else if (name === 'avplay-audio') avplayAudio2();
        else if (name === 'stop') stopAll();
        else if (name === 'storage') copyToStorage();
        else if (name === 'served') {
            if (servedByUs) return log('Already the served page');
            location.href = SERVICE + '/app/index.html';
        }
    }

    log('Files from ' + CDN_BASE);
    log('UA: ' + navigator.userAgent);
    try { log('webapis has: ' + Object.keys(webapis).join(', ')); } catch (e) { log('webapis: none'); }
    try { log('tizen has: ' + Object.keys(tizen).join(', ')); } catch (e) { /* none */ }

    // The core in the Node service, with V8's reference-types flag.
    var nodeCoreRow = row(SV, 'Core in Node (flag)', '…');
    (function pollCore(tries) {
        Promise.race([fetch(SERVICE + '/core'), timeout(90000)])
            .then(function (r) { return r.json(); })
            .then(function (j) {
                log('Node reftypes before flag: ' + j.reftypesBefore + ', after: ' + j.reftypesAfter);
                log('Node core: ' + (j.ok ? 'compiled in ' + j.ms + ' ms' : j.error));
                setRow(nodeCoreRow, j.ok ? '✓ ' + (j.ms / 1000).toFixed(1) + ' s' : '✗ ' + String(j.error).slice(0, 40), j.ok ? 'ok' : 'no');
            })
            .catch(function (e) {
                if (tries > 0) return setTimeout(function () { pollCore(tries - 1); }, 3000);
                setRow(nodeCoreRow, '✗ ' + short(e), 'no');
            });
    })(5);
})();
