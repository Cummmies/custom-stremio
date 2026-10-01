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
    send(res, 404, 'text/plain', 'not found');
});
server.on('error', function () {});
server.listen(8090, '127.0.0.1');
