# Pyra — Wildfire FWI

**Canadian Forest Fire Weather Index (CFFDRS) dashboard for Alberta and British Columbia.**  
Live weather → FWI/FBP fire behaviour · province-specific danger scales · 14-day NAEFS ensemble forecasts.

---

## Live Apps

| Province | Landing | Station Detail | Regional Summary | 14-Day Forecast |
|---|---|---|---|---|
| **Alberta** | [FWI/](https://tphambolio.github.io/FWI/) | [station_detail](https://tphambolio.github.io/FWI/station_detail/code.html) | [regional_summary](https://tphambolio.github.io/FWI/regional_summary/code.html) | [forecast_trends](https://tphambolio.github.io/FWI/forecast_trends/code.html) |
| **BC** | [FWI/bc/](https://tphambolio.github.io/FWI/bc/) | [bc/station_detail](https://tphambolio.github.io/FWI/bc/station_detail/code.html) | [bc/regional_summary](https://tphambolio.github.io/FWI/bc/regional_summary/code.html) | [bc/forecast_trends](https://tphambolio.github.io/FWI/bc/forecast_trends/code.html) |

---

## Fire Weather Index System

Pyra implements the full **CFFDRS** stack (Van Wagner 1987; Forestry Canada ST-X-3):

- **Fire Weather Indices** — FFMC, DMC, DC, ISI, BUI, FWI, DSR
- **Fire Behaviour Prediction** — ROS, HFI, CFB, FC, BE — all 16 CFFDRS fuel types (C1–C7, D1, M1–M4, O1a/O1b, S1–S3)
- **14-day NAEFS ensemble** — percentile bands from CWFIS WFS `firewx_naefs` layer, 35 BC stations + Alberta network

The FBP/FWI math is identical in both apps — only data tables, danger thresholds, and sector labels differ by province.

---

## Province Differences

### Alberta

| Item | Detail |
|---|---|
| Danger scale | Low / Moderate / High / Very High / Extreme (CIFFC standard 6-class without "Very Low") |
| Thresholds | Low <9 · Moderate <18 · High <33 · Very High <50 · Extreme ≥50 |
| Stations | CWFIS `firewx_stns_current` — Alberta network via `fetchCWFIS()` |
| Spring DC startup | 25–400 by zone (Alberta empirical; higher carry-over in dry SE) |
| Sectors | 6 latitude bands: NE Boreal · NW Sector · Lesser Slave · Central-N · Central · Southern |
| Default fuels | C2 (Boreal Spruce) · D1 (Leafless Aspen) |
| Noon LST | 19:00 UTC (MST = UTC−7) |
| Engine | `fwi.js` (root) |

### British Columbia

| Item | Detail |
|---|---|
| Danger scale | **Very Low / Low / Moderate / High / Extreme** (BCWS 5-class — no "Very High") |
| Thresholds | Very Low <5 · Low <12 · Moderate <21 · High <34 · Extreme ≥34 |
| Stations | **BCWS Datamart** (primary — 200+ BC fire weather stations, pre-computed FWI) → CWFIS `firewx_stns_current` (~11 BC border stations) → SWOB → Open-Meteo NWP |
| Spring DC startup | 50–175 by Fire Centre (maritime precip recharge via Van Wagner 1985 overwinter algorithm) |
| Sectors | 6 BC Fire Centres: Coastal · Kamloops · Cariboo · Prince George · Northwest · Southeast |
| Default fuels | C3 (Mature Lodgepole Pine) · C7 (Ponderosa Pine/Douglas-fir) |
| Noon LST | 20:00 UTC (PST = UTC−8) |
| Engine | `bc/fwi.js` (standalone, independent of root) |

The BC spring DC startup uses the Van Wagner (1985) overwinter carry-over equation:  
`DC_spring = DC_fall × e^(−rw/a) + b`  
where *rw* is accumulated overwinter precipitation, *a* = 50.04 mm per DC unit, *b* = 0.10.  
Cold-start fallback values by Fire Centre are hardcoded in `bc/fwi.js`.

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

## Architecture

```
FWI/
  fwi.js                     Alberta engine (pure AB — zero BC code)
  fwi-theme.js               Shared Tailwind theme config
  station_detail/code.html   AB station picker + FBP + trend chart
  regional_summary/code.html AB 6-sector overview
  forecast_trends/code.html  AB 14-day NAEFS matrix
  science_guide/code.html    AB science reference
  bc/
    fwi.js                   BC standalone engine (province hardcoded to BC)
    index.html               BC landing page
    station_detail/code.html BC station picker (C3/C7 defaults, BC danger scale)
    regional_summary/code.html  BC 6 Fire Centre overview
    forecast_trends/code.html   BC 14-day NAEFS (35 BC stations)
    science_guide/code.html     BC science reference (BCWS, SWOB, Van Wagner)
```

The BC engine (`bc/fwi.js`) is a fully self-contained copy. `_province` is hardcoded to `'BC'`; `setProvince()` is a no-op. The root `fwi.js` (Alberta) is untouched and has no BC code paths. Neither app can affect the other.

---

## Data Sources

| Source | Used for |
|---|---|
| **BCWS Weather Datamart** | BC FWI (Tier 0) — pre-computed FFMC/DMC/DC/BUI/ISI/FWI for 200+ BC stations. Daily CSV at `for.gov.bc.ca/ftp/HPR/external/!publish/BCWS_DATA_MART/YYYY/YYYY-MM-DD.csv` |
| **openmaps.gov.bc.ca** `PROT_WEATHER_STATIONS_SP` | BC station lat/lng registry (260 stations, `STATION_CODE` key for Datamart join) |
| CWFIS `firewx_stns_current` WFS | Alberta live fire weather (Tier 1 AB); limited BC coverage (~11 border stations) |
| Environment Canada SWOB | Tier 2 obs for BC stations not in BCWS Datamart or CWFIS |
| Open-Meteo NWP (HRRR/GFS) | Tier 3 fallback weather — last resort |
| CWFIS `firewx_naefs` WFS | 14-day NAEFS ensemble — AB (13 stations) + BC (35 stations, codes 10183–10269) |
| CFFDRS (Van Wagner 1987, ST-X-3) | FWI/FBP calculation — national standard |
| BCWS 2022 Implementation Guide | BC danger class thresholds |
| Van Wagner (1985) Appendix | BC spring DC overwinter algorithm |

---

## Fuel Types Supported

C1 · C2 · C3 · C4 · C5 · C6 · C7 · D1 · M1 · M2 · M3 · M4 · O1a · O1b · S1 · S2 · S3

All 16 CFFDRS fuel types with full FBP outputs (ROS, HFI, CFB, FC, BE, LB, WSE).

---

## References

- Van Wagner, C.E. (1987). *Development and structure of the Canadian Forest Fire Weather Index System.* Forestry Technical Report 35. Canadian Forestry Service, Ottawa.
- Forestry Canada Fire Danger Group (1992). *Development and Structure of the Canadian Forest Fire Behavior Prediction System.* Information Report ST-X-3.
- Van Wagner, C.E. (1985). *Drought, timelag and fire danger rating.* In: Proc. 8th Natl. Conf. on Fire and Forest Meteorology, pp. 178–185.
- BC Wildfire Service (2022). *CFFDRS Implementation Guide for BC Operations.* BCWS Fire Weather Program.

---

© 2026 Travis Kennedy · Free to use · No warranty  
[GitHub](https://github.com/Tphambolio/FWI) · [@lactucafarm](https://x.com/lactucafarm)
