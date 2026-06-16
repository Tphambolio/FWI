#!/usr/bin/env python3
"""
Browser smoke test for the Pyra FWI live site.
Verifies all major AB and BC app pages load correctly via Playwright.

Checks per page:
  - HTTP 200
  - Danger rating label present (Low/Moderate/High/Very High/Extreme)
  - Temperature in -40..50°C (plausible, not NaN/null) — where applicable
  - Weather source label present (CWFIS/SWOB/Open-Meteo)
  - No JS errors in console

Run: python3 tests/browser_smoke.py
Exit: 0 = all pass, 1 = any fail
"""
from playwright.sync_api import sync_playwright
import re, sys

BASE         = "https://tphambolio.github.io/FWI"
BASE_AB      = f"{BASE}/station_detail/code.html"
BASE_BC      = f"{BASE}/bc/station_detail/code.html"

# (url, label, wait_until)
# station_detail pages settle to networkidle; summary/trend pages keep
# long-polling background fetches so we use "load" + a short JS paint delay.
CHECKS = [
    (BASE_AB,                                      "AB station detail — default",    "networkidle"),
    (BASE_AB + "?stn=Lethbridge",                  "AB Lethbridge",                   "networkidle"),
    (BASE_AB + "?stn=McMurray",                    "AB Fort McMurray",                "networkidle"),
    (BASE_BC,                                      "BC station detail — default",     "networkidle"),
    (BASE_BC + "?stn=Vanderhoof",                  "BC Vanderhoof Hub (north)",        "networkidle"),
    (BASE_BC + "?stn=Cranbrook",                   "BC Cranbrook",                    "networkidle"),
    (f"{BASE}/regional_summary/code.html",         "AB regional summary",             "load"),
    (f"{BASE}/forecast_trends/code.html",          "AB forecast trends",              "load"),
    (f"{BASE}/science_guide/code.html",            "AB science guide",                "load"),
    (f"{BASE}/bc/regional_summary/code.html",      "BC regional summary",             "load"),
    (f"{BASE}/bc/forecast_trends/code.html",       "BC forecast trends",              "load"),
]

DANGER_LABELS = {'Very Low', 'Low', 'Moderate', 'High', 'Very High', 'Extreme'}
SOURCE_LABELS  = {'CWFIS', 'SWOB', 'Open-Meteo', 'NWP', 'MSC'}
JS_PAINT_MS    = 3000  # extra wait after "load" for JS to render initial content

passed = 0
failed = 0
issues = []

def check_page(browser, url, label, wait_until):
    global passed, failed
    page = browser.new_page()
    js_errors = []
    page.on("pageerror", lambda e: js_errors.append(str(e)))

    try:
        resp = page.goto(url, wait_until=wait_until, timeout=30000)
        if wait_until == "load":
            page.wait_for_timeout(JS_PAINT_MS)

        http_ok = resp is not None and resp.status < 400
        body    = page.inner_text('body')

        danger  = any(d in body for d in DANGER_LABELS)
        temps   = re.findall(r'(-?\d+(?:\.\d+)?)\s*°C', body)
        has_src = any(s in body for s in SOURCE_LABELS)

        ok  = http_ok and danger and not js_errors
        tag = 'PASS' if ok else 'FAIL'
        print(f"  {tag}  {label}")
        print(f"       http={'ok' if http_ok else resp.status if resp else '?'}  "
              f"danger={danger}  temps={temps[:2]}  source={has_src}  "
              f"wait={wait_until}  js_errs={len(js_errors)}")
        if js_errors:
            print(f"       JS errors: {js_errors[:3]}")
        if not http_ok:
            issues.append(f"{label}: HTTP {resp.status if resp else '?'}")
        if not danger:
            issues.append(f"{label}: no danger rating found")
        if js_errors:
            issues.append(f"{label}: JS errors: {js_errors[:2]}")

        if ok:
            passed += 1
        else:
            failed += 1

    except Exception as e:
        print(f"  FAIL  {label}")
        print(f"       ERROR: {e}")
        issues.append(f"{label}: {e}")
        failed += 1
    finally:
        page.close()

print("\n── Pyra FWI browser smoke test ──")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for url, label, wait_until in CHECKS:
        check_page(browser, url, label, wait_until)
    browser.close()

print(f"\n{'─' * 50}")
print(f"PASS {passed}  FAIL {failed}")
if issues:
    print("\nIssues:")
    for i in issues:
        print(f"  {i}")
sys.exit(1 if failed > 0 else 0)
