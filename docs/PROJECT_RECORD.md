# Pyra — Project Record

Living record of the work, decisions, scientific references and testing behind
**Pyra**, the Alberta + BC fire weather / fire behaviour dashboard.

- **Live:** https://tphambolio.github.io/FWI/ (AB) · https://tphambolio.github.io/FWI/bc/ (BC)
- **Repo:** https://github.com/Tphambolio/FWI (local: `~/dev/FWI`)
- **Owner:** Travis Kennedy, P.Ag
- **Status at this revision:** engine v145 live; all 7 test suites green on the live site.

---

## 1. Purpose and audience

Pyra is a field tool for **firefighters and operations chiefs**, and decision
support for an **ICS-trained team managing an incident**: daily fire weather
(CFFDRS FWI System), fire behaviour (FBP System) by fuel type, operational-period
planning, and printable briefings.

It is not an RPAS / drone tool (an RPAS ops panel was removed in June 2026 and
declined again 2026-10-08). Every number is informational. Users must verify
with their FBAN or agency; the site says so on every page and printout.

## 2. Architecture

Static GitHub Pages site. No build step: Tailwind CDN, Leaflet, vanilla
classic scripts.

| File | Role |
|---|---|
| `core/fwi-core.js` | Shared engine: CFFDRS science (single copy), data tiers, carry-over chain, UI rendering, `window.FWI` |
| `fwi.js` | Alberta province module: stations, fuels, AEF tier, DC floors, `PROVINCE` config |
| `bc/fwi.js` | BC province module: stations, fuels, BCWS mirror tier, BC danger scale, `PROVINCE` config |
| `*/code.html`, `briefing/index.html` | Pages: station detail, regional map, forecast trends, briefing, science guide |
| `.github/workflows/cwfis-daily.yml` | Daily Action: CWFIS carry-over cache, AEF pmwx mirror, BCWS noon mirror |
| `.github/workflows/gem-points.yml`, `tools/gem/` | 6-hourly Action: ECCC GEM point series from MSC GeoMet WCS → `data/gem/{ab,bc}.json`; station elevations from NRCan CDEM → `data/station_elevation.json` (`docs/data-sources.md`) |
| `config/weather.js`, `core/gem.js` | Model-weather source switch (Open-Meteo fallback flag, max age) and the GEM file loader the core's `_nwpHourly` uses |
| `tools/alerts/` | Threshold alert tool, run through the owner's local agent (Pilot). Delivery is disabled until configured |
| `tests/` | Offline unit/regression suites, reference oracle, browser suites |
| `sw.js`, `manifest.webmanifest`, `icons/`, `core/pwa.js` | Installable web app: service worker (shell cache-first, repo data stale-while-revalidate, third-party network-first), offline strip, Install button. No science or data-tier logic |
| `core/telemetry.js`, `config/telemetry.js` | Page-view beacon (provider `none` / Cloudflare / generic POST) and the Feedback button. Config is the only file to edit |
| `privacy/index.html`, `docs/privacy.md` | Privacy statement linked from every footer |

Each page loads the province module first, then the core. Province
differences live in `PROVINCE` config fields, never in `if (province)`
branches. Both script tags share one cache-bust version.

### Data tiers

1. **CWFIS** `firewx_stns_current`: station obs with the operational FWI chain.
2. **BC:** BCWS noon mirror (`data/bcws_noon.json`). **AB:** Alberta Wildfire pmwx mirror.
3. **ECCC MSC SWOB:** station sensor obs, taking the record closest to noon LST.
4. **ECCC GEM via MSC GeoMet** (v150): hourly point series per station in
   `data/gem/<prov>.json` (HRDPS 2.5 km → RDPS 10 km → GDPS 15 km, rebuilt every
   6 h by `gem-points.yml`), sampled at exact noon-LST and 16:00 hours.
   Open-Meteo `gem_seamless` only as the fallback flagged in `config/weather.js`
   (file missing, > 9 h old, or no point within 1 km); `fallback: 'none'` is
   required before commercial use. Before v150 this tier called Open-Meteo
   directly (ECMWF IFS until v145, GEM after).

A chain counts only if it is dated today (LST). Otherwise the dated carry-over
(`cwfis_prev.json` or the browser holding cache) is stepped forward one day
with today's weather.

## 3. Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-10-06 | Fall back to the dated carry-over instead of PENDING when CWFIS is empty | Fresh browsers showed "season start pending" on High-danger days |
| 2026-10-06 | Keep engine FWI classes 5.5/15.5/22.5/29.5 | Verified to match the CWFIS `public:fwi` legend (SCRIBE layer uses 5/10/20/30) |
| 2026-10-07 | Date-based leaf phenology D1↔D2, M1↔M2 (green-up ~May 20, leaf drop ~Sep 27 at 53.5°N, ±2 d/° lat) | D2 cannot spread below BUI 80; October forecasts showed ~0 kW/m |
| 2026-10-07 | Keep "Torching" label for 0 < CFB < 0.1 | Operational cue (ST-X-3 calls it surface) |
| 2026-10-07 | Keep existing HFI class fill colours; only text colours may change | Alberta WUI Pocket Guide palette |
| 2026-10-07 | Headline "Today" FWI = 16:00 peak burn; every other FWI labelled with role + valid time | Field relevance |
| 2026-10-07 | Merge AB/BC engines into core + province modules | 3,200 duplicated lines had drifted |
| 2026-10-08 | 60-min fire size = cffdrs point ignition with acceleration (ST-X-3 Eqs. 70-72) | Textbook for a new start. The previous "Alberta FSB ~96 ha" calibration had no documented source |
| 2026-10-08 | BC shows the official BCWS danger rating beside the FWI-based class | BCWS rates days with its own tables, not FWI alone |
| 2026-10-08 | Forecast chain: ECMWF noon-LST values first; NAEFS medians only beyond the ECMWF horizon | NAEFS max_temp/min_rh biased the chain dry |
| 2026-10-08 | Slope via the cffdrs wind–slope vector; site terrain from map pin (DEM) or manual entry | Previously ROS × spread factor with no direction, and never used |
| 2026-10-08 | Pyra audience = firefighters / ops chiefs / ICS teams; no RPAS panel | Owner direction |
| 2026-10-09 | After 16:00 local the station page's primary card and headline show tomorrow's peak burn; the right card shows the day after; today's passed peak stays as one reference line (`6182985`) | Owner: "make it make sense after 1600 for the ops chief" — evening work is planning the next operational period |
| 2026-10-09 | The ICS station briefing prints from the station page; after 16:00 it leads with the next operational period, and it carries the hourly shift table and the second fuel (`6182985`, `dedfb2f`) | FBAN UAT: the briefing lacked the shift outlook and fuel B; the evening print described a passed peak |
| 2026-10-09 | Shared `?stn=` links, first visits and GPS-nearest use the station's own fuel (AB); a returning user's saved fuel survives a reload (`5eb6364`) | Phone UAT: a fresh phone showed C2 at prairie stations (Hussar HFI 6, 33,997 kW/m) |
| 2026-10-09 | FSB builder pre-ticks stations within 60 km of the incident station, with a live count (`e82afa2`) | Whole-sector pre-tick (58 stations) was invisible, so ticking local stations removed them |
| 2026-10-09 | Map clusters take the worst FWI danger inside; still-loading clusters are neutral grey; the map fits the station network (`2765420`, `e82afa2`) | Extreme southern stations were hidden behind neutral bubbles at a cropped edge |
| 2026-10-09 | Every FWI on the briefing names its basis ("daily, noon LST", or "stepped with 16:00 forecast weather, pre-noon") (`dedfb2f`) | Owner rule: no unlabelled FWI numbers |
| 2026-10-10 | All sources behind Pyra collected in the Zotero collection "Pyra Sources" (29 items: 13 linked from the existing library, 16 imported) with Zotero keys in §4; AB science guide Open-Meteo citation corrected from "Zuur & Förster" to Zippenfenig (2024) | Rigour for the Claude for Science record; source audit also found an NWP model mislabel and three unverifiable citations (Open items) |
| 2026-10-10 | Alberta Red Flag Watch/Warning relayed from the AWCC fire weather forecasts: a GitHub Action (twice daily) parses the AM/PM forecast banner into `data/ab_redflag.json`; stations are placed in fire weather forecast zones vectorised from Alberta Wildfire's 2024 zones map (georeferenced to 10TM, corner error ~0.03%); banner on the station page, chips on the regional alarm strip, a line on the printed station briefing (v148) | Official product only; Pyra computes no red flag of its own. Parser tested on a real 2023 Warning/Watch forecast; 19 towns land in their known zones; Wood Buffalo NP is outside all zones |
| 2026-10-10 | BC danger class computed from the Wildfire Regulation Schedule 2 (BUI × FWI by Danger Region) instead of an FWI-only proxy; briefing legend shows Class I–V (v147) | The proxy disagreed with BCWS; with truncated BUI/FWI the Schedule 2 tables reproduce BCWS's published rating 99.87% of the time. Schedule 1 is a 2005 district map, so each station's region was fitted from its own ratings (FRANK CREEK 1375 fits poorly, 67%, and takes its neighbour's region) |
| 2026-10-10 | Open-Meteo pinned to ECCC GEM (`models=gem_seamless`) and every label says GEM (`b3a1a56`, v145) | Source audit: the unpinned best_match blend served GFS while labels said ECMWF; GEM is Canada's operational model, with HRDPS 2.5 km over the first 48 h |
| 2026-10-10 | Daily codes are always stepped with noon-LST weather; before noon the noon-LST *forecast* hour is used, never the 16:00 hour. The 16:00 MDT/PDT hour (= 15:00 LST, an operational choice) gives only the wind for peak-burn ISI/FWI and FBP. Report example: FWI 39.9 (old, double-counted afternoon) → 27.2 daily / 32.2 peak | Van Wagner 1987 FTR-35 PDF p. 13: FWI computed from noon readings represents the mid-afternoon peak (FireSim vs Pyra comparison, M2) |
| 2026-10-18 | Alberta permanent UTC−6 (Official Time Act; IANA tzdata 2026c, no fall-back on 2026-11-01): dated clock rules `AB_CLOCK_RULES` in fwi.js read through core `_clockAt` / `_clockOn` / `_noonMsOn` / `_wallFmt`. Fire-weather day unchanged by default: noon LST = 19 UTC (13:00 MT) before and after, one setting `AB_FWI_LST_OFFSET_FROM_2026_11_01` (7; 6 = 18 UTC). Wall clock labelled MDT before 2026-11-01 02:00 MDT and "MT" after (owner's choice, not IANA "CST"); after the change Pyra formats Alberta times with the fixed UTC−6 instead of the browser's tz data; the alert tool likewise | CWFIS gives every Alberta station `tz_correct` −7 ("estimated from coordinate ranges and maps"; Saskatchewan is split −6/−7 by longitude though legally UTC−6), Alberta Wildfire's PM Actual is defined in MST; daily CWFIS values match ECCC 19 UTC hourly records (Edmonton Int'l CS 17 Oct 2026). No agency has announced a change after 1 Nov: re-check around 1 March 2027. Report "Alberta permanent UTC-6 switch 2026-10-18" (FireSim [R57]); FireSim PR switched together |
| 2026-10-18 | B.C. permanent UTC−7 (permanent daylight time after the 2026-03-08 spring-forward; no fall-back on 2026-11-01; IANA tzdata 2026b): dated `BC_CLOCK_RULES` in bc/fwi.js like Alberta's. Wall clock labelled PDT/PST before 2026-11-01 09:00 UTC and "PT" after (B.C.'s "Pacific time"; pending owner confirmation), fixed UTC−7 instead of the browser's tz data after the change; alert tool likewise. Fire-weather day unchanged: noon LST 20 UTC, one setting `BC_FWI_LST_OFFSET_FROM_2026_11_01` (8). Also: before the change, labels follow the instant's own offset (`_tzLabelAt`): winter times read MST / PST, no longer MDT / PDT | CWFIS `tz_correct`: 392 BC stations −8, 75 eastern −7. On 17 Oct 2026, seven months after B.C.'s legal change, CWFIS daily values matched ECCC hourly at 20 UTC (Kamloops AUT 19.1 °C/25 %/33 km/h; Prince George A Auto 8.4/74/24) and at 19 UTC for the −7 stations (Cranbrook A Auto 16.2/32/14; Dawson Creek A 9.7/56/34): a jurisdiction that changed its legal clock kept its CWFIS observation hour. FireSim [R57] addendum |
| 2026-10-25 | Printed briefings stamp "Prepared" and the heading date on the province wall clock (`_wallFmt` + `_tzLabelAt`) instead of the viewer's device clock and Intl abbreviation; `tools/tz/cwfis_noon_probe.mjs` added to observe CWFIS's refresh hour after 2026-11-01 | Follow-up to the 2026-10-18 clock rules |
| 2026-10-25 | Pyra is an installable web app (manifest + `sw.js`, v149). Shell cache-first under a cache named for the engine `?v=`; `data/*.json|csv` stale-while-revalidate only while the cached copy is under 15 min old, otherwise network-first (6 s) with cache fallback; CWFIS / ECCC / Open-Meteo / tiles / CDNs network-first with cache fallback, failed responses never cached; analytics and PayPal hosts never intercepted. A cache fallback carries `X-Pyra-Cache: hit;<time>` and the page shows "Offline — showing data cached at <time>" | A firefighter who opened the station page on Wi-Fi must be able to reopen it without signal. The 15-min bound on data-file staleness keeps the data tiers seeing the day's `cwfis_prev.json` / BCWS mirror rather than yesterday's, so no tier logic changes |
| 2026-10-25 | Usage counting lives in `config/telemetry.js` with three providers (`none`, `cloudflare`, `post`). The Cloudflare Web Analytics token that eight pages carried inline since launch moved there, so the shipped default is `cloudflare` (cookieless, no personal data) rather than silently dropping the owner's counter; `post` sends one `sendBeacon` per page view with exactly page id, province, version, installed, viewport class, record type and a sessionStorage-only session id — never station, coordinates or typed text. Privacy statement `privacy/` + `docs/privacy.md`, linked from every footer and the menu | Owner asked for privacy-respecting counting with no third-party script by default; the existing Cloudflare tag was already the de-facto counter, so the honest default is to keep it visible in one config line, switchable to `none` |
| 2026-10-25 | Feedback button (bottom-right, above the bottom nav, z below the menu) on every page: 1–5 "Was this useful today?" (beacon only in `post` mode, otherwise noted on the device), text box, prefilled GitHub issue and optional mailto (`feedbackEmail`, hidden when empty). Prefill carries page, version, province and the text only | Field users should be able to say "this was/wasn't useful today" in one tap without accounts; the prefilled issue must not leak a user's station or location unless they type it |

| 2026-10-29 | Uptime monitor: the `ab-redflag workflow ran` threshold raised from 14 h to 26 h. GitHub starts scheduled runs up to ~3 h late, so the 17:30/22:30 UTC slots landed ~20 h apart and the 14 h rule opened a false incident every afternoon 2026-10-25→28 (issues #9–#12). 26 h still catches a missed day | Ops only; no engine change |
| 2026-10-29 | Tier 3 model weather = **ECCC GEM read from MSC GeoMet** (v150): a 6-hourly Action composites HRDPS (≤ +48 h) → RDPS (≤ +84 h) → GDPS (hourly, then 3-hourly interpolated to +240 h) from WCS 2.0.1 GetCoverage over one AB+BC box, samples every engine/CWFIS station bilinearly (direction through its vector; wind m/s → km/h; HRDPS run-total rain differenced; GDPS 3-h rain spread over its three hours) and commits `data/gem/{ab,bc}.json` with 48 h of history carried from the previous file. `core/gem.js` serves the Open-Meteo-shaped hourly payload, so the noon-LST / 16:00 / 24-h-rain sampling in the core is untouched. Open-Meteo stays only behind `config/weather.js fallback: 'open-meteo'` (file missing, > 9 h old, no point within 1 km), shipped **on** for the rollout and documented as **must be `'none'` before commercial use**. Station elevations (FMC) from NRCan CDEM (`data/station_elevation.json`) instead of the Open-Meteo elevation API; the pin-drop slope DEM call sits behind the same flag. Labels: "ECCC GEM (GeoMet) · noon LST"; "Open-Meteo" wording only on the fallback path; footers carry "Data Source: Environment and Climate Change Canada" | Commercial use of Pyra needs a licence-clean model-weather source (Open-Meteo's free tier is non-commercial; RUNBOOK and business plan open item). GeoMet is ECCC's own GEM output under the open data licence; one repo file per province replaces ~1,000 third-party calls per regional page load. Acceptance: Edmonton Blatchford 2026-10-29 01Z GEM −2.7 °C / 91 % / 12.1 km/h / 322° / 0.1 mm vs Open-Meteo gem_seamless −2.6 / 90 / 11.9 / 321 / 0.1; 7-hour independent check within 0.6 °C, 2 RH points, 1.6 km/h, 15°, rain equal. Elevations 667/344/892/225 m vs 667/344/891/223 (Copernicus 90 m) |

## 4. Science implementation and references

The engine follows the cited equations. Where cffdrs (the R package) implements
them, the tests check the engine against an independent JS port of the cffdrs
source (`tests/reference.mjs`, ported from https://github.com/cran/cffdrs,
retrieved 2026-10-08).

| Component | Implementation | Source |
|---|---|---|
| FFMC, DMC, DC, ISI, BUI, FWI (daily) | Van Wagner equations; DC with T floored at −2.8 °C; inputs clamped as cffdrs | Van Wagner 1987; Van Wagner & Pickett 1985; cffdrs |
| Hourly FFMC | Van Wagner 1977 hourly form | Van Wagner 1977; cffdrs `hffmc` |
| FBP spread (RSI, BE, ROS, CFB, SFC, TFC, HFI) | ST-X-3 with GLC-X-10 updates (M1–M4, curing, D2, C6) | FCFDG 1992; Wotton et al. 2009 |
| FBP spread ISI | Eq. 53a high-wind form at WSV ≥ 40 km/h | FCFDG 1992; cffdrs `initial_spread_index(fbpMod = TRUE)` |
| Foliar moisture content | FCFDG Eqs. 1–8 including the elevation form (Eqs. 3–4) | FCFDG 1992; cffdrs `foliar_moisture_content` |
| Slope | Spread factor → slope-equivalent ISI → WSE → wind/slope vector (WSV, RAZ) | FCFDG 1992 Eqs. 39–51; Wotton et al. 2009 Eqs. 41–44; cffdrs `slope_adjustment` |
| 60-min fire size | Point-ignition acceleration; back-fire ROS; LB(t) incl. grass; ellipse area | FCFDG 1992 Eqs. 70–81; cffdrs `distance_at_time`, `back_rate_of_spread`, `length_to_breadth[_at_time]` |
| Flame length | Byram for surface fires; Thomas for CFB ≥ 0.1 | Byram 1959; Thomas 1963; Rothermel 1991; Alexander & Cruz 2012 |
| Spring DC floor | Regional heuristic for cold-start DC (not CFFDRS) | Project heuristic; cf. Lawson & Armitage 2008 overwinter DC |
| BC Fire Danger Class | Schedule 2 BUI × FWI tables for Danger Regions 1–3, values truncated; region per BCWS station fitted from BCWS's own 2026 DANGER_RATING (nearest station elsewhere); FWI-only proxy only when BUI is unknown. Reproduces BCWS ratings on 99.87% of 38,613 station-days (2026-05-01 to 09-30) | Wildfire Regulation, B.C. Reg. 38/2005, Schedules 1–2 |
| Alberta Red Flag Watch/Warning | Relayed, not computed: parsed from the AWCC AM/PM fire weather forecast banner by zone | Alberta Wildfire 2019, Red Flag fact sheet; Fire Weather Forecast Zones map (2024) |
| HFI classes 1–6 and tactics | Class bounds and suppression descriptors | Alberta WUI Pocket Guide; Cole & Alexander 1995 |

**Deliberate deviations (documented in code):**
- FFMC moisture coefficient 147.2 (Van Wagner 1987 eq. 2; FTR-33 FORTRAN) vs cffdrs 147.27723. Not negligible: up to 0.12 FFMC / 0.6 ISI / 0.5 FWI daily and 1.1 FFMC in a 480-h hourly chain (FireSim vs Pyra comparison 2026-10-10). Pyra uses 147.2 consistently everywhere.
- C6 zero-wind upslope rate uses surface RSI in the slope routine.
- D2 slope inversion goes through D1 (exact, since D2 RSI = 0.2·D1).

### References

All sources below are in the Zotero collection **Pyra Sources** (local library, collection key `RAM676AU`; 38 items, all with a stored PDF), tagged `pyra-source`; the bracketed code after each entry is its Zotero item key. Each new item carries a child note saying what it drives in Pyra.

**Fire Weather Index System**
- Lawson, B.D.; Armitage, O.B. 2008. Weather guide for the Canadian Forest Fire Danger Rating System. Natural Resources Canada, Canadian Forest Service, Northern Forestry Centre, Edmonton. [`4AWT7VN5`]
- Van Wagner, C.E. 1977. A method of computing fine fuel moisture content throughout the diurnal cycle. Information Report PS-X-69. Petawawa Forest Experiment Station. [`LI4PA2K3`]
- Van Wagner, C.E. 1985. Drought, timelag and fire danger rating. *Proceedings of the 8th Conference on Fire and Forest Meteorology*, Detroit, MI, 178–185. Society of American Foresters. [`9F2JPJG7`]
- Van Wagner, C.E. 1987. Development and structure of the Canadian Forest Fire Weather Index System. Forestry Technical Report 35. Canadian Forestry Service, Ottawa. [`LERJ4VJ6`]
- Van Wagner, C.E.; Pickett, T.L. 1985. Equations and FORTRAN program for the Canadian Forest Fire Weather Index System. Forestry Technical Report 33. Canadian Forestry Service, Ottawa. [`94KGP5U3`]

**Fire Behavior Prediction System, crown fire and flame length**
- Alexander, M.E.; Cruz, M.G. 2012. Interdependencies between flame length and fireline intensity in predicting crown fire initiation and crown scorch height. *International Journal of Wildland Fire* 21: 95–113. [`6GKP64VK`]
- Byram, G.M. 1959. Combustion of forest fuels. In: Davis, K.P. (ed.), *Forest Fire: Control and Use*, 61–89. McGraw-Hill, New York. [`EUKYZ4PW`]
- Forestry Canada Fire Danger Group (FCFDG). 1992. Development and structure of the Canadian Forest Fire Behavior Prediction System. Information Report ST-X-3. Forestry Canada, Ottawa. [`LKBB3HE5`]
- Rothermel, R.C. 1991. Predicting behavior and size of crown fires in the Northern Rocky Mountains. Research Paper INT-438. USDA Forest Service, Intermountain Research Station. [`M6T6QB2T`]
- Thomas, P.H. 1963. The size of flames from natural fires. *Ninth Symposium (International) on Combustion*, 844–859. [`6449DW4E`]
- Van Wagner, C.E. 1977. Conditions for the start and spread of crown fire. *Canadian Journal of Forest Research* 7: 23–34. [`EGV8S4ZH`]
- Wotton, B.M.; Alexander, M.E.; Taylor, S.W. 2009. Updates and revisions to the 1992 Canadian Forest Fire Behavior Prediction System. Information Report GLC-X-10. Natural Resources Canada, Canadian Forest Service, Great Lakes Forestry Centre. [`3UTIPRZL`]

**Head fire intensity classes and operational guidance**
- Cole, F.V.; Alexander, M.E. 1995. Head fire intensity class graph for FBP System fuel type C-2. Canadian Forest Service, Northern Forestry Centre, Edmonton. [`YFNDUP9L`]
- Government of Alberta. 2022. Alberta Wildland Urban Interface Pocket Guide. https://www.alberta.ca/system/files/pses-alberta-wildland-urban-interface-pocket-guide.pdf [`SM5NRGUI`]
- Taylor, S.W.; Pike, R.G.; Alexander, M.E. 1997. Field guide to the Canadian Forest Fire Behavior Prediction (FBP) System. Special Report 11. Natural Resources Canada, Canadian Forest Service, Northern Forestry Centre, Edmonton. [`W86C9VP9`]
- Taylor, S.W.; Pike, R.G.; Alexander, M.E. 1996. Field guide to the Canadian Forest Fire Behavior Prediction (FBP) System. FRDA Handbook 012. Canadian Forest Service and BC Ministry of Forests, Victoria. ISBN 0-662-24104-5. The BC edition of the same guide; its PDF stands in for SR-11. [`QCZXFCUQ`]

**Weather inputs, interpolation and data systems**
- Candille, G. 2009. The multiensemble approach: the NAEFS example. *Monthly Weather Review* 137: 1655–1665. doi:10.1175/2008MWR2682.1 [`2JC5XGZY`]
- European Space Agency. 2022. Copernicus DEM (GLO-90). doi:10.5270/ESA-c5d3d65 [`LYXBSNG8`]
- Lee, B.S.; Alexander, M.E.; Hawkes, B.C.; Lynham, T.J.; Stocks, B.J.; Englefield, P. 2002. Information systems in support of wildland fire management decision making in Canada. *Computers and Electronics in Agriculture* 37: 185–198. doi:10.1016/S0168-1699(02)00120-5 [`9IIVZWHU`]
- Luo, W.; Taylor, M.C.; Parker, S.R. 2008. A comparison of spatial interpolation methods to estimate continuous wind speed surfaces using irregularly distributed data from England and Wales. *International Journal of Climatology* 28: 947–959. doi:10.1002/joc.1583 [`UFQ5NRGK`]
- Zippenfenig, P. 2024. Open-Meteo.com Weather API. Zenodo. doi:10.5281/zenodo.7970649 [`B7U7GCPC`]
- City of Edmonton, Urban Forest Initiatives. 2026. Edmonton FBP fuel type grid, 20 m (`Edmonton_FBP_FuelLayer_20251105_10m.tif`; the "10m" and date in the filename are wrong), from the 2025 City vegetation LiDAR and uPLVI. Technical lead T. Kennedy. Documented in *Edmonton Urban Canopy Cover Analysis 2025 — Project Report* (March 2026), §3.4 and Table 4.5; lineage in the FireSim project record. Not accuracy-assessed. [`E2PCWWD6`, report attached]
- Supporting (not cited in code): Jain, P.; Flannigan, M. 2017. Comparison of methods for spatial interpolation of fire weather in Alberta, Canada. *Canadian Journal of Forest Research* 47: 1646–1658. doi:10.1139/cjfr-2017-0101 — the Alberta-specific study behind interpolating weather before computing FWI; a better primary citation for `_computeIDWBlend` than the unverified Snyder (1992). [`ET83MVJM`, tag `pyra-supporting`]

**Alberta Red Flag Watch/Warning (relayed, not computed)**
- Alberta Wildfire. 2019. Red Flag: the adoption of the Red Flag Watch and Red Flag Warning nomenclature in AWCC fire weather forecasts. Government of Alberta. https://open.alberta.ca/publications/red-flag (copy watermarked out of date). [`V63FCWNZ`]
- Alberta Wildfire, Wildfire Geospatial Intelligence Unit. 2024. Fire Weather Forecast Zones (map). Vectorised and georeferenced by Pyra into `data/ab_fire_weather_zones.json`. [`TTJ2S8AW`]
- Alberta Wildfire Coordination Centre. AM and PM fire weather forecasts (`amfcst.pdf`, `pmfcst.pdf`), parsed twice daily by `.github/workflows/ab-redflag.yml`. Attached: 2026-10-09 PM forecast and the 2023-05-15 Red Flag forecast used as the test fixture. [`VZKRYRZ2`]

**Software and reference implementation**
- Wang, X.; Wotton, B.M.; Cantin, A.S.; Parisien, M.-A.; Anderson, K.; Moore, B.; Flannigan, M.D. 2017. cffdrs: an R package for the Canadian Forest Fire Danger Rating System. *Ecological Processes* 6: 5. [`BZMU7LVN`]
- cffdrs R package source, CRAN mirror https://github.com/cran/cffdrs (retrieved 2026-10-08), ported line-for-line to `tests/reference.mjs`. [`PY25G74P`]

**Citation audit, 2026-10-10.** Three citations could not be found and were replaced, with the claims corrected against the new sources:
- "Snyder (1992)" (IDW in `_computeIDWBlend`): not found. Replaced by Shepard 1968, the CWFIS weather grids metadata (same IDW scheme: 12 nearest stations, 1/d²), and Jain & Flannigan 2017 and Flannigan & Wotton 1989 for the evidence (they disagree; rain patchiness is the main error source). "Methodologically equivalent to CWFIS" removed.
- "Butler 2007 cap" (AB guide, slope limitation): Butler et al. 2007 exists but states no 2× cap; it reports McArthur (1968), about 2× at 10° and 4× at 20°. The limitation was also out of date (Pyra applies site slope since the slope work). Rewritten with the FBP Eq. 39 multipliers (1.7× at 20%, 2.3× at 30%, 6.8× at 60%, 10× at 70%+).
- "BCWS (2022) CFFDRS Implementation Guide" (BC guide ref [6], README): not found. Replaced by the Wildfire Regulation, B.C. Reg. 38/2005, Schedule 2, which sets the Fire Danger Class from BUI × FWI tables for three Danger Regions. Pyra's BC labels (FWI cut-points 5/12/21/34) are stated as a Pyra proxy; FWI 34 is not a Regulation cut-off.

**Added sources (Zotero, Pyra Sources):**
- Butler, B.W.; Anderson, W.R.; Catchpole, E.A. 2007. Influence of slope on fire spread rate. In: Butler, B.W.; Cook, W. (comps.), *The fire environment—innovations, management, and policy*. USDA Forest Service Proceedings RMRS-P-46CD, 75–82.
- Flannigan, M.D.; Wotton, B.M. 1989. A study of interpolation methods for forest fire danger rating in Canada. *Canadian Journal of Forest Research* 19: 1059–1066. doi:10.1139/x89-161
- Natural Resources Canada, Canadian Forest Service. 2020. Daily Weather Grids (CWFIS) — metadata record, Federal Geospatial Platform.
- Province of British Columbia. Wildfire Regulation, B.C. Reg. 38/2005 (consolidation current to 2026-04-29).
- Shepard, D. 1968. A two-dimensional interpolation function for irregularly-spaced data. *Proceedings of the 1968 23rd ACM National Conference*, 517–524. doi:10.1145/800186.810616
- Jain & Flannigan 2017 moves from "supporting" to cited (`_computeIDWBlend`).

### Data sources

| Source | Use | Licence | Zotero |
|---|---|---|---|
| NRCan CWFIS (GeoServer WFS/WMS) | Station FWI chain, SCRIBE forecast, NAEFS, FBP fuel grid, active fires, hotspots | OGL-Canada | `4B9TM6KC`, `9IIVZWHU`; fuel grid `E5N5TT35` |
| ECCC MSC SWOB realtime (api.weather.gc.ca) | Station sensor obs | OGL-Canada | `QI54NLVE` |
| BC Wildfire Service Datamart | Noon FWI codes + official danger rating (mirrored daily) | OGL-BC | `7EGXPF6H` |
| Alberta Wildfire pmwx.csv | AEF station obs (mirrored daily) | OGL-Alberta | `RHXC63JG` |
| ECCC MSC GeoMet (WCS 2.0.1; HRDPS continental, RDPS 10 km, GDPS 15 km layers) | Tier 3 model weather: hourly point series per station (`data/gem/<prov>.json`, v150); noon / 16:00 / 24-h rain / trend / outlook / 7-day chain | ECCC Data Server End-use Licence (attribution: "Data Source: Environment and Climate Change Canada") | to add (GeoMet documentation snapshot) |
| NRCan CDEM (Canadian Digital Elevation Model, cloud-optimised GeoTIFF, EPSG:3979) | Station ground elevation for FMC (`data/station_elevation.json`, v150) | OGL-Canada | to add |
| Open-Meteo (ECCC GEM `gem_seamless` since v145; Copernicus GLO-90 DEM) | **Fallback only since v150** (`config/weather.js`): NWP hourly / noon / 16:00 when the GEM file is missing, stale or lacks the point; pin-drop slope/aspect | CC BY 4.0 (free tier non-commercial) | `B7U7GCPC`, `LYXBSNG8` |
| City of Edmonton canopy LiDAR fuel raster | Edmonton pin-drop fuel type | City of Edmonton | `E2PCWWD6` |

## 5. Testing

| Suite | Command | What it checks |
|---|---|---|
| Unit / regression (301 tests) | `node --test "tests/**/*.test.mjs"` | Science vs oracle, tiers, dates, labels, chain, map, carry-over, phenology, FMC, spread, slope, outlook, alerts, after-16:00 ops view, PWA wiring, telemetry privacy contract, GEM point series (browser + Action) |
| GEM browser side (`tests/gem.test.mjs`, 27) | part of the unit run | The harness serves `data/gem/<prov>.json` built from each test's Open-Meteo mock, so every tier test runs on the GEM path with the GeoMet labels. Dedicated: one file fetch per page; noon-LST slot and 24-h rain from the file; forecast stops at the file horizon (no `?? 15` defaults); stale (> 9 h) / missing / no-point-within-1-km → Open-Meteo fallback with the Open-Meteo label; `fallback: 'none'` → stale file used and labelled, missing file fails the tier ("Data unavailable"); D+1 and provenance labels; station elevation from the file, DEM API and pin slope gated by the flag; `_window` days/hours modes, nulls outside the span |
| GEM Action (`tests/gem_action.test.mjs`, 15) | part of the unit run (fixture GeoTIFF test needs `npm install --prefix tools/gem`, skipped otherwise; CI installs it) | GeoMet time/reference_time parsing; compositing H → R → G/g with history left null, rain source rules (1 h, 3 h, run total), backfill run choice; bilinear and vector-direction sampling incl. a fixture GeoTIFF written and read back with the pinned reader; EPSG:3979 projection vs catalogue points; station extraction/dedupe/aliases; file assembly rounding; history merge; coverage |
| PWA static (`tests/pwa.test.mjs`) | part of the unit run | Manifest fields + icons exist; every page links manifest / theme-color / apple-touch-icon and loads config → telemetry → pwa at the engine `?v=`; `sw.js` precache entries exist; cache name = page `?v=`; no inline Cloudflare tag; Privacy link + disclaimer in every footer |
| Telemetry (`tests/telemetry.test.mjs`) | part of the unit run | With `none` / empty endpoint nothing is sent and no script injected; with `post` exactly one beacon with exactly the allowed keys and no station / coordinates / `?stn=`; Cloudflare mode injects only their script; ratings, issue and mailto prefill |
| Engine audit (492 checks) | `node tests/calc_audit.mjs` | Equation-level audit and invariants |
| Parity (108 checks) | `node tests/bc_parity.mjs` | Single-source science core; BC-specific functions |
| Live chain / API | `node tests/live_chain_test.mjs`, `node tests/live_api_test.mjs` | Real network: Open-Meteo, CWFIS, SWOB, NAEFS |
| Browser smoke (11 pages) | `python3 tests/browser_smoke.py` | Pages load with data, no JS errors |
| Deep E2E (185 checks) | `python3 tests/e2e_deep.py` | FWI components, FBP, no NaN, interactions, Trends content, unique stations, fresh-phone shared-link fuel + 390 px fit, ICS briefing print → PDF (AB + BC) |
| PWA browser (28 checks) | `python3 tests/pwa_browser.py` | Service worker registers at the root scope and controls the page; manifest parses; weather responses land in the runtime cache; Feedback button above the bottom nav, prefilled issue without the station, fits 390 px; then a truly offline relaunch (DNS blocked, local server stopped — Playwright's `set_offline` does not reach service workers) renders the station page from cache with the amber "Offline — showing data cached at <time>" strip, a danger label and no NaN |
| Everything | `bash tests/run_all.sh` | All of the above |

The browser suites target the live site by default. Set
`PYRA_BASE=http://127.0.0.1:8765` (and run `python3 -m http.server 8765`) to
test a local build first. CI runs the unit, audit and parity suites on every push.

**Per-file unit tests:**
- science 18, tiers 33, labels 26, dates 24, chain 22, alerts 17
- spread 10, slope 12, carryover 10, outlook 8, phenology 8, fmc 6, map 6, opsview 4
- pwa 22, telemetry 9 (2026-10-25)
- gem 27, gem_action 15 (2026-10-29)

Last full run 2026-10-09 against live v144: unit 204/0, audit 492/0, parity 108/0,
E2E 185/0, smoke 11/0.

Run 2026-10-25 against a local server of the `feat/pwa-usage-feedback` worktree
(v149, service worker registered): unit 259/0, audit 492/0, parity 182/0,
smoke 11/0, E2E 185/0, PWA browser 28/0.

Run 2026-10-29 against a local server of the `feat/geomet-nwp` worktree (v150,
pages reading the freshly built `data/gem/*.json`): unit 301/0, audit 492/0,
parity 182/0, live chain 11/0, live API 7/0, smoke 11/0, E2E 185/0, PWA
browser 28/0 — `bash tests/run_all.sh` 8 suites pass.

**UAT 2026-10-09 (FBAN walk-through, `docs/uat/2026-10-09/`):** the scenario was a grass fire near Hussar AGDM, using O1a/O1b fuels and 95% curing. Clients were desktop Chrome plus iPhone 14 and Pixel 7 emulation (portrait and landscape). The run produced three PDFs from live v144:
- the ICS station briefing at 18:00, leading with Saturday's operational period;
- the ICS station briefing in the morning, leading with today;
- the Fire Safety Briefing for the 9 stations within 60 km.

Found and fixed in v140–v144:
- The Trends page was blank because of a `naefsSt` ReferenceError, a regression from `30d838d`.
- Clusters hid danger.
- Embedded maps captured page scroll.
- A station was duplicated.
- The evening view described a peak that had already passed.
- Shared links used the wrong fuel.
- Phone landscape was mostly header.
- The briefing lacked the shift table and fuel B.
- The FSB builder pre-ticked stations out of sight.

**Oracle provenance:** `tests/reference.mjs` contains independent JS ports of
the cffdrs R functions: FWI codes, hourly FFMC, FBP ROS/SFC/TFC/HFI, FMC with
elevation, FBP ISI (Eq. 53a), BISI, distance at time, LB and LB(t), and slope
adjustment. Agreement is typically 1e-9 to 1e-12.

## 6. Open items

- [ ] Verify printed briefing on the EOC printer (colour + greyscale), and the phone UI on a real handset (emulation passed 2026-10-09).
- [x] BCWS official danger chip confirmed on the live BC station page (2026-10-09).
- [x] Alert delivery configured: WhatsApp via OpenClaw, daily 14:30 cron, quiet mode (2026-10-09, `eb45e98`).
- [ ] FBAN review: during frontal winds the hourly shift outlook can peak overnight (Hussar, 9–10 Oct: HFI 5 at 04:00 in O1b). This is model behaviour of the hourly FFMC + wind, not a code fault, but worth an analyst's eye.
- [ ] BC keeps `autoFuelOnSelect: false`, so BC shared links use the viewer's saved or default fuel (C3). Decide whether BC should adopt the station fuel too.
- [x] NWP provenance mislabel (found 2026-10-10): Open-Meteo calls now pin `models=gem_seamless` (ECCC GEM: HRDPS 2.5 km → RDPS → GDPS) and every label says GEM (v145, 2026-10-10).
- [x] Unverified citations resolved 2026-10-10 (Snyder 1992, Butler 2007 cap, BCWS 2022 guide): replaced with verified sources and the claims corrected; see §4 "Citation audit". BC Schedule 2 lookup implemented (v147).
- [x] Zotero: all 30 Pyra Sources items have a stored PDF (2026-10-10). Journal papers via UNBC library access (Lee 2002, Luo 2008, Thomas 1963); SR-11 1997 is a 26-page UNBC ebook excerpt alongside the full 1996 FRDA edition; data services carry dated documentation snapshots; the Edmonton fuel grid carries the City canopy report.
- [ ] Optional: compare 60-min sizes against a real Alberta FSB, if one becomes available.
- [ ] Spring 2027: run `tools/tz/cwfis_noon_probe.mjs` hourly 17–22 UTC on a few active days. If Alberta's daily chain appears before 19 UTC, set `AB_FWI_LST_OFFSET_FROM_2026_11_01 = 6` (fwi.js) and `FIRESIM_AB_FWI_LST_OFFSET_H=6` (FireSim); BC (20 UTC) is the control. Also confirm the AEF `pmwx.csv` PM Actual hour and the SWOB noon record.
- [ ] Map marker pill text is below 11 px (physical limit). Mitigated with aria-labels.
- [ ] **Before any commercial use:** set `config/weather.js` `fallback: 'none'` (Open-Meteo's free tier is non-commercial). The GEM file path has been the primary source since v150; watch the `Pyra GEM series … fresh (9 h)` uptime checks for a few weeks first. Remove the Open-Meteo footer attribution with the flag.
- [ ] Pin-dropped site slope still uses the Open-Meteo elevation API (behind the fallback flag). Replace with the NRCan CDEM COG read in the browser (the briefing page already loads geotiff.js for lightning; the COG serves `Access-Control-Allow-Origin: *`), then nothing in Pyra depends on Open-Meteo.
- [ ] Add the GeoMet documentation snapshot and the NRCan CDEM record to the Zotero collection "Pyra Sources" (§4 data sources table says "to add").
- [ ] GEM history for the 6 hours between the previous HRDPS run and the new one is carried from the previous file; the very first cycles after merge show GDPS ('g') for a few of those hours until the carry-over has HRDPS values. Self-heals; no action.
- [ ] Alberta observation hour after 2026-11-01 (I-10): CWFIS kept −7 (19 UTC) on 17 Oct 2026; no agency statement. Re-check by matching CWFIS daily values to ECCC hourly records once stations report in November (off-season) and again at season start (~1 March 2027); if Edmonton matches 18 UTC, set `AB_FWI_LST_OFFSET_FROM_2026_11_01 = 6` (and FireSim `FIRESIM_AB_FWI_LST_OFFSET_H=6`).
- [ ] BC eastern (Mountain-time) stations: CWFIS uses tz_correct −7 (noon 19 UTC) for 75 BC stations (Cranbrook, Dawson Creek, Fort St John, Sparwood, …); Pyra BC uses 20 UTC for all. Per-station noon hour would need the CWFIS tz table in the station list (found 2026-10-18).

## 7. Work log (commits since the 2026-10-06 review)

<!-- generated: git log --since=2026-10-05 --no-merges (CWFIS cache bot commits excluded) -->

| Date | Commit | Summary |
|---|---|---|
| 2026-10-29 | `49f4dc8` | feat(nwp): Tier 3 model weather from the ECCC GEM point series (GeoMet); Open-Meteo only as a flagged fallback (v150) |
| 2026-10-29 | `209cc03` | feat(gem): ECCC GeoMet point-series builder + first data/gem/{ab,bc}.json and station elevations |
| 2026-10-29 | `037c1f3` | feat(pwa): installable app with the last briefing cached offline; privacy-respecting usage counting + Feedback button (v149) |
| 2026-10-10 | `b3a1a56` | feat(nwp): pin Open-Meteo to ECCC GEM; labels say GEM (v145) |
| 2026-10-10 | `0ffab4f` | docs(record): Pyra Sources Zotero collection; fix Open-Meteo citation |
| 2026-10-09 | `4d4969f` | docs(record): 2026-10-09 UAT decisions, test counts, open items, UAT PDFs |
| 2026-10-09 | `e82afa2` | fix(uat): FSB builder pre-ticks the local stations visibly; map/trends phone polish |
| 2026-10-09 | `5eb6364` | fix(mobile): shared links use the station's fuel; usable phone landscape |
| 2026-10-09 | `6182985` | feat(ops): after 16:00 the station page and ICS briefing lead with the next operational period |
| 2026-10-09 | `2765420` | fix: Trends page blank (naefsSt ReferenceError); map shows worst danger; duplicate station |
| 2026-10-08 | `eb45e98` | feat(alerts): daily cron wrapper (run-daily.sh) + scheduling notes |
| 2026-10-08 | `84cd8d8` | feat(alerts): --test mode and verbatim channel delivery |
| 2026-10-08 | `1656a72` | docs: project record — decisions, science references, data sources, testing, work log |
| 2026-10-08 | `9456971` | feat: operational-period outlook (hourly fire behaviour for ICS planning) |
| 2026-10-08 | `9e561cc` | feat: site terrain (slope/aspect) for station-page fire behaviour |
| 2026-10-08 | `439d08d` | science: slope via the cffdrs wind–slope vector (ST-X-3 Eqs. 39-51) |
| 2026-10-08 | `b7333cd` | feat(tools): threshold alerts for ops chiefs (dry-run; delivery off) |
| 2026-10-08 | `4090763` | fix: loose ends — low-confidence forecast days, Today card weather, ICS print, BC fuel table |
| 2026-10-08 | `6ff91a3` | docs(trends): forecast source copy matches ECMWF-first chain; cache-bust v136 |
| 2026-10-08 | `30d838d` | science: forecast chain uses ECMWF noon-LST values; NAEFS medians only beyond |
| 2026-10-08 | `3a860f8` | science: SWOB uses the noon-LST observation for daily FWI inputs |
| 2026-10-08 | `887ea03` | feat(bc): show the official BCWS danger rating |
| 2026-10-08 | `6530d06` | science: crown-fire flame length via Thomas (1963) |
| 2026-10-08 | `46af3a8` | science: FBP high-wind ISI (Eq. 53a) and cffdrs 60-min fire size |
| 2026-10-08 | `2672a77` | science: FMC elevation form (FCFDG 1992 Eqs. 3-4); map FMC per station |
| 2026-10-08 | `4535737` | fix: BC station fuels, 16:00 policy for BC, map distance cap, AB/BC config alignment |
| 2026-10-08 | `abfb64a` | test(e2e): accept BCWS as a source label — BC noon mirror live since 2026-10-07 |
| 2026-10-08 | `3e5aa44` | perf(bc): regional map uses one bulk CWFIS query + BC tier rule (67 s -> 7 s) |
| 2026-10-07 | `2aa8223` | ui: data-age chips judged against the publishing schedule |
| 2026-10-07 | `55eaeeb` | ui: 44px footer links, briefing inputs and skip link |
| 2026-10-07 | `fcb1b3f` | ui(B/C): landmarks + a11y, provenance chips, labelled FWI roles, print fixes |
| 2026-10-07 | `899f16f` | ui(A): one danger token set, contrast-safe HFI palette, mobile header menu, nav/footer fixes |
| 2026-10-07 | `50fe51c` | fix: unify six AB/BC divergences the core merge exposed as config flags |
| 2026-10-07 | `66b33dc` | docs: science guides describe the shared core + province modules |
| 2026-10-07 | `23d53f2` | refactor(engine): stage f — drop dead duplicates, tidy modules, docs |
| 2026-10-07 | `18159b4` | refactor(engine): stage e — map, forecast and briefing builders in core |
| 2026-10-07 | `6080309` | refactor(engine): stage d — DOM wiring and UI rendering in core |
| 2026-10-07 | `1525b62` | refactor(engine): stage c — data tiers and carry-over in core |
| 2026-10-07 | `e3fa9e4` | refactor(engine): stage b — date/time helpers and PROVINCE config |
| 2026-10-07 | `fd9ac80` | refactor(engine): extract shared core/fwi-core.js (stage a: identical items + science core) |
| 2026-10-07 | `18897db` | test: tier/date/label/chain/map regression suite; fix 4 engine bugs it found |
| 2026-10-07 | `f851f36` | feat(bc): BCWS noon mirror + deterministic, date-checked BC tiers |
| 2026-10-07 | `6829f22` | feat: seasonal D1/D2 + M1/M2 fuels; flag yesterday's CWFIS on the map |
| 2026-10-06 | `39189c9` | fix: use daily carry-over when CWFIS is empty; correct chain dating |
| 2026-10-05 | `d6b4e9f` | fix: Edmonton fuel raster legend used the wrong code scheme |

## 8. Internal reports and validation results

| Date | Path | What |
|---|---|---|
| 2026-10-09 | `docs/uat/2026-10-09/ICS_station_briefing_Hussar_evening_1800.pdf` | UAT: ICS station briefing at 18:00 MDT (clock-shifted), leads with the next operational period |
| 2026-10-09 | `docs/uat/2026-10-09/ICS_station_briefing_Hussar_morning_now.pdf` | UAT: ICS station briefing at 08:30 MDT, leads with today |
| 2026-10-09 | `docs/uat/2026-10-09/FSB_Hussar_area.pdf` | UAT: Fire Safety Briefing, 9 stations within 60 km of Hussar AGDM |
