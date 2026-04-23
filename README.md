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
- D+1 tomorrow cards — peak burn forecast at ~14:00 LST from NAEFS ensemble
- 24-hour trend chart with FWI history
- Printable station briefing (PDF-ready) — includes fuel type label on all HFI sections
- Grass curing slider for O1a/O1b fuel types
- **193 Alberta stations** selectable via picker (CWFIS WFS — full AB fire weather network)
- **Station selection:** prefers nearest station with active FWI chain (FFMC + DC not null); falls back to nearest weather-only station if no FWI chain within 200 km
- **DC divergence warning:** flags when ≥2 nearby stations (≤75 km) differ by ≥75 DC units — indicates a localised precipitation event that may affect station representativeness

### Regional Summary
- All stations mapped; colour-coded by BC danger class or Alberta danger class
- Fire Centre / sector summary cards with live FWI

### 14-Day Forecast Trends
- NAEFS ensemble → Van Wagner carry-forward chain → FBP for each forecast day
- Fire Centre trend matrix (BC) / sector matrix (AB)
- Days-at-elevated-risk count per region

### Science Guide
- Full CFFDRS FWI system equations and BC vs AB danger scale comparison
- All 16 FBP fuel types — complete ST-X-3 parameter table (a, b, c, q, BUI₀, CBH, CFL, SFC)
- M1/M2 mixedwood blending, O1a/O1b curing factor, slash type SFC notes
- BC spring DC startup by Fire Centre · Van Wagner (1985) overwinter algorithm
- Data source provenance · BCWS Datamart · NAEFS · SWOB · Open-Meteo

---

## Province Differences

### Alberta

| Item | Detail |
|---|---|
| Danger scale | Low / Moderate / High / Very High / Extreme (CIFFC standard — no "Very Low") |
| Thresholds | Low <9 · Moderate <18 · High <33 · Very High <50 · Extreme ≥50 |
| Stations | CWFIS `firewx_stns_current` WFS — 193 stations, full AB fire weather network |
| Spring DC startup | 100–400 by zone (empirical; higher carry-over in dry SE) |
| Sectors | 6 latitude bands: NE Boreal · NW Sector · Lesser Slave · Central-N · Central · Southern |
| Default fuels | C2 (Boreal Spruce) · D1 (Leafless Aspen) |
| Noon LST | 19:00 UTC (MST = UTC−7) |
| Engine | `fwi.js` (root) |

### British Columbia

| Item | Detail |
|---|---|
| Danger scale | **Very Low / Low / Moderate / High / Extreme** (BCWS 5-class — no "Very High") |
| Thresholds | Very Low <5 · Low <12 · Moderate <21 · High <34 · Extreme ≥34 |
| Stations | **BCWS Datamart** (Tier 0 — 170+ stations, pre-computed FWI) → CWFIS border stations → SWOB → Open-Meteo NWP |
| Spring DC startup | 50–175 by Fire Centre (maritime precip recharge via Van Wagner 1985 overwinter algorithm) |
| Sectors | 6 BC Fire Centres: Coastal · Kamloops · Cariboo · Prince George · Northwest · Southeast |
| Default fuels | C3 (Mature Lodgepole Pine) · C7 (Ponderosa Pine/Douglas-fir) |
| Noon LST | 20:00 UTC (PST = UTC−8) |
| Peak burn | ~14:00 PDT |
| Engine | `bc/fwi.js` (standalone, independent of root) |

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
  fwi.js                     Alberta engine (pure AB — zero BC code)
  fwi-theme.js               Shared Tailwind theme config
  index.html                 Alberta landing (redirects to station_detail)
  station_detail/code.html   AB station picker + FBP + D+1 + trend chart
  regional_summary/code.html AB 6-sector overview + station map
  forecast_trends/code.html  AB 14-day NAEFS matrix
  science_guide/code.html    AB science reference (full 16-fuel table)
  bc/
    fwi.js                   BC standalone engine (_province hardcoded 'BC')
    index.html               BC landing page
    station_detail/code.html BC station picker (C3/C7 defaults, BC danger scale)
    regional_summary/code.html  BC 6 Fire Centre overview
    forecast_trends/code.html   BC 14-day NAEFS (35 BC stations)
    science_guide/code.html     BC science reference (BCWS, Van Wagner, full 16-fuel table)
```

The BC engine (`bc/fwi.js`) is fully self-contained. `_province` is hardcoded to `'BC'`; the root `fwi.js` (Alberta) has no BC code paths. Neither app can affect the other.

---

## Data Sources

| Source | Used for |
|---|---|
| **BCWS Weather Datamart** | BC FWI (Tier 0) — pre-computed FFMC/DMC/DC/BUI/ISI/FWI for 170+ BC stations. Daily CSV at `for.gov.bc.ca/ftp/HPR/external/!publish/BCWS_DATA_MART/YYYY/YYYY-MM-DD.csv` |
| **openmaps.gov.bc.ca** `PROT_WEATHER_STATIONS_SP` | BC station lat/lng registry (`STATION_CODE` key for Datamart join) |
| CWFIS `firewx_stns_current` WFS | Alberta live fire weather (Tier 1 AB); ~11 BC border stations |
| Environment Canada SWOB | BC Tier 2 — raw obs for stations not in BCWS Datamart |
| Open-Meteo NWP (ECMWF IFS) | Tier 3 fallback weather — last resort |
| CWFIS `firewx_naefs` WFS | 14-day NAEFS ensemble — AB (13 stations) + BC (35 stations, codes 10183–10269) |
| CFFDRS (Van Wagner 1987, ST-X-3) | FWI/FBP calculation — national standard |
| BCWS 2022 Implementation Guide | BC danger class thresholds |
| Van Wagner (1985) | BC spring DC overwinter algorithm |

---

## References

- Van Wagner, C.E. & Pickett, T.L. (1985). *Equations and FORTRAN program for the Canadian Forest Fire Weather Index System.* Forestry Technical Report 33.
- Van Wagner, C.E. (1987). *Development and structure of the Canadian Forest Fire Weather Index System.* Forestry Technical Report 35. Canadian Forestry Service, Ottawa.
- Forestry Canada Fire Danger Group (1992). *Development and Structure of the Canadian Forest Fire Behavior Prediction System.* Information Report ST-X-3.
- Van Wagner, C.E. (1985). *Drought, timelag and fire danger rating.* In: Proc. 8th Natl. Conf. on Fire and Forest Meteorology, pp. 178–185.
- Taylor, S.W.; Pike, R.G.; Alexander, M.E. (1997). *Field Guide to the Canadian Forest Fire Behavior Prediction (FBP) System.* Special Report 11. Natural Resources Canada.
- BC Wildfire Service (2022). *CFFDRS Implementation Guide for BC Operations.* BCWS Fire Weather Program.

---

© 2026 Travis Kennedy · Free to use · No warranty  
[GitHub](https://github.com/Tphambolio/FWI) · [@lactucafarm](https://x.com/lactucafarm)
