# Pyra operations runbook

For whoever is on watch while the apps run unattended (the 2027 season is supported remotely).
Companion: FireSim `docs/runbook.md` in Tphambolio/wildfire-simulator. Both apps are monitored
from this repository by `.github/workflows/uptime.yml` (every 30 min, `tools/uptime/check.mjs`).

## What is running

| Part | Where | Cost | Deploys |
|---|---|---|---|
| Pyra site | GitHub Pages from `main`, https://tphambolio.github.io/FWI/ | $0 | every push to `main` (1–3 min) |
| CWFIS / BCWS / AEF mirror | Action `cwfis-daily.yml`, 20:15 UTC daily → `data/cwfis_prev.json`, `data/bcws_noon.json`, `data/aef_pmwx.csv` | $0 | commits to `main` |
| Alberta Red Flag relay | Action `ab-redflag.yml`, 17:30 and 22:30 UTC → `data/ab_redflag.json` (commits only when the status changes) | $0 | commits to `main` |
| ECCC GEM point series | Action `gem-points.yml`, 03:40 / 09:40 / 15:40 / 21:40 UTC (≈ 3 h 40 after each HRDPS/RDPS cycle) → `data/gem/ab.json`, `data/gem/bc.json`, `data/station_elevation.json` (`tools/gem/`, ≈ 700–800 GeoMet WCS requests, 1.5–3 min) | $0 | commits to `main` |
| Science/unit tests | Action `tests.yml` on push and PR | $0 | — |
| Uptime monitor | Action `uptime.yml`, every 30 min | $0 | opens/closes an issue labelled `uptime` |
| Daily WhatsApp threshold alert | Workstation cron 14:30 local → `tools/alerts/run-daily.sh` → OpenClaw | $0 | **depends on the workstation being on** |

Pyra has no server of its own: the browser calls CWFIS (NRCan WFS) and ECCC SWOB directly and reads the
repository's mirrored files (BCWS noon, AEF pmwx, CWFIS carry-over, **ECCC GEM point series**) in a tiered
fallback. One upstream outage degrades a tier; the page still loads and the provenance chip says which tier
served the numbers. Model weather comes from `data/gem/<prov>.json` (GeoMet, every 6 h); `config/weather.js`
decides whether a page may still call Open-Meteo when that file is missing or > 9 h old
(`fallback: 'none'` since 2026-10-29: Open-Meteo is never called; a stale GEM file is used and labelled, a missing file is an error — so the `GEM series fresh` checks below are the ones that matter).

## Alerts

1. The uptime workflow opens **one** issue titled "Uptime: check failing" with the failing lines, comments on
   every later failing run, and closes it with a "Recovered" comment when all checks pass. GitHub e-mails the
   repository owner on open and close.
2. Optional phone push: set the repository variable `NTFY_TOPIC` (Settings → Secrets and variables → Actions →
   Variables) to a long random topic name and subscribe to it in the ntfy app (ntfy.sh, free, no account).
3. Upstream outages are `WARN` only and never open an issue.

## Triage

| Symptom (check name) | Likely cause | Do |
|---|---|---|
| `Pyra AB/BC station page` or `Pyra index` fail | GitHub Pages incident, or a broken push to `main` | Check https://www.githubstatus.com. If Pages is fine, open the page in a browser: a blank page or console error means a bad commit — `git revert <sha>` and push (see Rollback). |
| `cwfis-daily workflow ran` fail | CWFIS WFS down, BCWS or AEF endpoint changed, or the Action's push was rejected | Open the run in Actions. Network errors: re-run the job once; if CWFIS is down the app still works from the browser holding cache and shows amber/red provenance. Push rejected: re-run (the job rebases). Format change: fix the parser in the workflow, test with `workflow_dispatch`. |
| `ab-redflag workflow ran` fail | AWCC forecast PDF format or URL changed | Open the run log. The relay is an *official-product echo*; if the parser cannot read the banner it must write no products, never guess. Fix `tools/redflag/ab_redflag.mjs`, run `node tests/redflag.test.mjs`. |
| `CWFIS/BCWS/AEF mirror fresh` fail with the workflow passing | The mirror file is unchanged for > 36 h (upstream serving stale data) | Check https://cwfis.cfs.nrcan.gc.ca/ and https://wildfire.alberta.ca/files/pmwx.csv by hand. Nothing to fix on our side; note it in the issue. Off-season (Nov–Mar) AB stations go quiet but the files still regenerate daily. |
| `FireSim API health/version` fail | Fly machine stopped, out of memory, or a bad deploy | FireSim runbook (`docs/runbook.md` there): `flyctl status -a firesim-api`, `flyctl logs -a firesim-api`, `flyctl machine restart <id>`; rollback with `flyctl releases` + `flyctl deploy --image`. |
| `FireSim frontend` fail | Vercel build failed or Vercel incident | Vercel dashboard → Deployments → promote the previous production deployment. |
| `Pyra GEM series AB/BC fresh (9 h)` fail | `gem-points.yml` did not run or failed (GeoMet outage, a layer renamed, < 90 % of coverages downloaded, push rejected), or GitHub started the scheduled run late | Open the run in Actions. Pages keep working: with `config/weather.js` `fallback: 'open-meteo'` they call Open-Meteo for model weather and label it so; with `'none'` they use the stale file and the provenance says how old it is. Network errors: re-run the job (`workflow_dispatch`). Layer or dimension change: `node tools/gem/gem_points.mjs --dry` locally shows which model/layer fails; fix `tools/gem/lib.mjs MODELS`, run `node --test tests/gem_action.test.mjs`. Push rejected: re-run (the job rebases). |
| `Upstream ECCC GeoMet WCS` WARN | geo.weather.gc.ca outage or maintenance | Nothing. The next `gem-points.yml` run picks up; the file check above pages only if it stays stale > 9 h. |
| Users see times one hour off after 2026-11-01 | Their browser's time-zone data predates Alberta's/BC's clock change | Expected to be handled: Pyra formats all local times on fixed offsets (`_wallFmt`), not the browser's zone data. If it still happens, the page is cached — hard-reload; the service worker's cache name follows the `?v=` version. |
| A page shows old numbers after a release | Browser cache / service worker | Bump `?v=` on the page's script tags (and the SW cache name) and push. Users get the new version on the next load. |
| No WhatsApp alert came | Workstation off, OpenClaw gateway down, or no new threshold crossing (quiet mode) | `tail ~/logs/pyra-alerts.log`; `openclaw gateway status`. Exit 0 = nothing new, 10 = alert sent. This path is not monitored by the uptime workflow. |

## Rollback

```bash
git -C ~/dev/FWI fetch origin && git -C ~/dev/FWI log --oneline -5 origin/main
git -C ~/dev/FWI revert --no-edit <bad-sha> && git -C ~/dev/FWI push origin main
```
Pages redeploys in 1–3 minutes. Mirror-data commits (`chore: update …`) are safe to leave in place.

## Release checklist

1. `bash tests/run_all.sh` (unit → parity → audit → live → browser). Browser E2E on the live site is the gold standard.
2. Bump `?v=` on every page whose scripts changed; bump the service-worker cache name if present.
3. Push to `main`; confirm the live page shows the change; `node tools/uptime/check.mjs` passes.
4. Add a §7 work-log row to `docs/PROJECT_RECORD.md`.

## Seasonal

- **Spring (March–April):** CWFIS stations come back; run `tools/tz/cwfis_noon_probe.mjs` hourly 17–22 UTC on a few days to confirm the noon-LST hour after the 2026-11-01 clock change (see `docs/PROJECT_RECORD.md` §6). Check the regional DC floor still makes sense.
- **Before each season:** re-run the BC danger-class parity against BCWS, re-check the Red Flag zone map, reconfirm `tools/alerts/config.json` recipients.
- **Autumn:** nothing scheduled; the mirrors keep running.

## Access needed

GitHub repository admin (Actions, Pages, variables). No other credentials exist for Pyra. The WhatsApp
alert path needs the workstation login and the OpenClaw gateway.
