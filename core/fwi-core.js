/**
 * Pyra FWI — shared browser engine core (AB + BC).
 *
 * Van Wagner FWI System + FCFDG FBP System ported to JavaScript, plus the
 * shared data tiers, DOM wiring, map, forecast and briefing builders.
 * Reference: Van Wagner & Pickett (1985), Forestry Canada (1992).
 *
 * Load order (classic scripts, shared global scope — no build step):
 *   <script src="…/fwi.js"></script>          province module: defines PROVINCE
 *   <script src="…/core/fwi-core.js"></script> this file
 * Everything province-specific is read from the PROVINCE config object (and the
 * province module's own globals) at load or call time. The science core below
 * exists only here; the province modules must not redefine it.
 */

// Day-length factors by month (index 0 unused, months 1-12)
const DMC_LL = [0,6.5,7.5,9.0,12.8,13.9,13.9,12.4,10.9,9.4,8.0,7.0,6.0];
const DC_LL  = [0,-1.6,-1.6,-1.6,0.9,3.8,5.8,6.4,5.0,2.4,0.4,-1.6,-1.6];

// Spring startup defaults. FFMC 85 / DMC 6 are the Van Wagner (1987) defaults;
// Van Wagner's default DC is 15 — the 300 here is a project fallback, and the
// per-station DC comes from getStartupDC() (regional zone values, not CFFDRS).
const STARTUP = { ffmc: 85.0, dmc: 6.0, dc: 300.0 };

// ─── Province routing (all province differences come from PROVINCE) ─────────
/** Spring startup DC for a station (province startup-DC zone table, else the province default). */
function getStartupDC(stationName) { return PROVINCE.startupDC[stationName] ?? PROVINCE.startupDCDefault; }
/** Province danger class for display (AB: CWFIS 5-class incl. Very High; BC: 5-class incl. Very Low). */
function dangerRatingProv(fwi) { return PROVINCE.dangerRating(fwi); }
/** Province station list for UI pickers, map and summaries. */
function getStationList() { return PROVINCE.stations; }
/** Province sector / fire-centre label for a station. */
function stationSector(lat, lng) { return PROVINCE.stationSector(lat, lng); }
/** Province regional representative stations for trend/summary displays. */
function getRegions() { return PROVINCE.regions; }

/**
 * Regional spring DC floor by coordinate (Alberta only, March–June).
 * Based on Lawson & Armitage (2008) overwinter carryover expectations for each
 * climate zone, calibrated against CWFIS April 2026 well-initialized station data.
 * Stations reporting DC below 70% of their regional floor are considered
 * underinitialized (spring startup DC=15 default instead of overwinter equation).
 */
// Absolute DC below which a spring reading can only be the CWFIS cold-start
// artifact (MSC airport stations enter CWFIS with DC=15 — Van Wagner 1985
// "no data" fallback — instead of the Lawson & Armitage 2008 overwinter value).
// A genuinely well-initialized station, even after a wet spring, sits well
// above this, so the floor never overwrites real moisture state.
const DC_COLDSTART_CEILING = 60;

// ═══ SCIENCE CORE BEGIN: FWI daily equations (shared AB/BC — keep identical; CI-checked) ═══
function _ffmc(temp, rh, wind, rain, p) {
  let mo = 147.2 * (101 - p) / (59.5 + p);
  if (rain > 0.5) {
    const rf = rain - 0.5;
    let mr = mo + 42.5 * rf * Math.exp(-100 / (251 - mo)) * (1 - Math.exp(-6.93 / rf));
    if (mo > 150) mr += 0.0015 * (mo - 150) ** 2 * Math.sqrt(rf);
    mo = Math.min(mr, 250);
  }
  const ed = 0.942 * rh**0.679 + 11 * Math.exp((rh-100)/10) + 0.18*(21.1-temp)*(1-1/Math.exp(0.115*rh));
  let m;
  if (mo > ed) {
    const kd = (0.424*(1-(rh/100)**1.7) + 0.0694*Math.sqrt(wind)*(1-(rh/100)**8)) * 0.581*Math.exp(0.0365*temp);
    m = ed + (mo - ed) * 10**(-kd);
  } else {
    const ew = 0.618*rh**0.753 + 10*Math.exp((rh-100)/10) + 0.18*(21.1-temp)*(1-1/Math.exp(0.115*rh));
    if (mo < ew) {
      const kw = (0.424*(1-((100-rh)/100)**1.7) + 0.0694*Math.sqrt(wind)*(1-((100-rh)/100)**8)) * 0.581*Math.exp(0.0365*temp);
      m = ew - (ew - mo) * 10**(-kw);
    } else m = mo;
  }
  return Math.max(0, Math.min(101, 59.5 * (250 - m) / (147.2 + m)));
}

function _dmc(temp, rh, rain, month, p) {
  let d = p;
  if (rain > 1.5) {
    const re = 0.92*rain - 1.27;
    const mo = 20 + Math.exp(5.6348 - p/43.43);
    const b = p<=33 ? 100/(0.5+0.3*p) : p<=65 ? 14-1.3*Math.log(p) : 6.2*Math.log(p)-17.2;
    const mr = mo + 1000*re/(48.77 + b*re);
    d = Math.max(0, 244.72 - 43.43*Math.log(mr - 20));
  }
  if (temp > -1.1) d += 1.894*(temp+1.1)*(100-rh)*DMC_LL[month]*1e-4;
  return Math.max(0, d);
}

function _dc(temp, rain, month, p) {
  let d = p;
  if (rain > 2.8) {
    const rd = 0.83*rain - 1.27;
    const qr = 800*Math.exp(-p/400) + 3.937*rd;
    d = Math.max(0, 400*Math.log(800/qr));
  }
  // Van Wagner 1987 eq 22 (cffdrs dcCalc): T is floored at −2.8 °C, not skipped —
  // below −2.8 the day-length adjustment Lf/2 still applies when Lf > 0.
  const tdc = Math.max(temp, -2.8);
  d += 0.5 * Math.max(0, 0.36*(tdc+2.8) + DC_LL[month]);
  return Math.max(0, d);
}

function _isi(ffmc, wind) {
  const m = 147.2*(101-ffmc)/(59.5+ffmc);
  return 0.208 * Math.exp(0.05039*wind) * 91.9*Math.exp(-0.1386*m)*(1+m**5.31/4.93e7);
}

function _bui(dmc, dc) {
  if (!dmc && !dc) return 0;
  return Math.max(0, dmc<=0.4*dc
    ? 0.8*dmc*dc/(dmc+0.4*dc)
    : dmc - (1-0.8*dc/(dmc+0.4*dc))*(0.92+(0.0114*dmc)**1.7));
}

function _fwi(isi, bui) {
  const fd = bui<=80 ? 0.626*bui**0.809+2 : 1000/(25+108.64*Math.exp(-0.023*bui));
  const b = 0.1*isi*fd;
  return b<=1 ? b : Math.exp(2.72*(0.434*Math.log(b))**0.647);
}

/**
 * Hourly FFMC — Van Wagner (1977), as implemented in the cffdrs hffmc().
 * Same equilibrium/wetting structure as the daily code but with the hourly
 * log-drying coefficient 0.0579 (vs 0.581/day) over a 1-hour step.
 * Used for the 24-hour trend chart; DMC/DC are held at their daily values.
 */
function _hffmc(temp, rh, wind, rain, prevF) {
  let mo = 147.2 * (101 - prevF) / (59.5 + prevF);
  if (rain > 0) {
    let mr = mo + 42.5 * rain * Math.exp(-100 / (251 - mo)) * (1 - Math.exp(-6.93 / rain));
    if (mo > 150) mr += 0.0015 * (mo - 150) ** 2 * Math.sqrt(rain);
    mo = Math.min(mr, 250);
  }
  const ed = 0.942 * rh**0.679 + 11 * Math.exp((rh-100)/10) + 0.18*(21.1-temp)*(1-Math.exp(-0.115*rh));
  let m;
  if (mo > ed) {
    const ko = 0.424*(1-(rh/100)**1.7) + 0.0694*Math.sqrt(wind)*(1-(rh/100)**8);
    const kd = ko * 0.0579 * Math.exp(0.0365*temp);
    m = ed + (mo - ed) * 10**(-kd);
  } else {
    const ew = 0.618*rh**0.753 + 10*Math.exp((rh-100)/10) + 0.18*(21.1-temp)*(1-Math.exp(-0.115*rh));
    if (mo < ew) {
      const kl = 0.424*(1-((100-rh)/100)**1.7) + 0.0694*Math.sqrt(wind)*(1-((100-rh)/100)**8);
      const kw = kl * 0.0579 * Math.exp(0.0365*temp);
      m = ew - (ew - mo) * 10**(-kw);
    } else m = mo;
  }
  return Math.max(0, Math.min(101, 59.5 * (250 - m) / (147.2 + m)));
}

// ═══ SCIENCE CORE END: FWI daily equations ═══

/** Escape remote (WFS) text before it goes into HTML popups. */
function _esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Wind degrees → compass direction + arrow
function windCompass(deg) {
  if (deg == null) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const arrows = ['↓','↓','↙','↙','←','↖','↖','↑','↑','↑','↗','↗','→','↘','↘','↓'];
  const i = Math.round(deg / 22.5) % 16;
  return `${arrows[i]} ${dirs[i]} (${Math.round(deg)}°)`;
}

// FWI display classes — aligned to the CWFIS national FWI map intervals
// (public:fwi raster legend, GeoServer GetLegendGraphic, verified 2026-06-10:
//  0-5 / 6-15 / 16-22 / 23-29 / 30+). The previous 9/18/33/50 breaks cited
// "CWFIS/CIFFC operational scale" but matched no published source, and could
// label FWI 31 "High" where the CWFIS map shows its top class.
// NOTE: this is an FWI map classification, not an official Fire Danger Rating —
// provincial danger ratings are issued by Alberta Wildfire / agencies.
function dangerRating(fwi) {
  if (fwi <  5.5) return 'Low';
  if (fwi < 15.5) return 'Moderate';
  if (fwi < 22.5) return 'High';
  if (fwi < 29.5) return 'Very High';
  return 'Extreme';
}

// Same CWFIS FWI map intervals as dangerRating, classes 1-5.
// Returns { num, label, bg, text } for colour-coded display in briefings
function dangerClassNum(fwi) {
  if (fwi <  5.5) return { num: 1, label: 'Low',       bg: '#d4edda', text: '#155724' };
  if (fwi < 15.5) return { num: 2, label: 'Moderate',  bg: '#cce5ff', text: '#004085' };
  if (fwi < 22.5) return { num: 3, label: 'High',      bg: '#fff3cd', text: '#856404' };
  if (fwi < 29.5) return { num: 4, label: 'Very High', bg: '#ffe5cc', text: '#7d3200' };
  return            { num: 5, label: 'Extreme',   bg: '#f8d7da', text: '#721c24' };
}

// HFI intensity class 1–6 — operational plain-language scale (Glenn, FBAN)
// "No one understands kW/m" — show the number + what it means in the field
// FBP System HFI Intensity Class 1–6
// Source: Alberta WUI Pocket Guide (Gov. of Alberta, Forestry & Parks);
// Cole & Alexander (1995), CFS Northern Forestry Centre, Edmonton.
function hfiClassInfo(hfi) {
  if (hfi <   10) return { num: 1, label: 'Low',        size: 'Flame length < 0.2 m · Short firefighter',      desc: 'Direct attack with hand tools · Should anchor',             bg: '#1a3a7a', text: '#ffffff' };
  if (hfi <  500) return { num: 2, label: 'Moderate',   size: 'Flame length 0.2 – 1.5 m · Tallest firefighter', desc: 'Direct attack with hand tools · Should anchor',             bg: '#5bb8d4', text: '#0a2a50' };
  if (hfi < 2000) return { num: 3, label: 'High',       size: 'Flame length 1.5 – 2.5 m · Tallest firefighter', desc: 'Direct attack with pump and hose · Should anchor',          bg: '#1e6b35', text: '#ffffff' };
  if (hfi < 4000) return { num: 4, label: 'Very High',  size: 'Flame length 2.5 – 3.5 m · Fire engine',        desc: 'Indirect attack · Direct attack on less intense area · Must anchor', bg: '#f5c518', text: '#2a1a00' };
  if (hfi <10000) return { num: 5, label: 'Extreme',    size: 'Flame length 3.5 m+ · Peak of a bungalow',      desc: 'Indirect attack · Direct attack on less intense area · Must anchor', bg: '#e07820', text: '#ffffff' };
  return           { num: 6, label: 'Catastrophic', size: 'Flame length 3.5 m+ · Peak of a bungalow',      desc: 'No direct attack — evacuate structure zone',               bg: '#cc2200', text: '#ffffff' };
}

// Behaviour card gradient per danger level — used on full-height cards so keep tones rich, not neon
const DANGER_GRADIENTS = {
  'Low':       'linear-gradient(135deg, #2d9e58 0%, #175c30 100%)',
  'Moderate':  'linear-gradient(135deg, #7bd0ff 0%, #008abb 100%)',
  'High':      'linear-gradient(135deg, #c97ae0 0%, #7a28a8 100%)',
  'Very High': 'linear-gradient(135deg, #f07030 0%, #9e3800 100%)',
  'Extreme':   'linear-gradient(135deg, #e03030 0%, #8c0a0a 100%)',
};

// HFI class gradients for independent fuel section colouring (class 1–6)
const HFI_GRADIENTS = [
  null,
  'linear-gradient(135deg, #2952a3 0%, #1a3a7a 100%)',  // 1 Low          — navy blue (GoA official)
  'linear-gradient(135deg, #7bd4f0 0%, #3a9ccc 100%)',  // 2 Moderate     — sky blue  (GoA official)
  'linear-gradient(135deg, #2d8b48 0%, #1a5428 100%)',  // 3 High         — dark green (GoA official)
  'linear-gradient(135deg, #c8980a 0%, #8a6200 100%)',  // 4 Very High    — amber/gold (GoA official)
  'linear-gradient(135deg, #e07820 0%, #9e4800 100%)',  // 5 Extreme      — orange    (GoA official)
  'linear-gradient(135deg, #e03030 0%, #8c0a0a 100%)',  // 6 Catastrophic — red       (GoA official)
];

// Per-component thresholds (CFFDRS operational scale)
const COMPONENT_THRESHOLDS = {
  ffmc: [77, 84, 88, 91],   // Low / Mod / High / Very High / Extreme
  dmc:  [21, 27, 40, 60],
  dc:   [80, 190, 300, 500],
  isi:  [2,  5,  10,  20],
  bui:  [31, 40,  60,  90],
};
const RATING_LABELS = ['Low', 'Moderate', 'High', 'Very High', 'Extreme'];

function componentRating(key, val) {
  const t = COMPONENT_THRESHOLDS[key];
  if (!t) return dangerRating(val);
  for (let i = 0; i < t.length; i++) if (val < t[i]) return RATING_LABELS[i];
  return RATING_LABELS[4];
}

// ─── FBP System (FCFDG 1992 ST-X-3 · Wotton, Alexander & Taylor 2009 GLC-X-10) ──
// Constants verified line-for-line against the canonical `cffdrs` R package
// (github.com/cran/cffdrs) on 2026-06-10. Validated by tests/science.test.mjs
// against an independent reference port — run `node --test tests/`.

// ═══ SCIENCE CORE BEGIN: FBP parameters (shared AB/BC — keep identical; CI-checked) ═══
const FUEL_TYPES = {
  // a, b, c — ROS coefficients (ST-X-3 Table 6; M3/M4 per GLC-X-10 Eq. 30)
  // q, bui0 — buildup effect (ST-X-3 Table 7; C4 q=0.80, M1-M4 q=0.80/BUI0=50)
  // cbh (m), cfl (kg/m²) — crown geometry (ST-X-3 Table 8; M1-M4 CBH=6, CFL=0.80)
  // SFC is NOT a constant — see calcSFC() (ST-X-3 Eqs. 9-25, BUI/FFMC-dependent)
  C1:  { name:'Spruce-Lichen Woodland',       a:90,  b:0.0649, c:4.5,  q:0.90, bui0:72,  cbh:2,  cfl:0.75 },
  C2:  { name:'Boreal Spruce',                a:110, b:0.0282, c:1.5,  q:0.70, bui0:64,  cbh:3,  cfl:0.80 },
  C3:  { name:'Mature Jack/Lodgepole Pine',   a:110, b:0.0444, c:3.0,  q:0.75, bui0:62,  cbh:8,  cfl:1.15 },
  C4:  { name:'Immature Jack/Lodgepole Pine', a:110, b:0.0293, c:1.5,  q:0.80, bui0:66,  cbh:4,  cfl:1.20 },
  C5:  { name:'Red and White Pine',           a:30,  b:0.0697, c:4.0,  q:0.80, bui0:56,  cbh:18, cfl:1.20 },
  C6:  { name:'Conifer Plantation',           a:30,  b:0.0800, c:3.0,  q:0.80, bui0:62,  cbh:7,  cfl:1.80 },
  C7:  { name:'Ponderosa Pine/Douglas-fir',   a:45,  b:0.0305, c:2.0,  q:0.85, bui0:106, cbh:10, cfl:0.50 },
  D1:  { name:'Leafless Aspen',               a:30,  b:0.0232, c:1.6,  q:0.90, bui0:32,  cbh:0,  cfl:0.00 },
  D2:  { name:'Green Aspen',                  a:30,  b:0.0232, c:1.6,  q:0.90, bui0:32,  cbh:0,  cfl:0.00 }, // ROS = 0.2×D1, only at BUI ≥ 80 (GLC-X-10)
  M1:  { name:'Boreal Mixedwood — Leafless',  q:0.80, bui0:50, cbh:6,  cfl:0.80, mixedwood:true },
  M2:  { name:'Boreal Mixedwood — Green',     q:0.80, bui0:50, cbh:6,  cfl:0.80, mixedwood:true },
  M3:  { name:'Dead Balsam Fir Mixedwood — Leafless', a:120, b:0.0572, c:1.4,  q:0.80, bui0:50, cbh:6, cfl:0.80, deadfir:true },
  M4:  { name:'Dead Balsam Fir Mixedwood — Green',    a:100, b:0.0404, c:1.48, q:0.80, bui0:50, cbh:6, cfl:0.80, deadfir:true },
  S1:  { name:'Jack/Lodgepole Pine Slash',    a:75,  b:0.0297, c:1.3,  q:0.75, bui0:38,  cbh:0,  cfl:0.00 },
  S2:  { name:'White Spruce/Balsam Slash',    a:40,  b:0.0438, c:1.7,  q:0.75, bui0:63,  cbh:0,  cfl:0.00 },
  S3:  { name:'Cedar/Hemlock/DF Slash',       a:55,  b:0.0829, c:3.2,  q:0.75, bui0:31,  cbh:0,  cfl:0.00 },
  O1a: { name:'Matted Grass',                 a:190, b:0.0310, c:1.4,  q:1.00, bui0:1,   cbh:0,  cfl:0.00 },
  O1b: { name:'Standing Grass',               a:250, b:0.0350, c:1.7,  q:1.00, bui0:1,   cbh:0,  cfl:0.00 },
};

/**
 * Surface fuel consumption (kg/m²) — ST-X-3 Eqs. 9-25 (GLC-X-10 revisions).
 * SFC depends on BUI (duff load consumed) and, for C1/C7, on FFMC.
 * @param {string} fuelCode  FBP fuel type
 * @param {number} ffmc      Fine Fuel Moisture Code
 * @param {number} bui       Buildup Index
 * @param {number} pc        Percent conifer for M1/M2 (default 50)
 * @param {number} gfl       Grass fuel load kg/m² for O1 (GLC-X-10 default 0.35)
 */
function calcSFC(fuelCode, ffmc, bui, pc = 50, gfl = 0.35) {
  let sfc;
  switch (fuelCode) {
    case 'C1':  // Eqs. 9a/9b (GLC-X-10 revision)
      sfc = ffmc > 84
        ? 0.75 + 0.75 * Math.sqrt(1 - Math.exp(-0.23 * (ffmc - 84)))
        : 0.75 - 0.75 * Math.sqrt(1 - Math.exp(-0.23 * (84 - ffmc)));
      break;
    case 'C2': case 'M3': case 'M4':  // Eq. 10
      sfc = 5.0 * (1 - Math.exp(-0.0115 * bui)); break;
    case 'C3': case 'C4':             // Eq. 11
      sfc = 5.0 * Math.pow(1 - Math.exp(-0.0164 * bui), 2.24); break;
    case 'C5': case 'C6':             // Eq. 12
      sfc = 5.0 * Math.pow(1 - Math.exp(-0.0149 * bui), 2.48); break;
    case 'C7':                        // Eqs. 13-15 (forest floor + woody)
      sfc = (ffmc > 70 ? 2 * (1 - Math.exp(-0.104 * (ffmc - 70))) : 0)
          + 1.5 * (1 - Math.exp(-0.0201 * bui));
      break;
    case 'D1': case 'D2':             // Eq. 16
      sfc = 1.5 * (1 - Math.exp(-0.0183 * bui)); break;
    case 'M1': case 'M2':             // Eq. 17 — PC-weighted C2/D1 blend
      sfc = pc / 100 * (5.0 * (1 - Math.exp(-0.0115 * bui)))
          + (100 - pc) / 100 * (1.5 * (1 - Math.exp(-0.0183 * bui)));
      break;
    case 'O1a': case 'O1b':           // Eq. 18 — grass fuel load
      sfc = gfl; break;
    case 'S1':                        // Eqs. 19, 20, 25
      sfc = 4.0 * (1 - Math.exp(-0.025 * bui)) + 4.0 * (1 - Math.exp(-0.034 * bui)); break;
    case 'S2':                        // Eqs. 21, 22, 25
      sfc = 10.0 * (1 - Math.exp(-0.013 * bui)) + 6.0 * (1 - Math.exp(-0.060 * bui)); break;
    case 'S3':                        // Eqs. 23, 24, 25
      sfc = 12.0 * (1 - Math.exp(-0.0166 * bui)) + 20.0 * (1 - Math.exp(-0.0210 * bui)); break;
    default:
      sfc = 0;
  }
  return Math.max(sfc, 0.000001);
}
// ═══ SCIENCE CORE END: FBP parameters ═══


// Ecologically associated fuel pair for pin-drop auto-selection (Fuel A → Fuel B complement)
const FUEL_PAIR_COMPLEMENT = {
  C1:'C2',  C2:'M1',  C3:'C2',  C4:'C3',  C5:'C4',  C6:'C5',  C7:'D1',
  D1:'D2',  D2:'D1',
  M1:'C2',  M2:'M1',  M3:'M4',  M4:'M3',
  S1:'S2',  S2:'S3',  S3:'S2',
  O1a:'O1b', O1b:'O1a',
};

// Leaf phenology for deciduous / mixedwood fuels. FBP distinguishes leafless
// (D1, M1 — spring before green-up and fall after leaf drop) from green (D2, M2).
// Auto-assigned fuels follow the calendar; the dates are an operational
// approximation for aspen parkland/boreal (central AB green-up ~May 20, leaf
// drop ~Sep 27), shifted ~2 days per degree latitude (later green-up and
// earlier leaf drop further north). Tune here, not at the call sites.
const LEAF_ON_DOY_53_5  = 140; // May 20 (non-leap)
const LEAF_OFF_DOY_53_5 = 270; // Sep 27
function _isLeafOn(lat, ts = Date.now()) {
  const d = new Date(ts - 7 * 3600000); // MST calendar date
  const doy = Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
  const shift = 2 * ((lat ?? 53.5) - 53.5);
  return doy >= LEAF_ON_DOY_53_5 + shift && doy < LEAF_OFF_DOY_53_5 - shift;
}
/** Map an auto-assigned D1/D2 or M1/M2 code to the right leaf state for the date. */
function _seasonalFuel(code, lat, ts) {
  if (code !== 'D1' && code !== 'D2' && code !== 'M1' && code !== 'M2') return code;
  const on = _isLeafOn(lat, ts);
  return code[0] === 'D' ? (on ? 'D2' : 'D1') : (on ? 'M2' : 'M1');
}
/** Pin-drop pair: complement of fuel A, never the same fuel once leaf state is applied. */
function _seasonalPair(fuelA, lat) {
  const b = _seasonalFuel(FUEL_PAIR_COMPLEMENT[fuelA] || 'D1', lat);
  return b === fuelA ? 'C2' : b;
}

// ═══ SCIENCE CORE BEGIN: FMC + RSI helpers (shared AB/BC — keep identical; CI-checked) ═══
/**
 * Foliar moisture content — FCFDG 1992 Eqs. 1, 2, 5-8 (no-elevation form;
 * station elevations are not yet plumbed through).
 * FMC bottoms out (~85) around the date of minimum foliar moisture D0 and
 * saturates at 120 elsewhere. Affects crown-fire initiation via CSI.
 * @param {number} lat  Station latitude (°N)
 * @param {number} lng  Station longitude (°, negative W or positive °W both accepted)
 * @param {number} doy  Day of year (1-366)
 */
function calcFMC(lat, lng, doy) {
  const lonW = Math.abs(lng);                                  // Eq. 1 uses °W positive
  const latn = 46 + 23.4 * Math.exp(-0.0360 * (150 - lonW));   // Eq. 1
  const d0 = Math.round(151 * (lat / latn));                   // Eq. 2 (rounded — it is a date)
  const nd = Math.abs(doy - d0);                               // Eq. 5
  if (nd < 30) return 85 + 0.0189 * nd * nd;                   // Eq. 6
  if (nd < 50) return 32.9 + 3.17 * nd - 0.0288 * nd * nd;     // Eq. 7
  return 120;                                                  // Eq. 8
}

/** Basic RSI = a(1−e^{−b·ISI})^c — ST-X-3 Eq. 26. */
function _rsiBasic(fuelCode, isi) {
  const p = FUEL_TYPES[fuelCode];
  return p.a * Math.pow(1 - Math.exp(-p.b * isi), p.c);
}

/** Buildup effect — ST-X-3 Eq. 54. */
function _buildupEffect(fuelCode, bui) {
  const p = FUEL_TYPES[fuelCode];
  if (!p || bui <= 0 || p.bui0 <= 0) return 1;
  return Math.exp(50 * Math.log(p.q) * (1 / bui - 1 / p.bui0));
}
// ═══ SCIENCE CORE END: FMC + RSI helpers ═══


let _stationLat = PROVINCE.defaultStation.lat; // module-level; set by initFWI for FMC calculation
let _stationLng = PROVINCE.defaultStation.lng; // module-level; set by initFWI
let _stationName = PROVINCE.defaultStation.name; // module-level; set by initFWI // module-level; set by initFWI
let _initGeneration = 0; // increments each initFWI call; only latest call writes to DOM

// ═══ SCIENCE CORE BEGIN: calculateFBP (shared AB/BC — keep identical; CI-checked) ═══
/**
 * FBP head-fire behaviour from FWI codes + wind.
 * FCFDG 1992 (ST-X-3) with GLC-X-10 (2009) revisions, structured to match the
 * canonical `cffdrs` R package. Validated by tests/science.test.mjs.
 *
 * @param {string} fuelCode  FBP fuel type code (e.g. 'C2')
 * @param {number} ffmc      Fine Fuel Moisture Code
 * @param {number} dmc       Duff Moisture Code
 * @param {number} dc        Drought Code
 * @param {number} windSpeed 10-m open wind speed (km/h)
 * @param {number} slope     Percent slope (default 0; see note below)
 * @param {number} curing    Grass curing % for O1a/O1b (default 100 = fully cured)
 * @param {number} ps        Percent conifer (M1/M2 softwood share, default 50)
 * @param {object} opts      { lat, lng, doy, gfl, pdf } overrides — defaults to
 *                           the active station and today; pdf = % dead fir (M3/M4)
 * @returns {{ isi, bui, ros, hfi, cfb, sfc, tfc, fmc, csi, rso, flameLength, fireType } | null}
 */
function calculateFBP(fuelCode, ffmc, dmc, dc, windSpeed, slope = 0, curing = 100, ps = 50, opts = {}) {
  const ft = FUEL_TYPES[fuelCode];
  if (!ft) return null;

  const lat = opts.lat ?? _stationLat;
  const lng = opts.lng ?? _stationLng;
  const doy = opts.doy ?? Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const gfl = opts.gfl ?? 0.35;   // GLC-X-10 default grass fuel load
  const pdf = opts.pdf ?? 35;     // default % dead balsam fir for M3/M4

  // ISI — Van Wagner (1987), identical to the FWI-system form
  const m   = 147.2 * (101.0 - ffmc) / (59.5 + ffmc);
  const ff  = 91.9 * Math.exp(-0.1386 * m) * (1.0 + Math.pow(m, 5.31) / 4.93e7);
  const isi = 0.208 * ff * Math.exp(0.05039 * windSpeed);

  // BUI — same formula as _bui(); guard dmc=dc=0 to avoid 0/0 = NaN
  let bui;
  if (!dmc && !dc) {
    bui = 0;
  } else if (dmc <= 0.4 * dc) {
    bui = 0.8 * dmc * dc / (dmc + 0.4 * dc);
  } else {
    bui = dmc - (1.0 - 0.8 * dc / (dmc + 0.4 * dc)) * (0.92 + Math.pow(0.0114 * dmc, 1.7));
  }
  bui = Math.max(0, bui);

  const fmc = calcFMC(lat, lng, doy);
  const pc  = Math.max(0, Math.min(100, ps));
  const sfc = calcSFC(fuelCode, ffmc, bui, pc, gfl);

  // ── Initial spread rate RSI by fuel class ──────────────────────────────────
  let rsi;
  if (ft.mixedwood) {
    // M1: Eq. 27/28 — PC-weighted C2 + D1. M2: GLC-X-10 — D1 share × 0.2 (green).
    const hwFactor = fuelCode === 'M2' ? 0.2 : 1.0;
    rsi = pc / 100 * _rsiBasic('C2', isi) + hwFactor * (100 - pc) / 100 * _rsiBasic('D1', isi);
  } else if (ft.deadfir) {
    // M3/M4: GLC-X-10 Eqs. 29-33 — PDF-weighted dead-fir + D1 (M4: D1 share × 0.2)
    const hwFactor = fuelCode === 'M4' ? 0.2 : 1.0;
    rsi = pdf / 100 * _rsiBasic(fuelCode, isi) + hwFactor * (1 - pdf / 100) * _rsiBasic('D1', isi);
  } else if (fuelCode === 'O1a' || fuelCode === 'O1b') {
    // Grass curing — GLC-X-10 Eq. 35b (revised from ST-X-3 Eq. 35), multiplies ROS.
    // CF = 1.0 at 100% cured; the 1992 curve (which reached 2.22) is superseded.
    const cc = Math.max(0, Math.min(100, curing));
    const cf = cc < 58.8 ? 0.005 * (Math.exp(0.061 * cc) - 1) : 0.176 + 0.02 * (cc - 58.8);
    rsi = _rsiBasic(fuelCode, isi) * cf;
  } else if (fuelCode === 'D2') {
    // GLC-X-10: green aspen carries fire only at BUI ≥ 80, at 0.2 × D1 rate
    rsi = bui >= 80 ? 0.2 * _rsiBasic('D1', isi) : 0;
  } else if (fuelCode === 'C6') {
    rsi = 30 * Math.pow(1 - Math.exp(-0.08 * isi), 3.0);  // Eq. 62
  } else {
    rsi = _rsiBasic(fuelCode, isi);                        // Eq. 26
  }

  // Slope — ST-X-3 Eq. 39 spread factor, capped at 10 (GS ≥ 70%, GLC-X-10).
  // NOTE: approximation — full ST-X-3 slope treatment vectors slope through an
  // ISI-equivalent (ISF/WSE); no caller currently passes slope > 0.
  if (slope > 0) {
    rsi *= Math.min(Math.exp(3.533 * Math.pow(slope / 100.0, 1.2)), 10.0);
  }

  // ── Crown fire — ST-X-3 Eqs. 56-65 ─────────────────────────────────────────
  const csi = ft.cbh > 0
    ? 0.001 * Math.pow(ft.cbh, 1.5) * Math.pow(460 + 25.9 * fmc, 1.5)  // Eq. 56
    : Infinity;
  const rso = ft.cbh > 0 ? csi / (300 * sfc) : Infinity;               // Eq. 57 (m/min)

  let rss, cfb, ros;
  if (fuelCode === 'C6') {
    // C6 two-equation system: surface (RSS) vs crown (RSC) blended by CFB
    rss = rsi * _buildupEffect('C6', bui);                              // Eq. 63
    const fme = Math.pow(1.5 - 0.00275 * fmc, 4) / (460 + 25.9 * fmc) * 1000;  // Eq. 61
    const rsc = 60 * (1 - Math.exp(-0.0497 * isi)) * fme / 0.778;       // Eq. 64
    cfb = (rsc > rss && rss > rso) ? 1 - Math.exp(-0.23 * (rss - rso)) : 0;    // Eq. 58
    ros = rsc > rss ? rss + cfb * (rsc - rss) : rss;                    // Eq. 65
  } else {
    rss = rsi * _buildupEffect(fuelCode, bui);                          // Eq. 54/55
    cfb = (ft.cbh > 0 && rss > rso) ? 1 - Math.exp(-0.23 * (rss - rso)) : 0;   // Eq. 58
    ros = rss;
  }
  ros = Math.max(ros, 0.000001);

  // ── Consumption and intensity — ST-X-3 Eqs. 66-69 (GLC-X-10 66b/66c) ──────
  let cfc = cfb * ft.cfl;                                               // Eq. 66a
  if (ft.mixedwood) cfc *= pc / 100;                                    // Eq. 66b
  if (ft.deadfir)   cfc *= pdf / 100;                                   // Eq. 66c
  const tfc = sfc + cfc;                                                // Eq. 67
  const hfi = 300 * tfc * ros;                                          // Eq. 69 (kW/m)
  const sfi = 300 * sfc * (fuelCode === 'C6' ? rss : ros);              // surface-only intensity

  // Flame length — Byram (1959): L = 0.0775 × I^0.46 (applied to total HFI)
  const flameLength = hfi > 0 ? 0.0775 * Math.pow(hfi, 0.46) : 0.0;

  // Fire type classification (ST-X-3 CFB convention)
  let fireType = 'Surface';
  if      (cfb >= 0.9) fireType = 'Active Crown';
  else if (cfb >= 0.1) fireType = 'Passive Crown';
  else if (cfb > 0)    fireType = 'Torching'; // deliberate: ST-X-3 calls CFB < 0.1 surface fire; kept as an operational cue (2026-10-07)

  return { isi, bui, ros, hfi, cfb, sfc, tfc, fmc, csi, rso, sfi, flameLength, fireType };
}
// ═══ SCIENCE CORE END: calculateFBP ═══


/** Re-run FBP with cached last weather/FWI when fuel picker changes. */
let _lastWeather = null;
let _lastFWI     = null;
let _lastVWCalc  = null; // Van Wagner cold-start result for compare panel
let _selectNearestStation = null; // set by buildStationPicker; used by pin-drop map

function refreshFBP() {
  if (_lastWeather && _lastFWI) wireFBP(_lastWeather, _lastFWI);
  if (document.getElementById('fwi-d1-preview-section')) buildD1Card();
}

/**
 * Elliptical fire growth area at 60 min (ha) — CFFDRS FBP System.
 * LB = 1 + 8.729 × (1 − e^{−0.030 × WSE})^{2.155}  [length-to-breadth ratio]
 * A60 = π × (ROS × 60 × 1.05)² / (4 × LB × 10000)
 * The 1.05 factor approximates 5% back-spread contribution, calibrated to match
 * Alberta FSB reference values (C2, ROS=28 m/min, W20 → ~96 ha).
 */
function _calcFireArea60(ros, windSpeed) {
  if (!ros || ros <= 0) return 0;
  const lb = 1 + 8.729 * Math.pow(1 - Math.exp(-0.030 * (windSpeed || 0)), 2.155);
  const d  = ros * 60 * 1.05;
  return (Math.PI * d * d) / (4 * lb * 10000);
}

/** Null-safe number formatter — returns '—' if value is null/undefined. */
const fmt = (v, d = 1) => v != null ? (+v).toFixed(d) : '—';

/** Convert degrees to 16-point compass direction. */
function compassDir(deg) {
  if (deg == null) return '—';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(+deg / 22.5) % 16];
}

// ─── Haversine distance ───────────────────────────────────────────────────────
function _haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

/**
 * fetch() with a hard timeout. Every remote call should use this — a single
 * hung connection (CWFIS, SWOB, Open-Meteo) otherwise stalls the whole await
 * chain indefinitely. Throws on timeout or non-OK status.
 */
async function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ─── CWFIS WFS fetch ──────────────────────────────────────────────────────────
/**
 * Fetch live fire weather from CWFIS WFS (NRCan/MSC physical sensors).
 * Returns observed weather + pre-computed FWI codes when in-season (Apr–Oct).
 * Returns null on failure — caller falls back to Open-Meteo.
 *
 * Layer: public:firewx_stns_current (GeoServer WFS 2.0.0)
 * Reference: CWFIS, Natural Resources Canada
 */
async function fetchCWFIS(lat, lng, idwMode = false) {
  const bbox = 2.0; // ±2 degrees ≈ 220 km
  const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows` +
    `?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeName=public:firewx_stns_current&outputFormat=application/json&count=50` +
    `&CQL_FILTER=lat+BETWEEN+${lat - bbox}+AND+${lat + bbox}` +
    `+AND+lon+BETWEEN+${lng - bbox}+AND+${lng + bbox}`;

  try {
    // Non-OK status / timeout throw → null (caller falls back).
    const res = await fetchWithTimeout(url, PROVINCE.cwfisNoCache ? { cache: 'no-cache' } : {}, 10000);
    const data = await res.json();

    if (idwMode) {
      // Start with CWFIS features (may be empty during morning update window ~0800-1000 local)
      let features = data.features ?? [];
      // Province augmentation of the blend (AB: Alberta Wildfire AEF pmwx stations,
      // which use proper Lawson & Armitage overwinter DC initialization). Runs
      // regardless of CWFIS availability — the provincial feed is independent.
      const extra = await PROVINCE.idwExtraFeatures(lat, lng);
      if (extra.length) features = [...features, ...extra];
      if (!features.length) return null;
      return _computeIDWBlend(features, lat, lng);
    }

    return _selectCWFIS(data.features, lat, lng);
  } catch (e) {
    return null;
  }
}

/**
 * Select the best CWFIS observation for a point from a feature array.
 * Shared by fetchCWFIS (per-point query) and buildStationMap (one province
 * query reused for all stations). Prefers the nearest station with an active
 * FWI chain; falls back to nearest weather-only within +200 km.
 */
function _selectCWFIS(features, lat, lng) {
  if (!features?.length) return null;
  let fwiNearest = null, fwiDist = Infinity;
  let wxNearest  = null, wxDist  = Infinity;
  for (const feat of features) {
    const p = feat.properties;
    if (p.temp == null || p.rh == null || p.ws == null) continue;
    const d = _haversineKm(lat, lng, +p.lat, +p.lon);
    if (d < wxDist) { wxDist = d; wxNearest = p; }
    if (p.ffmc != null && p.dc != null && d < fwiDist) { fwiDist = d; fwiNearest = p; }
  }
  const nearest = (fwiNearest && fwiDist <= wxDist + 200) ? fwiNearest : wxNearest;
  if (!nearest) return null;

  // DC divergence check — flag if nearby stations (≤75 km) have DC spread ≥75
  let dcMin = Infinity, dcMax = -Infinity, dcCount = 0;
  for (const feat of features) {
    const p = feat.properties;
    if (p.dc == null) continue;
    const d = _haversineKm(lat, lng, +p.lat, +p.lon);
    if (d > 75) continue;
    dcMin = Math.min(dcMin, +p.dc);
    dcMax = Math.max(dcMax, +p.dc);
    dcCount++;
  }
  const dcDivergence = dcCount >= 2 && (dcMax - dcMin) >= 75
    ? { spread: Math.round(dcMax - dcMin), min: Math.round(dcMin), max: Math.round(dcMax) }
    : null;

  const hasFWI = nearest.ffmc != null && nearest.dmc != null && nearest.dc != null;
  const stationName = (nearest.name || '').replace(/\+/g, ' ').trim().replace(/\s+/g, ' ');

  // Correct underinitialized spring startup DC (cold-start artifact only)
  let rawDC = hasFWI ? +nearest.dc : null;
  let dcUnderinit = false;
  if (rawDC != null) {
    const adj = applyDCFloor(rawDC, +nearest.lat, +nearest.lon);
    rawDC = adj.dc; dcUnderinit = adj.corrected;
  }
  // BUI/FWI published by CWFIS were computed from the uncorrected DC; when the
  // floor raised DC, recompute them (Van Wagner 1987 eqs 27a/b, 28-30) so the
  // displayed BUI/FWI agree with the displayed DC and with the FBP outputs.
  let selBUI = hasFWI ? nearest.bui : null;
  let selFWI = hasFWI ? nearest.fwi : null;
  if (dcUnderinit && nearest.isi != null) {
    selBUI = _bui(+nearest.dmc, rawDC);
    selFWI = _fwi(+nearest.isi, selBUI);
  }

  return {
    temp:  nearest.temp,
    rh:    nearest.rh,
    wind:  nearest.ws,
    wdir:  nearest.wdir ?? null,
    rain:  nearest.precip ?? 0,
    month: new Date().getMonth() + 1,
    ffmc: hasFWI ? nearest.ffmc : null,
    dmc:  hasFWI ? nearest.dmc  : null,
    dc:   rawDC,
    isi:  hasFWI ? nearest.isi  : null,
    bui:  selBUI,
    fwi:  selFWI,
    fwiFromCWFIS: hasFWI,
    repDate: nearest.rep_date || null,
    source: hasFWI
      ? `CWFIS · ${stationName}`
      : `CWFIS · ${stationName} · FWI calc`,
    stationName,
    stationLat: +nearest.lat,
    stationLng: +nearest.lon,
    distKm: Math.round(nearest === fwiNearest ? fwiDist : wxDist), // distance of the station actually used
    dcDivergence,
    dcUnderinit,
  };
}

/**
 * Compute an IDW-blended weather/FWI observation from up to 12 nearest CWFIS stations.
 *
 * Weights: 1/d² (d in km, minimum 1 km to avoid division by zero at co-located points).
 * Scalar fields (temp, RH, wind speed, precip): standard IDW.
 * Wind direction: vector average via sin/cos components → atan2.
 * FFMC + DMC: IDW from chain-active stations only (short-to-medium memory, spatially continuous).
 * DC: IDW from chain stations only IF spread < 75 DC units; otherwise use nearest chain station
 *     DC and flag dcDivergence (DC has ~53-day memory, discontinuous across precip boundaries).
 *
 * Reference: Snyder (1992), Luo et al. (2008) — IDW on meteorological inputs prior to
 * FWI calculation is methodologically equivalent to the CWFIS gridded interpolation approach.
 */
function _computeIDWBlend(features, lat, lng, maxStations = 12) {
  // Build candidate list with distances; require valid weather obs
  const cands = [];
  for (const feat of features) {
    const p = feat.properties;
    if (p.temp == null || p.rh == null || p.ws == null) continue;
    const d = Math.max(_haversineKm(lat, lng, +p.lat, +p.lon), 1);
    cands.push({ p, d });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.d - b.d);
  const used = cands.slice(0, maxStations);

  // Normalised IDW weights
  const w   = used.map(c => 1 / (c.d * c.d));
  const wS  = w.reduce((s, v) => s + v, 0);
  const wN  = w.map(v => v / wS);
  const idw = key => used.reduce((s, c, i) => s + (+(c.p[key] ?? 0)) * wN[i], 0);

  // Scalar fields
  const temp = idw('temp');
  const rh   = Math.min(100, Math.max(0, idw('rh')));
  const wind = idw('ws');
  const rain = idw('precip');

  // Wind direction — circular mean
  let sinSum = 0, cosSum = 0, wdirCount = 0;
  used.forEach((c, i) => {
    if (c.p.wdir == null) return;
    const rad = (+c.p.wdir) * Math.PI / 180;
    sinSum += Math.sin(rad) * wN[i]; cosSum += Math.cos(rad) * wN[i]; wdirCount++;
  });
  const wdir = wdirCount ? Math.round(((Math.atan2(sinSum, cosSum) * 180 / Math.PI) + 360) % 360) : null;

  // FWI chain IDW — chain-active stations only (ffmc + dmc + dc all non-null)
  const chain = used.filter(c => c.p.ffmc != null && c.p.dmc != null && c.p.dc != null);
  let ffmc = null, dmc = null, dc = null, isi = null, bui = null, fwi = null;
  let fwiFromCWFIS = false, dcUnderinit = false;
  let dcDivergence = null;

  if (chain.length >= 1) {
    fwiFromCWFIS = true;
    const cw  = chain.map(c => 1 / (c.d * c.d));
    const cwS = cw.reduce((s, v) => s + v, 0);
    const cwN = cw.map(v => v / cwS);
    const cidw = key => chain.reduce((s, c, i) => s + (+c.p[key]) * cwN[i], 0);

    ffmc = cidw('ffmc');
    dmc  = cidw('dmc');
    isi  = cidw('isi');
    bui  = cidw('bui');
    fwi  = cidw('fwi');

    // Apply regional DC floor before blending — corrects stations that used DC=15
    // spring startup instead of the Lawson & Armitage overwinter equation.
    const correctedChain = chain.map(c => {
      const adj = applyDCFloor(+c.p.dc, +c.p.lat, +c.p.lon);
      if (adj.corrected) {
        return { ...c, p: { ...c.p, dc: adj.dc }, _dcCorrected: true };
      }
      return c;
    });
    if (correctedChain.some(c => c._dcCorrected)) dcUnderinit = true;

    // DC: IDW only if corrected chain stations agree within 75 units
    const dcVals = correctedChain.map(c => +c.p.dc);
    const dcSpread = Math.max(...dcVals) - Math.min(...dcVals);
    if (chain.length >= 2 && dcSpread >= 75) {
      // Divergent DC fallback is province policy (PROVINCE.idwDivergentDC):
      // 'max' — highest corrected DC (AB: the nearest is likely an
      // underinitialized airport station); 'nearest' — nearest chain station (BC).
      dc = PROVINCE.idwDivergentDC === 'nearest' ? dcVals[0] : Math.max(...dcVals);
      dcDivergence = {
        spread: Math.round(dcSpread),
        min: Math.round(Math.min(...dcVals)),
        max: Math.round(Math.max(...dcVals)),
      };
    } else {
      const cwcS = cw.reduce((s, v) => s + v, 0);
      const cwcN = cw.map(v => v / cwcS);
      dc = correctedChain.reduce((s, c, i) => s + (+c.p.dc) * cwcN[i], 0);
    }
    // BUI and FWI are nonlinear in their inputs — derive them from the blended
    // (and DC-floor-corrected) codes rather than averaging station BUI/FWI.
    bui = _bui(dmc, dc);
    fwi = _fwi(isi, bui);
  } else {
    // No chain — check for DC divergence across all nearby stations anyway
    let dcMin2 = Infinity, dcMax2 = -Infinity, dcCnt = 0;
    for (const c of cands) {
      if (c.p.dc == null || c.d > 75) continue;
      dcMin2 = Math.min(dcMin2, +c.p.dc); dcMax2 = Math.max(dcMax2, +c.p.dc); dcCnt++;
    }
    if (dcCnt >= 2 && (dcMax2 - dcMin2) >= 75)
      dcDivergence = { spread: Math.round(dcMax2 - dcMin2), min: Math.round(dcMin2), max: Math.round(dcMax2) };
  }

  const avgDist = Math.round(used.reduce((s, c) => s + c.d, 0) / used.length);
  const aefCount = used.filter(c => c.p.aef).length;
  const sourceLabel = aefCount
    ? `IDW · ${used.length} stations (${aefCount} AEF) · avg ${avgDist} km`
    : `IDW · ${used.length} stations · avg ${avgDist} km`;

  return {
    temp, rh, wind, wdir, rain,
    month: new Date().getMonth() + 1,
    ffmc, dmc, dc, isi, bui, fwi,
    fwiFromCWFIS,
    source: sourceLabel,
    stationName: null,
    stationLat: null, stationLng: null,
    distKm: Math.round(used[0].d),
    dcDivergence,
    idwMode: true,
    idwCount: used.length,
    idwAvgDist: avgDist,
  };
}

/**
 * Fetch weather from MSC SWOB realtime (api.weather.gc.ca).
 * Real sensor data — used as Tier 2 between CWFIS and Open-Meteo NWP.
 * Targets noon LST (19:00 UTC) when available; uses latest obs otherwise.
 * CORS: Access-Control-Allow-Origin: * confirmed on MSC open data API.
 */
async function fetchSWOB(lat, lng) {
  const bbox = 1.5; // ±1.5° ≈ 150 km
  // Without a datetime filter the endpoint returns stale archived records.
  // Request a 3-hour window ending now to ensure fresh observations only.
  const now  = new Date();
  const past = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const fmt  = d => d.toISOString().replace(/\.\d+Z$/, 'Z');
  // Request only the properties we read — full SWOB records carry hundreds of
  // fields each (~411 KB for 50); the subset is ~10× smaller. Province flag
  // (PROVINCE.trimFeedProperties). 8 s timeout: SWOB can hang for 13 s+, which
  // previously stalled the whole tier chain.
  const props = ['air_temp','avg_air_temp_pst1hr','rel_hum','avg_rel_hum_pst1hr',
    'avg_wnd_spd_10m_pst1hr','avg_wnd_spd_10m_pst10mts','avg_wnd_dir_10m_pst1hr',
    'avg_wnd_dir_10m_pst10mts','pcpn_amt_pst1hr','pcpn_amt_pst6hrs','pcpn_amt_pst24hrs',
    'date_tm-value','obs_date_tm','stn_nam-value'].join(',');
  const url = `https://api.weather.gc.ca/collections/swob-realtime/items` +
    `?bbox=${(lng-bbox).toFixed(2)},${(lat-bbox).toFixed(2)},${(lng+bbox).toFixed(2)},${(lat+bbox).toFixed(2)}` +
    `&datetime=${fmt(past)}/${fmt(now)}&limit=50${PROVINCE.trimFeedProperties ? `&properties=${props}` : ''}&f=json`;
  let res;
  try { res = await fetchWithTimeout(url, {}, 8000); } catch (_) { return null; }
  const d = await res.json();
  if (!d.features?.length) return null;

  // Find nearest station by geometry
  let nearest = null, minDist = Infinity;
  for (const f of d.features) {
    if (!f.geometry?.coordinates) continue;
    const [fLng, fLat] = f.geometry.coordinates;
    const dist = _haversineKm(lat, lng, fLat, fLng);
    if (dist < minDist) { minDist = dist; nearest = f; }
  }
  if (!nearest) return null;

  const p = nearest.properties;
  const temp = p['air_temp']                    ?? p['avg_air_temp_pst1hr'];
  const rh   = p['rel_hum']                     ?? p['avg_rel_hum_pst1hr'];
  const wind = p['avg_wnd_spd_10m_pst1hr']      ?? p['avg_wnd_spd_10m_pst10mts'];
  const wdir = p['avg_wnd_dir_10m_pst1hr']      ?? p['avg_wnd_dir_10m_pst10mts'];
  // Daily FWI needs 24-h precip accumulated to noon — prefer the synoptic
  // 24-h field; the 1-h amount alone made rain events nearly invisible.
  const rain = p['pcpn_amt_pst24hrs'] ?? p['pcpn_amt_pst6hrs'] ?? p['pcpn_amt_pst1hr'] ?? 0;
  if (temp == null || rh == null || wind == null) return null;

  const obsTime    = new Date(p['date_tm-value'] || p['obs_date_tm']);
  const obsUTCHour = obsTime.getUTCHours();
  const isNoonLST  = obsUTCHour >= PROVINCE.noonUTC - 1 && obsUTCHour <= PROVINCE.noonUTC + 1; // ±1 hr of noon LST
  const stnName    = (p['stn_nam-value'] || '').replace(/\+/g,' ').trim();
  const srcLabel   = isNoonLST
    ? `MSC SWOB · ${stnName} (noon LST)`
    : `MSC SWOB · ${stnName} (latest obs)`;

  const [nearestLng, nearestLat] = nearest.geometry.coordinates;
  return {
    temp, rh, wind, wdir, rain,
    month:       new Date().getMonth() + 1,
    source:      srcLabel,
    stationName: stnName,
    stationLat:  nearestLat,
    stationLng:  nearestLng,
    fwiFromCWFIS: false,
    distKm:      Math.round(minDist),
    obsTime:     obsTime.toISOString(),
  };
}

/**
 * Fetch weather — three-tier hierarchy:
 *   1. CWFIS firewx_stns_current — fire weather stations, pre-computed FWI chain
 *   2. MSC SWOB realtime         — real sensor obs, noon LST targeted
 *   3. Open-Meteo NWP            — model output, noon LST targeted, last resort
 */
// IDW blend mode — persisted across page loads
let _idwMode = false;

// Per-station holding-cache key. A single shared key was overwritten on every
// call during the 199-station map loop, so the last station processed won wrote
// the cache, and station_detail then replayed that arbitrary station's chain
// under whatever station the user selected. Round coords to ~1 km.
function _holdKey(lat, lng) {
  return `${PROVINCE.holdKeyPrefix}${lat.toFixed(2)},${lng.toFixed(2)}`;
}

/**
 * Primary weather + FWI-chain tier chain for a point. The tier order and the
 * pre-noon policy genuinely differ by province, so the chain itself lives in
 * the province module (PROVINCE.fetchPrimary): AB — CWFIS (+AEF in IDW) →
 * SWOB → NWP, pre-noon falls through to the 16:00 peak-burn forecast; BC —
 * date-checked BCWS noon mirror ∥ CWFIS → SWOB → NWP.
 */
async function fetchWeatherPrimary(lat, lng) {
  return PROVINCE.fetchPrimary(lat, lng);
}

/**
 * Cross-validate a chain station's weather against SWOB. If a close (≤ 25 km)
 * SWOB station disagrees by > 8 °C the chain station's obs is stale or the
 * sensor is faulty — use SWOB weather values while keeping the FWI chain
 * (which is based on carry-over, not the instantaneous reading). Otherwise
 * returns the chain observation unchanged.
 */
function _swobCrossCheck(chain, swob) {
  if (swob?.temp != null && chain.temp != null &&
      (swob.distKm ?? 999) <= 25 &&
      Math.abs(chain.temp - swob.temp) > 8) {
    return {
      ...swob,
      ffmc: chain.ffmc,  dmc: chain.dmc,  dc:  chain.dc,
      isi:  chain.isi,   bui: chain.bui,  fwi: chain.fwi,
      fwiFromCWFIS: chain.fwiFromCWFIS,
      chainSource:  chain.source,   // provenance of the FWI chain (BCWS or CWFIS)
      stationName:  chain.stationName,
      distKm:       chain.distKm,
      repDate:      chain.repDate,
    };
  }
  return chain;
}

/**
 * Fetch weather from Open-Meteo targeting the noon LST observation.
 * CFFDRS specifies noon Local Standard Time (UTC−7 AB / UTC−8 BC, year-round)
 * for daily FWI calculations. We request today's hourly array and select the
 * PROVINCE.noonUTC hour (= noon LST). Before noon the target is province
 * policy (PROVINCE.preNoonNWP): 'peak' — today's 16:00 peak-burn forecast
 * hour (AB); 'latest' — the most recent available hour (BC).
 */
async function fetchWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lng}` +
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,thunderstorm_probability` +
    `&past_days=1&forecast_days=2&timezone=UTC`;
  const res = await fetchWithTimeout(url, { cache: 'no-cache' }, 12000);
  const d = await res.json();
  const times = d.hourly.time; // ISO strings in UTC (timezone=UTC)

  // Post-noon: noon LST (PROVINCE.noonUTC) — standard CFFDRS input time.
  // Target the hour by explicit LST-date ISO string: the old UTC-hour index
  // selected tomorrow's forecast between 17:00 MST and midnight (UTC day rolls
  // over at 17:00 MST) and could never see a 24-h precip window.
  const lstNow    = new Date(Date.now() - PROVINCE.lstOffset * 3600000);
  const lstDate   = lstNow.toISOString().slice(0, 10);   // today's calendar date in LST
  const isPreNoon = lstNow.getUTCHours() < 12;
  let targetISO;
  if (!isPreNoon)                          targetISO = `${lstDate}T${PROVINCE.noonUTC}:00`;
  else if (PROVINCE.preNoonNWP === 'peak') targetISO = `${lstDate}T${PROVINCE.peakUTC}:00`; // 16:00 local peak burn
  else                                     targetISO = new Date().toISOString().slice(0, 13) + ':00'; // most recent available hour
  let i = times.indexOf(targetISO);
  if (i === -1) i = times.length - 1;

  // 24-h precipitation accumulated to the target hour (CFFDRS daily rain window).
  // past_days=1 guarantees the full preceding 24 h is in the array.
  const rain24 = d.hourly.precipitation
    .slice(Math.max(0, i - 23), i + 1)
    .reduce((s, v) => s + (v ?? 0), 0);

  const sourceNote = !isPreNoon ? 'Open-Meteo NWP (noon LST)'
    : PROVINCE.preNoonNWP === 'peak' ? `Open-Meteo NWP (peak burn forecast · 16:00 ${PROVINCE.tzLabel})`
    : 'Open-Meteo NWP (pre-noon — best available)';
  return {
    temp:  d.hourly.temperature_2m[i],
    rh:    d.hourly.relative_humidity_2m[i],
    wind:  d.hourly.wind_speed_10m[i],
    wdir:  d.hourly.wind_direction_10m[i] ?? null,
    rain:             rain24,
    thunderstormProb: d.hourly.thunderstorm_probability?.[i] ?? null,
    month: new Date().getMonth() + 1,
    source: sourceNote,
    fwiFromCWFIS: false,
  };
}

/**
 * Run FWI equations from weather + optional previous-day state.
 * When CWFIS provides pre-computed FWI codes (in-season), those are used
 * directly — they incorporate the proper daily carry-over chain from NRCan.
 * Van Wagner equations are used only when CWFIS codes are unavailable.
 */
function calculateFWI(w, prev = STARTUP) {
  if (w.fwiFromCWFIS && w.ffmc != null) {
    // Use CWFIS operational chain values as-is (FFMC/DMC/DC from actual carry-over)
    const isi = w.isi ?? _isi(w.ffmc, w.wind ?? 0);
    const bui = w.bui ?? _bui(w.dmc ?? 0, w.dc ?? 0);
    const fwi = w.fwi ?? _fwi(isi, bui);
    return { ffmc: w.ffmc, dmc: w.dmc, dc: w.dc, isi, bui, fwi, danger: dangerRatingProv(fwi), weather: w };
  }
  // Van Wagner equations — spring startup constants when no carry-over available.
  // Clamp sensor/NWP inputs to physical ranges (as cffdrs does): RH > 100 or
  // wind < 0 make the FFMC drying terms NaN; negative rain is meaningless.
  w = { ...w, rh: Math.min(100, Math.max(0, w.rh)), wind: Math.max(0, w.wind), rain: Math.max(0, w.rain ?? 0) };
  const ffmc = _ffmc(w.temp, w.rh, w.wind, w.rain, prev.ffmc);
  const dmc  = _dmc(w.temp, w.rh, w.rain, w.month, prev.dmc);
  const dc   = _dc(w.temp, w.rain, w.month, prev.dc);
  const isi  = _isi(ffmc, w.wind);
  const bui  = _bui(dmc, dc);
  const fwi  = _fwi(isi, bui);
  return { ffmc, dmc, dc, isi, bui, fwi, danger: dangerRatingProv(fwi), weather: w };
}

/**
 * Main entry point. Call from any FWI screen.
 *
 * @param {number} lat       Latitude (default: Edmonton)
 * @param {number} lng       Longitude (default: Edmonton)
 * @param {string} station   Station label for [data-fwi="station"] elements
 */
async function initFWI(lat = PROVINCE.initDefaults.lat, lng = PROVINCE.initDefaults.lng, station = PROVINCE.initDefaults.name) {
  _stationLat  = lat; // P5: update for seasonal FMC calculation
  _stationLng  = lng;
  _stationName = station;
  const gen = ++_initGeneration; // this call's generation token
  // Forecast cache is keyed on fuel settings only — a new station (or a new
  // carry-over chain) must refetch, or the D+1 card shows the previous station.
  _forecastCache = { days: [], results: [], resultsB: [] };
  document.querySelectorAll('[data-fwi="station"]').forEach(el => el.textContent = station);
  document.querySelectorAll('[data-fwi="updated"]').forEach(el => el.textContent = 'Loading…');

  try {
    if (!_cwfisPrev.stations) await loadCWFISPrev();
    const weather = await fetchWeatherPrimary(lat, lng);
    if (gen !== _initGeneration) return; // a newer initFWI started; discard stale result

    let result;
    if (weather.fwiFromCWFIS) {
      // CWFIS has today's operational FWI chain — use directly
      result = calculateFWI(weather);
      result._obsDate = weather.repDate ? String(weather.repDate).slice(0, 10) : _lstDateStr();
      // Cache only single-station reads; IDW blends are synthetic and should not
      // be replayed as authoritative chain values in subsequent page loads
      if (!weather.idwMode) {
        try {
          localStorage.setItem(_holdKey(lat, lng), JSON.stringify({
            ffmc: result.ffmc, dmc: result.dmc, dc: result.dc,
            isi: result.isi, bui: result.bui, fwi: result.fwi,
            danger: result.danger,
            stationName: weather.stationName,
            distKm: weather.distKm ?? null,
            repDate: weather.repDate,
            cachedAt: new Date().toISOString(),
          }));
        } catch (_) {}
      }
    } else {
      // CWFIS has no FWI codes for today (pre-noon, layer refresh, processing lag,
      // end of season). Fall back to the newest real carry-over — holding cache or
      // the daily cwfis_prev.json mirror — rather than showing PENDING.
      const co = _carryOverFor(lat, lng, station);
      if (co) {
        const dc = applyDCFloor(co.dc, lat, lng).dc;
        if (co.final) {
          // Already today's noon codes — ISI/BUI/FWI with today's wind
          const isi = _isi(co.ffmc, weather.wind ?? 0);
          const bui = _bui(co.dmc, dc);
          const fwi = _fwi(isi, bui);
          result = { ffmc: co.ffmc, dmc: co.dmc, dc, isi, bui, fwi,
                     danger: dangerRatingProv(fwi), weather };
        } else {
          // Previous day's codes — step one day forward with today's weather (Van Wagner 1987)
          result = calculateFWI({ ...weather, fwiFromCWFIS: false }, { ffmc: co.ffmc, dmc: co.dmc, dc });
        }
        result._cachedFWI = co;
        result._obsDate   = co.final ? co.obsDate : _lstDateStr();
      } else {
        result = { ffmc: null, dmc: null, dc: null, isi: null, bui: null, fwi: null,
                   danger: null, weather, _inactive: true };
      }
    }
    wireDOM(result, lat, lng);
    console.log('[FWI]', result);
  } catch (err) {
    if (gen !== _initGeneration) return; // stale failure — don't overwrite newer success
    console.warn('[FWI] Load failed:', err);
    document.querySelectorAll('[data-fwi="updated"]').forEach(el => el.textContent = 'Data unavailable');
  }
}

/**
 * Fetch weather + calculate FWI for a single station object {name, lat, lng}.
 * Sets module-level _stationLat/_stationLng/_stationName so that subsequent
 * calculateFBP() calls use the correct seasonal FMC for that station's latitude.
 * Returns {station, weather, fwi} — no DOM side effects.
 * Used by the Fire Safety Briefing builder (briefing/index.html).
 */
async function fetchStationData(station) {
  _stationLat  = station.lat;
  _stationLng  = station.lng;
  _stationName = station.name;
  if (!_cwfisPrev.stations) await loadCWFISPrev();
  const weather = await fetchWeatherPrimary(station.lat, station.lng);
  let prevFWI = { ffmc: STARTUP.ffmc, dmc: STARTUP.dmc, dc: getStartupDC(station.name) };
  if (!weather.fwiFromCWFIS) {
    const co = _carryOverFor(station.lat, station.lng, station.name);
    if (co) {
      const dc = applyDCFloor(co.dc, station.lat, station.lng).dc;
      if (co.final) {
        // Already today's noon codes — don't step them a second time
        const isi = _isi(co.ffmc, weather.wind ?? 0), bui = _bui(co.dmc, dc), fwiV = _fwi(isi, bui);
        return { station, weather, fwi: { ffmc: co.ffmc, dmc: co.dmc, dc, isi, bui, fwi: fwiV,
                 danger: dangerRatingProv(fwiV), weather } };
      }
      prevFWI = { ffmc: co.ffmc, dmc: co.dmc, dc };
    }
  }
  const fwi = calculateFWI(weather, prevFWI);
  return { station, weather, fwi };
}

/**
 * Fetch D+1 forecast weather for a station using ECMWF IFS via Open-Meteo.
 * FWI chain uses hour-12 (noon) forecast conditions with CWFIS carry-over as prev.
 * FBP wind uses hour-16 (peak burn ~16:00 MDT) — matches the D+1 peak prediction
 * shown on the station detail page.
 * Used by the Fire Safety Briefing builder for PM Forecast mode.
 */
async function fetchStationDataForecast(station) {
  _stationLat  = station.lat;
  _stationLng  = station.lng;
  _stationName = station.name;

  const days = await fetchForecast(station.lat, station.lng);

  // D+1: next operationally relevant peak burn day (today if before 16:00 local, tomorrow if after)
  let day = days[_nextPeakDayIdx(days)] || days[1] || days[0];

  // Weather: noon (hour 12) for FWI chain; peak wind (hour 16) for FBP
  const weather = {
    temp:             day.temp,
    rh:               day.rh,
    wind:             day.peak.wind,  // peak burn hour — used by calculateFBP
    wdir:             day.peak.wdir,
    rain:             day.rain,
    thunderstormProb: null,
    month:            new Date().getMonth() + 1,
    source:           `ECMWF IFS 0.25° · ${day.label} · Peak ~16:00 ${PROVINCE.tzLabel}`,
    fwiFromCWFIS:     false,
  };

  // FWI carry-over: use CWFIS yesterday values as starting state
  if (!_cwfisPrev.stations) await loadCWFISPrev();
  let prevFWI = { ffmc: STARTUP.ffmc, dmc: STARTUP.dmc, dc: getStartupDC(station.name) };
  const p = _cwfisPrevFor(station.name, station.lat, station.lng);
  if (p?.ffmc != null && p?.dmc != null && p?.dc != null) {
    prevFWI = { ffmc: p.ffmc, dmc: p.dmc, dc: applyDCFloor(p.dc, station.lat, station.lng).dc };
  }

  // Step the chain through any forecast days between the carry-over obs and
  // the target day (previously D+1 was stepped straight from D−1, skipping today).
  const asOf  = p?.repDate ? String(p.repDate).slice(0, 10) : null;
  const dayIx = days.indexOf(day);
  if (asOf && dayIx > 0) {
    const pre = calcMultiDay(days.slice(0, dayIx), getStartupDC(station.name), { ...prevFWI, obsDate: asOf });
    const last = pre[pre.length - 1];
    prevFWI = { ffmc: last.ffmc, dmc: last.dmc, dc: last.dc };
  }
  const dayDate = day?._ts != null ? new Date(day._ts).toISOString().slice(0, 10) : null;
  const fwi = (asOf && dayDate && dayDate <= asOf)
    ? calculateFWI({ ...weather, fwiFromCWFIS: true, ...prevFWI }, prevFWI) // target day already in carry-over
    : calculateFWI(weather, prevFWI);
  return { station, weather, fwi, forecastDay: day };
}
try { _idwMode = localStorage.getItem('fwi_idw_mode') === '1'; } catch (_) {}

/** Query NRCan CWFIS WMS for FBP fuel type at a lat/lng point. */
async function _queryWMSFuelType(lat, lng) {
  const layer = 'public:cffdrs_fbp_fuel_types';
  const d = 0.001;
  const url =
    `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wms?` +
    `SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo` +
    `&LAYERS=${layer}&QUERY_LAYERS=${layer}` +
    `&BBOX=${lng - d},${lat - d},${lng + d},${lat + d}` +
    `&WIDTH=3&HEIGHT=3&SRS=EPSG:4326&X=1&Y=1` +
    `&INFO_FORMAT=application/json`;
  const resp = await fetchWithTimeout(url, {}, 10000);
  const data = await resp.json();
  const props = data.features?.[0]?.properties || {};
  const raw = props.Label_CFFDRS_FBP_Fuel_Type ||
              props.FUELTYPE || props.fuel_type || props.fueltype || null;
  return _normalizeFuelCode(raw);
}

// Edmonton LiDAR fuel raster — loaded once, cached in memory
let _edmFuelCanvas = null;
let _edmFuelMeta   = null;

async function _loadEdmontonFuelRaster() {
  if (_edmFuelCanvas) return; // already loaded
  const base = document.querySelector('script[src*="fwi.js"]')?.src.replace(/fwi\.js.*$/, '') || '../';
  const [meta, imgBlob] = await Promise.all([
    fetch(base + 'data/edmonton_fuels.json').then(r => r.json()),
    fetch(base + 'data/edmonton_fuels.png').then(r => r.blob()),
  ]);
  const img = await createImageBitmap(imgBlob);
  const canvas = new OffscreenCanvas(meta.width, meta.height);
  canvas.getContext('2d').drawImage(img, 0, 0);
  _edmFuelCanvas = canvas;
  _edmFuelMeta   = meta;
}

/** Query Edmonton LiDAR fuel raster at lat/lng. Returns FBP code or null. */
async function _queryEdmontonFuelType(lat, lng) {
  await _loadEdmontonFuelRaster();
  const { bounds, width, height, codes } = _edmFuelMeta;
  if (lat < bounds.south || lat > bounds.north || lng < bounds.west || lng > bounds.east) return null;
  const px = Math.floor((lng - bounds.west)  / (bounds.east  - bounds.west)  * width);
  const py = Math.floor((bounds.north - lat) / (bounds.north - bounds.south) * height);
  const pixel = _edmFuelCanvas.getContext('2d').getImageData(px, py, 1, 1).data;
  const code  = pixel[0]; // R channel = fuel code value
  return codes[String(code)] || null;
}

/** Returns true if lat/lng is within the Edmonton fuel raster extent. */
function _isInEdmontonBounds(lat, lng) {
  if (!_edmFuelMeta) return false; // not loaded yet — check rough bounds
  const b = _edmFuelMeta.bounds;
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

// Rough Edmonton bounds for pre-load trigger (before meta is fetched)
const _EDM_ROUGH = { south: 53.33, north: 53.72, west: -113.72, east: -113.27 };

// ─── Regional Summary ────────────────────────────────────────────────────────

/** Map lat to one of 5 Alberta sectors (North→South). */
function _stationSector(lat) {
  if (lat >= 56.5) return 'Far North';
  if (lat >= 54.5) return 'North';
  if (lat >= 53.0) return 'Central';
  if (lat >= 51.5) return 'Central-South';
  return 'South';
}

/** Byram HFI intensity class label (1–6) from kW/m value. */
function _hfiClass(hfi) {
  if (hfi == null || isNaN(hfi)) return '—';
  if (hfi < 10)    return '1-Low';
  if (hfi < 500)   return '2-Mod';
  if (hfi < 2000)  return '3-High';
  if (hfi < 4000)  return '4-VH';
  if (hfi < 10000) return '5-Ext';
  return '6-Cat';
}

// Cache populated by buildRegionalSummary — used by exportRegionalDataset
let _regionalCache = [];
// Cache populated by buildStationMap — stores all 39 station FWI results
let _mapStationCache = [];

const FWI_ALARM_KEY = 'fwi-alarm-threshold';

function _getAlarmThreshold() {
  return parseFloat(localStorage.getItem(FWI_ALARM_KEY) ?? '15.5');
}
// Previous-day CWFIS carry-over values loaded from GitHub-hosted JSON (see cwfis-daily.yml)
let _cwfisPrev = {};
// Cache populated by buildForecastTrends — used by exportForecastReport
let _forecastCache = { days: [], results: [] };

/**
 * Load previous-day CWFIS carry-over values from the GitHub-hosted JSON.
 * Updated daily by .github/workflows/cwfis-daily.yml after 13:00 LST obs.
 * Used as `prev` in calculateFWI when CWFIS is not the live source (SWOB/NWP),
 * giving Van Wagner a real carry-over chain rather than spring STARTUP defaults.
 * Fails silently — any error leaves _cwfisPrev empty and STARTUP is used instead.
 */
async function loadCWFISPrev() {
  try {
    const res = await fetchWithTimeout(
      'https://raw.githubusercontent.com/Tphambolio/FWI/main/data/cwfis_prev.json',
      { cache: 'no-cache' }, PROVINCE.prevTimeoutMs
    );
    const data = await res.json();
    // Reject stale caches: if the daily Action has been broken for 2+ days,
    // silently replaying week-old codes is worse than a clean cold start.
    if (data?.generated && (Date.now() - new Date(data.generated).getTime()) > 48 * 3600000) {
      console.warn(`[FWI] cwfis_prev.json is stale (generated ${data.generated}) — ignoring`);
      return;
    }
    // Each province reads its own section (PROVINCE.prevSection: AB 'stations',
    // BC 'bcStations'). Previously both engines read `stations`, so BC's
    // "Red Deer" silently inherited Alberta Red Deer's codes from 600 km away.
    const section = data?.[PROVINCE.prevSection];
    if (section) _cwfisPrev = { generated: data.generated, stations: section };
  } catch (_) { /* network error — fall through to STARTUP defaults */ }
}

/**
 * Carry-over lookup for a station — case-insensitive name match with a
 * 10 km coordinate fallback (CWFIS renames/uppercases MSC stations over time).
 */
function _cwfisPrevFor(name, lat, lng) {
  const s = _cwfisPrev?.stations;
  if (!s) return null;
  if (!_cwfisPrev._upper) {
    _cwfisPrev._upper = {};
    for (const [k, v] of Object.entries(s)) _cwfisPrev._upper[k.toUpperCase()] = v;
  }
  const byName = _cwfisPrev._upper[(name || '').toUpperCase()];
  if (byName) return byName;
  if (lat == null || lng == null) return null;
  let best = null, bestD = 10;
  for (const v of Object.values(s)) {
    if (v?.lat == null || v?.lon == null) continue;
    const d = _haversineKm(lat, lng, v.lat, v.lon);
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}

/**
 * Calendar date (YYYY-MM-DD) of the CFFDRS observation day — noon LST
 * (PROVINCE.lstOffset hours behind UTC: 7 for AB MST, 8 for BC PST).
 */
function _lstDateStr(ts) {
  return new Date((ts ?? Date.now()) - PROVINCE.lstOffset * 3600000).toISOString().slice(0, 10);
}

/**
 * Return "YYYY-MM-DD" in the province's daylight time (PROVINCE.localOffset
 * hours behind UTC: MDT for AB, PDT for BC). All Today/Tomorrow labels and the
 * 16:00 peak-burn cut-over use this. Province modules expose it under their
 * historical names (_mdtDateStr / _pdtDateStr).
 * @param {number} [ts] - Unix ms timestamp; defaults to Date.now()
 */
function _localDateStr(ts) {
  const d = new Date((ts ?? Date.now()) - PROVINCE.localOffset * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Newest real FWI carry-over for a point when CWFIS has no codes for today
 * (pre-noon, the ~19 UTC layer refresh, processing lag, or end of season):
 * the browser holding cache or the daily cwfis_prev.json mirror, whichever
 * has the later observation date. Returns null if neither is ≤2 days old.
 * `final` = the codes are already today's noon values; otherwise they are an
 * earlier day's and must be stepped forward with today's weather.
 */
function _carryOverFor(lat, lng, name) {
  const cands = [];
  try {
    const h = JSON.parse(localStorage.getItem(_holdKey(lat, lng)));
    if (h?.ffmc != null && h?.dmc != null && h?.dc != null && h.repDate) cands.push({ ...h, src: 'holding' });
  } catch (_) {}
  const p = _cwfisPrevFor(name, lat, lng);
  if (p?.ffmc != null && p?.dmc != null && p?.dc != null && p.repDate) {
    cands.push({ ...p, src: 'daily',
      distKm: p.lat != null ? Math.round(_haversineKm(lat, lng, p.lat, p.lon)) : null });
  }
  let best = null;
  for (const c of cands) {
    c.obsDate = String(c.repDate).slice(0, 10);
    if (!best || c.obsDate > best.obsDate) best = c;
  }
  if (!best) return null;
  const ageDays = Math.round((Date.parse(_lstDateStr()) - Date.parse(best.obsDate)) / 86400000);
  if (!(ageDays >= 0 && ageDays <= 2)) return null;
  return { ...best, ageDays, final: ageDays === 0 };
}

// Union of both provinces' classes: 'Very Low' is BC-only, 'Very High' AB-only
// (BC's dangerRatingBC never returns it); lookups only, never iterated.
const DANGER_COLORS = {
  'Very Low':  { bar: 'bg-[#a7f3d0]',  badge: 'bg-[#a7f3d0]/20 text-[#a7f3d0]',   dot: 'bg-[#a7f3d0] shadow-[0_0_8px_#a7f3d0]' },
  'Low':       { bar: 'bg-secondary',         badge: 'bg-on-secondary-container/20 text-secondary',       dot: 'bg-secondary shadow-[0_0_8px_#4ae176]' },
  'Moderate':  { bar: 'bg-primary',            badge: 'bg-primary-container border border-primary/20 text-primary', dot: 'bg-primary shadow-[0_0_8px_#7bd0ff]' },
  'High':      { bar: 'bg-[#f5c518]',  badge: 'bg-[#f5c518]/10 text-[#f5c518]',   dot: 'bg-[#f5c518] shadow-[0_0_8px_#f5c518]' },
  'Very High': { bar: 'bg-[#f97316]',  badge: 'bg-[#f97316]/10 text-[#f97316]',   dot: 'bg-[#f97316] shadow-[0_0_8px_#f97316]' },
  'Extreme':   { bar: 'bg-[#ef4444]',  badge: 'bg-[#ef4444]/10 text-[#ef4444]',   dot: 'bg-[#ef4444] shadow-[0_0_8px_#ef4444]' },
};

function regionCard(name, sector, r) {
  const c = DANGER_COLORS[r.danger] || DANGER_COLORS['Moderate'];
  return `
<div class="group relative overflow-hidden bg-surface-container hover:bg-surface-container-high transition-all duration-300 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
  <div class="flex items-center gap-6">
    <div class="w-1.5 h-16 ${c.bar} rounded-full"></div>
    <div>
      <h3 class="font-headline text-2xl font-bold text-on-surface">${name}</h3>
      <div class="flex items-center gap-2 mt-1">
        <span class="material-symbols-outlined text-[14px] text-on-surface-variant">location_on</span>
        <span class="font-label text-xs text-on-surface-variant uppercase tracking-widest">${sector}</span>
      </div>
    </div>
  </div>
  <div class="flex flex-wrap items-center gap-4 md:gap-12">
    <div class="grid grid-cols-2 gap-x-8 gap-y-1">
      <div>
        <span class="font-label text-[10px] text-on-surface-variant uppercase block">Temp</span>
        <span class="font-headline text-lg text-on-surface font-medium">${fmt(r.weather.temp)}°C</span>
      </div>
      <div>
        <span class="font-label text-[10px] text-on-surface-variant uppercase block">Wind</span>
        <span class="font-headline text-lg text-on-surface font-medium">${fmt(r.weather.wind, 0)} km/h</span>
      </div>
      <div>
        <span class="font-label text-[10px] text-on-surface-variant uppercase block">FWI</span>
        <span class="font-headline text-lg text-on-surface font-medium">${fmt(r.fwi)}</span>
      </div>
      <div>
        <span class="font-label text-[10px] text-on-surface-variant uppercase block">RH</span>
        <span class="font-headline text-lg text-on-surface font-medium">${fmt(r.weather.rh, 0)}%</span>
      </div>
    </div>
    <div class="flex items-center gap-3 ${c.badge} px-4 py-2 rounded-full">
      <span class="w-2 h-2 rounded-full ${c.dot}"></span>
      <span class="font-label text-xs font-bold tracking-widest uppercase">${r.danger} Risk</span>
    </div>
  </div>
</div>`;
}

// ─── Forecast & Trends ───────────────────────────────────────────────────────


/** Return nearest NAEFS station within 150 km, or null. */
function findNearestNAEFS(lat, lng) {
  let best = null, bestDist = Infinity;
  for (const st of PROVINCE.naefsStations) {
    const d = _haversineKm(lat, lng, st.lat, st.lng);
    if (d < bestDist) { bestDist = d; best = st; }
  }
  return bestDist <= 150 ? best : null;
}

/** Fetch NAEFS ensemble forecast from CWFIS WFS for a given station code.
 *  Returns day objects compatible with calcMultiDay: {temp, rh, wind, rain, month, label}
 *  Uses max_temp + min_rh (fire weather peak) and median_ws, median_pcp. */
async function fetchForecastNAEFS(code) {
  const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs` +
    `?service=WFS&version=2.0.0&request=GetFeature&typeNames=public:firewx_naefs` +
    `&outputFormat=application/json&CQL_FILTER=code=${code}&count=20`;
  const res = await fetchWithTimeout(url, {}, 15000);
  const d = await res.json();
  return d.features
    .map(f => {
      const p = f.properties;
      const dt = new Date(p.date_time);
      const label = dt.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      // KNOWN LIMITATION: the CWFIS firewx_naefs layer publishes only ensemble
      // aggregates (max_temp, min_rh, median_ws, median_pcp). Feeding daily
      // max-T/min-RH into the noon-calibrated FWI equations overstates drying,
      // and median precip of a zero-inflated ensemble understates rain — both
      // bias the 14-day chain toward higher indices. Treat the NAEFS trend as
      // a conservative (drier) scenario; no member-level data is available to
      // do better from this layer.
      const peakTemp = p.max_temp ?? 15;
      const peakRh   = p.min_rh   ?? 40;
      const peakWind = p.median_ws ?? 10;
      // NAEFS date_time is midnight UTC representing that UTC calendar day.
      // _mdtDateStr subtracts 6h (MDT), so midnight UTC maps to 6pm of the
      // previous MDT day — off by one. Adding 12h shifts to noon UTC so
      // _mdtDateStr correctly returns the same calendar date in MDT.
      return {
        temp:  peakTemp,
        rh:    peakRh,
        wind:  peakWind,
        rain:  p.median_pcp  ?? 0,
        month: dt.getUTCMonth() + 1, // dt is midnight UTC — local month is the previous day's in the Americas
        label,
        _ts: dt.getTime() + 12 * 3600000,  // midnight UTC → noon UTC → same MDT calendar date
        peak: { temp: peakTemp, rh: peakRh, wind: peakWind },
      };
    })
    .sort((a, b) => a._ts - b._ts);
}

/** Fetch 7-day hourly forecast from Open-Meteo using ECMWF IFS 0.25° model.
 *  ECMWF IFS is the same model ECCC uses for verification — best available global NWP for Canadian latitudes. */
async function fetchForecast(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lng}` +
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation` +
    `&timezone=UTC&past_days=2&forecast_days=8`;
  const res = await fetchWithTimeout(url, {}, 15000);
  const d = await res.json();
  const h = d.hourly;
  const days = [];
  // The hourly array starts at 00:00 UTC two days ago (past_days=2). For each
  // forecast day starting today: noon LST = PROVINCE.noonUTC (19:00 UTC AB,
  // 20:00 UTC BC — CFFDRS chain input), peak burn = noon + 3 h (16:00 local
  // daylight time, FBP inputs). Daily rain is the CFFDRS
  // noon-to-noon 24-h accumulation — the old code passed a single hour of
  // precip, which made forecast rain ≈ 0 and biased the whole chain dry.
  // (The previous timezone=auto + index-12 selection also sampled 12:00 local
  // daylight time = 11:00 LST, parsed in the viewer's browser timezone.)
  // Day 0 is today's LST observation day, located by date. A fixed offset from
  // the array start broke after UTC midnight (evenings): "today" in UTC is
  // already tomorrow locally, so days[0] skipped today. past_days=2 keeps a
  // full 24-h rain window before day 0 in that case too.
  let base = h.time.indexOf(`${_lstDateStr()}T${PROVINCE.noonUTC}:00`);
  if (base < 23) base = 48 + PROVINCE.noonUTC;
  for (let day = 0; day < 7; day++) {
    const iNoon = base + 24 * day;
    const iPeak = iNoon + 3;
    if (iNoon >= (h.time?.length ?? 0)) break;
    const rain24 = h.precipitation
      .slice(iNoon - 23, iNoon + 1)
      .reduce((s, v) => s + (v ?? 0), 0);
    const date = new Date(h.time[iNoon] + ':00Z'); // explicit UTC parse
    days.push({
      temp:  h.temperature_2m[iNoon]       ?? 15,
      rh:    h.relative_humidity_2m[iNoon] ?? 40,
      wind:  h.wind_speed_10m[iNoon]       ?? 10,
      rain:  rain24,
      month: date.getUTCMonth() + 1,
      label: date.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
      _ts: date.getTime(),
      peak: {
        temp: h.temperature_2m[iPeak]        ?? h.temperature_2m[iNoon]        ?? 15,
        rh:   h.relative_humidity_2m[iPeak]  ?? h.relative_humidity_2m[iNoon]  ?? 40,
        wind: h.wind_speed_10m[iPeak]        ?? h.wind_speed_10m[iNoon]        ?? 10,
        wdir: h.wind_direction_10m?.[iPeak]  ?? h.wind_direction_10m?.[iNoon]  ?? null,
      },
    });
  }
  return days;
}

/**
 * Fetch the past 23 hours of hourly data for the 24-hour trend chart.
 * Uses Open-Meteo's past_hours extension.
 */
async function fetchHourly(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lng}` +
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation` +
    `&timezone=auto&past_hours=23&forecast_hours=0`;
  const res = await fetchWithTimeout(url, {}, 12000);
  const d = await res.json();
  const h = d.hourly;
  return (h.time || []).map((t, i) => ({
    time:  new Date(t),
    temp:  h.temperature_2m[i]       ?? 15,
    rh:    h.relative_humidity_2m[i]  ?? 40,
    wind:  h.wind_speed_10m[i]        ?? 10,
    rain:  h.precipitation[i]         ?? 0,
    month: new Date(t).getMonth() + 1,
  }));
}

/** Chain Van Wagner through multiple days, returning FWI result per day.
 *  startState: { ffmc, dmc, dc } — defaults to STARTUP if not provided (e.g. no obs yet).
 *  Pass _lastFWI when available so the chain continues from today's actual values. */
function calcMultiDay(days, startupDC = 300, startState = null) {
  let prev = startState
    ? { ffmc: startState.ffmc, dmc: startState.dmc, dc: startState.dc }
    : { ffmc: STARTUP.ffmc, dmc: STARTUP.dmc, dc: startupDC };
  // startState.obsDate = date of the noon obs the start state already includes.
  // Forecast days on/before it are not stepped again (that applied today's
  // drying twice); they report the state's codes with that day's forecast wind.
  const asOf = startState?.obsDate || null;
  // Guard against null values propagating through chain
  return days.map(w => {
    const safe = {
      temp:  w.temp  ?? 15,
      rh:    w.rh    ?? 40,
      wind:  w.wind  ?? 10,
      rain:  w.rain  ?? 0,
      month: w.month ?? (new Date().getMonth() + 1),
    };
    const dDate = w._ts != null ? new Date(w._ts).toISOString().slice(0, 10) : null;
    const r = (asOf && dDate && dDate <= asOf)
      ? calculateFWI({ ...safe, fwiFromCWFIS: true, ffmc: prev.ffmc, dmc: prev.dmc, dc: prev.dc }, prev)
      : calculateFWI(safe, prev);
    prev = { ffmc: r.ffmc, dmc: r.dmc, dc: r.dc };
    return { ...r, label: w.label };
  });
}

/** Read persisted fuel type (set by station_detail fuel picker), default PROVINCE.fuelDefaults.a. */
function _savedFuelCode() {
  return _seasonalFuel((typeof localStorage !== 'undefined' && localStorage.getItem(PROVINCE.storageKeys.fuelA))  || PROVINCE.fuelDefaults.a);
}

function _savedFuelCode2() {
  return _seasonalFuel((typeof localStorage !== 'undefined' && localStorage.getItem(PROVINCE.storageKeys.fuelB)) || PROVINCE.fuelDefaults.b);
}

function _savedCuring() {
  return parseInt((typeof localStorage !== 'undefined' && localStorage.getItem(PROVINCE.storageKeys.curing)) || '80', 10);
}

function _savedPS() {
  return parseInt((typeof localStorage !== 'undefined' && localStorage.getItem(PROVINCE.storageKeys.ps)) || '50', 10);
}

/**
 * Index of the next operationally relevant peak burn day in a `days` array.
 * Returns today's index if 16:00 local daylight time (MDT / PDT) has not yet
 * passed; tomorrow's index otherwise. Falls back to index 0.
 */
function _nextPeakDayIdx(days) {
  // Compare local daylight-time calendar dates — the old `getUTCHours() >= 22`
  // test was only true 16:00–17:59 MDT (UTC wraps at 18:00 MDT), and the cutoff
  // used the *viewer's* local midnight, so evening visitors saw "Tomorrow" flip
  // back to a stale "Today".
  const localNow   = new Date(Date.now() - PROVINCE.localOffset * 3600000);
  const peakPassed = localNow.getUTCHours() >= 16;   // 16:00 local peak burn
  const today      = _localDateStr();
  const idx = days.findIndex(d => d._ts &&
    (peakPassed ? _localDateStr(d._ts) > today : _localDateStr(d._ts) >= today));
  return idx >= 0 ? idx : 0;
}

/** Chain Van Wagner + FBP per day. FBP uses each day's peak (16:00) conditions.
 *  Returns results array where each element has { ...fwiResult, fbp, peakWeather }. */
function calcMultiDayFBP(days, startupDC = 300, startState = null, fuelCode = 'C2', curing = 100, ps = 50, opts = {}) {
  const results = calcMultiDay(days, startupDC, startState);
  return results.map((r, i) => {
    const pw = days[i]?.peak || days[i]; // peak = 16:00; fallback to noon
    const fbp = calculateFBP(fuelCode, r.ffmc, r.dmc, r.dc, pw.wind ?? r.weather?.wind ?? 10, 0, curing, ps, opts);
    return { ...r, fbp, peakWeather: pw };
  });
}

function trendLabel(fwi, prevFwi) {
  const delta = fwi - prevFwi;
  if (delta > 5)  return 'ESCALATING';
  if (delta < -5) return 'IMPROVING';
  return 'STABLE';
}

// ─── Forecast Summary Text ───────────────────────────────────────────────────

function forecastSummaryText(days, results, stationName = 'Edmonton', source = 'Open-Meteo NWP') {
  const peakDay  = results.reduce((a, b) => b.fwi > a.fwi ? b : a);
  const trend    = results[results.length - 1].fwi > results[0].fwi ? 'increasing' : 'decreasing';
  const maxDanger = peakDay.danger;
  const peakTemp  = Math.max(...days.map(d => d.temp ?? -99)).toFixed(1);
  const minRH     = Math.min(...days.map(d => d.rh  ?? 999)).toFixed(0);
  const nDays     = days.length;
  return `${stationName} station — ${nDays}-day outlook: FWI peaks at ${peakDay.fwi.toFixed(1)} (${maxDanger}) on ${peakDay.label}. ` +
    `Forecast trend is ${trend}. Peak temperature ${peakTemp}°C, minimum relative humidity ${minRH}%. ` +
    `Source: ${source} — Van Wagner CFFDRS carry-forward.`;
}

function exportForecastReport() {
  const { days, results } = _forecastCache;
  if (!results.length) { alert('Forecast still loading — try again in a moment.'); return; }
  const timestamp = new Date().toISOString();
  const rows = [['Timestamp', 'Day', 'Date', 'Temp_C', 'RH_pct', 'Wind_kmh', 'Rain_mm', 'FFMC', 'DMC', 'DC', 'ISI', 'BUI', 'FWI', 'Danger']];
  results.forEach((r, i) => {
    const d = days[i];
    rows.push([
      timestamp, `D+${i+1}`, r.label,
      d.temp, d.rh, d.wind, d.rain,
      r.ffmc.toFixed(1), r.dmc.toFixed(1), r.dc.toFixed(1),
      r.isi.toFixed(1), r.bui.toFixed(1), r.fwi.toFixed(1), r.danger,
    ]);
  });
  _triggerCSVDownload(rows, `fwi-forecast-${new Date().toISOString().slice(0,10)}.csv`);
}

function _triggerCSVDownload(rows, filename) {
  const csv  = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Live Station Map (Leaflet) ───────────────────────────────────────────────

const MARKER_COLORS = {
  'Low':       '#4ae176',
  'Moderate':  '#7bd0ff',
  'High':      '#f5c518',
  'Very High': '#ff8c42',
  'Extreme':   '#ff4d4d',
};

async function fetchSCRIBE(lat, lng) {
  try {
    const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs` +
      `?service=WFS&version=2.0.0&request=GetFeature&typeNames=public:firewx_scribe` +
      `&outputFormat=application/json` +
      `&CQL_FILTER=latitude+BETWEEN+${(lat-2).toFixed(2)}+AND+${(lat+2).toFixed(2)}` +
      `+AND+longitude+BETWEEN+${(lng-2).toFixed(2)}+AND+${(lng+2).toFixed(2)}&count=500`;
    let res;
    try { res = await fetchWithTimeout(url, {}, 12000); } catch (_) { return null; }
    const d = await res.json();
    // Group valid records by station name
    const byStation = {};
    for (const f of d.features) {
      const p = f.properties;
      if (p.fwi == null || p.fwi < 0) continue; // FWI 0 is a valid forecast
      if (!byStation[p.name]) byStation[p.name] = { lat: p.latitude, lng: p.longitude, records: [] };
      byStation[p.name].records.push(p);
    }
    // Find nearest station with valid data
    let best = null, bestDist = Infinity;
    for (const [name, data] of Object.entries(byStation)) {
      const dist = _haversineKm(lat, lng, data.lat, data.lng);
      if (dist < bestDist) { bestDist = dist; best = { name, distKm: Math.round(dist), records: data.records.sort((a,b) => new Date(a.rep_date) - new Date(b.rep_date)) }; }
    }
    return best;
  } catch (e) {
    console.warn('[FWI SCRIBE]', e);
    return null;
  }
}

async function fetchActiveFires() {
  const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs` +
    `?service=WFS&version=2.0.0&request=GetFeature&typeNames=public:activefires_current` +
    `&outputFormat=application/json&count=200`;
  try {
    const res = await fetchWithTimeout(url, {}, 12000);
    const d = await res.json();
    return d.features.map(f => f.properties).filter(p => p.lat && p.lon);
  } catch (_) { return []; }
}

async function fetchHotspots() {
  // Filter to Canada/northern US bbox. With PROVINCE.trimFeedProperties, request
  // only the fields we render — the full GeoJSON is ~468 KB for 500 dots; the
  // property subset is ~10× smaller.
  const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs` +
    `?service=WFS&version=2.0.0&request=GetFeature&typeNames=public:hotspots_24h` +
    `&outputFormat=application/json${PROVINCE.trimFeedProperties ? '&propertyName=lat,lon,satellite,sensor,hfi' : ''}` +
    `&CQL_FILTER=lat+BETWEEN+48+AND+70+AND+lon+BETWEEN+-140+AND+-50&count=500`;
  try {
    const res = await fetchWithTimeout(url, {}, 12000);
    const d = await res.json();
    return d.features.map(f => f.properties).filter(p => p.lat && p.lon);
  } catch (_) { return []; }
}

window.FWI = { initFWI, calcFMC, calcSFC, _hffmc, buildStationPicker, buildRegionalSummary, buildForecastTrends, buildHourlyChart, buildStationMap, buildD1Card, calculateFWI, calculateFBP, calcMultiDayFBP, wireFBP, refreshFBP, fetchWeather, fetchCWFIS, fetchWeatherPrimary, fetchStationData, fetchStationDataForecast, dangerRating, exportRegionalDataset, exportForecastReport, printProvincialBriefing, printStationBriefing, FUEL_TYPES, FUEL_PAIR_COMPLEMENT, hfiClassInfo, _calcFireArea60, _stationSector, _updateAlarmStrip,
  get _idwMode() { return _idwMode; },
  set _idwMode(v) { _idwMode = v; },
};
// Province-specific window.FWI members (e.g. BC_STATIONS, dangerRatingBC).
if (typeof PROVINCE.exports === 'function') Object.assign(window.FWI, PROVINCE.exports());
