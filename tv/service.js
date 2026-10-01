// Runs in TizenBrew's Node.js service on the TV (old Node: plain ES5 only).
// Answers the test page on http://127.0.0.1:8090:
//   /info         Node version, memory, disk
//   /proxy?url=   fetches a URL for the page (no CORS limits here)
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
            hasWebAssembly: typeof WebAssembly !== 'undefined'
        };
        return send(res, 200, 'application/json', JSON.stringify(info));
    }
    if (u.pathname === '/proxy' && u.query.url) return get(u.query.url, res, 0);
    if (u.pathname === '/core') return coreTest(res);
    send(res, 404, 'text/plain', 'not found');
});
server.on('error', function () {});
server.listen(8090, '127.0.0.1');
