#!/usr/bin/env bash
# Daily Pyra threshold alert (cron entry point).
#   30 14 * * * /path/to/FWI/tools/alerts/run-daily.sh   # 14:30 local, ahead of the 16:00 peak burn
# Uses tools/alerts/config.json (gitignored; delivery settings + recipient).
# Quiet mode: only NEW threshold crossings are sent. Extra args are passed
# through (e.g. --dry-run to test the cron path without sending).
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh" >/dev/null 2>&1 && nvm use 22 >/dev/null 2>&1
LOG="${PYRA_ALERT_LOG:-$HOME/logs/pyra-alerts.log}"
mkdir -p "$(dirname "$LOG")"
args=("$@"); [ ${#args[@]} -eq 0 ] && args=(--send)
{
  echo "=== $(date '+%F %T %Z') run ${args[*]}"
  node tools/alerts/run.mjs --config tools/alerts/config.json "${args[@]}"
  rc=$?
  case $rc in 0) echo "--- exit 0: no new crossing";; 10) echo "--- exit 10: alert produced";; *) echo "--- exit $rc: ERROR";; esac
} >> "$LOG" 2>&1
exit 0
