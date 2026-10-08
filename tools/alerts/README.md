# Pyra threshold alerts

Tells an ops chief or IMT when fire behaviour at the stations they watch
crosses a threshold, so they don't have to open the site to find out.

For each watched station the tool runs the same path as the station page. The
province module and `core/fwi-core.js` load into a Node vm context, the same
way the tests load them, so the tool uses the engine's own science and data
tiers. Nothing is re-implemented. The path is:

1. `initFWI`: the CWFIS / BCWS / SWOB / Open-Meteo tier chain, with carry-over
   from the holding cache or `data/cwfis_prev.json`.
2. `fetchForecastDays` and `calcMultiDayFBP`, chained from today's state (the
   D+1 card chain). These give today's and tomorrow's **16:00 peak burn**:
   danger, FWI and the worst HFI class across the configured fuels.
3. `_provenance`: OBSERVED, MODEL FORECAST or CARRIED FROM YESTERDAY, plus the
   network and data age. For BC it also gives the BCWS official rating when a
   BCWS chain was used.

The tool then checks the thresholds and builds **one** plain-text message
that is short enough to read on a phone.

## Run it

```bash
cp tools/alerts/config.example.json tools/alerts/config.json   # gitignored; edit stations/thresholds
node tools/alerts/run.mjs --config tools/alerts/config.json            # = --dry-run
node tools/alerts/run.mjs --config tools/alerts/config.json --now 2026-07-15T20:00:00Z
```

| flag | effect |
|---|---|
| `--dry-run` | Default. Prints the message and the exact `openclaw agent …` command it would run. Quiet-mode state is not changed. |
| `--update-state` | Used with a dry run. Also records this run's crossings in `state.json`. |
| `--send` | Delivers through OpenClaw. **Refused** unless `delivery.enabled` is `true`. Saves state only after a successful delivery, so a failed send is retried on the next run. |
| `--now ISO` | Evaluates as of this instant. Live data is still fetched. |

Exit codes: `0` no alert, `10` alert produced, `1` error (bad config, delivery
failure, or every station failed). Stations fail one at a time: a station that
fails is listed under "NOT CHECKED" in the message and the other stations
still run. A failed station also keeps its previous quiet-mode state.

A per-station summary goes to stderr. The message and the command go to stdout.

## Config fields

| field | meaning |
|---|---|
| `timezone` | IANA zone for the message timestamp. Default `America/Edmonton`. |
| `stations[]` | `{ province: "AB"\|"BC", name }`. The name must match the engine's station list (`ALBERTA_STATIONS` / `BC_STATIONS`, case-insensitive). Regional names such as BC `Kamloops` also work, or you can give `lat`/`lng`. Optional fields: `fuels` (FBP codes; the worst one is used, and D1/D2 and M1/M2 follow leaf state), `curing`, `ps`, and `thresholds` (per-station override). Without `fuels` the page defaults apply: AB uses the station's fuel from the station table plus a complement, BC uses C3 + C7. |
| `thresholds.fwi` | Alerts when the 16:00 peak-burn FWI is at or above this value. This is the site's headline value. |
| `thresholds.hfiClass` | Alerts when the worst configured fuel's HFI class (1–6) is at or above this value. |
| `thresholds.bcwsDanger` | BC only. Alerts when the official BCWS danger class (`"Very Low"`…`"Extreme"` or 1–5) is at or above this value. Only checked when today's chain is a BCWS chain. |
| `quiet.enabled` | Default true. Alerts only on a **new** crossing compared with the last run, stored in `quiet.stateFile` (default `state.json` beside the config; gitignored). If a crossing holds, it doesn't alert again. If it drops and then rises, it alerts again. A new threshold on a station that is already alerting also counts as new. |
| `forecastLookAhead.enabled` | Default true. Also alerts if **tomorrow's** 16:00 peak burn is forecast to cross the FWI or HFI threshold. |
| `delivery` | `{ enabled, command: "openclaw", agent: "main" }`. Ships with `enabled: false`. |

Leave a threshold out (or set it to null) to skip that check. Example station
names in the sample config: AB `Edmonton Blatchford`, `Fort McMurray A`, and BC
`Afton`. Afton is the BCWS station 4 km from Kamloops A; `Kamloops A` itself is
not in `BC_STATIONS`.

## Enabling delivery later (owner)

Nothing here schedules itself. When you're ready, take these steps:

1. In `tools/alerts/config.json`, set `"delivery": { "enabled": true, "command": "openclaw", "agent": "main" }`.
2. Run `node tools/alerts/run.mjs --config tools/alerts/config.json --send` once by hand
   and confirm that Pilot relays the message.
3. Schedule that same command, for example as an OpenClaw cron job or a
   workstation crontab entry. A sensible cadence:
   - **14:30 local**, after the CWFIS noon-LST chain publishes (about 14:00 LST)
     and before the 16:00 peak burn;
   - optionally **07:00 local** for the forecast look-ahead.

   Quiet mode keeps repeated runs from re-sending a crossing that is still in
   place. A crontab-style line would look like this:
   `30 14 * * * cd ~/dev/FWI && node tools/alerts/run.mjs --config tools/alerts/config.json --send`.
   The cron is described here only and has not been created.

On `--send` the tool runs `openclaw agent --agent <agent> --message "<text>"`
directly with `execFile`, without a shell. Exit code 10 means a message was
handed off.

*Pyra — informational only; verify with your FBAN/agency.*

## Scheduled (workstation crontab)
Owner's setup (2026-10-08): delivered verbatim to WhatsApp through OpenClaw
(`delivery.channel` + `delivery.target` in the gitignored `config.json`),
default stations and thresholds, quiet mode on.

    30 14 * * * /home/rpas/dev/FWI/tools/alerts/run-daily.sh   # pyra_alerts

`run-daily.sh` loads Node 22 through nvm and logs every run to `~/logs/pyra-alerts.log`.
- Test the cron path without sending: `tools/alerts/run-daily.sh --dry-run`
- Test delivery end to end, leaving state alone: `node tools/alerts/run.mjs --config tools/alerts/config.json --test --send`
- Remove the schedule: `crontab -l | grep -v pyra_alerts | crontab -`
