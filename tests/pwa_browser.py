#!/usr/bin/env python3
"""
PWA browser check for Pyra (Playwright, Chromium) — a real offline test.

Phase 1 (online, persistent profile):
  1. The service worker registers at the site root scope and controls the page
     after one reload (the first load installs it; the engine's data fetches on
     that load happen before it controls the page).
  2. The manifest is served and parses; theme-color is set.
  3. The Feedback button exists, sits above the bottom nav, opens a panel whose
     GitHub link carries page/version but not the ?stn= station; the page still
     fits 390 px; no Install button without beforeinstallprompt.
  4. The runtime cache holds the weather responses behind the page.

Phase 2 (offline, same profile):
  Playwright's set_offline() does not reach service workers, so the browser is
  relaunched with `--host-resolver-rules=MAP * ~NOTFOUND` (every hostname fails
  to resolve) and, for a local server, the server is stopped too. The station
  page must render from the service-worker cache, show the amber "Offline —
  showing data cached at <time>" strip, carry a danger label and no NaN, with
  no JS errors.

Run: python3 tests/pwa_browser.py                       (live site)
     PYRA_BASE=http://127.0.0.1:8766 python3 tests/pwa_browser.py
       → any 127.0.0.1 / localhost base makes the script serve the repo itself
         on a free port, so it can stop the server for the offline phase.
Exit 0 = all pass, 1 = any fail.
"""
from playwright.sync_api import sync_playwright
import os, sys, socket, threading, tempfile, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get("PYRA_BASE", "https://tphambolio.github.io/FWI")
LOCAL = urlparse(BASE).hostname in ('127.0.0.1', 'localhost')
DANGER = ['Low', 'Moderate', 'High', 'Very High', 'Extreme']

passed = failed = 0
issues = []

def p(ok, label, detail=''):
    global passed, failed
    print(f"    {'PASS' if ok else 'FAIL'}  {label}" + (f"  [{detail}]" if detail else ''))
    if ok: passed += 1
    else:
        failed += 1; issues.append(f"{label}: {detail}")

# ── Own static server for the local case (so it can be stopped) ──────────────
server = None
if LOCAL:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    server = ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    BASE = f"http://127.0.0.1:{port}"
    print(f"  serving {ROOT} at {BASE}")
AB_URL = f"{BASE}/station_detail/code.html"
profile = tempfile.mkdtemp(prefix='pyra-pwa-')
PHONE = dict(viewport={'width': 390, 'height': 664}, is_mobile=True, has_touch=True, timezone_id='America/Edmonton')

with sync_playwright() as pw:
    # ── Phase 1: online ──────────────────────────────────────────────────────
    ctx = pw.chromium.launch_persistent_context(profile, headless=True, **PHONE)
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    js_errors = []
    page.on('pageerror', lambda e: js_errors.append(str(e)))

    print("\n  ── Service worker + manifest ──")
    page.goto(f"{AB_URL}?stn=Hussar%20AGDM", wait_until='load', timeout=60000)
    sw = page.evaluate("""async () => {
        const reg = await navigator.serviceWorker.ready;
        await new Promise(r => { if (navigator.serviceWorker.controller) r(); else navigator.serviceWorker.addEventListener('controllerchange', r, {once:true}); setTimeout(r, 15000); });
        return { scope: reg.scope, active: !!reg.active, controlled: !!navigator.serviceWorker.controller };
    }""")
    p(sw['active'], 'service worker active', sw['scope'])
    p(sw['scope'].rstrip('/') == BASE.rstrip('/'), 'scope is the site root', sw['scope'])
    p(sw['controlled'], 'page controlled by the service worker (clients.claim)')
    man = page.evaluate("""async () => { const l = document.querySelector('link[rel=manifest]'); const r = await fetch(l.href); const j = await r.json(); return { ok: r.ok, name: j.name, display: j.display, icons: j.icons.length }; }""")
    p(man['ok'] and man['display'] == 'standalone' and man['icons'] >= 3, 'manifest served and parses', str(man))
    p(page.evaluate("document.querySelector('meta[name=theme-color]')?.content") == '#0b1326', 'theme-color meta')

    # Second load: now every fetch goes through the worker and the weather
    # responses behind the page land in the runtime cache.
    page.reload(wait_until='load', timeout=60000)
    page.wait_for_function("labels => labels.some(l => document.body.innerText.includes(l))", arg=DANGER, timeout=40000)
    page.wait_for_timeout(4000)
    caches = page.evaluate("async () => (await caches.keys()).sort()")
    p(any(k.startswith('pyra-shell-v') for k in caches), 'versioned shell cache exists', ','.join(caches))
    rt = page.evaluate("async () => { const c = await caches.open('pyra-runtime-v1'); return (await c.keys()).map(k => new URL(k.url).hostname); }")
    p(any('cwfis' in h or 'open-meteo' in h or 'weather.gc.ca' in h for h in rt), 'weather responses cached for offline fallback', f"{len(rt)} entries: {sorted(set(rt))}")
    p(page.locator('#pyra-offline-strip:visible').count() == 0, 'no offline strip while online')

    print("\n  ── Feedback button ──")
    fb = page.locator('#pyra-feedback-btn')
    p(fb.count() == 1 and fb.is_visible(), 'Feedback button visible')
    box = fb.bounding_box()
    nav = page.locator('nav[aria-label="Primary"]').bounding_box()
    p(box and nav and box['y'] + box['height'] <= nav['y'] + 1, 'button sits above the bottom nav', f"btn bottom {box and box['y']+box['height']:.0f} vs nav top {nav and nav['y']:.0f}")
    p(box and box['height'] >= 44, 'button is a 44 px tap target', f"{box and box['height']}")
    fb.click()
    panel = page.locator('#pyra-feedback-panel')
    p(panel.is_visible(), 'panel opens')
    href = page.locator('#pyra-feedback-panel .pf-issue').get_attribute('href')
    p(href.startswith('https://github.com/Tphambolio/FWI/issues/new?title='), 'GitHub issue link prefilled', href[:70])
    p('ab%2Fstation' in href and '(v' in href, 'issue carries page id + version')
    p('Hussar' not in href, 'issue does not carry the ?stn= station')
    p(page.locator('#pyra-feedback-panel .pf-mail').count() == 0, 'Email option hidden while feedbackEmail is empty')
    page.locator('#pyra-feedback-panel [data-rating="4"]').click()
    p('Thanks' in page.locator('#pyra-feedback-panel .pf-thanks').inner_text(), 'rating thanked')
    p(page.evaluate("JSON.parse(localStorage.getItem('pyra-feedback-rating')||'{}').rating") == 4, 'rating kept on device (no post endpoint)')
    ov = page.evaluate("() => document.documentElement.scrollWidth - innerWidth")
    p(ov <= 0, 'no horizontal scroll at 390 px with the panel open', f'overflow {ov}px')
    page.locator('#pyra-feedback-panel .pf-close').click()
    p(page.locator('.pyra-install-btn').count() == 0, 'no Install button without beforeinstallprompt')
    p(not js_errors, 'no JS errors online', '; '.join(js_errors[:2]))
    ctx.close()

    # ── Phase 2: truly offline ───────────────────────────────────────────────
    print("\n  ── Offline (DNS blocked" + (", local server stopped" if server else "") + ") ──")
    if server:
        server.shutdown(); server.server_close()
    ctx = pw.chromium.launch_persistent_context(profile, headless=True, args=['--host-resolver-rules=MAP * ~NOTFOUND'], **PHONE)
    ctx.set_offline(True)   # page-level too, so navigator.onLine is false
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    js_errors = []
    page.on('pageerror', lambda e: js_errors.append(str(e)))
    try:
        page.goto(f"{AB_URL}?stn=Hussar%20AGDM", wait_until='load', timeout=60000)
        page.wait_for_timeout(6000)
        p(page.locator('#fwi-station-picker').count() == 1, 'station page shell served from the service-worker cache')
        strip = page.locator('#pyra-offline-strip')
        p(strip.count() == 1 and strip.is_visible(), 'offline strip visible')
        txt = strip.inner_text() if strip.count() else ''
        p('Offline' in txt and 'cached at' in txt, 'strip says offline + the cached-at time', txt[:100])
        st = page.evaluate("PyraPWA.state")
        p(bool(st.get('lastCachedAt')), 'cache hits reported X-Pyra-Cache: hit;<time>', str(st.get('lastCachedAt')))
        body = page.inner_text('body')
        p(any(l in body for l in DANGER), 'danger label rendered offline from cached data')
        p('NaN' not in body, 'no NaN offline')
        p(not js_errors, 'no JS errors offline', '; '.join(js_errors[:2]))
    except Exception as e:
        p(False, 'offline phase', str(e)[:200])
    ctx.close()

print(f"\nPASS {passed}  FAIL {failed}")
for i in issues: print(f"  ✗ {i}")
sys.exit(1 if failed else 0)
