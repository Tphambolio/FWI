/**
 * Pyra PWA client (every page loads this after config/telemetry.js + core/telemetry.js).
 *
 *   1. Registers the service worker (sw.js at the repo root; scope = repo root).
 *   2. Offline strip: when the browser reports no connection, or a fetch was
 *      answered from the service worker's cache because the network failed
 *      (response header X-Pyra-Cache: hit;<ISO time>), a small non-blocking
 *      strip says "Offline — showing data cached at <time>". It sits inside a
 *      sticky header (station, briefing) or at the top of <main> under a fixed
 *      header, so it never covers controls. Detection wraps window.fetch to
 *      read the header; it changes nothing about what the engine fetches.
 *   3. "Install Pyra": a footer / menu button shown only after the browser
 *      fired beforeinstallprompt; hidden once installed. iOS Safari fires no
 *      event, so nothing appears there (the science guide explains
 *      Share → Add to Home Screen).
 *
 * No science, no data tiers, no personal data. Exposes window.PyraPWA for tests.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var script = document.currentScript;
  var src = (script && script.src) || '';
  var ROOT = src ? new URL('../', src) : new URL('./', location.href);           // repo root: …/FWI/
  var VERSION = (/[?&]v=(\d+)/.exec(src) || [])[1] || '';
  var state = { root: ROOT.href, version: VERSION, offline: false, lastCachedAt: null, installable: false, installed: false };
  window.PyraPWA = { state: state, showOffline: showOffline, hideOffline: hideOffline, noteCacheHit: noteCacheHit };

  // ── 1. Service worker ──────────────────────────────────────────────────────
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    var reg = function () {
      navigator.serviceWorker.register(new URL('sw.js', ROOT).href, { scope: ROOT.pathname })
        .catch(function (e) { console.warn('[pyra-pwa] service worker not registered:', e && e.message); });
    };
    if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg);
  }

  // ── 2. Offline strip ───────────────────────────────────────────────────────
  var strip = null, stripText = null;
  function fmtTime(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return null;
    try { return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }
  function ensureStrip() {
    if (strip) return strip;
    strip = document.createElement('div');
    strip.id = 'pyra-offline-strip';
    strip.className = 'no-print';
    strip.setAttribute('role', 'status');
    strip.setAttribute('aria-live', 'polite');
    strip.hidden = true;
    strip.style.cssText = 'display:flex;align-items:center;gap:10px;padding:4px 10px 4px 12px;background:#3b2a05;color:#fcd34d;border:1px solid rgba(252,211,77,.45);font:600 12px/1.35 Inter,system-ui,sans-serif;border-radius:6px;margin:0 0 6px';
    stripText = document.createElement('span');
    stripText.style.cssText = 'flex:1;min-width:0';
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss offline notice');
    close.textContent = '×';
    close.style.cssText = 'min-width:36px;min-height:36px;margin:-4px -6px -4px 0;border:0;background:transparent;color:inherit;font-size:20px;line-height:1;cursor:pointer;border-radius:6px';
    close.addEventListener('click', function () { strip.hidden = true; });
    strip.appendChild(stripText);
    strip.appendChild(close);
    var header = document.querySelector('header');
    var pos = header ? getComputedStyle(header).position : '';
    if (header && pos === 'sticky') header.insertBefore(strip, header.firstChild);
    else {
      var main = document.getElementById('main') || document.querySelector('main') || document.body;
      main.insertBefore(strip, main.firstChild);
    }
    return strip;
  }
  function showOffline(cachedAtISO) {
    if (cachedAtISO && (!state.lastCachedAt || cachedAtISO > state.lastCachedAt)) state.lastCachedAt = cachedAtISO;
    state.offline = true;
    var render = function () {
      var s = ensureStrip();
      var t = fmtTime(state.lastCachedAt);
      stripText.textContent = navigator.onLine === false
        ? 'Offline — showing data cached ' + (t ? 'at ' + t : 'on an earlier visit') + '. Values do not update until a connection returns.'
        : 'No connection to the data services — showing data cached ' + (t ? 'at ' + t : 'on an earlier visit') + '.';
      s.hidden = false;
    };
    if (document.body) render(); else document.addEventListener('DOMContentLoaded', render, { once: true });
  }
  function hideOffline() {
    state.offline = false;
    if (strip) strip.hidden = true;
  }
  function noteCacheHit(headerValue) {
    var iso = String(headerValue || '').split(';')[1] || null;
    showOffline(iso);
  }
  // Read X-Pyra-Cache on every response the page fetches; the engine's own
  // fetch semantics are untouched (same promise, same rejection).
  var nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function pyraFetch() {
      var p = nativeFetch.apply(this, arguments);
      if (p && typeof p.then === 'function') {
        p.then(function (res) {
          try {
            var h = res && res.headers && res.headers.get && res.headers.get('X-Pyra-Cache');
            if (h && h.indexOf('hit') === 0) noteCacheHit(h);
          } catch (_) { /* opaque response */ }
        }, function () { /* the caller handles its own rejection */ });
      }
      return p;
    };
  }
  window.addEventListener('offline', function () { showOffline(null); });
  window.addEventListener('online', function () { hideOffline(); });
  if (navigator.onLine === false) showOffline(null);

  // ── 3. Install affordance ──────────────────────────────────────────────────
  var deferredPrompt = null;
  function isStandalone() {
    try { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
    catch (_) { return false; }
  }
  function installButton(variant) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pyra-install-btn';
    b.textContent = 'Install Pyra';
    b.setAttribute('aria-label', 'Install Pyra as an app on this device');
    b.style.cssText = variant === 'menu'
      ? 'display:flex;align-items:center;gap:12px;min-height:44px;padding:0 10px;border-radius:10px;font:600 15px Inter,sans-serif;color:#7bd0ff;background:rgba(123,208,255,.08);border:1px solid rgba(123,208,255,.35);width:100%;cursor:pointer;margin-top:8px'
      : 'display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:999px;font:700 12px Inter,sans-serif;color:#7bd0ff;background:rgba(123,208,255,.10);border:1px solid rgba(123,208,255,.45);cursor:pointer';
    b.addEventListener('click', function () {
      if (!deferredPrompt) return;
      var ev = deferredPrompt; deferredPrompt = null;
      ev.prompt();
      Promise.resolve(ev.userChoice).then(function (c) {
        if (c && c.outcome === 'accepted') { state.installed = true; removeInstall(); }
        else deferredPrompt = ev;
      }).catch(function () {});
    });
    return b;
  }
  function renderInstall() {
    if (isStandalone() || !deferredPrompt) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', renderInstall, { once: true }); return; }
    var footerRow = document.querySelector('footer .flex.flex-wrap') || document.querySelector('footer');
    if (footerRow && !footerRow.querySelector('.pyra-install-btn')) footerRow.appendChild(installButton('footer'));
    var menu = document.getElementById('pyra-menu');
    if (menu && !menu.querySelector('.pyra-install-btn')) {
      var links = menu.querySelectorAll('.pm-link');
      var last = links[links.length - 1];
      if (last) last.insertAdjacentElement('afterend', installButton('menu'));
    }
  }
  function removeInstall() {
    var btns = document.querySelectorAll('.pyra-install-btn');
    for (var i = 0; i < btns.length; i++) btns[i].remove();
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    state.installable = true;
    renderInstall();
  });
  window.addEventListener('appinstalled', function () { deferredPrompt = null; state.installed = true; removeInstall(); });
})();
