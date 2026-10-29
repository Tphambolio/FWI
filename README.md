# Pyra — Wildfire FWI

**Canadian Forest Fire Weather Index (CFFDRS) dashboard for Alberta and British Columbia.**  
Live weather → FWI/FBP fire behaviour · province-specific danger scales · 14-day NAEFS ensemble forecasts · printable station briefings.

---

## Live Apps

| Province | Landing | Station Detail | Regional Summary | 14-Day Forecast | Science Guide |
|---|---|---|---|---|---|
| **Alberta** | [FWI/](https://tphambolio.github.io/FWI/) | [station_detail](https://tphambolio.github.io/FWI/station_detail/code.html) | [regional_summary](https://tphambolio.github.io/FWI/regional_summary/code.html) | [forecast_trends](https://tphambolio.github.io/FWI/forecast_trends/code.html) | [science_guide](https://tphambolio.github.io/FWI/science_guide/code.html) |
| **BC** | [FWI/bc/](https://tphambolio.github.io/FWI/bc/) | [bc/station_detail](https://tphambolio.github.io/FWI/bc/station_detail/code.html) | [bc/regional_summary](https://tphambolio.github.io/FWI/bc/regional_summary/code.html) | [bc/forecast_trends](https://tphambolio.github.io/FWI/bc/forecast_trends/code.html) | [bc/science_guide](https://tphambolio.github.io/FWI/bc/science_guide/code.html) |

Each BC page has an **Alberta →** toggle in the top-right header to switch to the equivalent Alberta page, and vice versa.

---

## Features

### Station Detail
- Live FWI (FFMC · DMC · DC · ISI · BUI · FWI) from observed noon weather
- Dual FBP fire behaviour cards (Fuel A + Fuel B) — HFI class, ROS, flame length, fire type, CFB
- D+1 tomorrow cards — peak burn forecast at ~16:00 MDT from NAEFS ensemble
- 24-hour trend chart with FWI history
- Printable station briefing (PDF-ready) — includes fuel type label on all HFI sections
- Grass curing slider for O1a/O1b fuel types
- **193 Alberta stations** selectable via picker (CWFIS WFS — full AB fire weather network)
- **Station selection:** prefers nearest station with active FWI chain (FFMC + DC not null); falls back to nearest weather-only station if no FWI chain within 200 km
- **DC divergence warning:** flags when ≥2 nearby stations (≤75 km) differ by ≥75 DC units — indicates a localised precipitation event that may affect station representativeness
- **Spring DC floor correction:** many CWFIS MSC airport stations use DC=15 at season open (Van Wagner 1985 "no data" fallback) instead of the Lawson & Armitage (2008) overwinter carryover equation, causing systematic spring underinitialization. Pyra applies a coordinate-based regional floor (March–June only, Alberta only) calibrated from April 2026 CWFIS well-initialized station data and the Alberta Wildfire AEF pmwx.csv network. Values below 70% of the zone floor are corrected upward. Edmonton zone: 300 · SE prairies: 450 · Calgary metro: 280 · Red Deer: 290

### Regional Summary
- All stations mapped; colour-coded by BC danger class or Alberta danger class
- Fire Centre / sector summary cards with live FWI

### 14-Day Forecast Trends
- NAEFS ensemble → Van Wagner carry-forward chain → FBP for each forecast day
- Fire Centre trend matrix (BC) / sector matrix (AB)
- Days-at-elevated-risk count per region

### Installable app, works offline
- Pyra is a Progressive Web App: install it from the browser and the last briefing you opened reopens in the field with no signal, under an amber "Offline — showing data cached at <time>" strip
- Service worker (`sw.js`): app shell cache-first (versioned with the engine `?v=`), repo data files stale-while-revalidate, weather services / tiles / CDNs network-first with cache fallback
- "Install Pyra" button appears in the footer and menu only when the browser offers installation; iOS uses Share → Add to Home Screen

### Feedback and usage counting
- "Feedback" button on every page: 1–5 "Was this useful today?", a text box, and prefilled GitHub-issue / email options — never your station or location unless you type it
- Usage counting is configured in one file, `config/telemetry.js` (`none` · Cloudflare Web Analytics · a generic POST endpoint); no cookies, no fingerprinting, no personal data — see [privacy/](https://tphambolio.github.io/FWI/privacy/) (`docs/privacy.md`)

### Science Guide
- Full CFFDRS FWI system equations and BC vs AB danger scale comparison
- All 16 FBP fuel types — complete ST-X-3 parameter table (a, b, c, q, BUI₀, CBH, CFL, SFC)
- M1/M2 mixedwood blending, O1a/O1b curing factor, slash type SFC notes
- BC spring DC startup by Fire Centre · Van Wagner (1985) overwinter algorithm
- Data source provenance · BCWS Datamart · NAEFS · SWOB · ECCC GEM (GeoMet)

### Model weather: ECCC GEM read from MSC GeoMet
- Tier 3 model weather (noon-LST chain inputs when no station reports, 16:00 peak-burn wind, 24-h trend, operational-period outlook, 7-day forecast chain) is **ECCC GEM** — HRDPS 2.5 km → RDPS 10 km → GDPS 15 km — composited every 6 h by `.github/workflows/gem-points.yml` from GeoMet WCS into `data/gem/ab.json` and `data/gem/bc.json` (hourly temp / RH / 10 m wind / direction / rain at every station, now −48 h … +240 h). The browser reads one file per province; no third-party weather API is called per station. Format: `docs/data-sources.md`
- `config/weather.js` is the only switch: `fallback: 'open-meteo'` (shipped default during rollout) lets a page call Open-Meteo `gem_seamless` when the file is missing, older than 9 h or lacks the station; **set `fallback: 'none'` before any commercial use** (Open-Meteo's free tier is non-commercial). Provenance labels read "ECCC GEM (GeoMet)"; the "Open-Meteo" wording appears only on the fallback path
- Station elevations for foliar moisture content come from NRCan's CDEM (`data/station_elevation.json`, same Action) instead of the Open-Meteo elevation API
- Attribution: *Data Source: Environment and Climate Change Canada* (ECCC open data licence)

---

## Install on your phone

Pyra installs like an app and keeps the last briefing you opened for use without signal.

| Device | How |
|---|---|
| Android (Chrome, Edge, Samsung Internet) | Open any Pyra page → tap **Install Pyra** in the footer or the ☰ menu (or the browser's own "Install app" prompt) |
| iPhone / iPad (Safari) | Open Pyra in Safari → **Share** → **Add to Home Screen** |
| Windows / macOS (Chrome, Edge) | Install icon in the address bar, or **Install Pyra** in the footer |

Offline behaviour: pages and engine scripts are cached when first opened; the data responses behind the last page you viewed are kept as a fallback. With no connection the page renders from that cache and shows an amber strip "Offline — showing data cached at <time>". Values do not update until a connection returns. Clearing the site's data in the browser removes the cache.

## Privacy

No accounts, no cookies, no fingerprinting. Usage counting is a single switch in `config/telemetry.js` (`provider: 'none' | 'cloudflare' | 'post'`); the full statement is at [privacy/](https://tphambolio.github.io/FWI/privacy/) with its source text in `docs/privacy.md`.

---

## Province Differences

### Alberta

| Item | Detail |
|---|---|
| Danger scale | Low / Moderate / High / Very High / Extreme (CWFIS FWI map intervals — verified against the public:fwi raster legend) |
| Thresholds | Low ≤5 · Moderate 6–15 · High 16–22 · Very High 23–29 · Extreme 30+ (CWFIS FWI map intervals) |
| Stations | CWFIS `firewx_stns_current` WFS — 193 stations, full AB fire weather network |
| Spring DC startup | Regional floor correction applied (Mar–Jun): Edmonton 250 · SE prairies 450 · Calgary 280 · Red Deer 290 · Slave Lake 180. Raw CWFIS values below 70% of zone floor are corrected. Based on Lawson & Armitage (2008) overwinter equation + April 2026 AEF pmwx.csv calibration. |
| Sectors | 6 latitude bands: NE Boreal · NW Sector · Lesser Slave · Central-N · Central · Southern |
| Default fuels | C2 (Boreal Spruce) · D1 (Leafless Aspen) |
| Noon LST | 19:00 UTC (12:00 MST, CWFIS station standard time; kept after Alberta fixed its clock at UTC−6 on 2026-11-01 until CWFIS confirms — `tools/tz/cwfis_noon_probe.mjs`) |
| Engine | `fwi.js` (AB province module) + `core/fwi-core.js` (shared core) |

### British Columbia

| Item | Detail |
|---|---|
| Danger scale | **Very Low / Low / Moderate / High / Extreme** (BCWS 5-class — no "Very High") |
| Thresholds | Very Low <5 · Low <12 · Moderate <21 · High <34 · Extreme ≥34 |
| Stations | **BCWS Datamart** (Tier 0 — 170+ stations, pre-computed FWI) → CWFIS border stations → SWOB → ECCC GEM (GeoMet point series) |
| Spring DC startup | 50–175 by Fire Centre (maritime precip recharge via Van Wagner 1985 overwinter algorithm) |
| Sectors | 6 BC Fire Centres: Coastal · Kamloops · Cariboo · Prince George · Northwest · Southeast |
| Default fuels | C3 (Mature Lodgepole Pine) · C7 (Ponderosa Pine/Douglas-fir) |
| Noon LST | 20:00 UTC (PST = UTC−8) |
| Peak burn | ~16:00 PDT |
| Engine | `bc/fwi.js` (BC province module) + `core/fwi-core.js` (shared core) |

The BC spring DC startup uses the Van Wagner (1985) overwinter carry-over equation:  
`DC_spring = DC_fall × e^(−rw/a) + b`  
where *rw* is accumulated overwinter precipitation, *a* = 50.04 mm per DC unit, *b* = 0.10.  
Cold-start fallback values by Fire Centre are hardcoded in `bc/fwi.js → BC_STATION_STARTUP_DC`.

---

## BC Fire Centres

| Fire Centre | HQ | Sample Stations (170+ total in app) |
|---|---|---|
| Coastal | Victoria | Summit, Cedar, Toba Camp, Quinsam Base, Menzies Camp, Woss Camp, Homathko |
| Kamloops | Kamloops | Penticton RS, Lillooet, Revelstoke, Aspen Grove, Sparks Lake, Afton, McCuddy |
| Cariboo | Williams Lake | Alexis Creek, Horsefly, Riske Creek, Tatla Lake, Wells Gray, Churn Creek |
| Prince George | Prince George | Vanderhoof Hub, Mackenzie FS, Fort St James, Bear Lake, McBride, Bednesti |
| Northwest | Smithers | Burns Lake 850m, Dease Lake FS, Terrace, Bob Quinn Lake, Sustut, Kitpark |
| Southeast | Castlegar | Cranbrook, Elko, Grand Forks, Palliser, Revelstoke, Darkwoods, Koocanusa |

---

## FBP Fuel Types Supported

All 16 CFFDRS fuel types — selectable via the fuel picker on Station Detail. HFI class, ROS, flame length, CFB, and fire type are reported for each.

| Code | Name | Key Characteristic |
|---|---|---|
| C1 | Spruce-Lichen Woodland | Open sub-boreal; low crown fuel |
| C2 | Boreal Spruce | AB Fuel A default; low CBH = crown-fire prone |
| C3 | Mature Jack/Lodgepole Pine | BC Fuel A default; dominant interior BC fuel |
| C4 | Immature Jack/Lodgepole Pine | Post-fire/post-MPB regenerating stands |
| C5 | Red and White Pine | High CBH (18m) — crown-fire resistant at lower intensities |
| C6 | Conifer Plantation | Highest CFL (1.80 kg/m²) — extreme crown fuel load |
| C7 | Ponderosa Pine / Douglas-fir | BC Fuel B default; BUI₀=106 — BUI-driven at high danger |
| D1 | Leafless Aspen | AB Fuel B default; surface fire only (CBH=0, CFL=0) |
| D2 | Green Aspen | Near-zero spread (a=6); summer aspen |
| M1 | Boreal Mixedwood — Leafless | ROS blends C2 + D1 by PS% softwood fraction |
| M2 | Boreal Mixedwood — Green | ROS blends C2 + D2 by PS% softwood fraction |
| O1a | Matted Grass | Curing-driven; CF formula applied to ISI |
| O1b | Standing Grass | Fastest grass spread (a=250); extreme at 100% curing |
| S1 | Jack/Lodgepole Pine Slash | SFC=4.50 kg/m² — extreme surface fire intensity |
| S2 | White Spruce / Balsam Slash | SFC=4.50; slower spread than S1 |
| S3 | Cedar / Hemlock / DF Slash | SFC=4.50; fastest slash spread (c=3.2); BC coastal/cedar-hemlock |

Full ST-X-3 parameter tables (a, b, c, q, BUI₀, CBH, CFL, SFC) with operational notes are in the science guides.

---

## Architecture

```
FWI/
  core/fwi-core.js           Shared engine core: science core (FWI/FBP), data tiers,
                             DOM wiring, map, forecast + briefing builders, window.FWI
  fwi.js                     Alberta province module (PROVINCE config, stations, fuels,
                             AEF pmwx tier, DC floors / startup zones)
  fwi-theme.js               Shared Tailwind theme config + page chrome (menu)
  core/pwa.js                Service-worker registration, offline strip, Install button
  core/telemetry.js          Privacy-respecting page-view beacon + Feedback button/panel
  config/telemetry.js        The only telemetry/feedback settings file (provider, endpoint, email)
  config/weather.js          The only model-weather settings file (GEM file source, Open-Meteo fallback flag, max age)
  core/gem.js                Loader for the ECCC GEM point series (data/gem/<prov>.json) + station elevations
  data/gem/{ab,bc}.json      Hourly GEM series per station, written every 6 h by gem-points.yml (docs/data-sources.md)
  data/station_elevation.json  NRCan CDEM ground elevation per station (same Action)
  tools/gem/                 The Action's builder: lib.mjs (pure compositing/sampling) + gem_points.mjs (GeoMet WCS, CDEM COG)
  sw.js                      Service worker (app shell / data / third-party caching)
  manifest.webmanifest       Web app manifest (icons in icons/, generated by tools/pwa/make_icons.py)
  privacy/index.html         Privacy statement (source text: docs/privacy.md)
  index.html                 Alberta landing (redirects to station_detail)
  station_detail/code.html   AB station picker + FBP + D+1 + trend chart
  regional_summary/code.html AB 6-sector overview + station map
  forecast_trends/code.html  AB 14-day NAEFS matrix
  science_guide/code.html    AB science reference (full 16-fuel table)
  bc/
    fwi.js                   BC province module (PROVINCE config, stations, fuels,
                             BCWS noon-mirror tier, BC danger classes, DC floors)
    index.html               BC landing page
    station_detail/code.html BC station picker (C3/C7 defaults, BC danger scale)
    regional_summary/code.html  BC 6 Fire Centre overview
    forecast_trends/code.html   BC 14-day NAEFS (35 BC stations)
    science_guide/code.html     BC science reference (BCWS, Van Wagner, full 16-fuel table)
```

Each page loads its province module first, then the shared core, as classic scripts (no build step):

```html
<script src="../fwi.js?v=150"></script><script src="../config/weather.js?v=150"></script><script src="../core/gem.js?v=150"></script><script src="../core/fwi-core.js?v=150"></script>            <!-- AB pages -->
<script src="../fwi.js?v=150"></script><script src="../../config/weather.js?v=150"></script><script src="../../core/gem.js?v=150"></script><script src="../../core/fwi-core.js?v=150"></script>   <!-- bc/ pages -->
```

Every page then loads `config/telemetry.js`, `core/telemetry.js` and `core/pwa.js` at the same `?v=`; `sw.js` names its cache after that version (CI checks they agree, and that `config/weather.js` and `core/gem.js` load before the core).

The province module defines a single `PROVINCE` config object (time offsets, storage keys, station lists, danger classes, tier policy, …) plus genuinely province-specific code; the core reads it at load and call time and never branches on the province name. The science core (FWI equations, FBP parameters, FMC/RSI, `calculateFBP`) exists once, in `core/fwi-core.js` — CI checks that neither province module redefines it.

---

## Data Sources

| Source | Used for |
|---|---|
| **BCWS Weather Datamart** | BC FWI (Tier 0) — pre-computed FFMC/DMC/DC/BUI/ISI/FWI for 170+ BC stations. Daily CSV at `for.gov.bc.ca/ftp/HPR/external/!publish/BCWS_DATA_MART/YYYY/YYYY-MM-DD.csv` |
| **openmaps.gov.bc.ca** `PROT_WEATHER_STATIONS_SP` | BC station lat/lng registry (`STATION_CODE` key for Datamart join) |
| CWFIS `firewx_stns_current` WFS | Alberta live fire weather (Tier 1 AB); ~11 BC border stations |
| **Alberta Wildfire pmwx.csv** | AEF fire weather stations (25 stations, southern/central AB) — properly initialized via Lawson & Armitage (2008) overwinter equation. Used in IDW blend to correct DC underinitialization near AEF station coverage. `wildfire.alberta.ca/files/pmwx.csv` |
| Environment Canada SWOB | BC Tier 2 — raw obs for stations not in BCWS Datamart |
| **ECCC GEM via MSC GeoMet** (HRDPS 2.5 km → RDPS 10 km → GDPS 15 km) | Tier 3 model weather — hourly point series per station in `data/gem/<prov>.json`, built every 6 h by `gem-points.yml` from GeoMet WCS 2.0.1. *Data Source: Environment and Climate Change Canada.* Format and acceptance evidence: `docs/data-sources.md` |
| NRCan CDEM (cloud-optimised GeoTIFF) | Station ground elevation for FMC (`data/station_elevation.json`, same Action) — OGL-Canada |
| Open-Meteo `gem_seamless` (CC BY 4.0, non-commercial free tier) | **Fallback only**, behind `config/weather.js` `fallback: 'open-meteo'`: used when a GEM file is missing, > 9 h old or lacks the station; plus the elevation API for pin-dropped slope. Must be `'none'` for commercial use |
| CWFIS `firewx_naefs` WFS | 14-day NAEFS ensemble — AB (13 stations) + BC (35 stations, codes 10183–10269) |
| CFFDRS (Van Wagner 1987, ST-X-3) | FWI/FBP calculation — national standard |
| BC Wildfire Regulation (B.C. Reg. 38/2005, Sch. 2) | BC Fire Danger Class from BUI × FWI by Danger Region (reproduces BCWS ratings 99.87%) |
| Van Wagner (1985) | BC spring DC overwinter algorithm |

---

## References

- Van Wagner, C.E. & Pickett, T.L. (1985). *Equations and FORTRAN program for the Canadian Forest Fire Weather Index System.* Forestry Technical Report 33.
- Van Wagner, C.E. (1987). *Development and structure of the Canadian Forest Fire Weather Index System.* Forestry Technical Report 35. Canadian Forestry Service, Ottawa.
- Forestry Canada Fire Danger Group (1992). *Development and Structure of the Canadian Forest Fire Behavior Prediction System.* Information Report ST-X-3.
- Van Wagner, C.E. (1985). *Drought, timelag and fire danger rating.* In: Proc. 8th Natl. Conf. on Fire and Forest Meteorology, pp. 178–185.
- Lawson, B.D. & Armitage, O.B. (2008). *Weather Guide for the Canadian Forest Fire Danger Rating System.* Natural Resources Canada, Canadian Forest Service, Northern Forestry Centre, Edmonton, Alberta. — overwinter DC carryover equation used for spring startup initialization.
- Taylor, S.W.; Pike, R.G.; Alexander, M.E. (1997). *Field Guide to the Canadian Forest Fire Behavior Prediction (FBP) System.* Special Report 11. Natural Resources Canada.
- Province of British Columbia. *Wildfire Regulation*, B.C. Reg. 38/2005, Schedules 1–3 (Danger Regions, Fire Danger Class, restrictions).
- Full source list with Zotero keys: `docs/PROJECT_RECORD.md` §4.

---

© 2026 Travis Kennedy · Free to use · No warranty  
[GitHub](https://github.com/Tphambolio/FWI) · [@lactucafarm](https://x.com/lactucafarm)
