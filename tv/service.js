// The test's Node.js service on the TV (plain ES5: older TVs have Node 4).
// Runs either inside TizenBrew (as the module's serviceFile) or as the test
// app's own Tizen service. Answers on http://127.0.0.1:8090 (or 8091):
//   /info         Node version, memory
//   /proxy?url=   fetches a URL for the page (no CORS limits here)
//   /core         compiles Stremio's core here with reference types on
//   /app/...      the test page itself, from jsDelivr (to compare a page
//                 served by us with the packaged one)
var http = require('http');
var https = require('https');
var os = require('os');
var urlLib = require('url');

function send(res, code, type, body) {
    res.writeHead(code, {
        'Content-Type': type,
        'Access-Control-Allow-Origin': '*'
    });
    res.end(body);
}

function get(url, res, redirects) {
    var lib = url.indexOf('https:') === 0 ? https : http;
    var opts = urlLib.parse(url);
    opts.headers = { 'User-Agent': 'custom-stremio-tv-probe' };
    lib.get(opts, function (up) {
        if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location && redirects < 5) {
            up.resume();
            return get(urlLib.resolve(url, up.headers.location), res, redirects + 1);
        }
        res.writeHead(up.statusCode, {
            'Content-Type': up.headers['content-type'] || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*'
        });
        up.pipe(res);
    }).on('error', function (e) {
        send(res, 502, 'text/plain', String(e && e.message));
    });
}

// Can Node's V8 run Stremio's core with the reference-types flag on?
var REFTYPES = Buffer.from('AGFzbQEAAAABBgFgAW8BbwMCAQAKBgEEACAACw==', 'base64');
var APP_FILES = 'https://cdn.jsdelivr.net/gh/Cummmies/custom-stremio/tv/app/';
var CORE_URL = 'https://cdn.jsdelivr.net/npm/@stremio/stremio-core-web@0.63.2/stremio_core_web_bg.wasm';
function coreTest(res) {
    var out = {};
    try { out.reftypesBefore = WebAssembly.validate(REFTYPES); } catch (e) { out.reftypesBefore = String(e); }
    try { require('v8').setFlagsFromString('--experimental-wasm-reftypes'); } catch (e) { out.flagError = String(e); }
    try { out.reftypesAfter = WebAssembly.validate(REFTYPES); } catch (e) { out.reftypesAfter = String(e); }
    https.get(CORE_URL, function (up) {
        var chunks = [];
        up.on('data', function (c) { chunks.push(c); });
        up.on('end', function () {
            var t0 = Date.now();
            WebAssembly.compile(Buffer.concat(chunks)).then(function () {
                out.ok = true;
                out.ms = Date.now() - t0;
                send(res, 200, 'application/json', JSON.stringify(out));
            }, function (e) {
                out.ok = false;
                out.error = String(e && e.message || e);
                send(res, 200, 'application/json', JSON.stringify(out));
            });
        });
    }).on('error', function (e) {
        out.ok = false;
        out.error = 'download: ' + e.message;
        send(res, 200, 'application/json', JSON.stringify(out));
    });
}

var server = http.createServer(function (req, res) {
    var u = urlLib.parse(req.url, true);
    if (u.pathname === '/info') {
        var info = {
            node: process.version,
            versions: process.versions,
            platform: process.platform,
            arch: process.arch,
            totalMemMB: Math.round(os.totalmem() / 1048576),
            freeMemMB: Math.round(os.freemem() / 1048576),
            cpus: (os.cpus() || []).length,
            hasWebAssembly: typeof WebAssembly !== 'undefined',
            // Which copy answered: TizenBrew's service or the app's own.
            owner: (process.argv || []).join(' ').indexOf('CStremioTV') >= 0 ? 'app' : 'TizenBrew'
        };
        return send(res, 200, 'application/json', JSON.stringify(info));
    }
    if (u.pathname === '/proxy' && u.query.url) return get(u.query.url, res, 0);
    if (u.pathname === '/core') return coreTest(res);
    if (u.pathname.indexOf('/app/') === 0) return get(APP_FILES + u.pathname.slice(5), res, 0);
    send(res, 404, 'text/plain', 'not found');
});
// Messages for the test page, sent over a Tizen message port when this runs
// as the app's own service (the page shows them in its log).
var pending = [];
var port = null;
function report(msg) {
    pending.push(String(msg));
    flush();
}
function flush() {
    if (typeof tizen === 'undefined' || !tizen.messageport) return;
    try {
        if (!port) port = tizen.messageport.requestRemoteMessagePort('CStremioTV.CustomStremio', 'cs-log');
        while (pending.length) port.sendMessage([{ key: 'msg', value: pending[0] }]), pending.shift();
    } catch (e) {
        port = null; // the page isn't listening yet; retried below
    }
}
var flushTimer = setInterval(flush, 1000);
setTimeout(function () { clearInterval(flushTimer); }, 60000);

process.on('uncaughtException', function (e) { report('service crashed: ' + (e && e.stack || e)); });

// TizenBrew already uses 8090 for the module's copy of this service; the app's
// own copy takes 8091 if 8090 is busy.
var ports = [8090, 8091];
function listen(i) {
    server.once('error', function (e) {
        report('listen ' + ports[i] + ': ' + e.code);
        if (i + 1 < ports.length) listen(i + 1);
    });
    server.listen(ports[i], '127.0.0.1', function () {
        report('service listening on ' + ports[i] + ', Node ' + process.version);
    });
}
var started = false;
function start() {
    if (started) return;
    started = true;
    try { listen(0); } catch (e) { report('start failed: ' + e.message); }
}
start();

// As a Tizen service the runtime calls these.
if (typeof module !== 'undefined' && module.exports) {
    module.exports.onStart = function () { report('onStart'); start(); };
    module.exports.onRequest = function () { report('onRequest'); start(); };
    module.exports.onExit = function () { try { server.close(); } catch (e) { /* closed */ } };
}
