#!/usr/bin/env bash
# Run every Pyra FWI test suite and report a combined result.
# Exit 0 = all pass, 1 = any failure.
#
# Usage: bash tests/run_all.sh
#        (run from repo root)

set -euo pipefail
cd "$(dirname "$0")/.."

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[0;33m'
NC='\033[0m'

pass=0
fail=0
results=()

run_suite() {
  local label="$1"; shift
  local cmd=("$@")
  printf "\n${YLW}── %s ──${NC}\n" "$label"
  if "${cmd[@]}"; then
    printf "${GRN}  SUITE PASS${NC}  %s\n" "$label"
    pass=$(( pass + 1 ))
    results+=("PASS  $label")
  else
    printf "${RED}  SUITE FAIL${NC}  %s\n" "$label"
    fail=$(( fail + 1 ))
    results+=("FAIL  $label")
  fi
}

# ── Node.js unit / integration suites ────────────────────────────────────────
run_suite "science (Van Wagner reference)" \
  node tests/science.test.mjs

run_suite "calc_audit (18 CFFDRS cases)" \
  node tests/calc_audit.mjs

run_suite "bc_parity (16 AB/BC engine cases)" \
  node tests/bc_parity.mjs

# ── Live network tests (skip gracefully if offline) ──────────────────────────
run_suite "live_chain (Open-Meteo 7-day, AB+BC engines)" \
  node tests/live_chain_test.mjs

run_suite "live_api (CWFIS + SWOB + NAEFS)" \
  node tests/live_api_test.mjs

# ── Browser smoke test (requires playwright) ─────────────────────────────────
if command -v python3 &>/dev/null && python3 -c "import playwright" 2>/dev/null; then
  run_suite "browser_smoke (6 AB+BC pages)" \
    python3 tests/browser_smoke.py
else
  printf "\n${YLW}── browser_smoke ──${NC}\n"
  printf "  SKIP  playwright not available\n"
  results+=("SKIP  browser_smoke (playwright unavailable)")
fi

# ── Summary ──────────────────────────────────────────────────────────────────
printf "\n%s\n" "$(printf '─%.0s' {1..60})"
for r in "${results[@]}"; do
  if [[ "$r" == PASS* ]]; then printf "${GRN}%s${NC}\n" "$r"
  elif [[ "$r" == FAIL* ]]; then printf "${RED}%s${NC}\n" "$r"
  else printf "${YLW}%s${NC}\n" "$r"; fi
done
printf "\nSuites: ${GRN}%d pass${NC}  ${RED}%d fail${NC}\n" "$pass" "$fail"

[[ $fail -eq 0 ]]
