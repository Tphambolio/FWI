/**
 * Pyra usage counting + feedback panel (every page loads this after config/telemetry.js).
 *
 * Usage counting — privacy-respecting by construction:
 *   - no cookies, no localStorage identifiers, no fingerprinting, no third-party
 *     script unless config/telemetry.js names the Cloudflare provider;
 *   - provider 'post': ONE navigator.sendBeacon() per page view with exactly
 *     ALLOWED_KEYS — page id (ab/station, bc/regional, …), province, app
 *     version (the ?v= on this script tag), installed (display-mode
 *     standalone), coarse viewport class (phone/desktop), a random per-tab
 *     session id held in sessionStorage only, and the record type;
 *   - never the station a user chose, never coordinates, never free text;
 *   - endpoint empty or provider 'none' → nothing is sent.
 *
 * Feedback — a small fixed "Feedback" button (bottom-right, above the bottom
 * nav) opening a panel: a 1–5 "Was this useful today?" row (sent as a
 * `rating` beacon only with provider 'post'; otherwise kept on the device and
 * thanked), a free-text box, "Open a GitHub issue" (prefilled title/body:
 * page, version, province, the text — never station or location) and "Email"
 * (mailto: to config feedbackEmail; hidden when empty).
 *
 * Exposes window.PyraTelemetry for tests.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var cfg = window.PYRA_TELEMETRY || {};
  var provider = cfg.provider || 'none';
  var endpoint = typeof cfg.endpoint === 'string' ? cfg.endpoint.trim() : '';
  var feedbackEmail = typeof cfg.feedbackEmail === 'string' ? cfg.feedbackEmail.trim() : '';
  var REPO_ISSUES = 'https://github.com/Tphambolio/FWI/issues/new';
  var ALLOWED_KEYS = ['type', 'page', 'province', 'version', 'installed', 'viewport', 'session', 'rating'];

  // ── Page context (no user data) ───────────────────────────────────────────
  var script = document.currentScript;
  var src = (script && script.src) || '';
  var ROOT = src ? new URL('../', src) : new URL('./', location.href);
  var VERSION = (/[?&]v=(\d+)/.exec(src) || [])[1] || '';
  var PAGE_IDS = { station_detail: 'station', regional_summary: 'regional', forecast_trends: 'trends', science_guide: 'science', briefing: 'briefing', privacy: 'privacy' };

  function pageContext() {
    var rel = location.pathname;
    if (rel.indexOf(ROOT.pathname) === 0) rel = rel.slice(ROOT.pathname.length);
    var province = 'AB';
    if (rel.indexOf('bc/') === 0) { province = 'BC'; rel = rel.slice(3); }
    var seg = rel.split('/')[0];
    var page = PAGE_IDS[seg] || (seg === '' || seg === 'index.html' ? 'landing' : 'other');
    var installed = false;
    try { installed = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; } catch (_) {}
    var w = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0;
    return { page: province.toLowerCase() + '/' + page, province: province, version: VERSION ? 'v' + VERSION : '', installed: !!installed, viewport: w && w < 768 ? 'phone' : 'desktop' };
  }

  function sessionId() {
    try {
      var s = sessionStorage.getItem('pyra-session');
      if (s) return s;
      var bytes = new Uint8Array(8);
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
      else for (var i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
      s = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      sessionStorage.setItem('pyra-session', s);
      return s;
    } catch (_) { return 'na'; }
  }

  var ctx = pageContext();
  function payload(type, extra) {
    var p = { type: type || 'pageview', page: ctx.page, province: ctx.province, version: ctx.version, installed: ctx.installed, viewport: ctx.viewport, session: sessionId() };
    if (extra) for (var k in extra) if (ALLOWED_KEYS.indexOf(k) !== -1) p[k] = extra[k];
    return p;
  }

  /** Send one record. Returns true only if something was handed to the network. */
  function send(record) {
    if (provider !== 'post' || !endpoint) return false;
    var body = JSON.stringify(record);
    try {
      if (navigator.sendBeacon) return navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
      if (typeof fetch === 'function') { fetch(endpoint, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(function () {}); return true; }
    } catch (_) {}
    return false;
  }

  // ── Provider wiring ───────────────────────────────────────────────────────
  var sentPageview = false;
  if (provider === 'cloudflare' && cfg.token) {
    var s = document.createElement('script');
    s.defer = true;
    s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    s.setAttribute('data-cf-beacon', JSON.stringify({ token: String(cfg.token) }));
    (document.head || document.documentElement).appendChild(s);
  } else if (provider === 'post' && endpoint) {
    sentPageview = send(payload('pageview'));
  }

  // ── Feedback ──────────────────────────────────────────────────────────────
  function rate(n) {
    n = Math.max(1, Math.min(5, Math.round(+n)));
    var sent = send(payload('rating', { rating: n }));
    try { localStorage.setItem('pyra-feedback-rating', JSON.stringify({ rating: n, at: new Date().toISOString() })); } catch (_) {}
    return sent;
  }
  function issueURL(text, rating) {
    var title = 'Feedback: ' + ctx.page + (ctx.version ? ' (' + ctx.version + ')' : '');
    var body = '**Page:** ' + ctx.page + ' · **Province:** ' + ctx.province + ' · **Version:** ' + (ctx.version || 'n/a') +
      ' · **Installed app:** ' + (ctx.installed ? 'yes' : 'no') + ' · **Viewport:** ' + ctx.viewport + '\n' +
      (rating ? '**Was this useful today?** ' + rating + '/5\n' : '') + '\n' + (text || '') + '\n';
    return REPO_ISSUES + '?title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
  }
  function mailURL(text, rating) {
    if (!feedbackEmail) return '';
    var subject = 'Pyra feedback: ' + ctx.page + (ctx.version ? ' (' + ctx.version + ')' : '');
    var body = 'Page: ' + ctx.page + '\nProvince: ' + ctx.province + '\nVersion: ' + (ctx.version || 'n/a') + '\nInstalled app: ' + (ctx.installed ? 'yes' : 'no') +
      (rating ? '\nUseful today: ' + rating + '/5' : '') + '\n\n' + (text || '') + '\n';
    return 'mailto:' + feedbackEmail + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  var rating = 0;
  function buildFeedback() {
    if (!document.body || document.getElementById('pyra-feedback-btn')) return;
    var css = document.createElement('style');
    css.textContent = [
      '#pyra-feedback-btn{position:fixed;right:12px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:1002;min-height:44px;padding:0 14px;border-radius:999px;background:rgba(11,19,38,.94);border:1px solid rgba(123,208,255,.45);color:#7bd0ff;font:700 12px/1 Inter,system-ui,sans-serif;letter-spacing:.04em;cursor:pointer;box-shadow:0 6px 20px rgba(6,14,32,.55)}',
      '#pyra-feedback-btn:hover{background:rgba(123,208,255,.14)}',
      '#pyra-feedback-panel{position:fixed;right:12px;bottom:calc(136px + env(safe-area-inset-bottom,0px));z-index:1002;width:min(340px,calc(100vw - 24px));background:#0f1829;border:1px solid #1e2740;border-radius:14px;padding:14px;color:#dae2fd;font:14px/1.4 Inter,system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.6)}',
      '#pyra-feedback-panel h2{margin:0 0 8px;font:700 14px \'Space Grotesk\',Inter,sans-serif;color:#7bd0ff}',
      '#pyra-feedback-panel .pf-row{display:flex;gap:6px;margin-bottom:10px}',
      '#pyra-feedback-panel .pf-row button{flex:1;min-height:44px;border-radius:10px;border:1px solid #334155;background:#131b2e;color:#dae2fd;font:700 15px Inter,sans-serif;cursor:pointer}',
      '#pyra-feedback-panel .pf-row button[aria-pressed="true"]{background:rgba(123,208,255,.18);border-color:#7bd0ff;color:#7bd0ff}',
      '#pyra-feedback-panel textarea{width:100%;min-height:72px;box-sizing:border-box;border-radius:10px;border:1px solid #334155;background:#0b1326;color:#dae2fd;padding:8px 10px;font:13px/1.4 Inter,sans-serif;resize:vertical}',
      '#pyra-feedback-panel .pf-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}',
      '#pyra-feedback-panel .pf-actions a,#pyra-feedback-panel .pf-actions button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 12px;border-radius:10px;font:700 12px Inter,sans-serif;text-decoration:none;cursor:pointer;border:1px solid rgba(123,208,255,.45);background:rgba(123,208,255,.10);color:#7bd0ff}',
      '#pyra-feedback-panel .pf-actions .pf-close{border-color:#334155;background:transparent;color:#cbd5e1;margin-left:auto}',
      '#pyra-feedback-panel .pf-note{margin:8px 0 0;font-size:11px;color:#94a3b8;line-height:1.4}',
      '#pyra-feedback-panel .pf-thanks{font-size:12px;color:#4ae176;min-height:16px;margin:-4px 0 6px}',
      '@media print{#pyra-feedback-btn,#pyra-feedback-panel{display:none !important}}',
      '@media (max-height:520px){#pyra-feedback-btn{bottom:calc(52px + env(safe-area-inset-bottom,0px))}#pyra-feedback-panel{bottom:calc(104px + env(safe-area-inset-bottom,0px));max-height:calc(100vh - 120px);overflow:auto}}',
    ].join('\n');
    document.head.appendChild(css);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'pyra-feedback-btn';
    btn.className = 'no-print';
    btn.textContent = 'Feedback';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'pyra-feedback-panel');

    var panel = document.createElement('section');
    panel.id = 'pyra-feedback-panel';
    panel.className = 'no-print';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'pyra-feedback-title');
    panel.hidden = true;
    panel.innerHTML =
      '<h2 id="pyra-feedback-title">Was this useful today?</h2>' +
      '<div class="pf-row" role="group" aria-label="Rate 1 to 5">' +
        [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-rating="' + n + '" aria-pressed="false" aria-label="' + n + ' of 5">' + n + '</button>'; }).join('') +
      '</div>' +
      '<p class="pf-thanks" aria-live="polite"></p>' +
      '<label for="pyra-feedback-text" style="display:block;font-size:12px;color:#cbd5e1;margin-bottom:4px">What would make Pyra more useful?</label>' +
      '<textarea id="pyra-feedback-text" placeholder="Optional. Add your station or area only if you want to."></textarea>' +
      '<div class="pf-actions">' +
        '<a class="pf-issue" href="' + REPO_ISSUES + '" target="_blank" rel="noopener">Open a GitHub issue</a>' +
        (feedbackEmail ? '<a class="pf-mail" href="#">Email</a>' : '') +
        '<button type="button" class="pf-close">Close</button>' +
      '</div>' +
      '<p class="pf-note">The issue or email opens in a new tab/your mail app with the page, version and your text prefilled; nothing is posted until you send it there. Your station and location are not included.</p>';

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    var thanks = panel.querySelector('.pf-thanks');
    var textarea = panel.querySelector('#pyra-feedback-text');
    var issue = panel.querySelector('.pf-issue');
    var mail = panel.querySelector('.pf-mail');
    function syncLinks() {
      issue.href = issueURL(textarea.value, rating);
      if (mail) mail.href = mailURL(textarea.value, rating);
    }
    function setOpen(open) {
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { syncLinks(); var first = panel.querySelector('[data-rating="1"]'); if (first) first.focus(); }
      else btn.focus();
    }
    btn.addEventListener('click', function () { setOpen(panel.hidden); });
    panel.querySelector('.pf-close').addEventListener('click', function () { setOpen(false); });
    panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } });
    panel.querySelectorAll('[data-rating]').forEach(function (b) {
      b.addEventListener('click', function () {
        rating = +b.getAttribute('data-rating');
        panel.querySelectorAll('[data-rating]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        var sent = rate(rating);
        thanks.textContent = sent ? 'Thanks — recorded.' : 'Thanks — noted on this device.';
        syncLinks();
      });
    });
    textarea.addEventListener('input', syncLinks);
    syncLinks();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildFeedback, { once: true });
  else buildFeedback();

  window.PyraTelemetry = {
    config: { provider: provider, endpoint: endpoint, feedbackEmail: feedbackEmail },
    context: ctx,
    ALLOWED_KEYS: ALLOWED_KEYS,
    payload: payload,
    send: send,
    rate: rate,
    issueURL: issueURL,
    mailURL: mailURL,
    sentPageview: sentPageview,
  };
})();
