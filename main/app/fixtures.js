// Sample data for the preview site (preview/README.md): what the addons,
// image services and other web services would answer, made up and always the
// same, so every screen looks the same on every run. Used by preview/sw.js,
// which answers the app's requests with it.
//
// Plain ES2017: runs in the TV's old engine (Chromium 69) too.
(function (root) {
    'use strict';

    var MOVIES = [
        'The Long Harbor', 'Glass Orchard', 'Northbound', 'A Quiet Engine', 'Paper Lanterns',
        'Saltwater Kings', 'The Ninth Hour', 'Copper Sky', 'Little Thunder', 'Midnight Ferry',
        'Static Bloom', 'The Cartographer', 'Velvet Circuit', 'Hollow Pines', 'Second Summer',
        'Iron Lullaby', 'Bright Margins', 'The Last Arcade',
    ];
    var SERIES = [
        'Signal & Noise', 'The Atlas Hotel', 'Low Tide', 'Foxglove', 'Parallel Lines',
        'Kingdom of Wires', 'The Night Desk', 'Overgrowth', 'Paper Moon Club', 'Ember Valley',
        'Dead Reckoning', 'Small Hours', 'The Understudy', 'Frontier Radio', 'Half Light',
        'Common Ground', 'Echo Park West', 'The Orchard Files',
    ];
    var GENRES = ['Drama', 'Comedy', 'Thriller', 'Sci-Fi', 'Adventure', 'Mystery', 'Romance', 'Animation'];
    var CAST = ['Maya Holloway', 'Theo Grant', 'Ines Calder', 'Ravi Mendes', 'Juno Park', 'Oskar Lind', 'Celia Moreau', 'Dev Anand Rao', 'Lena Fischer', 'Marcus Webb'];
    var DESCRIPTION = 'A sample title for the preview site. When an old friend turns up with a map that shouldn’t exist, two strangers set out across a country that keeps rearranging itself — and discover the journey was never about the destination.';

    function hash(s) {
        var h = 2166136261;
        for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
        return h >>> 0;
    }

    function idOf(type, i) {
        return 'tt' + ((type === 'series' ? 9100000 : 9000000) + i);
    }
    function titleOf(id) {
        var n = Number(id.slice(2));
        if (n >= 9100000) return SERIES[(n - 9100000) % SERIES.length];
        if (n >= 9000000) return MOVIES[(n - 9000000) % MOVIES.length];
        return 'Sample ' + id;
    }
    function typeOf(id) {
        return Number(id.slice(2)) >= 9100000 ? 'series' : 'movie';
    }

    function preview(type, i) {
        var id = idOf(type, i);
        var h = hash(id);
        return {
            id: id,
            type: type,
            name: titleOf(id),
            poster: 'https://images.metahub.space/poster/medium/' + id + '/img',
            posterShape: 'poster',
            background: 'https://images.metahub.space/background/medium/' + id + '/img',
            logo: 'https://images.metahub.space/logo/medium/' + id + '/img',
            description: DESCRIPTION,
            releaseInfo: type === 'series' ? 2018 + (h % 6) + '–' : String(2012 + (h % 13)),
            imdbRating: (6 + (h % 35) / 10).toFixed(1),
            genres: [GENRES[h % GENRES.length], GENRES[(h >> 3) % GENRES.length]].filter(function (g, k, a) { return a.indexOf(g) === k; }),
            runtime: type === 'series' ? '45 min' : 90 + (h % 50) + ' min',
        };
    }

    /** A catalog's items: each catalog a different slice, so rows differ. */
    function catalog(type, id, extra) {
        var count = type === 'series' ? SERIES.length : MOVIES.length;
        var offset = { top: 0, imdbRating: 5, year: 9 }[id] || 3;
        var items = [];
        for (var i = 0; i < count; i++) items.push(preview(type, (i + offset) % count));
        var search = /search=([^&/]+)/.exec(extra || '');
        if (search) {
            var q = decodeURIComponent(search[1]).toLowerCase();
            items = items.filter(function (m) { return m.name.toLowerCase().indexOf(q) !== -1 || q.length < 3; });
        }
        if (/skip=/.test(extra || '')) items = [];
        return { metas: items };
    }

    function meta(type, id) {
        var m = preview(type, Number(id.slice(2)) % 100000);
        m.id = id;
        m.name = titleOf(id);
        m.cast = CAST.slice(0, 8);
        m.director = ['Ada Whitlock'];
        m.writer = ['Sam Ostrowski', 'Priya Nair'];
        m.trailerStreams = [{ title: 'Trailer', ytId: 'preview' + (hash(id) % 1000) }];
        m.links = [{ name: m.imdbRating, category: 'imdb', url: 'https://imdb.com/title/' + id }]
            .concat(m.genres.map(function (g) { return { name: g, category: 'Genres', url: 'stremio:///discover/x/' + type + '/top?genre=' + g }; }))
            .concat(m.cast.map(function (c) { return { name: c, category: 'Cast', url: 'stremio:///search?search=' + encodeURIComponent(c) }; }))
            .concat([{ name: 'Ada Whitlock', category: 'Directors', url: 'stremio:///search?search=Ada%20Whitlock' }]);
        m.videos = [];
        if (type === 'series') {
            for (var s = 1; s <= 3; s++) {
                for (var e = 1; e <= 10; e++) {
                    m.videos.push({
                        id: id + ':' + s + ':' + e,
                        season: s,
                        episode: e,
                        title: EPISODES[(s * 10 + e) % EPISODES.length],
                        overview: 'Episode ' + e + ' of season ' + s + '. Loyalties shift when a stranger arrives with news from the coast, and nobody is quite who they said they were.',
                        thumbnail: 'https://episodes.preview.invalid/' + id + '/' + s + '/' + e + '.svg',
                        released: new Date(Date.UTC(2023 + s - 1, 1, e * 7)).toISOString(),
                    });
                }
            }
        }
        return { meta: m };
    }
    var EPISODES = ['Pilot', 'The Crossing', 'Old Friends', 'Static', 'Landfall', 'Night Shift', 'Undertow', 'The Long Way Round', 'Signals', 'Homecoming', 'Fault Lines', 'Paper Trail', 'Open Water'];

    function streams(type, id) {
        var q = ['2160p HDR', '1080p', '1080p', '720p', '480p'];
        return {
            streams: q.map(function (quality, i) {
                return {
                    name: 'Preview\n' + quality.split(' ')[0],
                    title: titleOf(id.split(':')[0]) + ' ' + quality + '\n💾 ' + (8 - i * 1.4).toFixed(1) + ' GB  👤 ' + (120 - i * 20) + '  ⚙️ Sample Source',
                    url: 'https://media.preview.invalid/' + encodeURIComponent(id) + '/' + i + '.mp4',
                    behaviorHints: { bingeGroup: 'preview-' + i },
                };
            }),
        };
    }

    // --- images (SVG) -----------------------------------------------------------

    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function colors(seed) {
        var h = hash(seed);
        var a = h % 360;
        return ['hsl(' + a + ',45%,32%)', 'hsl(' + ((a + 40) % 360) + ',55%,14%)', 'hsl(' + ((a + 180) % 360) + ',60%,62%)'];
    }
    function poster(id) {
        var c = colors(id);
        var words = titleOf(id).split(' ');
        var lines = [];
        words.forEach(function (w) {
            var last = lines[lines.length - 1];
            if (last && (last + ' ' + w).length <= 11) lines[lines.length - 1] = last + ' ' + w;
            else lines.push(w);
        });
        var text = lines.map(function (l, i) {
            return '<text x="30" y="' + (560 - (lines.length - 1 - i) * 54) + '" font-size="48" font-weight="700" fill="#fff" font-family="Helvetica,Arial,sans-serif">' + esc(l) + '</text>';
        }).join('');
        return '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">' +
            '<defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/></linearGradient></defs>' +
            '<rect width="400" height="600" fill="url(#g)"/><circle cx="300" cy="170" r="120" fill="' + c[2] + '" opacity="0.35"/>' +
            '<text x="30" y="60" font-size="20" letter-spacing="4" fill="#fff" opacity="0.7" font-family="Helvetica,Arial,sans-serif">' + (typeOf(id) === 'series' ? 'SERIES' : 'FILM') + '</text>' +
            text + '</svg>';
    }
    function backdrop(seed, label) {
        var c = colors(seed);
        return '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">' +
            '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/></linearGradient>' +
            '<radialGradient id="r" cx="0.75" cy="0.3" r="0.6"><stop offset="0" stop-color="' + c[2] + '" stop-opacity="0.55"/><stop offset="1" stop-color="' + c[2] + '" stop-opacity="0"/></radialGradient></defs>' +
            '<rect width="1280" height="720" fill="url(#g)"/><rect width="1280" height="720" fill="url(#r)"/>' +
            '<path d="M0 560 L320 420 L560 520 L860 360 L1280 540 L1280 720 L0 720Z" fill="#000" opacity="0.25"/>' +
            (label ? '<text x="1240" y="680" text-anchor="end" font-size="40" fill="#fff" opacity="0.6" font-family="Helvetica,Arial,sans-serif">' + esc(label) + '</text>' : '') +
            '</svg>';
    }
    function logo(id) {
        var name = titleOf(id);
        var w = Math.max(360, name.length * 60);
        return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="140" viewBox="0 0 ' + w + ' 140">' +
            '<text x="4" y="100" font-size="76" font-weight="800" letter-spacing="1" fill="#fff" font-family="Georgia,serif">' + esc(name.toUpperCase()) + '</text></svg>';
    }

    // --- requests ---------------------------------------------------------------

    function json(body) {
        return { type: 'application/json', body: JSON.stringify(body) };
    }
    function svg(body) {
        return { type: 'image/svg+xml', body: body };
    }

    /**
     * The answer to a request for `url`: { type, body, slow } (slow: a catalog,
     * which the "slow network" option delays), { status } for an error, or
     * null to fail it as a network error.
     */
    function respond(url) {
        var u;
        try {
            u = new URL(url);
        } catch (e) {
            return null;
        }
        var path = decodeURIComponent(u.pathname);
        var m;

        // Images.
        if (u.hostname === 'images.metahub.space') {
            m = /^\/(poster|background|logo)\/\w+\/(tt\d+)\//.exec(path);
            if (!m) return null;
            if (m[1] === 'poster') return svg(poster(m[2]));
            if (m[1] === 'logo') return svg(logo(m[2]));
            return svg(backdrop(m[2]));
        }
        if (u.hostname === 'episodes.preview.invalid') {
            m = /^\/([^/]+)\/(\d+)\/(\d+)\.svg$/.exec(path);
            return m ? svg(backdrop(m[1] + m[2] + m[3], 'S' + m[2] + ' · E' + m[3])) : null;
        }
        if (u.hostname === 'i.ytimg.com') return svg(backdrop(path, '▶ Trailer'));

        // Addons: catalog, meta, stream, subtitles.
        m = /^\/catalog\/(movie|series)\/([^/.]+)(?:\/([^.]+))?\.json$/.exec(path);
        if (m) {
            var r = json(catalog(m[1], m[2], m[3]));
            r.slow = true;
            return r;
        }
        if (/^\/catalog\//.test(path)) return json({ metas: [] });
        m = /^\/meta\/(movie|series)\/([^/]+)\.json$/.exec(path);
        if (m) return json(meta(m[1], m[2].split(':')[0]));
        m = /^\/stream\/(movie|series)\/([^/]+)\.json$/.exec(path);
        if (m) return json(streams(m[1], m[2]));
        if (/^\/subtitles\//.test(path)) return json({ subtitles: [] });

        // Intro and credits timings (src/lib/player/skips.ts).
        if (u.hostname === 'api.introdb.app') return json({ intro: { start_sec: 5, end_sec: 70 }, outro: { start_sec: 5400, end_sec: 5520 } });
        if (u.hostname === 'api.theintrodb.org') return json({ error: 'preview' });

        // Anime ids (src/lib/anime.svelte.ts).
        if (/anime-list/.test(path)) return json([]);

        // Updates, accounts and anything else: not in the preview.
        return { status: 404 };
    }

    root.PreviewFixtures = { respond: respond, preview: preview, titleOf: titleOf, idOf: idOf };
})(typeof self !== 'undefined' ? self : this);
