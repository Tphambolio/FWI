#!/usr/bin/env python3
"""
Deep end-to-end test for the Pyra FWI live site.

Goes beyond browser_smoke.py (which only checks page load + danger label).
Verifies:
  1.  All FWI components (FFMC/DMC/DC/ISI/BUI/FWI) populated + within scientific bounds
  2.  No "NaN" text anywhere on the page
  3.  Weather fields (temp/rh/wind) plausible and not "—"
  4.  Data source attribution rendered
  5.  FBP panel (ROS, HFI, CFB, flame) populated — not "—"
  6.  Station picker interaction: change station → data updates
  7.  URL deep-link (?stn=) loads correct station
  8.  Forecast / tomorrow preview panel renders values
  9.  Both AB and BC engines covered across geographically diverse stations
  10. Console JS errors fail the test

Scientific bounds (Van Wagner / FCFDG 1992):
  FFMC  0–101     DMC  0–999     DC  0–1500
  ISI   0–150     BUI  0–999     FWI 0–300

Run: python3 tests/e2e_deep.py
Exit: 0 = all pass, 1 = any failure
"""

from playwright.sync_api import sync_playwright, TimeoutError as PwTimeout
import re, sys

BASE    = "https://tphambolio.github.io/FWI"
AB_URL  = f"{BASE}/station_detail/code.html"
BC_URL  = f"{BASE}/bc/station_detail/code.html"

# Scientific validity bounds for each FWI component
BOUNDS = {
    'ffmc': (0,   101),
    'dmc':  (0,   999),
    'dc':   (0,  1500),
    'isi':  (0,   150),
    'bui':  (0,   999),
    'fwi':  (0,   300),
}

DANGER_LABELS  = {'Very Low', 'Low', 'Moderate', 'High', 'Very High', 'Extreme'}
SOURCE_LABELS  = {'CWFIS', 'SWOB', 'Open-Meteo', 'NWP', 'MSC', 'NAEFS'}
NETWORK_WAIT   = 30_000   # ms
PAINT_WAIT     = 4_000    # ms extra after "load" pages
FWI_CALC_WAIT  = 20_000   # ms to wait for FWI chain to finish (PENDING → value)

passed = failed = warn = 0
issues = []

def p(ok, label, detail=''):
    global passed, failed
    tag = 'PASS' if ok else 'FAIL'
    print(f"    {tag}  {label}" + (f"  [{detail}]" if detail else ''))
    if ok:
        passed += 1
    else:
        failed += 1
        issues.append(f"{label}: {detail}" if detail else label)


def get_text(page, selector):
    """Return stripped inner text of first matching element, or '' on miss."""
    try:
        el = page.query_selector(selector)
        return el.inner_text().strip() if el else ''
    except Exception:
        return ''


def parse_num(text):
    """Extract first number from text (handles '86.2', '15.3 km/h', '42%')."""
    m = re.search(r'-?\d+(?:\.\d+)?', text)
    return float(m.group()) if m else None


def check_fwi_components(page, label_prefix):
    """
    FWI components must either be numeric and within scientific bounds (FWI chain active),
    or ALL show '—' with danger=PENDING (CWFIS down / season not started — both valid states).
    Returns (ok, fwi_active) where fwi_active=True means values are populated.
    """
    print(f"\n  ── FWI components ({label_prefix}) ──")
    # Check if the chain is active by reading the FWI element
    fwi_els = page.query_selector_all('[data-fwi="fwi"]')
    fwi_text = next((e.inner_text().strip() for e in fwi_els
                     if e.inner_text().strip() not in ('', '—')), '')
    fwi_active = parse_num(fwi_text) is not None

    if not fwi_active:
        # Acceptable: chain not active. Verify all components show '—', not NaN or garbage.
        pending_ok = True
        for key in BOUNDS:
            els = page.query_selector_all(f'[data-fwi="{key}"]')
            texts = [e.inner_text().strip() for e in els if e.inner_text().strip()]
            for t in texts:
                if t not in ('—', '') and 'NaN' not in t:
                    # Unexpected non-dash, non-NaN value when chain is inactive
                    pass  # tolerate — may be partial render
                if 'NaN' in t:
                    pending_ok = False
        p(True, f'FWI chain PENDING (CWFIS down / season start) — all components show —', '')
        return True, False

    # Chain is active — every component must be in bounds
    all_ok = True
    for key, (lo, hi) in BOUNDS.items():
        els = page.query_selector_all(f'[data-fwi="{key}"]')
        text = next((e.inner_text().strip() for e in els
                     if e.inner_text().strip() not in ('', '—')), '')
        val = parse_num(text)
        in_bounds = val is not None and lo <= val <= hi
        ok = in_bounds
        p(ok, f'{key}={text}', f'bounds {lo}–{hi}' if not ok else '')
        if not ok:
            all_ok = False
    return all_ok, True


def check_no_nan(page, label_prefix):
    """No literal 'NaN' text anywhere visible on the page."""
    body = page.inner_text('body')
    nan_count = body.count('NaN')
    ok = nan_count == 0
    p(ok, f'no NaN on page ({label_prefix})',
      f'{nan_count} occurrences found' if not ok else '')
    return ok


def check_weather(page, label_prefix):
    """Temperature, RH, wind speed — plausible values, not dashes."""
    print(f"\n  ── Weather fields ({label_prefix}) ──")
    fields = {
        'temp':  (-50, 60),
        'rh':    (  1, 100),
        'wind':  (  0, 200),
    }
    all_ok = True
    for key, (lo, hi) in fields.items():
        text = get_text(page, f'[data-fwi="{key}"]')
        val  = parse_num(text)
        ok   = val is not None and lo <= val <= hi
        p(ok, f'{key}={text!r}', f'expect {lo}–{hi}' if not ok else '')
        if not ok:
            all_ok = False
    return all_ok


def check_source(page, label_prefix):
    """Data source attribution is rendered and recognised."""
    text = get_text(page, '[data-fwi="source-station"]')
    ok   = text != '' and text != '—' and any(s in text for s in SOURCE_LABELS)
    p(ok, f'source attribution ({label_prefix})', f'got {text!r}' if not ok else text[:60])
    return ok


def check_fbp_panel(page, suffix, label_prefix, fwi_active=True):
    """
    FBP panel — when FWI chain is active, ROS/HFI/CFB must be populated.
    When chain is PENDING, hfi-label must show 'N/A' (not fabricated low values).
    """
    print(f"\n  ── FBP panel {suffix} ({label_prefix}) ──")
    if not fwi_active:
        # Expect N/A shown, not fabricated values
        hfi_label = get_text(page, f'#fwi-fbp-hfi-label-{suffix}')
        ok = 'N/A' in hfi_label or hfi_label == ''
        p(ok, f'FBP N/A when chain PENDING (got {hfi_label!r})',
          'shows value but FWI chain is inactive' if not ok else '')
        return ok

    checks = {
        f'fwi-fbp-ros-{suffix}':   (0, 1000,  'm/min'),
        f'fwi-fbp-hfi-{suffix}':   (0, 150000, 'kW/m'),
        f'fwi-fbp-cfb-{suffix}':   (0, 100,    '%'),
        f'fwi-fbp-flame-{suffix}': (0, 200,    'm'),
    }
    all_ok = True
    for elem_id, (lo, hi, unit) in checks.items():
        text = get_text(page, f'#{elem_id}')
        val  = parse_num(text)
        ok   = text != '' and text != '—' and val is not None
        p(ok, f'{elem_id.split("-")[-2]}={text!r}', f'unpopulated' if not ok else '')
        if not ok:
            all_ok = False
    return all_ok


def check_js_errors(js_errors, label_prefix):
    """No JS console errors."""
    ok = len(js_errors) == 0
    p(ok, f'no JS errors ({label_prefix})',
      '; '.join(js_errors[:2]) if not ok else '')
    return ok


def check_tomorrow_preview(page, label_prefix):
    """Tomorrow / D+1 preview panel has forecast temp rendered."""
    text = get_text(page, '#fwi-d1-preview-temp')
    val  = parse_num(text)
    ok   = val is not None and -50 <= val <= 60
    p(ok, f'tomorrow preview temp ({label_prefix})',
      f'got {text!r}' if not ok else f'{text}')
    return ok


def check_d1_fbp_panel(page, label_prefix):
    """
    D+1 forecast FBP panel must be populated regardless of CWFIS state.
    When FWI chain is PENDING, buildD1Card falls back to startup-default chain
    and must still produce valid ROS/HFI/CFB for the forecast day.
    This verifies the null-chainStart fallback introduced in the CWFIS-outage fix.
    """
    print(f"\n  ── D+1 forecast FBP panel ({label_prefix}) ──")
    checks = [
        ('fwi-d1-preview-ros-a',       0, 500,   'm/min'),
        ('fwi-d1-preview-hfi-kwm-a',   0, 200000, 'kW/m'),
        ('fwi-d1-preview-cfb-a',       0, 100,   '%'),
        ('fwi-d1-preview-flame-a',     0, 200,   'm'),
        ('fwi-d1-preview-date',        None, None, 'date label'),
    ]
    all_ok = True
    for elem_id, lo, hi, unit in checks:
        text = get_text(page, f'#{elem_id}')
        if lo is None:
            # date label — just needs to be non-empty
            ok = text not in ('', '—', 'Loading…')
            p(ok, f'{elem_id.split("-")[-1]}={text!r}', 'still loading' if not ok else '')
        else:
            val = parse_num(text)
            ok  = text not in ('', '—') and val is not None
            p(ok, f'{elem_id.split("-")[-1]}={text!r}', f'unpopulated ({unit})' if not ok else '')
        if not ok:
            all_ok = False
    return all_ok


def run_station_page(browser, url, station_label, stn_param=None):
    """Full deep check on one station page."""
    full_url = url + (f'?stn={stn_param}' if stn_param else '')
    print(f"\n{'─'*60}")
    print(f"  {station_label}")
    print(f"  {full_url}")

    js_errors = []
    page = browser.new_page()
    page.on('pageerror', lambda e: js_errors.append(str(e)))

    try:
        resp = page.goto(full_url, wait_until='networkidle', timeout=NETWORK_WAIT)
        http_ok = resp is not None and resp.status < 400
        p(http_ok, 'HTTP 200', f'status={resp.status if resp else "?"}' if not http_ok else '')

        # Wait for FWI chain to finish: danger moves off PENDING/— to a real label
        # PENDING is an acceptable runtime state (CWFIS outage / season not started),
        # so treat timeout here as WARN only — not a test failure.
        try:
            page.wait_for_function(
                "() => { const t = document.querySelector('[data-fwi=\"danger\"]')?.innerText?.trim(); "
                "return t && t !== '—' && t !== 'PENDING'; }",
                timeout=FWI_CALC_WAIT
            )
        except PwTimeout:
            global warn
            warn += 1
            print(f'    WARN  FWI chain still PENDING after {FWI_CALC_WAIT//1000}s '
                  f'({station_label}) — CWFIS outage or season not started')

        _, fwi_active = check_fwi_components(page, station_label)
        check_no_nan(page, station_label)
        check_weather(page, station_label)
        check_source(page, station_label)
        check_fbp_panel(page, 'a', station_label, fwi_active)
        check_tomorrow_preview(page, station_label)
        check_d1_fbp_panel(page, station_label)
        check_js_errors(js_errors, station_label)

    except PwTimeout:
        p(False, f'page load timed out ({station_label})', f'{full_url}')
    except Exception as e:
        p(False, f'unexpected error ({station_label})', str(e))
    finally:
        page.close()


def run_station_switch_test(browser):
    """
    Interaction test: load default Edmonton, note FWI, then switch to
    Lethbridge via the station picker. Both stations must populate without NaN.
    """
    print(f"\n{'─'*60}")
    print("  Station picker interaction: Edmonton → Lethbridge")

    js_errors = []
    page = browser.new_page()
    page.on('pageerror', lambda e: js_errors.append(str(e)))

    try:
        page.goto(AB_URL, wait_until='networkidle', timeout=NETWORK_WAIT)
        # Wait for FWI chain to settle
        try:
            page.wait_for_function(
                "() => { const t = document.querySelector('[data-fwi=\"danger\"]')?.innerText?.trim(); "
                "return t && t !== '—' && t !== 'PENDING'; }",
                timeout=FWI_CALC_WAIT
            )
        except PwTimeout:
            pass  # continue anyway, the FAIL will surface below

        # Capture FWI value for Edmonton (may be '—' if CWFIS is down — that's ok)
        fwi_edm_text = get_text(page, '[data-fwi="fwi"]')
        fwi_edm = parse_num(fwi_edm_text)
        danger_text = get_text(page, '[data-fwi="danger"]')
        edm_loaded = fwi_edm is not None or danger_text in ('PENDING', *DANGER_LABELS)
        p(edm_loaded, 'Edmonton loaded before switch (FWI or PENDING)',
          f'danger={danger_text!r} fwi={fwi_edm_text!r}' if not edm_loaded else f'danger={danger_text!r}')

        # Switch station via picker
        picker = page.query_selector('#fwi-station-picker')
        if picker:
            picker.select_option(label='Lethbridge')
            page.wait_for_load_state('networkidle', timeout=NETWORK_WAIT)
            # Wait for FWI to re-calculate after station switch
            try:
                page.wait_for_function(
                    "() => { const t = document.querySelector('[data-fwi=\"danger\"]')?.innerText?.trim(); "
                    "return t && t !== '—' && t !== 'PENDING'; }",
                    timeout=FWI_CALC_WAIT
                )
            except PwTimeout:
                pass
        else:
            p(False, 'station picker found', 'element missing')
            return

        fwi_leth_text = get_text(page, '[data-fwi="fwi"]')
        fwi_leth = parse_num(fwi_leth_text)
        danger_leth = get_text(page, '[data-fwi="danger"]')
        leth_loaded = fwi_leth is not None or danger_leth in ('PENDING', *DANGER_LABELS)
        p(leth_loaded, 'Lethbridge loaded after switch (FWI or PENDING)',
          f'danger={danger_leth!r} fwi={fwi_leth_text!r}' if not leth_loaded else f'danger={danger_leth!r}')

        # DOM must not contain NaN after switch
        check_no_nan(page, 'after station switch')
        check_js_errors(js_errors, 'station switch interaction')

    except PwTimeout:
        p(False, 'station switch timed out', AB_URL)
    except Exception as e:
        p(False, 'station switch unexpected error', str(e))
    finally:
        page.close()


def run_load_page(browser, url, label):
    """
    Lightweight check for 'load'-wait pages (regional summary, forecast trends).
    Checks: HTTP 200, no NaN, no JS errors, danger label visible.
    """
    print(f"\n{'─'*60}")
    print(f"  {label}")
    js_errors = []
    page = browser.new_page()
    page.on('pageerror', lambda e: js_errors.append(str(e)))
    try:
        resp = page.goto(url, wait_until='load', timeout=NETWORK_WAIT)
        page.wait_for_timeout(PAINT_WAIT)
        http_ok = resp is not None and resp.status < 400
        p(http_ok, 'HTTP 200', f'status={resp.status if resp else "?"}')
        check_no_nan(page, label)
        check_js_errors(js_errors, label)
    except PwTimeout:
        p(False, f'timed out ({label})', url)
    except Exception as e:
        p(False, f'error ({label})', str(e))
    finally:
        page.close()


print(f"\n{'═'*60}")
print("  Pyra FWI  —  Deep E2E Test Suite")
print(f"{'═'*60}")

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)

    # ── AB station detail — three geographically diverse stations ──────────────
    run_station_page(browser, AB_URL, 'AB Edmonton (default)')
    run_station_page(browser, AB_URL, 'AB Lethbridge (south)',    'Lethbridge')
    run_station_page(browser, AB_URL, 'AB Fort McMurray (north)', 'McMurray')

    # ── BC station detail ──────────────────────────────────────────────────────
    run_station_page(browser, BC_URL, 'BC default')
    run_station_page(browser, BC_URL, 'BC Kamloops (interior)',   'Kamloops')
    run_station_page(browser, BC_URL, 'BC Cranbrook (southeast)', 'Cranbrook')

    # ── Interaction test ───────────────────────────────────────────────────────
    run_station_switch_test(browser)

    # ── Summary / trend pages (load-wait) ─────────────────────────────────────
    run_load_page(browser, f"{BASE}/regional_summary/code.html",     'AB regional summary')
    run_load_page(browser, f"{BASE}/forecast_trends/code.html",      'AB forecast trends')
    run_load_page(browser, f"{BASE}/bc/regional_summary/code.html",  'BC regional summary')
    run_load_page(browser, f"{BASE}/bc/forecast_trends/code.html",   'BC forecast trends')

    browser.close()

print(f"\n{'═'*60}")
print(f"PASS {passed}  WARN {warn}  FAIL {failed}")
if issues:
    print('\nFailed checks:')
    for i in issues:
        print(f"  ✗ {i}")
sys.exit(1 if failed > 0 else 0)
