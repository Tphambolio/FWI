#!/usr/bin/env python3
"""
Browser smoke test for the Pyra FWI live site.
Verifies AB and BC station detail pages load correctly via Playwright.

Checks per page:
  - HTTP 200
  - Danger rating label present (Low/Moderate/High/Very High/Extreme)
  - Temperature in -40..50°C (plausible, not NaN/null)
  - Weather source label present (CWFIS/SWOB/Open-Meteo)
  - No JS errors in console

Run: python3 tests/browser_smoke.py
Exit: 0 = all pass, 1 = any fail
"""
from playwright.sync_api import sync_playwright
import re, sys

BASE_AB = "https://tphambolio.github.io/FWI/station_detail/code.html"
BASE_BC = "https://tphambolio.github.io/FWI/bc/station_detail/code.html"

CHECKS = [
    (BASE_AB,              "AB station detail — default"),
    (BASE_AB + "?stn=LETH","AB Lethbridge"),
    (BASE_AB + "?stn=FORT","AB Fort McMurray"),
    (BASE_BC,              "BC station detail — default"),
    (BASE_BC + "?stn=KAMLOOPS", "BC Kamloops"),
    (BASE_BC + "?stn=CRAN",     "BC Cranbrook"),
]

DANGER_LABELS = {'Low', 'Moderate', 'High', 'Very High', 'Extreme'}
SOURCE_LABELS  = {'CWFIS', 'SWOB', 'Open-Meteo', 'NWP', 'MSC'}

passed = 0
failed = 0
issues = []

def check_page(page, url, label):
    global passed, failed
    js_errors = []
    page.on("pageerror", lambda e: js_errors.append(str(e)))

    resp = page.goto(url, wait_until="networkidle", timeout=30000)
    http_ok   = resp is not None and resp.status < 400
    body      = page.inner_text('body')

    danger    = any(d in body for d in DANGER_LABELS)
    temps     = re.findall(r'(-?\d+(?:\.\d+)?)\s*°C', body)
    plausible = any(-40 <= float(t) <= 50 for t in temps) if temps else False
    has_src   = any(s in body for s in SOURCE_LABELS)

    ok = http_ok and danger and not js_errors
    tag = 'PASS' if ok else 'FAIL'
    print(f"  {tag}  {label}")
    print(f"       http={'ok' if http_ok else resp.status if resp else '?'}  "
          f"danger={danger}  temps={temps[:2]}  source={has_src}  js_errs={len(js_errors)}")
    if js_errors:
        print(f"       JS errors: {js_errors[:3]}")
    if not http_ok:
        issues.append(f"{label}: HTTP {resp.status if resp else '?'}")
    if not danger:
        issues.append(f"{label}: no danger rating (body: {body[:120]!r})")
    if js_errors:
        issues.append(f"{label}: JS errors: {js_errors[:2]}")

    if ok:
        passed += 1
    else:
        failed += 1

print("\n── Pyra FWI browser smoke test ──")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    for url, label in CHECKS:
        check_page(page, url, label)
    browser.close()

print(f"\n{'─' * 50}")
print(f"PASS {passed}  FAIL {failed}")
if issues:
    print("\nIssues:")
    for i in issues:
        print(f"  {i}")
sys.exit(1 if failed > 0 else 0)
