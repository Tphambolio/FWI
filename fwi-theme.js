// Shared Tailwind config for all FWI pages — load before Tailwind CDN
tailwind.config = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "on-tertiary-fixed": "#36003e",
        "on-primary-container": "#008abb",
        "tertiary-container": "#2f0037",
        "on-primary-fixed": "#001e2c",
        "secondary-fixed": "#6bff8f",
        "on-primary": "#00354a",
        "on-secondary-fixed": "#002109",
        "surface-tint": "#7bd0ff",
        "on-tertiary-container": "#ce3ae5",
        "on-surface": "#dae2fd",
        "inverse-primary": "#00668a",
        "secondary-fixed-dim": "#4ae176",
        "error": "#ffb4ab",
        "surface-bright": "#31394d",
        "on-error-container": "#ffdad6",
        "surface": "#0b1326",
        "on-background": "#dae2fd",
        "primary-fixed-dim": "#7bd0ff",
        "primary-fixed": "#c4e7ff",
        "inverse-on-surface": "#283044",
        "outline-variant": "#45464d",
        "on-secondary-container": "#004119",
        "on-tertiary-fixed-variant": "#7c008e",
        "tertiary-fixed": "#ffd6fd",
        "primary-container": "#001a27",
        "on-secondary-fixed-variant": "#005321",
        "on-secondary": "#003915",
        "on-surface-variant": "#c6c6cd",
        "on-error": "#690005",
        "tertiary-fixed-dim": "#fbabff",
        "outline": "#909097",
        "surface-container-high": "#222a3d",
        "secondary-container": "#00b954",
        "surface-container-lowest": "#060e20",
        "surface-container-low": "#131b2e",
        "surface-dim": "#0b1326",
        "secondary": "#4ae176",
        "background": "#0b1326",
        "error-container": "#93000a",
        "on-primary-fixed-variant": "#004c69",
        "primary": "#7bd0ff",
        "inverse-surface": "#dae2fd",
        "on-tertiary": "#580065",
        "surface-container-highest": "#2d3449",
        "surface-variant": "#2d3449",
        "tertiary": "#fbabff",
        "surface-container": "#171f33"
      },
      fontFamily: {
        "headline": ["Space Grotesk"],
        "body": ["Inter"],
        "label": ["Inter"]
      },
      borderRadius: { "DEFAULT": "0.125rem", "lg": "0.25rem", "xl": "0.5rem", "full": "0.75rem" },
    },
  },
};

// ─── Shared page chrome (every page loads this file) ──────────────────────────
// Global a11y CSS (skip link, focus rings, chips, tap targets, reduced motion)
// and the hamburger menu. The menu holds the province switch, data-feed status,
// page links and credits that used to crowd the header (and overflowed 390 px).
// Pages opt in with:
//   <button id="pyra-menu-btn" data-prov="AB|BC" data-page="station|map|trends|science|briefing"
//           data-root="../" aria-controls="pyra-menu" aria-expanded="false">
(function () {
  if (typeof document === 'undefined') return;
  var css = [
    '.skip-link{position:fixed;left:8px;top:-80px;z-index:5000;background:#7bd0ff;color:#001e2c;padding:14px 18px;border-radius:8px;font:700 14px Inter,sans-serif;text-decoration:none}',
    '.skip-link:focus{top:8px}',
    ':where(a,button,select,input,summary,textarea,th[tabindex],[tabindex="0"]):focus-visible{outline:3px solid #7bd0ff !important;outline-offset:2px;border-radius:4px}',
    '.pyra-chip{display:inline-flex;align-items:center;gap:4px;font-size:11px;line-height:1.25;font-weight:700;letter-spacing:.03em;padding:3px 8px;border-radius:6px;white-space:nowrap}',
    '.pyra-chip-lg{font-size:13px;padding:5px 10px}',
    '.pyra-tap{min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center}',
    '@media (max-width:767px){.leaflet-touch .leaflet-bar a{width:44px !important;height:44px !important;line-height:44px !important;font-size:20px !important}}',
    '@media (prefers-reduced-motion:reduce){.animate-pulse,.tomorrow-slide-in{animation:none !important}*{scroll-behavior:auto !important}}',
    '#pyra-menu-backdrop{position:fixed;inset:0;background:rgba(2,6,23,.6);z-index:4000}',
    '#pyra-menu{position:fixed;top:0;left:0;bottom:0;width:min(340px,88vw);overflow-y:auto;z-index:4001;background:#0b1326;border-right:1px solid #1e2740;box-shadow:0 0 40px rgba(0,0,0,.6);padding:12px 16px 32px;color:#dae2fd;font-family:Inter,sans-serif}',
    '#pyra-menu a{color:#dae2fd;text-decoration:none}',
    '#pyra-menu .pm-link{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 10px;border-radius:10px;font-size:15px}',
    '#pyra-menu .pm-link:hover{background:rgba(123,208,255,.08)}',
    '#pyra-menu .pm-link[aria-current="page"]{background:rgba(123,208,255,.14);color:#7bd0ff;font-weight:700}',
    '#pyra-menu .pm-h{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#94a3b8;margin:18px 0 6px;font-weight:700}',
    '#pyra-menu .pm-seg{display:flex;gap:8px}',
    '#pyra-menu .pm-seg a{flex:1;min-height:44px;display:flex;align-items:center;justify-content:center;border-radius:10px;border:1px solid #334155;font-weight:700;font-size:14px}',
    '#pyra-menu .pm-seg a[aria-current="true"]{background:rgba(123,208,255,.16);border-color:#7bd0ff;color:#7bd0ff}',
    '#pyra-menu .pm-small{font-size:13px;color:#cbd5e1;line-height:1.6}',
    '#pyra-menu .pm-small a{color:#7bd0ff;text-decoration:underline;display:inline-block;min-height:32px;line-height:32px}',
  ].join('\n');
  var st = document.createElement('style');
  st.id = 'pyra-chrome-css';
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  var PAGES = [
    ['station',  'station_detail/code.html',   'local_fire_department', 'Station'],
    ['map',      'regional_summary/code.html', 'map',                   'Map'],
    ['trends',   'forecast_trends/code.html',  'trending_up',           'Trends'],
    ['science',  'science_guide/code.html',    'menu_book',             'Science'],
    ['briefing', 'briefing/',                  'assignment',            'Briefing'],
  ];

  function buildMenu(btn) {
    var prov = btn.dataset.prov === 'BC' ? 'BC' : 'AB';
    var page = btn.dataset.page || 'station';
    var root = btn.dataset.root || '';
    var pre = prov === 'BC' ? root + 'bc/' : root;
    var cur = PAGES.filter(function (p) { return p[0] === page; })[0] || PAGES[0];
    var credits = prov === 'BC' ? 'Travis Kennedy · Claude · Glenn · Patrick (testing)' : 'Travis Kennedy · Claude · Glenn';
    var nav = document.createElement('nav');
    nav.id = 'pyra-menu';
    nav.setAttribute('aria-label', 'Site menu');
    nav.hidden = true;
    nav.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<span style="font:700 18px \'Space Grotesk\',sans-serif;color:#7bd0ff">Pyra <span style="font-size:13px;color:#cbd5e1;font-weight:600">· ' + (prov === 'BC' ? 'BC Wildfire FWI' : 'Alberta FWI System') + '</span></span>' +
        '<button type="button" id="pyra-menu-close" class="pyra-tap" aria-label="Close menu" style="color:#7bd0ff;border-radius:10px"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>' +
      '</div>' +
      '<p class="pm-small" style="display:flex;align-items:center;gap:8px;margin-top:6px"><span aria-hidden="true" style="width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block"></span>Live data feeds · values refresh on every page load</p>' +
      '<p class="pm-h">Province</p>' +
      '<div class="pm-seg">' +
        '<a href="' + root + cur[1] + '"' + (prov === 'AB' ? ' aria-current="true"' : '') + '>Alberta</a>' +
        '<a href="' + root + 'bc/' + cur[1] + '"' + (prov === 'BC' ? ' aria-current="true"' : '') + '>British Columbia</a>' +
      '</div>' +
      '<p class="pm-h">Pages</p>' +
      PAGES.map(function (p) {
        return '<a class="pm-link" href="' + pre + p[1] + '"' + (p[0] === page ? ' aria-current="page"' : '') + '>' +
          '<span class="material-symbols-outlined" aria-hidden="true">' + p[2] + '</span>' + p[3] + '</a>';
      }).join('') +
      '<p class="pm-h">About</p>' +
      '<p class="pm-small">Built by ' + credits + '.<br>' +
        '<a href="https://x.com/lactucafarm" target="_blank" rel="noopener">DM on X</a> · ' +
        '<a href="https://github.com/Tphambolio/FWI/issues" target="_blank" rel="noopener">GitHub issues</a> · ' +
        '<a href="https://github.com/Tphambolio/FWI" target="_blank" rel="noopener">Source code</a></p>' +
      '<p class="pm-small" style="color:#fcd34d;margin-top:10px">Unofficial — for situational awareness only. Verify with an FBAN / the provincial agency before operational decisions.</p>';
    var back = document.createElement('div');
    back.id = 'pyra-menu-backdrop';
    back.hidden = true;
    document.body.appendChild(back);
    document.body.appendChild(nav);
    return { nav: nav, back: back };
  }

  function wire() {
    var btn = document.getElementById('pyra-menu-btn');
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    var m = buildMenu(btn);
    var close = document.getElementById('pyra-menu-close');
    function focusables() { return m.nav.querySelectorAll('a[href],button'); }
    function setOpen(open) {
      m.nav.hidden = !open;
      m.back.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (open) close.focus(); else btn.focus();
    }
    btn.addEventListener('click', function () { setOpen(m.nav.hidden); });
    close.addEventListener('click', function () { setOpen(false); });
    m.back.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (m.nav.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
      if (e.key === 'Tab') {            // keep focus inside the open menu
        var f = focusables(), first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();

// Short screens (a phone held sideways, a small laptop with display scaling):
// a pinned header + summary + bottom nav left almost no room for content.
// Below 520 px of height the header scrolls away and the nav becomes one slim row.
(function () {
  if (typeof document === 'undefined') return;
  const st = document.createElement('style');
  st.textContent = `@media (max-height: 520px) {
    header.sticky { position: static !important; }
    nav[aria-label="Primary"].fixed { padding: 2px 8px calc(2px + env(safe-area-inset-bottom)) !important; }
    nav[aria-label="Primary"].fixed > a { flex-direction: row !important; gap: 6px; min-height: 40px !important; padding-top: 0 !important; padding-bottom: 0 !important; }
    nav[aria-label="Primary"].fixed .material-symbols-outlined { font-size: 20px !important; }
  }`;
  (document.head || document.documentElement).appendChild(st);
})();
