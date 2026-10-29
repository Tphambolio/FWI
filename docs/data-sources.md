# Pyra data sources — model weather (ECCC GEM via MSC GeoMet)

Pyra's Tier 3 model weather (the hourly NWP used for noon-LST chain inputs,
16:00 peak-burn wind, the 24-h trend chart, the operational-period outlook and
the 7-day forecast chain) comes from Environment and Climate Change Canada's
GEM models, read from **MSC GeoMet** by a GitHub Action and committed to this
repository as two point-series files. The browser reads those files; it does
not call a weather API per station.

**Data Source: Environment and Climate Change Canada** — reproduced under the
[ECCC Data Server End-use Licence](https://eccc-msc.github.io/open-data/licence/readme_en/)
(no fee, attribution required; the source is named on every page footer and in
each file's `attribution` field).

Station ground elevations (foliar moisture content, FCFDG 1992 Eqs. 3–4) come
from Natural Resources Canada's **Canadian Digital Elevation Model (CDEM)**,
Open Government Licence – Canada, read once per station from the national
cloud-optimised GeoTIFF.

Open-Meteo (`models=gem_seamless`, the pre-v150 source) is kept **only as a
fallback** behind `config/weather.js` (`fallback: 'none'` since 2026-10-29; set `'open-meteo'` to re-enable), used when a
GEM file is missing, older than `max_age_h` (9 h) or lacks a station. Its free
tier is for non-commercial use: **set `fallback: 'none'` before any commercial
use of Pyra.**

## Pipeline

| Step | Where | Cadence |
|---|---|---|
| Composite HRDPS → RDPS → GDPS point series | `tools/gem/gem_points.mjs` (+ `tools/gem/lib.mjs`, pure logic) | `.github/workflows/gem-points.yml`, 03:40 / 09:40 / 15:40 / 21:40 UTC (~3 h 40 after each 00/06/12/18Z cycle) and on demand |
| Write `data/gem/ab.json`, `data/gem/bc.json` | same | each run (commit `chore: update GEM point series (HRDPS run …)`) |
| Fill `data/station_elevation.json` for new stations | same, from the NRCan CDEM COG | only when a station is missing from the file |
| Read in the browser | `core/gem.js` → `core/fwi-core.js _nwpHourly()` | once per page per province |
| Freshness watch | `tools/uptime/check.mjs` (`Pyra GEM series AB/BC fresh (9 h)`, FAIL) + `Upstream ECCC GeoMet WCS` (WARN) | every 30 min |

### GeoMet layers (verified 2026-10-29)

| Model | Grid / horizon | Layers | Units as served |
|---|---|---|---|
| HRDPS continental | 2.5 km, hourly to +48 h, runs 00/06/12/18Z | `HRDPS.CONTINENTAL_TT` `_HR` `_WSPD` `_WD` `_PR` | °C · % · **m/s** · ° (from) · **mm accumulated since the run started** |
| RDPS | 10 km, hourly to +84 h, runs 00/06/12/18Z | `RDPS_10km_AirTemp_2m` `_RelativeHumidity_2m` `_WindSpeed_10m` `_WindDir_10m` `_Precip-Accum1h` | °C · % · m/s · ° · mm in the hour |
| GDPS | 15 km, hourly to +84 h then 3-hourly to +240 h, runs 00/12Z | `GDPS_15km_AirTemp_2m` `_RelativeHumidity_2m` `_WindSpeed_10m` `_WindDir_10m` `_Precip-Accum1h` `_Precip-Accum3h` `_Precip-Accum` | as RDPS; 3-h and run-total accumulations |

Conversions applied: wind × 3.6 → **km/h** (the CFFDRS 10 m open wind); HRDPS
rain = `PR(h) − PR(h−1)` within the run (first hour `PR(h)`); GDPS 3-hourly
tail rain = `Precip-Accum3h(t1) / 3` for each of the three hours `(t0, t1]`,
or `(Precip-Accum(t1) − Precip-Accum(t0)) / 3` beyond the 3-h layer's reach
(~+168 h), so every covered hour has a numeric rain value. Temperature, RH and
wind in the 3-hourly tail are linearly interpolated between the two bracketing
instants (direction through its unit vector). Every request pins the run with
`DIM_REFERENCE_TIME`, so one file never mixes runs within a model.

One WCS 2.0.1 `GetCoverage` per layer per hour over a single AB+BC box
(−139.1…−109.5 °E, 48.3…60.1 °N) returns a float32 GeoTIFF on a lat/lon grid
(HRDPS 671 × 351 px ≈ 0.94 MB; RDPS 94 × 131 ≈ 50 KB; GDPS 197 × 78 ≈ 62 KB).
Each is sampled bilinearly at every station (direction through sin/cos) and
discarded. Budget per cycle: **≈ 680–810 coverages, 240–370 MB, 80–100 s** at
concurrency 5 (first run of a day with a fresh HRDPS cycle: 48 × 5 HRDPS +
36 × 5 RDPS + 52 × 5 GDPS-tail requests; the first ever run adds ≤ 30 × 5
short-lead backfills for the history). The Action aborts without writing if
fewer than 90 % of the coverages download.

### History

The grid runs from now − 48 h to now + 240 h. Hours at or before the newest
HRDPS run start are *history*: the previous file's values for those hours are
carried forward (they were HRDPS short-lead forecasts when written), and gaps
are backfilled from the newest earlier run with a 1–6 h lead
(`DIM_REFERENCE_TIME` of that run). The browser needs ≤ 48 past hours (the
24-h rain window to noon LST, the 23-h trend chart, the outlook's seed).

## File format `data/gem/<prov>.json` (schema 1)

```jsonc
{
  "schema": 1, "province": "ab",
  "generated": "2026-10-29T13:17:21.512Z",            // staleness stamp (browser max_age_h = 9)
  "attribution": "Data Source: Environment and Climate Change Canada",
  "licence": "https://eccc-msc.github.io/open-data/licence/readme_en/",
  "model_runs": { "hrdps": "2026-10-29T06:00:00Z", "rdps": "2026-10-29T06:00:00Z", "gdps": "2026-10-29T00:00:00Z" },
  "start": "2026-10-27T13:00:00Z", "step_h": 1, "n": 289,   // hour i = start + i h (UTC)
  "units": { "temp": "°C (2 m)", "rh": "% (2 m)", "wind": "km/h (10 m)", "wdir": "deg, from", "rain": "mm in the hour ending at the step" },
  "src": "-6h30H48R36g150-13",   // one character per hour, see src_legend (H HRDPS · h HRDPS short-lead history · R RDPS · G GDPS hourly · g GDPS 3-hourly interpolated · p carried · - none)
  "src_legend": { "H": "...", "h": "...", "R": "...", "G": "...", "g": "...", "p": "...", "-": "no data" },
  "stations": {
    "Edmonton Blatchford": { "lat": 53.567, "lon": -113.517,
      "temp": [null, -2.7, …], "rh": [null, 91, …], "wind": [null, 12.1, …], "wdir": [null, 322, …], "rain": [null, 0.1, …] },
    "EDMONTON BLATCHFORD": { "alias": "Edmonton Blatchford" }   // same point (≤ 100 m): one series stored
  }
}
```

- Keys are the exact station names the engines use (`ALBERTA_STATIONS`,
  `BC_STATIONS`, every `data/cwfis_prev.json` station). The browser looks a
  station up by **coordinates** (nearest point within `max_point_km`, 1 km).
- Numbers are rounded to one decimal (RH and direction to integers); `null`
  marks an hour no model covers (outside the span, or a failed coverage).
- Sizes (2026-10-29): AB 319 points + 76 aliases → 1.6 MB; BC 497 + 157 → 2.5 MB
  (GitHub Pages serves them gzipped, ≈ 25 %).

## File format `data/station_elevation.json`

```jsonc
{ "generated": "…", "source": "NRCan CDEM … EPSG:3979 — Open Government Licence – Canada",
  "url": "https://datacube-prod-data-public.s3.amazonaws.com/store/elevation/cdem-cdsm/cdem/cdem-canada-dem.tif",
  "stations": { "Edmonton Blatchford": { "lat": 53.567, "lon": -113.517, "elev": 667 }, "OMAK AIRPORT": { "lat": …, "lon": …, "elev": null } } }
```

`elev` is the nearest 16 m CDEM cell (points projected with the EPSG:3979
Lambert conformal conic in `tools/gem/lib.mjs lcc3979`); `null` for the few
US border stations outside the CDEM. Spot check against the Open-Meteo
elevation API (Copernicus GLO-90): Edmonton Blatchford 667 / 667 m, Kamloops A
344 / 344, Hussar 892 / 891, Fort Chipewyan 225 / 223.

## Acceptance evidence (2026-10-29, Edmonton Blatchford 53.567 −113.517)

GeoMet HRDPS 00Z run sampled from the file vs Open-Meteo `gem_seamless` for
the same UTC hours:

| Hour (UTC) | Source | Temp °C GEM / OM | RH % | Wind km/h | Dir ° | Rain mm |
|---|---|---|---|---|---|---|
| 2026-10-29 01:00 | H (HRDPS) | −2.7 / −2.6 | 91 / 90 | 12.1 / 11.9 | 322 / 321 | 0.1 / 0.1 |
| 2026-10-29 14:00 | H (HRDPS, raw raster) | −3.35 / −3.2 | 93.7 / 93 | 6.2 (1.73 m/s) / 6.1 | 318.8 / 319 | 0.04 (PR 14Z − PR 13Z) / 0.0 |

The wind match confirms the GeoMet layers are m/s; the differenced `PR`
matches Open-Meteo's hourly precipitation. An independent 7-hour check across
h/H/R/g sources found temperature within 0.6 °C, RH within 2 points, wind
within 1.6 km/h, direction within 15°, rain equal.

## Running it by hand

```bash
npm install --prefix tools/gem           # geotiff 2.1.3, pinned; node_modules is git-ignored
node tools/gem/gem_points.mjs --dry      # plan only: runs, hour sources, request count
node tools/gem/gem_points.mjs            # ≈ 1.5–3 min; writes data/gem/*.json (+ elevations)
node --test tests/gem_action.test.mjs tests/gem.test.mjs
```
