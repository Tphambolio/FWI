# Pyra — Project Record

Living record of the work, decisions, scientific references and testing behind
**Pyra**, the Alberta + BC fire weather / fire behaviour dashboard.

- **Live:** https://tphambolio.github.io/FWI/ (AB) · https://tphambolio.github.io/FWI/bc/ (BC)
- **Repo:** https://github.com/Tphambolio/FWI (local: `~/dev/FWI`)
- **Owner:** Travis Kennedy, P.Ag
- **Status at this revision:** engine v139 live; all 7 test suites green on the live site.

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
| `tools/alerts/` | Threshold alert tool, run through the owner's local agent (Pilot). Delivery is disabled until configured |
| `tests/` | Offline unit/regression suites, reference oracle, browser suites |

Each page loads the province module first, then the core. Province
differences live in `PROVINCE` config fields, never in `if (province)`
branches. Both script tags share one cache-bust version.

### Data tiers

1. **CWFIS** `firewx_stns_current`: station obs with the operational FWI chain.
2. **BC:** BCWS noon mirror (`data/bcws_noon.json`). **AB:** Alberta Wildfire pmwx mirror.
3. **ECCC MSC SWOB:** station sensor obs, taking the record closest to noon LST.
4. **Open-Meteo ECMWF IFS:** NWP at exact noon-LST and 16:00 hours.

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
| HFI classes 1–6 and tactics | Class bounds and suppression descriptors | Alberta WUI Pocket Guide; Cole & Alexander 1995 |

**Deliberate deviations (documented in code):**
- FFMC moisture coefficient 147.2 (Van Wagner 1987) vs cffdrs 147.27723 (~1e-4 relative).
- C6 zero-wind upslope rate uses surface RSI in the slope routine.
- D2 slope inversion goes through D1 (exact, since D2 RSI = 0.2·D1).

### References

- Alexander, M.E.; Cruz, M.G. 2012. Interdependencies between flame length and fireline intensity in predicting crown fire initiation and crown scorch height. *International Journal of Wildland Fire* 21: 95–113.
- Byram, G.M. 1959. Combustion of forest fuels. In: Davis, K.P. (ed.), *Forest Fire: Control and Use*. McGraw-Hill, New York.
- Cole, F.V.; Alexander, M.E. 1995. Head fire intensity class graph for FBP System fuel type C-2. Canadian Forest Service, Northern Forestry Centre, Edmonton.
- Forestry Canada Fire Danger Group (FCFDG). 1992. Development and structure of the Canadian Forest Fire Behavior Prediction System. Information Report ST-X-3. Forestry Canada, Ottawa.
- Lawson, B.D.; Armitage, O.B. 2008. Weather guide for the Canadian Forest Fire Danger Rating System. Natural Resources Canada, Canadian Forest Service, Northern Forestry Centre, Edmonton.
- Rothermel, R.C. 1991. Predicting behavior and size of crown fires in the Northern Rocky Mountains. Research Paper INT-438. USDA Forest Service, Intermountain Research Station.
- Thomas, P.H. 1963. The size of flames from natural fires. *Ninth Symposium (International) on Combustion*, 844–859.
- Van Wagner, C.E. 1977. A method of computing fine fuel moisture content throughout the diurnal cycle. Information Report PS-X-69. Petawawa Forest Experiment Station.
- Van Wagner, C.E. 1987. Development and structure of the Canadian Forest Fire Weather Index System. Forestry Technical Report 35. Canadian Forestry Service, Ottawa.
- Van Wagner, C.E.; Pickett, T.L. 1985. Equations and FORTRAN program for the Canadian Forest Fire Weather Index System. Forestry Technical Report 33. Canadian Forestry Service, Ottawa.
- Wang, X.; Wotton, B.M.; Cantin, A.S.; Parisien, M.-A.; Anderson, K.; Moore, B.; Flannigan, M.D. 2017. cffdrs: an R package for the Canadian Forest Fire Danger Rating System. *Ecological Processes* 6: 5.
- Wotton, B.M.; Alexander, M.E.; Taylor, S.W. 2009. Updates and revisions to the 1992 Canadian Forest Fire Behavior Prediction System. Information Report GLC-X-10. Natural Resources Canada, Canadian Forest Service, Great Lakes Forestry Centre.

### Data sources

| Source | Use | Licence |
|---|---|---|
| NRCan CWFIS (GeoServer WFS/WMS) | Station FWI chain, SCRIBE forecast, NAEFS, FBP fuel grid, active fires, hotspots | OGL-Canada |
| ECCC MSC SWOB realtime (api.weather.gc.ca) | Station sensor obs | OGL-Canada |
| BC Wildfire Service Datamart | Noon FWI codes + official danger rating (mirrored daily) | OGL-BC |
| Alberta Wildfire pmwx.csv | AEF station obs (mirrored daily) | OGL-Alberta |
| Open-Meteo (ECMWF IFS 0.25°, Copernicus GLO-90 DEM) | NWP hourly / noon / 16:00; elevation, slope, aspect | CC BY 4.0 |
| City of Edmonton canopy LiDAR fuel raster | Edmonton pin-drop fuel type | City of Edmonton |

## 5. Testing

| Suite | Command | What it checks |
|---|---|---|
| Unit / regression (204 tests) | `node --test tests/*.test.mjs` | Science vs oracle, tiers, dates, labels, chain, map, carry-over, phenology, FMC, spread, slope, outlook, alerts, after-16:00 ops view |
| Engine audit (492 checks) | `node tests/calc_audit.mjs` | Equation-level audit and invariants |
| Parity (108 checks) | `node tests/bc_parity.mjs` | Single-source science core; BC-specific functions |
| Live chain / API | `node tests/live_chain_test.mjs`, `node tests/live_api_test.mjs` | Real network: Open-Meteo, CWFIS, SWOB, NAEFS |
| Browser smoke (11 pages) | `python3 tests/browser_smoke.py` | Pages load with data, no JS errors |
| Deep E2E (185 checks) | `python3 tests/e2e_deep.py` | FWI components, FBP, no NaN, interactions, Trends content, unique stations, fresh-phone shared-link fuel + 390 px fit, ICS briefing print → PDF (AB + BC) |
| Everything | `bash tests/run_all.sh` | All of the above |

The browser suites target the live site by default. Set
`PYRA_BASE=http://127.0.0.1:8765` (and run `python3 -m http.server 8765`) to
test a local build first. CI runs the unit, audit and parity suites on every push.

**Per-file unit tests:**
- science 18, tiers 33, labels 26, dates 24, chain 22, alerts 17
- spread 10, slope 12, carryover 10, outlook 8, phenology 8, fmc 6, map 6, opsview 4

Last full run 2026-10-09 against live v144: unit 204/0, audit 492/0, parity 108/0,
E2E 185/0, smoke 11/0.

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
- [ ] Optional: compare 60-min sizes against a real Alberta FSB, if one becomes available.
- [ ] Map marker pill text is below 11 px (physical limit). Mitigated with aria-labels.

## 7. Work log (commits since the 2026-10-06 review)

<!-- generated: git log --since=2026-10-05 --no-merges (CWFIS cache bot commits excluded) -->

| Date | Commit | Summary |
|---|---|---|
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
