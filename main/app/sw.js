// The preview site's service worker (preview/README.md): answers the app's
// requests to other sites (addons, images, web services) with the sample data
// in fixtures.js, so the preview never touches the real services and always
// looks the same. The app's own files load as usual.
//
// Plain ES2017: runs in the TV's old engine (Chromium 69) too.
/* eslint-env serviceworker */
importScripts('./fixtures.js');

// "Slow network" option (preview/boot.js): how long catalogs take, in ms.
var delay = 0;

self.addEventListener('install', function () {
    self.skipWaiting();
});
self.addEventListener('activate', function (e) {
    e.waitUntil(self.clients.claim());
});
self.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'delay') delay = Number(e.data.ms) || 0;
});

self.addEventListener('fetch', function (e) {
    var url = e.request.url;
    if (new URL(url).origin === self.location.origin) return;
    var r = self.PreviewFixtures.respond(url);
    if (!r) {
        e.respondWith(Response.error());
        return;
    }
    var response = r.status
        ? new Response('', { status: r.status, headers: { 'Access-Control-Allow-Origin': '*' } })
        : new Response(r.body, { headers: { 'Content-Type': r.type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
    if (r.slow && delay) {
        e.respondWith(new Promise(function (resolve) {
            setTimeout(function () { resolve(response); }, delay * (0.5 + Math.random()));
        }));
    } else {
        e.respondWith(response);
    }
});
