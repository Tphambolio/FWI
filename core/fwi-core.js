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
 // module-level; set by initFWI
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

/**
 * Fetch weather — three-tier hierarchy:
 *   1. CWFIS firewx_stns_current — fire weather stations, pre-computed FWI chain
 *   2. MSC SWOB realtime         — real sensor obs, noon LST targeted
 *   3. Open-Meteo NWP            — model output, noon LST targeted, last resort
 */
// IDW blend mode — persisted across page loads
let _idwMode = false;
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
// Previous-day CWFIS carry-over values loaded from GitHub-hosted JSON (see cwfis-daily.yml)
let _cwfisPrev = {};
// Cache populated by buildForecastTrends — used by exportForecastReport
let _forecastCache = { days: [], results: [] };

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

// NAEFS stations available in CWFIS firewx_naefs WFS layer (Alberta only)
const NAEFS_AB_STATIONS = [
  { code: 10160, name: 'Banff',               lat: 51.18, lng: -115.57 },
  { code: 10161, name: 'Calgary Intl',         lat: 51.12, lng: -114.02 },
  { code: 10162, name: 'Cold Lake',            lat: 54.42, lng: -110.28 },
  { code: 10163, name: 'Coronation',           lat: 52.07, lng: -111.45 },
  { code: 10164, name: 'Edmonton Intl A',      lat: 53.30, lng: -113.58 },
  { code: 10165, name: 'Edmonton Municipal A', lat: 53.57, lng: -113.52 },
  { code: 10166, name: 'Edson',                lat: 53.58, lng: -116.47 },
  { code: 10167, name: 'Fort Chipewyan',       lat: 58.77, lng: -111.12 },
  { code: 10168, name: 'Fort McMurray',        lat: 56.65, lng: -111.22 },
  { code: 10169, name: 'Grande Prairie',       lat: 55.18, lng: -118.88 },
  { code: 10170, name: 'High Level',           lat: 58.62, lng: -117.17 },
  { code: 10171, name: 'Jasper',               lat: 52.88, lng: -118.07 },
  { code: 10172, name: 'Lac La Biche',         lat: 54.77, lng: -112.02 },
  { code: 10173, name: 'Lethbridge',           lat: 49.63, lng: -112.80 },
  { code: 10174, name: 'Lloydminster',         lat: 53.32, lng: -110.07 },
  { code: 10175, name: 'Medicine Hat',         lat: 50.02, lng: -110.72 },
  { code: 10176, name: 'Peace River',          lat: 56.23, lng: -117.43 },
  { code: 10177, name: 'Pincher Creek',        lat: 49.52, lng: -113.98 },
  { code: 10178, name: 'Red Deer',             lat: 52.18, lng: -113.90 },
  { code: 10179, name: 'Rocky Mtn House',      lat: 52.43, lng: -114.92 },
  { code: 10180, name: 'Slave Lake',           lat: 55.30, lng: -114.78 },
  { code: 10181, name: 'Vermilion',            lat: 53.35, lng: -110.83 },
  { code: 10182, name: 'Whitecourt',           lat: 54.15, lng: -115.78 },
];

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

window.FWI = { initFWI, calcFMC, calcSFC, _hffmc, buildStationPicker, buildRegionalSummary, buildForecastTrends, buildHourlyChart, buildStationMap, buildD1Card, calculateFWI, calculateFBP, calcMultiDayFBP, wireFBP, refreshFBP, fetchWeather, fetchCWFIS, fetchWeatherPrimary, fetchStationData, fetchStationDataForecast, dangerRating, exportRegionalDataset, exportForecastReport, printProvincialBriefing, printStationBriefing, ALBERTA_STATIONS, FUEL_TYPES, FUEL_PAIR_COMPLEMENT, hfiClassInfo, _calcFireArea60, _stationSector, _updateAlarmStrip,
  get _idwMode() { return _idwMode; },
  set _idwMode(v) { _idwMode = v; },
};
// Province-specific window.FWI members (e.g. BC_STATIONS, dangerRatingBC).
if (typeof PROVINCE.exports === 'function') Object.assign(window.FWI, PROVINCE.exports());
