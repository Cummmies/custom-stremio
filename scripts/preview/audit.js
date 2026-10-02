// Injected into the app by check.mjs: lists what the TV remote can focus, the
// way src/lib/tv/remote.ts does (keep the two in step), and measures it.
// Plain ES2017 (Chromium 69).
(function () {
    'use strict';
    var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    var MIN_TARGET = 16;
    var next = 1;

    function zoom() {
        return parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    }
    function visible(el) {
        var r = el.getBoundingClientRect();
        if (r.width < MIN_TARGET || r.height < MIN_TARGET) return null;
        if (el.closest('[inert], [aria-hidden="true"]')) return null;
        var s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.pointerEvents === 'none' || Number(s.opacity) === 0) return null;
        return r;
    }
    function scope() {
        var menus = [].slice.call(document.querySelectorAll('[data-menu]')).filter(visible);
        if (menus.length) return menus[menus.length - 1];
        var dialogs = document.querySelectorAll('dialog[open]');
        return dialogs.length ? dialogs[dialogs.length - 1] : document;
    }
    function idOf(el) {
        if (!el || el === document.body || el === document.documentElement) return null;
        if (!el.dataset.audit) el.dataset.audit = String(next++);
        return el.dataset.audit;
    }
    function label(el) {
        if (!el || el === document.body) return '(nothing)';
        var t = el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t) {
            var img = el.querySelector('img[alt]');
            t = img ? img.alt : '';
        }
        if (!t && el.placeholder) t = el.placeholder;
        var where = el.closest('header.nav') ? 'top bar' : el.closest('dialog') ? 'dialog' : '';
        var section = '';
        var sec = el.closest('section, [data-index]');
        if (sec) {
            var h = sec.querySelector('h1, h2, h3');
            if (h && !h.contains(el)) section = h.textContent.replace(/\s+/g, ' ').trim();
        }
        return (t ? t.slice(0, 48) : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '')) +
            (section ? ' — in “' + section.slice(0, 32) + '”' : '') + (where ? ' (' + where + ')' : '');
    }
    /** Page coordinates, in the page's own (zoomed) units. */
    function box(el, r) {
        r = r || el.getBoundingClientRect();
        return { left: r.left + scrollX, top: r.top + scrollY, right: r.right + scrollX, bottom: r.bottom + scrollY, width: r.width, height: r.height };
    }
    function list() {
        var out = [];
        var els = scope().querySelectorAll(FOCUSABLE);
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (el.tabIndex < 0) continue;
            var r = visible(el);
            if (r) out.push({ id: idOf(el), label: label(el), header: !!el.closest('header.nav'), box: box(el, r) });
        }
        return out;
    }
    function find(id) {
        return document.querySelector('[data-audit="' + id + '"]');
    }

    window.__audit = {
        list: list,
        active: function () {
            var a = document.activeElement;
            var id = idOf(a);
            if (!id) return null;
            var r = a.getBoundingClientRect();
            var z = zoom();
            var vw = innerWidth / z;
            var vh = innerHeight / z;
            // Covered by something else (a sticky bar, a mask) at its middle?
            var hit = document.elementFromPoint((r.left + r.width / 2) * z, (r.top + r.height / 2) * z);
            return {
                id: id,
                label: label(a),
                box: box(a, r),
                // How much of it is outside the screen, in page units.
                outside: Math.max(0, -r.left, -r.top, r.right - vw, r.bottom - vh),
                covered: !!hit && hit !== a && !a.contains(hit) && !hit.contains(a),
                inList: list().some(function (c) { return c.id === id; }),
            };
        },
        /** Focus an item as the remote does (focusEl in remote.ts). */
        focus: function (id) {
            var el = find(id);
            if (!el) return false;
            el.focus({ preventScroll: true });
            // Arriving by the arrows, a text field isn't typing yet (remote.ts locks it).
            if ((el.tagName === 'INPUT' && !/^(button|checkbox|radio|range|submit|reset|file|color)$/.test(el.type)) || el.tagName === 'TEXTAREA') {
                el.readOnly = true;
                el.dataset.tvLocked = '';
            }
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            var r = el.getBoundingClientRect();
            var top = r.top - document.body.getBoundingClientRect().top;
            if (top + r.height < (innerHeight / zoom()) * 0.85) scrollTo(0, 0);
            return document.activeElement === el;
        },
        viewport: function () {
            var z = zoom();
            return { width: innerWidth / z, height: innerHeight / z };
        },
        /** Outlines two items (for a screenshot of a problem). */
        mark: function (fromId, toId) {
            [].forEach.call(document.querySelectorAll('.audit-mark'), function (m) { m.remove(); });
            [[fromId, '#38bdf8', 'from'], [toId, '#f43f5e', 'to']].forEach(function (x) {
                var el = x[0] && find(x[0]);
                if (!el) return;
                var r = el.getBoundingClientRect();
                var m = document.createElement('div');
                m.className = 'audit-mark';
                m.setAttribute('style', 'position:fixed;z-index:2147483647;pointer-events:none;border:4px solid ' + x[1] + ';border-radius:8px;left:' + (r.left - 4) + 'px;top:' + (r.top - 4) + 'px;width:' + r.width + 'px;height:' + r.height + 'px');
                var t = document.createElement('span');
                t.textContent = x[2];
                t.setAttribute('style', 'position:absolute;top:-28px;left:-4px;background:' + x[1] + ';color:#000;font:bold 16px sans-serif;padding:2px 8px;border-radius:6px');
                m.appendChild(t);
                document.body.appendChild(m);
            });
        },
        unmark: function () {
            [].forEach.call(document.querySelectorAll('.audit-mark'), function (m) { m.remove(); });
        },
    };
})();
