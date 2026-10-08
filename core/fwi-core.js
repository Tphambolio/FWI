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

// Absolute DC below which a spring reading can only be the CWFIS cold-start
// artifact (MSC airport stations enter CWFIS with DC=15 — Van Wagner 1985
// "no data" fallback — instead of the Lawson & Armitage 2008 overwinter value).
// A genuinely well-initialized station, even after a wet spring, sits well
// above this, so the floor never overwrites real moisture state.
const DC_COLDSTART_CEILING = 60;

// ═══ SCIENCE CORE BEGIN: FWI daily equations (single source for AB + BC — CI-checked) ═══
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

// Print-safe danger colours for briefings — union of both provinces' classes
// ('Very Low' BC-only, 'Very High' AB-only); lookups only, never iterated.
const PRINT_DANGER_COLORS = {
  'Very Low':  { bg: '#d0f4e4', text: '#0a4a2a' },
  'Low':       { bg: '#d4edda', text: '#155724' },
  'Moderate':  { bg: '#cce5ff', text: '#004085' },
  'High':      { bg: '#fff3cd', text: '#856404' },
  'Very High': { bg: '#ffe5cc', text: '#7d3200' },
  'Extreme':   { bg: '#f8d7da', text: '#721c24' },
};

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
  if (hfi <10000) return { num: 5, label: 'Extreme',    size: 'Flame length 3.5 m+ · Peak of a bungalow',      desc: 'Indirect attack · Direct attack on less intense area · Must anchor', bg: '#e07820', text: '#2a1a00' };
  return           { num: 6, label: 'Catastrophic', size: 'Flame length 3.5 m+ · Peak of a bungalow',      desc: 'No direct attack — evacuate structure zone',               bg: '#cc2200', text: '#ffffff' };
}

// ─── Danger colour tokens — ONE set used everywhere (badges, chips, map pills,
// table cells, alarm strip, print). Low green · Moderate blue · High yellow ·
// Very High orange · Extreme red (BC adds Very Low; AB has no Very Low).
// `fg` = text on the dark UI surfaces (≥ 4.5:1 on #0b1326–#171f33);
// `solid` = fill for markers/chips; `on` = text on `solid` (≥ 4.5:1).
// Print-paper chips use PRINT_DANGER_COLORS (same hues, light tints).
const DANGER_TOKENS = {
  'Very Low':  { fg: '#a7f3d0', solid: '#a7f3d0', on: '#0b1326' },
  'Low':       { fg: '#4ae176', solid: '#4ae176', on: '#0b1326' },
  'Moderate':  { fg: '#7bd0ff', solid: '#7bd0ff', on: '#0b1326' },
  'High':      { fg: '#f5c518', solid: '#f5c518', on: '#0b1326' },
  'Very High': { fg: '#f97316', solid: '#f97316', on: '#0b1326' },
  'Extreme':   { fg: '#f87171', solid: '#ef4444', on: '#140a0a' },
};
const _NO_DANGER = { fg: '#94a3b8', solid: '#94a3b8', on: '#0b1326' };
function _dangerTok(d) { return DANGER_TOKENS[d] || _NO_DANGER; }
/** Inline style for a tinted danger chip on the dark UI. */
function dangerChipStyle(d) {
  const t = _dangerTok(d);
  return `background:${t.solid}26;color:${t.fg};border:1px solid ${t.solid}66`;
}

// Behaviour card gradient per danger level — same hues as DANGER_TOKENS
// (the old purple 'High' disagreed with every other High on the site).
const DANGER_GRADIENTS = {
  'Low':       'linear-gradient(135deg, #2d9e58 0%, #175c30 100%)',
  'Moderate':  'linear-gradient(135deg, #7bd0ff 0%, #008abb 100%)',
  'High':      'linear-gradient(135deg, #f5c518 0%, #c8980a 100%)',
  'Very High': 'linear-gradient(135deg, #f07030 0%, #9e3800 100%)',
  'Extreme':   'linear-gradient(135deg, #e03030 0%, #8c0a0a 100%)',
};

// HFI class 1–6 card palette — owner decision: KEEP these fills (Alberta WUI
// Pocket Guide: 1 navy · 2 sky · 3 green · 4 yellow · 5 orange · 6 red).
// `text` is the contrast-safe text colour on the fill (WCAG AA ≥ 4.5:1 at BOTH
// gradient stops): dark on 2 / 4 / 5, white on 1 / 3 / 6. Gradient stops on 3, 4
// and 5 were nudged within the same hue so one text colour passes end to end.
// `fill` is the flat colour for map pills, table chips, legends and print;
// `pattern` is a non-colour cue on 5 / 6 (deuteranopia collapses 4/5/6).
const HFI_STYLE = [
  null,
  { grad: 'linear-gradient(135deg, #2952a3 0%, #1a3a7a 100%)', fill: '#1a3a7a', text: '#ffffff', pattern: '' },
  { grad: 'linear-gradient(135deg, #7bd4f0 0%, #3a9ccc 100%)', fill: '#5bb8d4', text: '#0a2a50', pattern: '' },
  { grad: 'linear-gradient(135deg, #23783c 0%, #1a5428 100%)', fill: '#1e6b35', text: '#ffffff', pattern: '' },
  { grad: 'linear-gradient(135deg, #e0b012 0%, #c8980a 100%)', fill: '#f5c518', text: '#2a1a00', pattern: '' },
  { grad: 'linear-gradient(135deg, #e8822a 0%, #d26e18 100%)', fill: '#e07820', text: '#2a1a00',
    pattern: 'repeating-linear-gradient(45deg, rgba(0,0,0,0.20) 0 2px, transparent 2px 7px)' },
  { grad: 'linear-gradient(135deg, #e03030 0%, #8c0a0a 100%)', fill: '#cc2200', text: '#ffffff',
    pattern: 'repeating-linear-gradient(45deg, rgba(0,0,0,0.28) 0 2px, transparent 2px 7px), repeating-linear-gradient(-45deg, rgba(0,0,0,0.28) 0 2px, transparent 2px 7px)' },
];
// HFI class gradients for independent fuel section colouring (class 1–6)
const HFI_GRADIENTS = HFI_STYLE.map(s => s && s.grad);
/** HFI class number (1–6) from the regional "N-Word" label, or 0. */
function _hfiNumOf(lbl) { return parseInt(String(lbl || '').split('-')[0], 10) || 0; }
/** Inline style for a flat HFI chip / cell: card fill + safe text, plus a
 *  pattern and heavy border on 5 / 6 so they never rely on colour alone. */
function hfiChipStyle(num) {
  const s = HFI_STYLE[num];
  if (!s) return 'background:#334155;color:#e2e8f0';
  const bg = s.pattern ? `background:${s.pattern},${s.fill}` : `background:${s.fill}`;
  const border = num >= 5 ? `;box-shadow:inset 0 0 0 2px ${num === 6 ? '#000000' : '#2a1a00'}` : '';
  return `${bg};color:${s.text}${border}`;
}
/** Apply an HFI class to a fuel card section: gradient fill + safe text colour. */
function _paintHfiSection(el, num) {
  if (!el) return;
  const s = HFI_STYLE[num] || HFI_STYLE[1];
  el.style.background = s.grad;
  el.style.color = s.text;
  el.dataset.hfi = String(num);
}

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

// ═══ SCIENCE CORE BEGIN: FBP parameters (single source for AB + BC — CI-checked) ═══
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

// ═══ SCIENCE CORE BEGIN: FMC + RSI helpers (single source for AB + BC — CI-checked) ═══
/**
 * Foliar moisture content — FCFDG 1992 Eqs. 1-8, as cffdrs foliar_moisture_content():
 * the elevation form (Eqs. 3-4) when elevation (m ASL) is known, else Eqs. 1-2.
 * Elevation shifts the date of minimum FMC later (~+0.0172 d/m), e.g. Banff
 * (1388 m) D0 ≈ 161 vs 146 without it.
 * FMC bottoms out (~85) around the date of minimum foliar moisture D0 and
 * saturates at 120 elsewhere. Affects crown-fire initiation via CSI.
 * @param {number} lat  Station latitude (°N)
 * @param {number} lng  Station longitude (°, negative W or positive °W both accepted)
 * @param {number} doy  Day of year (1-366)
 */
function calcFMC(lat, lng, doy, elev = 0) {
  const lonW = Math.abs(lng);                                  // Eqs. 1/3 use °W positive (cffdrs flips negative LONG)
  const useElev = elev != null && elev > 0;
  const latn = useElev
    ? 43 + 33.7 * Math.exp(-0.0351 * (150 - lonW))             // Eq. 3 (elevation known)
    : 46 + 23.4 * Math.exp(-0.0360 * (150 - lonW));            // Eq. 1
  const d0 = Math.round(useElev
    ? 142.1 * (lat / latn) + 0.0172 * elev                     // Eq. 4 (elevation in m)
    : 151 * (lat / latn));                                     // Eq. 2 (rounded — it is a date)
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
let _stationElev = null; // station elevation (m ASL) for the FMC elevation form; null → Eqs. 1-2

/**
 * Ground elevation (m ASL) at a point — Open-Meteo elevation API (Copernicus
 * 90 m DEM), cached per point. null on failure (FMC then uses the no-elevation
 * form, as before). Used for foliar moisture content (FCFDG 1992 Eqs. 3-4).
 */
const _elevCache = new Map();
async function _elevationFor(lat, lng) {
  const key = `${(+lat).toFixed(3)},${(+lng).toFixed(3)}`;
  if (_elevCache.has(key)) return _elevCache.get(key);
  let elev = null;
  try {
    const d = await fetchWithTimeout(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`, {}, 6000).then(r => r.json());
    const v = Array.isArray(d?.elevation) ? d.elevation[0] : d?.elevation;
    if (typeof v === 'number' && isFinite(v) && v > -500 && v < 9000) elev = v;
  } catch (_) {}
  _elevCache.set(key, elev);
  return elev;
}
let _stationLng = PROVINCE.defaultStation.lng; // module-level; set by initFWI
let _stationName = PROVINCE.defaultStation.name; // module-level; set by initFWI
let _initGeneration = 0; // increments each initFWI call; only latest call writes to DOM

// ═══ SCIENCE CORE BEGIN: calculateFBP (single source for AB + BC — CI-checked) ═══
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

  // ISI for FBP spread — Van Wagner (1987) form with the FBP high-wind
  // modification (ST-X-3 Eq. 53a; cffdrs initial_spread_index(fbpMod = TRUE)):
  // at WSV ≥ 40 km/h f(W) = 12·(1 − e^{−0.0818·(WSV−28)}) instead of e^{0.05039·WSV},
  // which otherwise nearly doubles ISI (and ROS) by 60 km/h. The daily FWI-system
  // ISI does not use 53a. A negative windSpeed (back-fire ISI) uses the exponential.
  const m   = 147.2 * (101.0 - ffmc) / (59.5 + ffmc);
  const ff  = 91.9 * Math.exp(-0.1386 * m) * (1.0 + Math.pow(m, 5.31) / 4.93e7);
  const fw  = windSpeed >= 40 ? 12 * (1 - Math.exp(-0.0818 * (windSpeed - 28))) : Math.exp(0.05039 * windSpeed);
  const isi = 0.208 * ff * fw;

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

  const elev = opts.elev ?? _stationElev ?? 0;
  const fmc = calcFMC(lat, lng, doy, elev);
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

  // Flame length (m). Byram (1959) L = 0.0775·I^0.46 is a surface-fire relation;
  // applied to crown-fire intensities it understates flames (10 000 kW/m → 5.4 m).
  // For crowning (CFB ≥ 0.1) use Thomas (1963) L = 0.0266·I^(2/3) (~12 m at
  // 10 000 kW/m), the crown-fire relation used by Rothermel (1991) and discussed
  // by Alexander & Cruz (2012, IJWF 21:95-113).
  const flameLength = hfi <= 0 ? 0.0
    : cfb >= 0.1 ? 0.0266 * Math.pow(hfi, 2 / 3)
    : 0.0775 * Math.pow(hfi, 0.46);
  const flameModel = cfb >= 0.1 ? 'Thomas 1963 (crown)' : 'Byram 1959 (surface)';

  // Fire type classification (ST-X-3 CFB convention)
  let fireType = 'Surface';
  if      (cfb >= 0.9) fireType = 'Active Crown';
  else if (cfb >= 0.1) fireType = 'Passive Crown';
  else if (cfb > 0)    fireType = 'Torching'; // deliberate: ST-X-3 calls CFB < 0.1 surface fire; kept as an operational cue (2026-10-07)

  // ── Fire size at 60 min from a point ignition — as cffdrs ─────────────────
  // Back-fire ROS (BROS): the same ROS system evaluated at the back-fire ISI,
  // whose wind function is e^{−0.05039·W} (cffdrs back_rate_of_spread), i.e.
  // this function with −wind. Head/back distances with point-source
  // acceleration (ST-X-3 Eqs. 70-72; cffdrs distance_at_time), length-to-
  // breadth at time t (Eqs. 79-81; length_to_breadth[_at_time]), and the
  // ellipse area π·a·b with a = (DH + DB)/2, b = a / LB(t).
  let bros = null, lb = null, area60 = null, dh = null, db = null;
  if (!opts._back) {
    const back = calculateFBP(fuelCode, ffmc, dmc, dc, -windSpeed, slope, curing, ps,
      { ...opts, lat, lng, doy, elev, _back: true });
    bros = back.ros;
    const wsv = Math.max(0, windSpeed);
    lb = (fuelCode === 'O1a' || fuelCode === 'O1b')
      ? (wsv >= 1 ? 1.1 * Math.pow(wsv, 0.464) : 1.0)                   // Eqs. 80/81 (grass)
      : 1 + 8.729 * Math.pow(1 - Math.exp(-0.030 * wsv), 2.155);         // Eq. 79
    const openFuel = ['C1', 'O1a', 'O1b', 'S1', 'S2', 'S3', 'D1'].includes(fuelCode);
    const alpha = openFuel ? 0.115 : 0.115 - 18.8 * Math.pow(cfb, 2.5) * Math.exp(-8 * cfb); // Eq. 72
    const t = 60;                                                        // minutes
    const distAt = r => r * (t + Math.exp(-alpha * t) / alpha - 1 / alpha);                 // Eq. 71
    dh = distAt(ros);
    db = distAt(bros);
    const lbt = (lb - 1) * (1 - Math.exp(-alpha * t)) + 1;              // LB at time t
    area60 = Math.PI / (4 * lbt) * Math.pow(dh + db, 2) / 10000;       // ha
  }

  return { isi, bui, ros, hfi, cfb, sfc, tfc, fmc, csi, rso, sfi, flameLength, flameModel, fireType, bros, lb, dh, db, area60 };
}

// ═══ SCIENCE CORE END: calculateFBP ═══

/** Render FBP results for both fuels into the station_detail dual-fuel sections. */
function wireFBP(weather, fwi) {
  const fuelA = document.getElementById('fwi-fuel-picker')?.value   || 'C2';
  const fuelB = document.getElementById('fwi-fuel-picker-2')?.value || 'D1';
  localStorage.setItem(PROVINCE.storageKeys.fuelA, fuelA);
  localStorage.setItem(PROVINCE.storageKeys.fuelB, fuelB);
  const curing = _savedCuring();
  const ps     = _savedPS();

  const populateSection = (suffix, result) => {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    if (!result) { set('fwi-fbp-hfi-label' + suffix, 'N/A'); return; }
    set('fwi-fbp-ros'   + suffix, result.ros.toFixed(1) + ' m/min');
    set('fwi-fbp-hfi'   + suffix, Math.round(result.hfi).toLocaleString() + ' kW/m');
    set('fwi-fbp-flame' + suffix, result.flameLength.toFixed(1) + ' m');
    set('fwi-fbp-type'  + suffix, result.fireType);
    set('fwi-fbp-cfb'   + suffix, (result.cfb * 100).toFixed(0) + '%');
    const cl    = hfiClassInfo(result.hfi);
    const numEl = document.getElementById('fwi-fbp-hfi-rating' + suffix);
    const lblEl = document.getElementById('fwi-fbp-hfi-label'  + suffix);
    const szEl  = document.getElementById('fwi-fbp-hfi-size'   + suffix);
    const dscEl = document.getElementById('fwi-fbp-hfi-desc'   + suffix);
    if (numEl) { numEl.textContent = cl.num; numEl.style.color = ''; }
    if (lblEl) { lblEl.textContent = 'HFI'; lblEl.style.color = ''; }
    if (szEl)  { szEl.textContent  = cl.size; szEl.style.color = ''; }
    if (dscEl) { dscEl.textContent = cl.desc; }
    const sectionEl = document.getElementById('fwi-fbp-section' + suffix);
    _paintHfiSection(sectionEl, cl.num);
  };

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('fwi-fbp-fuel-name-a', FUEL_TYPES[fuelA]?.name || fuelA);
  setEl('fwi-fbp-fuel-name-b', FUEL_TYPES[fuelB]?.name || fuelB);
  // Guard: if the FWI chain has no valid state (CWFIS down, season not started),
  // ffmc is null. calculateFBP would silently coerce null→0 giving FFMC=0 → ISI≈0
  // → artificially low/misleading fire behaviour. Show N/A instead.
  const fbpA = fwi.ffmc != null
    ? calculateFBP(fuelA, fwi.ffmc, fwi.dmc, fwi.dc, weather.wind, 0, curing, ps)
    : null;
  const fbpB = fwi.ffmc != null
    ? calculateFBP(fuelB, fwi.ffmc, fwi.dmc, fwi.dc, weather.wind, 0, curing, ps)
    : null;
  populateSection('-a', fbpA);
  populateSection('-b', fbpB);
  // Provisional summary row from exactly what the cards now show; buildD1Card
  // replaces it with the 16:00 peak-burn values when it repaints the cards.
  _renderPeakSummary({ ffmc: fwi.ffmc, dmc: fwi.dmc, dc: fwi.dc, wind: weather.wind,
    fbpA, fbpB, fuelA, fuelB, peak: false });
}

// ─── Station summary row (station_detail) ────────────────────────────────────
// Danger + FWI + worst HFI are computed from the SAME inputs the Today
// peak-burn cards render (FFMC/DMC/DC + the wind the cards' FBP used), so the
// row can never disagree with the cards. FWI here = standard ISI/BUI/FWI from
// those inputs — display only, the FWI/FBP science is untouched.
let _summaryProv = null;
function _renderPeakSummary(o) {
  const row = document.getElementById('fwi-summary-row');
  if (!row) return;
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  if (o.ffmc == null) {
    set('fwi-summary-danger', `<span class="pyra-chip" style="${PROV_LEVEL_STYLE.neutral}">PENDING</span>`);
    set('fwi-summary-fwi', '<span class="text-slate-300">FWI —</span>');
    set('fwi-summary-hfi', '');
    return;
  }
  const isi = _isi(o.ffmc, o.wind ?? 0);
  const fwi = _fwi(isi, _bui(o.dmc, o.dc));
  const danger = dangerRatingProv(fwi);
  const t = _dangerTok(danger);
  const when = o.peak ? `16:00 ${PROVINCE.tzLabel} peak burn` : 'current weather (peak-burn forecast loading…)';
  // Agency rating (BCWS DANGER_RATING) when today's chain came from the agency —
  // shown beside the FWI-derived class, never replacing the 16:00 headline.
  const official = _lastFWI?.dangerSource === 'official' ? _lastFWI.danger : null;
  const ot = official ? _dangerTok(official) : null;
  set('fwi-summary-danger',
    `<span class="pyra-chip pyra-chip-lg font-black uppercase tracking-wide" style="background:${t.solid};color:${t.on}" title="FWI-based danger class at ${_esc(when)} (${PROVINCE.dangerScaleNote || 'FWI map classes'}) — not an official agency rating">${danger}</span>` +
    (official ? ` <span class="pyra-chip font-bold" style="background:${ot.solid};color:${ot.on}" title="Official BC Wildfire Service danger rating for today's noon observation (BCWS Datamart)">BCWS official: ${official}</span>` : ''));
  set('fwi-summary-fwi',
    `<span class="font-headline text-xl font-black text-white">FWI ${fwi.toFixed(1)}</span> <span class="text-[11px] text-slate-300">${when}</span>`);
  const cands = [[o.fbpA, o.fuelA], [o.fbpB, o.fuelB]].filter(([f]) => f);
  if (cands.length) {
    const [wf, wFuel] = cands.reduce((a, b) => (b[0].hfi > a[0].hfi ? b : a));
    const cl = hfiClassInfo(wf.hfi);
    set('fwi-summary-hfi',
      `<span class="pyra-chip pyra-chip-lg font-bold" style="${hfiChipStyle(cl.num)}" title="Worst of the two selected fuels: ${_esc(FUEL_TYPES[wFuel]?.name || wFuel)} · ${Math.round(wf.hfi).toLocaleString()} kW/m">HFI ${cl.num} · ${cl.label}</span>` +
      `<span class="text-[11px] text-slate-300">${_esc(FUEL_TYPES[wFuel]?.name || wFuel)}</span>`);
  } else {
    set('fwi-summary-hfi', '');
  }
  const live = document.getElementById('fwi-summary-live');
  if (live) live.textContent = `${danger}, FWI ${fwi.toFixed(1)} at ${when}`;
}

/** Data-age + source chips (summary row and Today card); re-run every minute. */
function _renderSummaryProv() {
  const p = _summaryProv;
  if (!p) return;
  const fresh = _provenance(p.w, p.co);
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set('fwi-summary-age', provenanceChipHTML(fresh));
  set('fwi-summary-src',
    `<span class="pyra-chip" title="${_esc(fresh.detail)}" style="${PROV_LEVEL_STYLE.neutral}">${fresh.network}</span>`);
  set('fwi-today-prov', `${provenanceChipHTML(fresh, true)} <span class="pyra-chip" style="${PROV_LEVEL_STYLE.neutral}" title="${_esc(fresh.detail)}">${fresh.network}</span>`);
}
let _summaryTimer = null;


/** Re-run FBP with cached last weather/FWI when fuel picker changes. */
let _lastWeather = null;
let _lastFWI     = null;
let _lastVWCalc  = null; // Van Wagner cold-start result for compare panel
let _selectNearestStation = null; // set by buildStationPicker; used by pin-drop map

function refreshFBP() {
  if (_lastWeather && _lastFWI) wireFBP(_lastWeather, _lastFWI);
  if (document.getElementById('fwi-d1-preview-section')) buildD1Card();
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
 * Map bulk-path distance cap (km). The province-wide CWFIS query has no bbox
 * around each station, so without a cap a remote station could take a chain
 * from 300+ km away. 150 km ≈ the per-station query's ±2° box at these
 * latitudes; beyond it the map falls back to the per-station tier chain.
 */
const MAP_CWFIS_MAX_KM = 150;
/** Default map picker: nearest CWFIS station from the bulk features, within the cap. */
function _mapPickNearest(features, lat, lng) {
  const w = _selectCWFIS(features, lat, lng);
  return w && (w.distKm ?? 0) <= MAP_CWFIS_MAX_KM ? w : null;
}

/**
 * One province-wide CWFIS query — every station in a single request, instead
 * of one bbox query per station. Returns the raw feature array (cached for the
 * page session) so buildStationMap can resolve all stations locally.
 * Bounding box from PROVINCE.cwfisBBox [latMin, latMax, lonMin, lonMax].
 */
let _allCWFISFeatures = null;
async function fetchAllCWFIS([latMin, latMax, lonMin, lonMax] = PROVINCE.cwfisBBox) {
  if (_allCWFISFeatures) return _allCWFISFeatures;
  const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows` +
    `?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeName=public:firewx_stns_current&outputFormat=application/json&count=2000` +
    `&CQL_FILTER=lat+BETWEEN+${latMin}+AND+${latMax}+AND+lon+BETWEEN+${lonMin}+AND+${lonMax}`;
  const data = await fetchWithTimeout(url, { cache: 'no-cache' }, 20000).then(r => r.json());
  _allCWFISFeatures = data.features ?? [];
  return _allCWFISFeatures;
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
    elev: nearest.elev != null && isFinite(+nearest.elev) ? +nearest.elev : null, // station elevation (m) — FMC Eqs. 3-4
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
  // Daily FWI inputs are the noon-LST observation (CFFDRS). Once today's noon has
  // passed, request a ±1 h window around it and take, from the nearest station,
  // the record closest to noon (its pcpn_amt_pst24hrs is then the noon-to-noon
  // rain). Before noon, or if the noon record isn't published yet, fall back to
  // a 3-hour window ending now (latest obs). Without a datetime filter the
  // endpoint returns stale archived records.
  const now    = new Date();
  const noonMs = Date.parse(_lstDateStr(now.getTime()) + 'T00:00:00Z') + PROVINCE.noonUTC * 3600000;
  const fmt    = d => d.toISOString().replace(/\.\d+Z$/, 'Z');
  const windows = [];
  if (now.getTime() >= noonMs) windows.push([new Date(noonMs - 3600000), new Date(Math.min(now.getTime(), noonMs + 3600000))]);
  windows.push([new Date(now.getTime() - 3 * 3600000), now]);
  // Request only the properties we read — full SWOB records carry hundreds of
  // fields each (~411 KB for 50); the subset is ~10× smaller. Province flag
  // (PROVINCE.trimFeedProperties). 8 s timeout: SWOB can hang for 13 s+, which
  // previously stalled the whole tier chain.
  const props = ['air_temp','avg_air_temp_pst1hr','rel_hum','avg_rel_hum_pst1hr',
    'avg_wnd_spd_10m_pst1hr','avg_wnd_spd_10m_pst10mts','avg_wnd_dir_10m_pst1hr',
    'avg_wnd_dir_10m_pst10mts','pcpn_amt_pst1hr','pcpn_amt_pst6hrs','pcpn_amt_pst24hrs',
    'date_tm-value','obs_date_tm','stn_nam-value'].join(',');
  const obsMs = f => Date.parse(f.properties?.['date_tm-value'] || f.properties?.['obs_date_tm']);
  let d = null;
  for (const [from, to] of windows) {
    const url = `https://api.weather.gc.ca/collections/swob-realtime/items` +
      `?bbox=${(lng-bbox).toFixed(2)},${(lat-bbox).toFixed(2)},${(lng+bbox).toFixed(2)},${(lat+bbox).toFixed(2)}` +
      `&datetime=${fmt(from)}/${fmt(to)}&limit=200${PROVINCE.trimFeedProperties ? `&properties=${props}` : ''}&f=json`;
    let res;
    try { res = await fetchWithTimeout(url, {}, 8000); } catch (_) { continue; }
    const j = await res.json().catch(() => null);
    if (j?.features?.length) { d = j; break; }
  }
  if (!d) return null;

  // Nearest station by geometry, then that station's record closest to noon LST
  // (all records of one station share its coordinates).
  let nearest = null, minDist = Infinity;
  for (const f of d.features) {
    if (!f.geometry?.coordinates) continue;
    const [fLng, fLat] = f.geometry.coordinates;
    const dist = _haversineKm(lat, lng, fLat, fLng);
    if (dist < minDist - 1e-9) { minDist = dist; nearest = f; }
    else if (Math.abs(dist - minDist) <= 1e-9 && nearest &&
             Math.abs(obsMs(f) - noonMs) < Math.abs(obsMs(nearest) - noonMs)) nearest = f;
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
try { _idwMode = localStorage.getItem('fwi_idw_mode') === '1'; } catch (_) {}

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
      officialDanger: chain.officialDanger ?? null,
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
    // An agency's own published rating (BCWS DANGER_RATING) takes precedence over
    // the FWI-derived class; dangerSource records which one is shown.
    const official = w.officialDanger ?? null;
    return { ffmc: w.ffmc, dmc: w.dmc, dc: w.dc, isi, bui, fwi,
             danger: official ?? dangerRatingProv(fwi),
             dangerSource: official ? 'official' : 'fwi', weather: w };
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
  return { ffmc, dmc, dc, isi, bui, fwi, danger: dangerRatingProv(fwi), dangerSource: 'fwi', weather: w };
}

/** Fill all [data-fwi="key"] elements with the computed values. */
function wireDOM(r, lat, lng) {
  const set = (key, val) =>
    document.querySelectorAll(`[data-fwi="${key}"]`).forEach(el => el.textContent = val);

  const pct = (key, val, max) =>
    document.querySelectorAll(`[data-fwi-bar="${key}"]`).forEach(el => {
      el.style.width = Math.min(100, (val / max) * 100).toFixed(1) + '%';
    });

  // Weather
  set('temp',  fmt(r.weather.temp) + '°C');
  set('rh',    fmt(r.weather.rh, 0) + '%');
  set('wind',  fmt(r.weather.wind, 0) + ' km/h');
  set('wdir',  r.weather.wdir != null ? `${compassDir(r.weather.wdir)} (${Math.round(r.weather.wdir)}°)` : '—');
  set('rain',  fmt(r.weather.rain) + ' mm');

  // FWI components — null means season-start / no data yet
  if (r.ffmc != null) {
    set('ffmc', r.ffmc.toFixed(1));
    set('dmc',  r.dmc.toFixed(1));
    set('dc',   r.dc.toFixed(1));
    set('isi',  r.isi.toFixed(1));
    set('bui',  r.bui.toFixed(1));
    set('fwi',  r.fwi.toFixed(1));
    pct('ffmc', r.ffmc, 101);
    pct('dmc',  r.dmc,  200);
    pct('dc',   r.dc,   800);
    pct('isi',  r.isi,  25);
    pct('bui',  r.bui,  200);
    pct('fwi',  r.fwi,  50);
  } else {
    ['ffmc','dmc','dc','isi','bui','fwi'].forEach(k => set(k, '—'));
  }

  // Danger labels
  const dangerText = r.danger || 'Pending';
  set('danger',       dangerText.toUpperCase() + (r.danger ? ' RISK' : ''));
  set('danger-label', r.danger ? r.danger + ' Risk Level' : 'Season not started');

  // Hero card colour driven by individual fuel section gradients; outer card stays neutral

  // Rating badges — per-component thresholds
  document.querySelectorAll('[data-fwi-rating]').forEach(el => {
    const key = el.dataset.fwiRating;
    const val = { ffmc: r.ffmc, dmc: r.dmc, dc: r.dc, isi: r.isi, bui: r.bui, fwi: r.fwi }[key];
    const rating = val != null ? componentRating(key, val) : null;
    el.textContent = rating ? rating.toUpperCase() : '—';
    // Same danger token colours as every other rating on the site (was pink/purple)
    if (el.style) el.style.cssText = rating ? dangerChipStyle(rating) : '';
  });

  // Timestamp — show the actual CWFIS/BCWS observation date when available;
  // avoids "Live" labelling yesterday's noon data as current before noon today.
  if (r.weather.repDate) {
    // CWFIS rep_date is a date stamp (T12:00Z), not an obs time — compare the
    // calendar date against today's LST date, not the viewer's local clock.
    const obsDate = String(r.weather.repDate).slice(0, 10);
    const isToday = obsDate === _lstDateStr();
    const label = new Date(obsDate + 'T12:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    set('updated', isToday ? 'Noon LST · today' : `Noon LST · ${label} (not today)`);
  } else if (r.weather.source?.includes('peak burn forecast')) {
    set('updated', `Peak Burn Forecast · 16:00 ${PROVINCE.tzLabel}`);
  } else {
    set('updated', `Live · ${new Date().toLocaleTimeString()}`);
  }
  const _distStr = r.weather.distKm != null ? ` · ${r.weather.distKm} km` : '';
  // Only CWFIS-sourced weather gets the CWFIS prefix — SWOB results also carry
  // a stationName, and were mislabelled "CWFIS · <airport>".
  const _src = r.weather.source || '';
  const srcLabel = (r.weather.stationName && _src.startsWith('CWFIS'))
    ? `CWFIS · ${r.weather.stationName}${_distStr}`
    : (_src ? `${_src}${r.weather.stationName && !/\bkm\b/.test(_src) ? _distStr : ''}` : 'Open-Meteo NWP');
  set('source-station', srcLabel);

  // Plain-language provenance chips (summary row + Today card) and the role /
  // valid-time label of the daily FWI in the components strip.
  _summaryProv = { w: r.weather, co: r._cachedFWI || null };
  _renderSummaryProv();
  if (!_summaryTimer && document.getElementById('fwi-summary-row') && typeof setInterval === 'function') {
    _summaryTimer = setInterval(_renderSummaryProv, 60000);
  }
  const roleEl = document.getElementById('fwi-daily-role');
  if (roleEl) {
    const fmtD = d => new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const src = r.weather.source || '';
    roleEl.textContent = r.ffmc == null ? 'CFFDRS daily FWI · pending (no chain yet)'
      : src.includes('peak burn forecast') ? `CFFDRS daily FWI · stepped with 16:00 ${PROVINCE.tzLabel} model weather (pre-noon) · ${fmtD(_lstDateStr())}`
      : r.weather.repDate ? `CFFDRS daily FWI · noon LST ${fmtD(r.weather.repDate)}`
      : r._cachedFWI && !r._cachedFWI.final ? `CFFDRS daily FWI · noon LST ${fmtD(_lstDateStr())} · carried from ${fmtD(r._cachedFWI.obsDate)} chain`
      : `CFFDRS daily FWI · noon LST ${fmtD(_lstDateStr())}`;
  }

  // IDW toggle button state sync
  const idwBtn = document.getElementById('fwi-idw-toggle');
  if (idwBtn) {
    idwBtn.classList.toggle('bg-primary/20', _idwMode);
    idwBtn.classList.toggle('text-primary', _idwMode);
    idwBtn.classList.toggle('border-primary/40', _idwMode);
    idwBtn.classList.toggle('text-slate-400', !_idwMode);
    idwBtn.classList.toggle('border-slate-600', !_idwMode);
    const lbl = idwBtn.querySelector('#fwi-idw-label');
    if (lbl) lbl.textContent = _idwMode
      ? `IDW · ${r.weather.idwCount ?? '?'} stn`
      : 'Single Stn';
  }

  // DC source indicator
  const dcBadge = document.getElementById('fwi-dc-source');
  if (dcBadge) {
    if (r.weather.idwMode) {
      const n = r.weather.idwCount ?? '?';
      const avg = r.weather.idwAvgDist != null ? ` · avg ${r.weather.idwAvgDist} km` : '';
      dcBadge.textContent = `IDW blend · ${n} stations${avg}`;
      dcBadge.className = 'mt-2 inline-block text-[9px] font-label font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary';
    } else if (r.weather.fwiFromCWFIS) {
      const stn = r.weather.stationName ? ` · ${r.weather.stationName}` : '';
      const dst = r.weather.distKm != null ? ` · ${r.weather.distKm} km` : '';
      // BCWS chains also set fwiFromCWFIS (= "agency chain") — label by actual source
      const chainSrc = r.weather.chainSource || r.weather.source || '';
      dcBadge.textContent = (chainSrc.startsWith('BCWS') ? 'BCWS' : 'CWFIS') + stn + dst;
      dcBadge.className = 'mt-2 inline-block text-[9px] font-label font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary';
    } else if (r._cachedFWI) {
      const co = r._cachedFWI;
      const stn = co.src === 'holding' ? (co.stationName || '') : _stationName;
      const dstStr = co.distKm != null ? ` · ${co.distKm} km` : '';
      const dateStr = co.obsDate
        ? new Date(co.obsDate + 'T12:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })
        : '';
      dcBadge.textContent = co.final
        ? `CWFIS (holding)${stn ? ' · ' + stn : ''}${dstStr} · ${dateStr}`
        : `Calc from CWFIS ${dateStr} chain${stn ? ' · ' + stn : ''}${dstStr}`;
      dcBadge.className = 'mt-2 inline-block text-[9px] font-label font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400';
    } else {
      dcBadge.textContent = 'Season start pending · CWFIS inactive';
      dcBadge.className = 'mt-2 inline-block text-[9px] font-label font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-400';
    }
  }

  // DC divergence warning — shown when nearby stations (≤75 km) differ by ≥75 DC units
  const divEl = document.getElementById('fwi-dc-divergence');
  const div = r.weather?.dcDivergence;
  if (divEl) {
    if (div) {
      divEl.textContent = `⚠ DC varies across nearby stations (${div.min}–${div.max}). Local precip event likely — consider selecting a different station.`;
      divEl.className = 'mt-2 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2 leading-snug';
    } else {
      divEl.textContent = '';
      divEl.className = 'hidden';
    }
  }

  // Cache for FBP re-runs on fuel picker change
  _lastWeather = r.weather;
  _lastFWI     = r;

  // Always compute Van Wagner cold-start for compare panel (even when CWFIS is primary)
  const _sel = document.getElementById('fwi-station-picker');
  const _startupDC = getStartupDC(
    _sel ? (_sel.options[_sel.selectedIndex]?.textContent?.trim() || '') : ''
  );
  _lastVWCalc = calculateFWI({ ...r.weather, fwiFromCWFIS: false }, { ffmc: STARTUP.ffmc, dmc: STARTUP.dmc, dc: _startupDC });
  const cmpSet = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  cmpSet('fwi-cmp-ffmc', _lastVWCalc.ffmc.toFixed(1));
  cmpSet('fwi-cmp-dmc',  _lastVWCalc.dmc.toFixed(1));
  cmpSet('fwi-cmp-dc',   _lastVWCalc.dc.toFixed(1));
  cmpSet('fwi-cmp-isi',  _lastVWCalc.isi.toFixed(1));
  cmpSet('fwi-cmp-bui',  _lastVWCalc.bui.toFixed(1));
  cmpSet('fwi-cmp-fwi',  _lastVWCalc.fwi.toFixed(1));
  cmpSet('fwi-compare-note', `startup DC ${_startupDC} · ${r.weather.fwiFromCWFIS ? 'CWFIS chain is primary above' : 'same source as above'}`);

  // FBP fire behaviour (station_detail only — skip if no FWI data yet)
  if (r.ffmc != null) wireFBP(r.weather, r);
  else _renderPeakSummary({ ffmc: null });

  // D+1 tomorrow card (station_detail only — silently no-ops on other pages)
  if (document.getElementById('fwi-d1-preview-section')) buildD1Card();

  // P4: SCRIBE 48-hr validation — async, non-blocking
  const _g = _initGeneration;
  fetchSCRIBE(lat, lng).then(sc => { if (_g === _initGeneration) renderSCRIBE(sc); });
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
    _stationElev = null;
    const [weather, elev] = await Promise.all([fetchWeatherPrimary(lat, lng), _elevationFor(lat, lng)]);
    if (gen !== _initGeneration) return; // a newer initFWI started; discard stale result
    _stationElev = elev;

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
  const [weather, elev] = await Promise.all([fetchWeatherPrimary(station.lat, station.lng), _elevationFor(station.lat, station.lng)]);
  _stationElev = elev;
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

  const [days, elev] = await Promise.all([fetchForecast(station.lat, station.lng), _elevationFor(station.lat, station.lng)]);
  _stationElev = elev;

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
  return { station, weather, fwi, forecastDay: day, chainDate: asOf, chainStation: p?.name ?? null };
}

/** Normalise raw WMS fuel type string to a FUEL_TYPES key, or null.
 *  Handles "O-1a Matted Grass" → "O1a", "C-2" → "C2", etc. */
function _normalizeFuelCode(raw) {
  if (!raw) return null;
  const token = raw.trim().split(/\s/)[0]; // take code only, strip description
  const norm = t => t.toUpperCase().replace(/-/g, '').replace(/\/\d+$/, '');
  const s = norm(token);
  const match = Object.keys(FUEL_TYPES).find(k => k.toUpperCase() === s);
  if (match) return match;
  // Handle WMS slash-notation (D-1/D-2 → try the part before the first /).
  const slash = token.indexOf('/');
  if (slash > 0) {
    const s2 = norm(token.slice(0, slash));
    return Object.keys(FUEL_TYPES).find(k => k.toUpperCase() === s2) || null;
  }
  return null;
}

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

/**
 * Replace the station-detail OSM iframe with an interactive Leaflet map.
 * User clicks anywhere → queries WMS fuel type → sets both fuel pickers
 * → switches to nearest CWFIS weather station.
 * Requires Leaflet 1.9.x to be loaded in the page <head>.
 */
function _initPinDropMap() {
  const container = document.getElementById('fwi-map-frame');
  if (!container || typeof L === 'undefined' || container._leaflet_id) return;

  const map = L.map(container, { zoomControl: true, attributionControl: false });
  container._leafletMap = map;

  // Esri World Imagery — satellite, no API key, no CSP issues
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18,
  }).addTo(map);
  // Esri reference overlay — place names, roads, boundaries on top of satellite
  L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18, opacity: 0.85,
  }).addTo(map);

  // Station marker dots — store refs for selection highlighting
  const _pinMarkers = {};
  getStationList().forEach(s => {
    const key = `${s.lat},${s.lng}`;
    _pinMarkers[key] = L.circleMarker([s.lat, s.lng], {
      radius: 4, fillColor: '#7bd0ff', color: '#fff', weight: 1, fillOpacity: 0.8,
    }).addTo(map).bindTooltip(s.name, { permanent: false, direction: 'top' });
  });
  container._pinMarkers = _pinMarkers;

  // Initial view — current station picker value
  const sel = document.getElementById('fwi-station-picker');
  if (sel?.value) {
    const [lat, lng] = sel.value.split(',').map(Number);
    map.setView([lat, lng], 8);
    if (_pinMarkers[sel.value]) {
      _pinMarkers[sel.value].setStyle({ radius: 8, fillColor: '#e05030', color: '#fff', weight: 2, fillOpacity: 1 });
    }
  } else {
    map.setView(PROVINCE.pinMapCenter, 6);
  }

  // Pre-load Edmonton raster in background (PROVINCE.edmontonFuelRaster — AB only;
  // BC has no Edmonton LiDAR data)
  if (PROVINCE.edmontonFuelRaster) _loadEdmontonFuelRaster().catch(() => {});

  let pinMarker = null;
  const statusEl  = document.getElementById('fwi-map-status');
  const coordsEl  = document.getElementById('fwi-map-coords');

  map.on('click', async e => {
    const { lat, lng } = e.latlng;

    // Drop / move pin
    if (pinMarker) pinMarker.setLatLng([lat, lng]);
    else           pinMarker = L.marker([lat, lng]).addTo(map);

    // Update coords overlay
    if (coordsEl) coordsEl.textContent =
      `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ` +
      `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;

    if (statusEl) statusEl.textContent = 'Querying fuel type…';

    // Edmonton LiDAR raster first; fall back to NRCan WMS
    let fuelA = null;
    const inEdm = lat >= _EDM_ROUGH.south && lat <= _EDM_ROUGH.north &&
                  lng >= _EDM_ROUGH.west  && lng <= _EDM_ROUGH.east;
    if (inEdm) {
      try { fuelA = await _queryEdmontonFuelType(lat, lng); } catch(e) {}
    }
    if (!fuelA) {
      try { fuelA = await _queryWMSFuelType(lat, lng); } catch (err) {
        console.warn('[PinDrop] WMS query failed:', err);
      }
    }

    if (fuelA) {
      fuelA = _seasonalFuel(fuelA, lat);           // raster D2/M2 are structural classes
      const fuelB = _seasonalPair(fuelA, lat);
      ['fwi-fuel-picker', 'fwi-fuel-picker-mobile'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = fuelA;
      });
      ['fwi-fuel-picker-2', 'fwi-fuel-picker-mobile-2'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = fuelB;
      });
      localStorage.setItem(PROVINCE.storageKeys.fuelA, fuelA);
      localStorage.setItem(PROVINCE.storageKeys.fuelB, fuelB);
      if (statusEl) statusEl.textContent =
        `${FUEL_TYPES[fuelA]?.name || fuelA}  ·  ${FUEL_TYPES[fuelB]?.name || fuelB}`;

      // Sync conditional rows
      if (typeof _syncCuringVisibility === 'function') _syncCuringVisibility();
      if (typeof _syncPSVisibility     === 'function') _syncPSVisibility();
      refreshFBP();
    } else {
      if (statusEl) statusEl.textContent = 'Fuel type unavailable — using nearest station default';
    }

    // Switch weather to nearest CWFIS station
    if (_selectNearestStation) _selectNearestStation(lat, lng);
  });
}

/** Placeholder option before geolocation: first PROVINCE.pickerDefaultNames match, else the first option. */
function _defaultPickerOption(sel) {
  const opts = Array.from(sel.options);
  return opts.find(o => PROVINCE.pickerDefaultNames.includes(o.textContent)) || sel.options[0];
}

/** Populate a <select id="fwi-station-picker"> and wire change events. */
function buildStationPicker() {
  const sel = document.getElementById('fwi-station-picker');
  if (!sel) return;

  sel.innerHTML = '';
  getStationList().forEach(s => {
    const opt = document.createElement('option');
    opt.value = `${s.lat},${s.lng}`;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });

  function loadStation(save = true) {
    const [lat, lng] = sel.value.split(',').map(Number);
    const name = sel.options[sel.selectedIndex].textContent;
    if (save) {
      localStorage.setItem(PROVINCE.storageKeys.station, sel.value);
      history.replaceState(null, '', `${location.pathname}?stn=${encodeURIComponent(name)}`);
    }
    const frame = document.getElementById('fwi-map-frame');
    if (frame?._leafletMap) {
      frame._leafletMap.setView([lat, lng], 8);
      if (frame._pinMarkers) {
        const selKey = sel.value;
        Object.entries(frame._pinMarkers).forEach(([k, m]) => {
          m.setStyle(k === selKey
            ? { radius: 8, fillColor: '#e05030', color: '#fff', weight: 2, fillOpacity: 1 }
            : { radius: 4, fillColor: '#7bd0ff', color: '#fff', weight: 1, fillOpacity: 0.8 }
          );
        });
      }
    }
    const coords = document.getElementById('fwi-map-coords');
    if (coords) coords.textContent = `${Math.abs(lat).toFixed(4)}° ${lat>=0?'N':'S'}, ${Math.abs(lng).toFixed(4)}° ${lng>=0?'E':'W'}`;
    const stLabel = document.getElementById('fwi-map-station');
    if (stLabel) stLabel.textContent = name;
    // Auto-set fuel type from station lookup; sync both pickers.
    // PROVINCE.autoFuelOnSelect — AB only; BC respects the user's selection.
    if (PROVINCE.autoFuelOnSelect) {
      const derivedFuel = _seasonalFuel(PROVINCE.stationFuel(name, lat), lat);
      ['fwi-fuel-picker', 'fwi-fuel-picker-mobile'].forEach(id => {
        const fp = document.getElementById(id);
        if (fp) fp.value = derivedFuel;
      });
      // Seasonal adjustment can make fuel B equal fuel A (e.g. both D1 after leaf
      // drop) — give B the ecological complement instead of a duplicate panel.
      const fpB = document.getElementById('fwi-fuel-picker-2');
      if (fpB && fpB.value === derivedFuel) {
        const alt = _seasonalPair(derivedFuel, lat);
        ['fwi-fuel-picker-2', 'fwi-fuel-picker-mobile-2'].forEach(id => {
          const el = document.getElementById(id); if (el) el.value = alt;
        });
      }
    }
    initFWI(lat, lng, name);
    buildHourlyChart(lat, lng, name);
  }

  function selectByValue(val) {
    if (val && Array.from(sel.options).find(o => o.value === val)) {
      sel.value = val;
      return true;
    }
    return false;
  }

  function selectNearest(userLat, userLng) {
    let nearest = null, minDist = Infinity;
    getStationList().forEach(s => {
      const d = _haversineKm(userLat, userLng, s.lat, s.lng);
      if (d < minDist) { minDist = d; nearest = s; }
    });
    if (nearest) {
      const val = `${nearest.lat},${nearest.lng}`;
      sel.value = val;
      localStorage.setItem(PROVINCE.storageKeys.station, val);
      loadStation(false);
    }
  }
  _selectNearestStation = selectNearest; // expose for pin-drop map

  sel.addEventListener('change', () => loadStation(true));

  // URL deep link: ?stn=NAME pre-selects a station for sharing / bookmarking.
  // Case-insensitive; strips non-alphanumeric so "Fort+McMurray" == "fortmcmurray".
  // Priority: exact → prefix → substring. Does NOT overwrite localStorage.
  const _urlStn = new URLSearchParams(location.search).get('stn');
  if (_urlStn) {
    const q = _urlStn.toLowerCase().replace(/[^a-z0-9]/g, '');
    const stationList = getStationList();
    const norm = s => s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const stnMatch =
      stationList.find(s => norm(s) === q) ||
      stationList.find(s => norm(s).startsWith(q)) ||
      stationList.find(s => norm(s).includes(q));
    if (stnMatch && selectByValue(`${stnMatch.lat},${stnMatch.lng}`)) {
      loadStation(false); // don't overwrite saved station
      return;
    }
  }

  const saved = localStorage.getItem(PROVINCE.storageKeys.station);
  if (selectByValue(saved)) {
    // Returning user — load saved station immediately, no geo prompt
    loadStation(false);
  } else if (navigator.geolocation) {
    // First visit — show the province default station as placeholder, then auto-detect
    const dflt = _defaultPickerOption(sel);
    if (dflt) sel.value = dflt.value;
    loadStation(false);
    navigator.geolocation.getCurrentPosition(
      pos => selectNearest(pos.coords.latitude, pos.coords.longitude),
      ()  => loadStation(true),  // denied — save current default
      { timeout: 8000, maximumAge: 300000 }
    );
  } else {
    const dflt = _defaultPickerOption(sel);
    if (dflt) sel.value = dflt.value;
    loadStation(true);
  }

  _initPinDropMap();
}

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

/**
 * Plain-language provenance for a weather / FWI-chain result — shared by the
 * station_detail summary row and the regional table + map popups.
 *   kind     OBSERVED · MODEL FORECAST · CARRIED FROM YESTERDAY
 *   network  CWFIS · BCWS · MSC SWOB · Open-Meteo (station network or model)
 *   obsMs    observation time (CWFIS/BCWS rep_date = noon LST of that date; SWOB obs time)
 *   level    daily CWFIS/BCWS chain vs the newest chain expected by now (today's
 *            after 14:00 LST, else yesterday's): 'ok' current · 'amber' 1 day behind · 'red' more;
 *            hourly SWOB: 'ok' ≤ 3 h · 'amber' > 3 h · 'red' > 24 h; 'neutral' = model
 *   detail   technical detail for the chip title (source, station, distance, chain date)
 * `co` = the dated carry-over that was used (from _carryOverFor), if any.
 * Display only — it never changes which tier or carry-over the engine picked.
 */
function _provenance(w, co = null, nowMs = Date.now()) {
  w = w || {};
  const src = w.source || '';
  const chainSrc = w.chainSource || src;
  const network = chainSrc.startsWith('BCWS') ? 'BCWS'
    : (w.fwiFromCWFIS || w.idwMode) ? 'CWFIS'
    : src.startsWith('MSC') ? 'MSC SWOB'
    : 'Open-Meteo';
  const noonMs = d => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') + PROVINCE.noonUTC * 3600000;
  let kind, obsMs = null;
  if (co) {
    kind = co.final ? 'OBSERVED' : 'CARRIED FROM YESTERDAY';
    obsMs = co.obsDate ? noonMs(co.obsDate) : null;
  } else if (w.fwiFromCWFIS && w.repDate) {
    obsMs = noonMs(w.repDate);
    kind = String(w.repDate).slice(0, 10) < _lstDateStr(nowMs) ? 'CARRIED FROM YESTERDAY' : 'OBSERVED';
  } else if (network === 'MSC SWOB') {
    kind = 'OBSERVED';
    obsMs = w.obsTime ? Date.parse(w.obsTime) : null;
  } else if (network === 'Open-Meteo') {
    kind = 'MODEL FORECAST';
  } else {
    kind = 'OBSERVED';
  }
  const ageH = obsMs != null && isFinite(obsMs) ? Math.max(0, (nowMs - obsMs) / 3600000) : null;
  // CWFIS/BCWS chains are one noon-LST observation per day, so judge them by
  // obs date (today ok · yesterday amber · older red) — an hours threshold
  // turned every normal noon obs amber by mid-afternoon. Hourly sensors (SWOB)
  // keep the 3 h / 24 h thresholds.
  const dailyDate = co?.obsDate || ((w.fwiFromCWFIS && w.repDate) ? String(w.repDate).slice(0, 10) : null);
  let level;
  if (ageH == null) level = 'neutral';
  else if (dailyDate) {
    // Today's noon chain is published ~2 h after noon LST; until then yesterday's
    // is the newest that can exist and is not "late".
    const lstHour = new Date(nowMs - PROVINCE.lstOffset * 3600000).getUTCHours();
    const expected = lstHour >= 14 ? _lstDateStr(nowMs) : _lstDateStr(nowMs - 86400000);
    const behind = Math.round((Date.parse(expected) - Date.parse(dailyDate)) / 86400000);
    level = behind <= 0 ? 'ok' : behind === 1 ? 'amber' : 'red';
  } else level = ageH > 24 ? 'red' : ageH > 3 ? 'amber' : 'ok';
  const age = ageH == null ? '' : ageH < 1 ? '<1 h old' : ageH < 48 ? `${Math.round(ageH)} h old` : `${Math.round(ageH / 24)} d old`;
  const parts = [];
  if (src) parts.push(src);
  if (w.stationName && !src.includes(w.stationName)) parts.push(w.stationName);
  if (w.distKm != null && !/\bkm\b/.test(src)) parts.push(`${w.distKm} km away`);
  if (w.repDate) parts.push(`chain date ${String(w.repDate).slice(0, 10)} (noon LST)`);
  if (co) parts.push(`carry-over from the ${co.src === 'holding' ? 'holding cache' : 'daily CWFIS mirror'}, ${co.obsDate || '?'}${co.stationName ? ' · ' + co.stationName : ''}${co.final ? '' : ' — stepped one day with today’s weather'}`);
  if (w.obsTime && !w.repDate) parts.push(`obs ${String(w.obsTime).slice(0, 16).replace('T', ' ')} UTC`);
  if (w.idwMode) parts.push(`IDW blend of ${w.idwCount ?? '?'} stations`);
  return { kind, network, obsMs, ageH, age, level, detail: parts.join(' · ') };
}

const PROV_LEVEL_STYLE = {
  ok:      'background:#14532d66;color:#bbf7d0;border:1px solid #22c55e88',
  amber:   'background:#78350f66;color:#fde68a;border:1px solid #f59e0b99',
  red:     'background:#7f1d1d80;color:#fecaca;border:1px solid #ef4444aa',
  neutral: 'background:#1e293b;color:#cbd5e1;border:1px solid #475569',
};
/** Plain-language provenance chip HTML. `short` uses the compact table face. */
function provenanceChipHTML(p, short = false) {
  const face = !short ? (p.kind === 'OBSERVED' ? 'OBSERVED (station sensor)' : p.kind)
    : p.kind === 'CARRIED FROM YESTERDAY' ? 'CARRIED' : p.kind === 'MODEL FORECAST' ? 'MODEL' : p.kind;
  const title = `${p.kind}${p.age ? ' — ' + p.age : ''} · ${p.network}${p.detail ? ' · ' + p.detail : ''}`;
  return `<span class="pyra-chip" title="${_esc(title)}" style="${PROV_LEVEL_STYLE[p.level]}">${face}${p.age ? ' · ' + p.age : ''}</span>`;
}

/** Grey "No data" state for table rows still loading (slow) or never loaded (final). */
function _markUnloadedRows(final = false) {
  const tbody = document.getElementById('fwi-station-tbody');
  if (!tbody) return;
  tbody.querySelectorAll('tr[data-state="loading"]').forEach(tr => {
    const cell = tr.querySelector('td[data-cell="pending"]');
    if (!cell) return;
    cell.innerHTML = `<span class="pyra-chip" style="${PROV_LEVEL_STYLE.neutral}">No data</span>` +
      `<span class="ml-2 text-[11px] text-slate-400">${final ? 'the station feed returned nothing usable' : 'no response yet — still trying'}</span>`;
    if (final) tr.dataset.state = 'nodata';
  });
}

/** Update a single skeleton row in fwi-station-tbody with live data. */
function _updateStationTableRow(entry) {
  const id = 'srow-' + entry.name.replace(/\s+/g, '-');
  const tr = document.getElementById(id);
  if (!tr) return;
  const r = entry.result;
  const fbp = entry.fbp;
  const prov = entry.prov || _provenance(r.weather);
  const hfiLabel = fbp ? _hfiClass(fbp.hfi) : '—';
  const hfiN     = _hfiNumOf(hfiLabel);
  const hfiNum   = fbp?.hfi != null ? Math.round(fbp.hfi).toLocaleString() : '—';
  if (tr.dataset) tr.dataset.state = 'loaded';
  tr.innerHTML =
    `<td class="py-2 pl-3 pr-2 font-semibold text-xs"><a href="../station_detail/code.html" onclick="localStorage.setItem('${PROVINCE.storageKeys.station}','${entry.navLat ?? entry.lat},${entry.navLng ?? entry.lng}')" class="text-[#7bd0ff] hover:underline">${entry.name}</a></td>` +
    `<td class="py-2 pr-2 text-slate-400 text-[11px]">${stationSector(entry.navLat ?? entry.lat, entry.navLng ?? entry.lng)}</td>` +
    `<td class="py-2 pr-2 whitespace-nowrap">${provenanceChipHTML(prov, true)}<span class="block text-[11px] text-slate-400 mt-0.5">${prov.network}</span></td>` +
    `<td class="py-2 pr-2 text-right text-xs">${r.weather?.temp != null ? (+r.weather.temp).toFixed(1) : '—'}°</td>` +
    `<td class="py-2 pr-2 text-right text-xs">${r.weather?.rh != null ? Math.round(r.weather.rh) : '—'}%</td>` +
    `<td class="py-2 pr-2 text-right text-xs">${r.weather?.wind != null ? Math.round(r.weather.wind) : '—'}</td>` +
    `<td class="py-2 pr-2 text-right text-xs font-bold text-[#dae2fd]">${r.fwi != null ? r.fwi.toFixed(1) : '—'}</td>` +
    `<td class="py-2 pr-2 text-xs whitespace-nowrap"><span class="pyra-chip font-bold" style="${dangerChipStyle(r.danger)}">${r.danger}</span></td>` +
    `<td class="py-2 pr-3 text-right whitespace-nowrap">${hfiN ? `<span class="pyra-chip font-bold" style="${hfiChipStyle(hfiN)}" title="HFI class ${hfiLabel}">${hfiLabel}</span>` : '—'}<span class="block text-[11px] text-slate-400 mt-0.5">${hfiNum !== '—' ? hfiNum + ' kW/m' : ''}</span></td>`;

  // Update header stats from running cache
  const valid = _mapStationCache.filter(e => e.result?.fwi != null);
  const extCnt = valid.filter(e => e.result.danger === 'Extreme').length;
  const avgRH  = valid.length ? valid.reduce((s, e) => s + (e.result.weather?.rh ?? 0), 0) / valid.length : null;
  const el1 = document.getElementById('fwi-extreme-count');
  const el2 = document.getElementById('fwi-avg-rh');
  if (el1) el1.textContent = extCnt > 0 ? `${extCnt} Extreme` : extCnt === 0 ? '0' : '—';
  if (el2 && avgRH != null) el2.textContent = `${avgRH.toFixed(0)}%`;
  _updateAlarmStrip();
}


/** Sort station table by column key (asc/desc). */
function _sortStationTable(col, asc) {
  const tbody = document.getElementById('fwi-station-tbody');
  if (!tbody) return;
  const sectorOrder = PROVINCE.sectorOrder;
  // Union of both provinces' classes, ascending (each province uses a subset).
  const dangerOrder = ['Very Low', 'Low', 'Moderate', 'High', 'Very High', 'Extreme'];
  const rows = [...tbody.querySelectorAll('tr')];
  rows.sort((a, b) => {
    const na = a.id.replace('srow-', '').replace(/-/g, ' ');
    const nb = b.id.replace('srow-', '').replace(/-/g, ' ');
    const ea = _mapStationCache.find(e => e.name === na);
    const eb = _mapStationCache.find(e => e.name === nb);
    if (!ea && !eb) return 0;
    if (!ea) return 1;
    if (!eb) return -1;
    let va, vb;
    switch (col) {
      case 'sector':  va = sectorOrder.indexOf(stationSector(ea.lat, ea.lng)); vb = sectorOrder.indexOf(stationSector(eb.lat, eb.lng)); break;
      case 'name':    va = ea.name; vb = eb.name; break;
      case 'temp':    va = ea.result?.weather?.temp ?? -999; vb = eb.result?.weather?.temp ?? -999; break;
      case 'rh':      va = ea.result?.weather?.rh ?? -1;   vb = eb.result?.weather?.rh ?? -1; break;
      case 'wind':    va = ea.result?.weather?.wind ?? -1; vb = eb.result?.weather?.wind ?? -1; break;
      case 'fwi':     va = ea.result?.fwi ?? -1;           vb = eb.result?.fwi ?? -1; break;
      case 'danger':  va = dangerOrder.indexOf(ea.result?.danger); vb = dangerOrder.indexOf(eb.result?.danger); break;
      case 'hfi':     va = ea.fbp?.hfi ?? -1;              vb = eb.fbp?.hfi ?? -1; break;
      default:        return 0;
    }
    if (va < vb) return asc ? -1 : 1;
    if (va > vb) return asc ? 1 : -1;
    return 0;
  });
  rows.forEach(r => tbody.appendChild(r));
}

// Cache populated by buildRegionalSummary — used by exportRegionalDataset
let _regionalCache = [];
// Cache populated by buildStationMap — stores all 39 station FWI results
let _mapStationCache = [];

const FWI_ALARM_KEY = 'fwi-alarm-threshold';

function _getAlarmThreshold() {
  return parseFloat(localStorage.getItem(FWI_ALARM_KEY) ?? '15.5');
}

function _updateAlarmStrip() {
  const strip = document.getElementById('fwi-alarm-strip');
  if (!strip) return;
  const threshold = _getAlarmThreshold();
  const alarms = _mapStationCache
    .filter(e => e.result?.fwi != null && e.result.fwi >= threshold)
    .sort((a, b) => b.result.fwi - a.result.fwi);
  const thEl = document.getElementById('fwi-alarm-threshold-label');
  if (thEl) thEl.textContent = `FWI ≥ ${threshold}`;
  if (!alarms.length) {
    strip.innerHTML = `<span class="text-[11px] text-slate-400 italic">No stations above FWI ${threshold} · ${_mapStationCache.filter(e=>e.result).length} loaded</span>`;
    return;
  }
  // Grouped by danger class (highest first) with counts; each group expands to
  // its station links. Open groups survive the per-row re-render.
  const open = new Set([...strip.querySelectorAll('details[open]')].map(d => d.dataset.danger));
  const order = ['Extreme', 'Very High', 'High', 'Moderate', 'Low', 'Very Low'];
  const groups = order.map(d => [d, alarms.filter(e => e.result.danger === d)]).filter(([, l]) => l.length);
  strip.innerHTML = groups.map(([d, list]) => {
    const t = _dangerTok(d);
    const links = list.map(e => {
      const nav = `${e.navLat ?? e.lat},${e.navLng ?? e.lng}`;
      return `<a href="../station_detail/code.html" onclick="localStorage.setItem('${PROVINCE.storageKeys.station}','${nav}')"
        class="inline-flex items-center gap-1.5 min-h-[32px] px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-colors hover:brightness-110"
        style="${dangerChipStyle(d)}"><span>${e.name}</span><span class="font-headline">${e.result.fwi.toFixed(1)}</span></a>`;
    }).join('');
    return `<details data-danger="${d}" class="w-full sm:w-auto"${open.has(d) ? ' open' : ''}>
      <summary class="inline-flex items-center gap-2 min-h-[44px] px-3 rounded-lg cursor-pointer text-xs font-bold" style="background:${t.solid};color:${t.on}">
        <span>${d}</span><span class="font-headline text-sm">${list.length}</span><span class="font-normal">station${list.length === 1 ? '' : 's'}</span>
      </summary>
      <div class="flex flex-wrap gap-2 mt-2">${links}</div>
    </details>`;
  }).join('');
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
  'Extreme':   { bar: 'bg-[#ef4444]',  badge: 'bg-[#ef4444]/15 text-[#f87171] border border-[#ef4444]/40',   dot: 'bg-[#ef4444] shadow-[0_0_8px_#ef4444]' },
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

async function buildRegionalSummary() {
  const list = document.getElementById('fwi-region-list');
  if (!list) return;

  const sectorOrder = PROVINCE.sectorOrder;
  const sorted = [...getStationList()].sort((a, b) => {
    const sa = sectorOrder.indexOf(stationSector(a.lat, a.lng));
    const sb = sectorOrder.indexOf(stationSector(b.lat, b.lng));
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });

  let _sortCol = 'sector', _sortAsc = true;

  list.innerHTML = `
    <div class="overflow-x-auto rounded-xl border border-outline-variant/10">
      <table id="fwi-station-table" class="w-full text-sm">
        <thead class="bg-[#131b2e] sticky top-0">
          <tr>
            <th class="text-left py-2.5 pl-3 pr-2 font-label text-[11px] uppercase tracking-wider text-slate-400 cursor-pointer hover:text-[#7bd0ff] select-none whitespace-nowrap" data-sort="name">Station ↕</th>
            <th class="text-left py-2.5 pr-2 font-label text-[11px] uppercase tracking-wider text-slate-400 cursor-pointer hover:text-[#7bd0ff] select-none" data-sort="sector">Sector</th>
            <th class="text-left py-2.5 pr-2 font-label text-[11px] uppercase tracking-wider text-slate-400 whitespace-nowrap">Source</th>
            <th class="text-right py-2.5 pr-2 font-label text-[11px] uppercase tracking-wider text-slate-400 cursor-pointer hover:text-[#7bd0ff] select-none" data-sort="temp">Temp</th>
            <th class="text-right py-2.5 pr-2 font-label text-[11px] uppercase tracking-wider text-slate-400 cursor-pointer hover:text-[#7bd0ff] select-none" data-sort="rh">RH</th>
            <th class="text-right py-2.5 pr-2 font-label text-[11px] uppercase tracking-wider text-slate-400 cursor-pointer hover:text-[#7bd0ff] select-none" data-sort="wind">Wind</th>
            <th class="text-right py-2.5 pr-2 font-label text-[11px] uppercase tracking-wider text-slate-400 cursor-pointer hover:text-[#7bd0ff] select-none" data-sort="fwi">FWI</th>
            <th class="text-left py-2.5 pr-2 font-label text-[11px] uppercase tracking-wider text-slate-400 cursor-pointer hover:text-[#7bd0ff] select-none" data-sort="danger">Danger</th>
            <th class="text-right py-2.5 pr-3 font-label text-[11px] uppercase tracking-wider text-slate-400 cursor-pointer hover:text-[#7bd0ff] select-none whitespace-nowrap" data-sort="hfi">HFI Cls</th>
          </tr>
        </thead>
        <tbody id="fwi-station-tbody" class="divide-y divide-[#1e2740]">
          ${sorted.map(s =>
            `<tr id="srow-${s.name.replace(/\s+/g,'-')}" data-state="loading" class="bg-[#0f1829] hover:bg-[#131b2e] transition-colors">
              <td class="py-2 pl-3 pr-2 font-semibold text-xs"><a href="../station_detail/code.html" onclick="localStorage.setItem('${PROVINCE.storageKeys.station}','${s.lat},${s.lng}')" class="text-[#7bd0ff] hover:underline">${s.name}</a></td>
              <td class="py-2 pr-2 text-slate-400 text-[11px]">${stationSector(s.lat, s.lng)}</td>
              <td colspan="7" data-cell="pending" class="py-2 pr-3 text-slate-400 text-[11px]"><span class="inline-flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse inline-block" aria-hidden="true"></span>Loading…</span></td>
            </tr>`
          ).join('')}
        </tbody>
      </table>
    </div>`;

  // Wire sortable column headers
  // Rows the map loop has not reached yet get an explicit grey state after 20 s
  // (BC runs the full tier chain per station, so late rows are normal); rows
  // still empty when the map loop finishes are marked "No data" there.
  setTimeout(() => _markUnloadedRows(false), 20000);
  list.querySelectorAll('#fwi-station-table th[data-sort]').forEach(th => {
    th.tabIndex = 0;
    th.setAttribute('aria-label', `Sort by ${th.textContent.replace(/[↕↑↓]/g, '').trim()}`);
    th.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); th.click(); } });
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (_sortCol === col) _sortAsc = !_sortAsc;
      else { _sortCol = col; _sortAsc = col !== 'fwi' && col !== 'hfi'; }
      // Update header indicators
      list.querySelectorAll('#fwi-station-table th[data-sort]').forEach(h => {
        const base = h.textContent.replace(/ [↑↓]$/, '');
        h.textContent = h.dataset.sort === _sortCol ? `${base} ${_sortAsc ? '↑' : '↓'}` : base;
      });
      _sortStationTable(_sortCol, _sortAsc);
    });
  });
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
      // The CWFIS firewx_naefs layer publishes daily statistics only
      // (max/min/median/pct25/pct75 of temp, rh, ws, pcp) — no noon-LST value.
      // Using max_temp/min_rh (the driest statistic of each) biased the chain
      // strongly dry (e.g. 17.4 vs median 9.7 °C). Use the medians as the central
      // estimate. NAEFS now only extends the trend beyond the ECMWF horizon
      // (fetchForecastDays); ECMWF supplies exact noon-LST/16:00 values first.
      const peakTemp = p.median_temp ?? 15;
      const peakRh   = p.median_rh   ?? 40;
      const peakWind = p.median_ws   ?? 10;
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

/**
 * Render the 24-hour FWI trend chart into <div id="fwi-chart-bars">.
 * Hourly FFMC (Van Wagner 1977) chained through the past 24 h of weather,
 * with DMC/DC held at today's daily values (standard hourly-FWI practice);
 * hourly ISI/FWI follow from hourly FFMC + hourly wind.
 * The previous implementation chained the *daily* equations hour-by-hour —
 * each bar absorbed a full day's drying, which was dimensionally wrong.
 */
async function buildHourlyChart(lat, lng, stationName = 'Edmonton') {
  const container = document.getElementById('fwi-chart-bars');
  if (!container) return;

  let hours;
  try {
    hours = await fetchHourly(lat, lng);
  } catch (e) {
    console.warn('[FWI Chart]', e);
    if (container) container.innerHTML =
      '<div class="text-xs text-slate-500 p-3">Hourly trend unavailable — weather fetch failed.</div>';
    return;
  }
  if (!hours.length) return;

  // Seed from today's daily codes when available; hFFMC equilibrates within
  // a few hours so a 24-h-old seed converges quickly.
  const seedFFMC = _lastFWI?.ffmc ?? STARTUP.ffmc;
  const dmcToday = _lastFWI?.dmc  ?? STARTUP.dmc;
  const dcToday  = _lastFWI?.dc   ?? getStartupDC(stationName);
  const buiToday = _bui(dmcToday, dcToday);

  let f = seedFFMC;
  const results = hours.map(w => {
    f = _hffmc(w.temp, w.rh, w.wind, w.rain, f);
    const isi = _isi(f, w.wind);
    const fwi = _fwi(isi, buiToday);
    return { fwi, danger: dangerRatingProv(fwi), time: w.time };
  });

  const maxFWI = Math.max(...results.map(r => r.fwi), 1);
  const now = new Date();

  container.innerHTML = results.map(r => {
    const h = Math.max(4, (r.fwi / maxFWI) * 100).toFixed(1);
    const c = DANGER_COLORS[r.danger] || DANGER_COLORS['Moderate'];
    const isPast = r.time <= now;
    const bg = isPast ? c.bar : c.bar + '/30';
    const timeLabel = r.time.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `<div class="flex-1 ${bg} rounded-t-sm transition-colors cursor-help group relative" style="height:${h}%">` +
      `<div class="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-surface-container-highest px-2 py-1 rounded text-[11px] whitespace-nowrap z-10">${timeLabel} — ${fmt(r.fwi)}</div>` +
      `</div>`;
  }).join('');

  // Render x-axis labels from actual data timestamps (5 evenly spaced)
  const timesEl = document.getElementById('fwi-chart-times');
  if (timesEl && results.length) {
    const n = results.length - 1;
    const indices = [0, Math.round(n * 0.25), Math.round(n * 0.5), Math.round(n * 0.75), n];
    timesEl.innerHTML = indices.map(i =>
      `<span>${results[i].time.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>`
    ).join('');
  }
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

/**
 * Forecast days for the FWI/FBP chain: ECMWF IFS via Open-Meteo (exact noon-LST
 * and 16:00 hours, ~7 days) first, extended with NAEFS ensemble medians beyond
 * the ECMWF horizon (flagged ensembleTail — lower confidence). NAEFS alone only
 * if ECMWF fails. Returns { days, source }.
 */
async function fetchForecastDays(lat, lng) {
  const naefsSt = findNearestNAEFS(lat, lng);
  const [ec, na] = await Promise.all([
    fetchForecast(lat, lng).catch(() => null),
    naefsSt ? fetchForecastNAEFS(naefsSt.code).catch(() => null) : Promise.resolve(null),
  ]);
  const dateOf = d => new Date(d._ts).toISOString().slice(0, 10);
  if (ec?.length) {
    const last = dateOf(ec[ec.length - 1]);
    const tail = (na || []).filter(d => dateOf(d) > last).map(d => ({ ...d, ensembleTail: true }));
    return {
      days: [...ec, ...tail],
      source: tail.length
        ? `ECMWF IFS noon LST (days 1–${ec.length}) + NAEFS ensemble median${naefsSt ? ' · ' + naefsSt.name : ''} (days ${ec.length + 1}–${ec.length + tail.length}, lower confidence)`
        : 'ECMWF IFS 0.25° (Open-Meteo) · noon LST',
    };
  }
  if (na?.length) return { days: na, source: `NAEFS ensemble median (${naefsSt.name}) — ECMWF unavailable` };
  throw new Error('[FWI] no forecast available (ECMWF and NAEFS failed)');
}

async function buildForecastTrends(lat = 53.5344, lng = -113.4903, stationName = 'Edmonton') {
  try {
    // Prefer NAEFS (Environment Canada 14-day ensemble at fire weather stations)
    // Fall back to Open-Meteo if no NAEFS station within 150 km
    const { days, source: forecastSource } = await fetchForecastDays(lat, lng);
    // Start the chain from today's observed FFMC/DMC/DC if available; otherwise cold-start.
    // Apply DC floor so a cold-start artifact in _lastFWI.dc doesn't suppress the 14-day trend.
    const chainStart = (_lastFWI?.ffmc != null) ? {
      ffmc: _lastFWI.ffmc,
      dmc:  _lastFWI.dmc,
      dc:   applyDCFloor(_lastFWI.dc ?? getStartupDC(stationName), lat, lng).dc,
      obsDate: _lastFWI._obsDate ?? null,
    } : null;
    const fuelCode = _savedFuelCode();
    const curing   = _savedCuring();
    const results = calcMultiDayFBP(days, getStartupDC(stationName), chainStart, fuelCode, curing);
    _forecastCache = { days, results, fuelCode, curing, lat: _stationLat, lng: _stationLng };
    const maxFWI = Math.max(...results.map(r => r.fwi), 1);

    // Peak danger window — 3-day block centred on the highest FWI day
    const peakDay  = results.reduce((a, b) => b.fwi > a.fwi ? b : a);
    const peakIdx  = results.indexOf(peakDay);
    const winStart = Math.max(0, peakIdx - 1);
    const winEnd   = Math.min(results.length - 1, peakIdx + 1);
    const winLabel = winStart === winEnd
      ? results[winStart].label.split(',')[0]
      : `${results[winStart].label.split(',')[0]} – ${results[winEnd].label.split(',')[0]}`;
    const elPH  = document.getElementById('fwi-peak-label-hero');
    const elPWF = document.getElementById('fwi-peak-window-fwi');
    const elPWD = document.getElementById('fwi-peak-window-dates');
    const elPWR = document.getElementById('fwi-peak-window-rating');
    if (elPH)  elPH.textContent  = peakDay.label.split(',')[0];
    if (elPWF) elPWF.textContent = peakDay.fwi.toFixed(1);
    if (elPWD) elPWD.textContent = winLabel;
    if (elPWR) {
      elPWR.textContent = peakDay.danger;
      elPWR.className   = 'pyra-chip text-[11px] font-bold uppercase';
      if (elPWR.style) elPWR.style.cssText = dangerChipStyle(peakDay.danger);
    }
    // Role + valid time for every forecast FWI on this page (owner rule: no
    // unlabelled FWI numbers). These are daily noon-LST chain values, not the
    // station page's 16:00 peak-burn headline.
    const chainRole = naefsSt && /^NAEFS/.test(forecastSource) ? 'NAEFS ensemble chain' : 'ECMWF via Open-Meteo chain';
    const elRole = document.getElementById('fwi-peak-window-role');
    if (elRole) elRole.textContent = `${chainRole} · daily FWI, valid noon LST ${peakDay.label}`;

    // Days at elevated risk — FWI at or above the province's "High" class
    // (PROVINCE.highDangerFWI: AB 15.5 on the CWFIS FWI map intervals, BC 21)
    const daysAtRisk = results.filter(r => r.fwi >= PROVINCE.highDangerFWI).length;
    const elDAR = document.getElementById('fwi-days-at-risk');
    const elTD  = document.getElementById('fwi-total-days');
    if (elDAR) elDAR.textContent = daysAtRisk;
    if (elTD)  elTD.textContent  = results.length;

    // Week-over-week trend
    const half  = Math.ceil(results.length / 2);
    const w1    = results.slice(0, half);
    const w2    = results.slice(half);
    const w1avg = w1.reduce((s, r) => s + r.fwi, 0) / w1.length;
    const w2avg = w2.length ? w2.reduce((s, r) => s + r.fwi, 0) / w2.length : w1avg;
    const wTrend = w2avg > w1avg + 3 ? 'ESCALATING' : w2avg < w1avg - 3 ? 'IMPROVING' : 'STABLE';
    const elTL  = document.getElementById('fwi-outlook-trend-label');
    const elW1  = document.getElementById('fwi-w1-avg');
    const elW2  = document.getElementById('fwi-w2-avg');
    if (elTL) elTL.textContent = wTrend;
    if (elW1) elW1.textContent = w1avg.toFixed(1);
    if (elW2) elW2.textContent = w2avg.toFixed(1);
    // The trend compares period averages; say where the peak falls so "Peak
    // EXTREME" beside "IMPROVING" reads as consistent, not contradictory.
    const elTN = document.getElementById('fwi-outlook-trend-note');
    if (elTN) {
      const peakWk = peakIdx < half ? 'first' : 'second';
      elTN.textContent = `Compares average FWI, not the peak. Peak ${peakDay.fwi.toFixed(1)} (${peakDay.danger}) falls in the ${peakWk} half of the outlook.`;
    }

    // Data source pill
    const elSrc = document.getElementById('fwi-source-label');
    if (elSrc) elSrc.textContent = `${chainRole} · daily FWI, valid noon LST · ${forecastSource}`;

    // Forecast summary paragraph
    const sumEl = document.getElementById('fwi-forecast-summary');
    if (sumEl) sumEl.textContent = forecastSummaryText(days, results, stationName, forecastSource);

    // Hero stat boxes — peak temp, min RH, max wind across forecast window
    const peakTemp = Math.max(...days.map(d => d.temp ?? -99));
    const minRH    = Math.min(...days.map(d => d.rh   ?? 999));
    const maxWind  = Math.max(...days.map(d => d.wind  ?? 0));
    const elPT = document.getElementById('fwi-peak-temp');
    const elMR = document.getElementById('fwi-min-rh');
    const elMW = document.getElementById('fwi-max-wind');
    if (elPT) elPT.textContent = fmt(peakTemp) + '°C';
    if (elMR) elMR.textContent = fmt(minRH, 0) + '%';
    if (elMW) elMW.textContent = fmt(maxWind, 0) + ' km/h';

    // D+1 Peak Burn section — next operationally relevant peak burn day
    // (today if before 16:00 local daylight time, tomorrow if after)
    const d1SafeIdx = _nextPeakDayIdx(days);
    const d1HeadEl = document.getElementById('fwi-d1-heading');
    if (d1HeadEl) {
      // Label from the selected day's local date, not the clock.
      const dayLocal = days[d1SafeIdx]?._ts ? _localDateStr(days[d1SafeIdx]._ts) : null;
      const lbl = dayLocal && dayLocal > _localDateStr() ? 'Tomorrow' : 'Today';
      d1HeadEl.textContent = lbl + ' — Peak Burn Prediction';
    }
    if (results.length > 0) {
      const d1 = results[d1SafeIdx];
      const d1fbp = d1.fbp;
      const d1pw  = d1.peakWeather || d1;
      const setD1 = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      setD1('fwi-d1-label', d1.label || 'D+1');
      setD1('fwi-d1-temp',  fmt(d1pw.temp) + '°C');
      setD1('fwi-d1-rh',    fmt(d1pw.rh, 0) + '%');
      setD1('fwi-d1-wind',  fmt(d1pw.wind, 0) + ' km/h');
      setD1('fwi-d1-isi',   d1.isi.toFixed(1));
      setD1('fwi-d1-fwi',   d1.fwi.toFixed(1));
      setD1('fwi-d1-fwi-role', `${chainRole} · daily FWI, valid noon LST ${d1.label || ''}`);
      const d1RatingEl = document.getElementById('fwi-d1-rating');
      if (d1RatingEl) { d1RatingEl.textContent = d1.danger; d1RatingEl.className = 'pyra-chip ml-1 text-[11px] font-bold'; if (d1RatingEl.style) d1RatingEl.style.cssText = dangerChipStyle(d1.danger); }
      if (d1fbp) {
        const d1cl = hfiClassInfo(d1fbp.hfi);
        setD1('fwi-d1-ros',   d1fbp.ros.toFixed(1));
        const d1HfiEl = document.getElementById('fwi-d1-hfi');
        if (d1HfiEl) { d1HfiEl.textContent = Math.round(d1fbp.hfi).toLocaleString(); d1HfiEl.className = 'font-headline text-2xl font-bold text-white'; }
        const d1HfiCls = document.getElementById('fwi-d1-hfi-class');
        if (d1HfiCls) { d1HfiCls.textContent = `HFI ${d1cl.num} · ${d1cl.label}`; if (d1HfiCls.style) d1HfiCls.style.cssText = hfiChipStyle(d1cl.num); }
        setD1('fwi-d1-flame', d1fbp.flameLength.toFixed(1) + ' m');
        setD1('fwi-d1-type',  d1fbp.fireType);
        setD1('fwi-d1-cfb',   (d1fbp.cfb * 100).toFixed(0) + '%');
      }
      const fuelName = FUEL_TYPES[fuelCode]?.name || fuelCode;
      setD1('fwi-d1-fuel', `${fuelCode} — ${fuelName}`);
      // Escape warning — names the day the prediction is for (was always "tomorrow")
      const d1WarnEl = document.getElementById('fwi-d1-escape-warn');
      if (d1WarnEl) {
        const dl = days[d1SafeIdx]?._ts ? _localDateStr(days[d1SafeIdx]._ts) : null;
        const whenTxt = dl && dl > _localDateStr() ? `tomorrow (${d1.label})` : `today (${d1.label})`;
        d1WarnEl.textContent = `⚠ HFI ≥ 4,000 kW/m — potential for escaped fire during the peak burn period ${whenTxt}`;
        d1WarnEl.style.display = (d1fbp && d1fbp.hfi >= 4000) ? 'block' : 'none';
      }
    }

    // Bar chart — all 7 days, coloured by danger rating
    const barContainer = document.getElementById('fwi-trend-bars');
    if (barContainer) {
      barContainer.innerHTML = results.map(r => {
        const h = Math.max(4, (r.fwi / maxFWI) * 100).toFixed(1);
        const c = DANGER_COLORS[r.danger] || DANGER_COLORS['Moderate'];
        return `<div class="w-full ${c.bar} rounded-t-sm transition-colors relative group cursor-help" style="height:${h}%">` +
          `<div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-[11px] text-on-surface bg-surface-container-highest px-1.5 py-0.5 rounded hidden group-hover:block whitespace-nowrap z-10">${r.label} — ${r.fwi.toFixed(1)} (${r.danger})</div>` +
          `</div>`;
      }).join('');
    }

    // X-axis labels — show ~5 evenly spaced + peak day; keep all spans for bar alignment
    const timesEl = document.getElementById('fwi-trend-times');
    if (timesEl) {
      const n = results.length;
      const showSet = new Set([0, n - 1, peakIdx]);
      const step = Math.max(1, Math.floor(n / 4));
      for (let i = 0; i < n; i += step) showSet.add(i);
      timesEl.innerHTML = results.map((r, i) =>
        `<span class="${showSet.has(i) ? 'truncate' : 'invisible'}">${r.label.split(',')[0]}</span>`
      ).join('');
    }

    // Forecast FBP table — all forecast days with fire behaviour columns
    const fbpTbody = document.getElementById('fwi-forecast-fbp-tbody');
    if (fbpTbody && results.length > 0) {
      fbpTbody.innerHTML = results.map((r, i) => {
        const pw  = days[i]?.peak || days[i];
        const fbp = r.fbp;
        const hn  = fbp ? hfiClassInfo(fbp.hfi).num : 0;
        const dl  = days[i]?._ts ? _localDateStr(days[i]._ts) : null;
        const tag = dl === _localDateStr() ? 'Today' : dl === _localDateStr(Date.now() + 86400000) ? 'Tomorrow' : '';
        const isD1 = i === d1SafeIdx;
        return `<tr class="hover:bg-surface-container transition-colors ${isD1 ? 'bg-surface-container/50' : ''}">
  <td class="py-3 pl-4 pr-3 font-headline font-bold text-white text-sm whitespace-nowrap">${r.label}${tag ? ` <span class="text-[11px] font-label text-primary ml-1">${tag}</span>` : ''}</td>
  <td class="py-3 text-sm text-on-surface-variant">${fmt(pw?.temp ?? days[i]?.temp)}°C</td>
  <td class="py-3 text-sm ${(pw?.rh ?? days[i]?.rh) < 30 ? 'text-amber-300 font-bold' : 'text-on-surface-variant'}">${fmt(pw?.rh ?? days[i]?.rh, 0)}%</td>
  <td class="py-3 text-sm text-on-surface-variant">${fmt(pw?.wind ?? days[i]?.wind, 0)} km/h${pw?.wdir != null ? ' ' + compassDir(pw.wdir) : ''}</td>
  <td class="py-3"><span class="pyra-chip text-[11px] font-bold" style="${dangerChipStyle(r.danger)}" title="${r.danger}">${r.fwi.toFixed(1)}</span></td>
  <td class="py-3 text-sm text-on-surface-variant">${fbp ? fbp.ros.toFixed(1) : '—'}</td>
  <td class="py-3 text-sm whitespace-nowrap">${fbp ? `<span class="pyra-chip font-bold" style="${hfiChipStyle(hn)}">${hn}</span> <span class="text-on-surface-variant">${Math.round(fbp.hfi).toLocaleString()}</span>` : '—'}</td>
  <td class="py-3 text-sm text-on-surface-variant">${fbp ? fbp.fireType : '—'}</td>
</tr>`;
      }).join('');
    }

    // Trend table — top 5 stations, loaded sequentially to avoid rate-limiting
    const tbody = document.getElementById('fwi-trend-tbody');
    if (tbody) {
      const tableStations = getRegions().slice(0, PROVINCE.trendTableCount);
      let tableHTML = '';
      for (const reg of tableStations) {
        try {
          const w = await fetchWeatherPrimary(reg.lat, reg.lng);
          // Same dated carry-over as the station map (no cold-start STARTUP
          // codes, which made every row read MODERATE).
          let prev = { ffmc: STARTUP.ffmc, dmc: STARTUP.dmc, dc: getStartupDC(reg.name) };
          let co = null;
          if (!w.fwiFromCWFIS) {
            co = _carryOverFor(reg.lat, reg.lng, reg.name);
            if (co) prev = { ffmc: co.ffmc, dmc: co.dmc, dc: co.dc };
          }
          const r = co?.final
            ? calculateFWI({ ...w, fwiFromCWFIS: true, ...prev }, prev)
            : calculateFWI(w, prev);
          const prov = _provenance(w, co);
          const name = reg.name.toUpperCase();
          tableHTML += `
<tr class="hover:bg-surface-container transition-colors">
  <td class="py-4 pl-4 pr-3">
    <span class="block text-white font-bold font-headline">${name}</span>
    <span class="block mt-1 whitespace-nowrap">${provenanceChipHTML(prov, true)} <span class="text-[11px] text-slate-400">${prov.network}</span></span>
  </td>
  <td class="py-4 pr-3 font-headline font-bold text-white whitespace-nowrap">${fmt(r.weather.temp)}°C</td>
  <td class="py-4 pr-3 font-bold whitespace-nowrap ${r.weather.rh < 30 ? 'text-amber-300' : 'text-on-surface'}">${fmt(r.weather.rh, 0)}%</td>
  <td class="py-4 pr-3 text-sm text-on-surface-variant whitespace-nowrap">${fmt(r.weather.wind, 0)} km/h${r.weather.wdir != null ? ' ' + compassDir(r.weather.wdir) : ''}</td>
  <td class="py-4 pr-3">
    <span class="pyra-chip text-[11px] font-bold" style="${dangerChipStyle(r.danger)}">${r.danger.toUpperCase()}</span>
  </td>
  <td class="py-4 pr-4">
    <span class="text-sm font-bold text-white block">${fmt(r.fwi)}</span>
    <div class="w-24 h-1 bg-surface-container-highest rounded-full overflow-hidden mt-1" aria-hidden="true">
      <div class="h-full" style="background:${_dangerTok(r.danger).solid};width:${Math.min(100, r.fwi * 2).toFixed(1)}%"></div>
    </div>
  </td>
</tr>`;
        } catch (e) {
          console.warn(`[FWI Trend Table] ${reg.name}:`, e);
          tableHTML += `<tr><td colspan="6" class="py-3 pl-4 text-slate-400 text-xs"><span class="pyra-chip" style="${PROV_LEVEL_STYLE.neutral}">No data</span> ${reg.name} — unavailable</td></tr>`;
        }
      }
      tbody.innerHTML = tableHTML;
    }
  } catch (e) {
    console.warn('[FWI Forecast]', e);
    const tbody = document.getElementById('fwi-trend-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center text-slate-400 py-6">Forecast unavailable — check connection</td></tr>`;
  }
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

function exportRegionalDataset() {
  if (!_regionalCache.length) { alert('Data still loading — try again in a moment.'); return; }
  const timestamp = new Date().toISOString();
  const rows = [['Timestamp', 'Station', 'Sector', 'Lat', 'Lng', 'Temp_C', 'RH_pct', 'Wind_kmh', 'Rain_mm', 'FFMC', 'DMC', 'DC', 'ISI', 'BUI', 'FWI', 'Danger']];
  for (const { name, sector, lat, lng, result: r } of _regionalCache) {
    rows.push([
      timestamp, name, sector, lat, lng,
      r.weather.temp, r.weather.rh, r.weather.wind, r.weather.rain,
      r.ffmc.toFixed(1), r.dmc.toFixed(1), r.dc.toFixed(1),
      r.isi.toFixed(1), r.bui.toFixed(1), r.fwi.toFixed(1), r.danger,
    ]);
  }
  _triggerCSVDownload(rows, `fwi-${PROVINCE.csvSlug}-${new Date().toISOString().slice(0,10)}.csv`);
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

/**
 * Print Provincial Briefing — landscape A4/Letter, ICS-formatted.
 * Uses _mapStationCache (all 39 stations) if populated, else _regionalCache (5 zones).
 */
function printProvincialBriefing(mode = 'provincial') {
  // Determine data source
  const useMap = _mapStationCache.length > 0;
  const useRegional = !useMap && _regionalCache.length > 0;
  if (!useMap && !useRegional) { alert('Data still loading — try again in a moment.'); return; }

  const now   = new Date();
  const today = now.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const prepared = now.toLocaleString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });

  // Build station rows — sort by FWI descending within each sector grouping
  let rows;
  if (useMap) {
    // Assign sector from the province station list
    const sectorMap = {};
    getStationList().forEach(s => { sectorMap[s.name] = stationSector(s.lat, s.lng); });
    const sectorOrder = PROVINCE.sectorOrder;
    rows = [..._mapStationCache].sort((a, b) => {
      const sa = sectorOrder.indexOf(sectorMap[a.name]);
      const sb = sectorOrder.indexOf(sectorMap[b.name]);
      if (sa !== sb) return sa - sb;
      return b.result.fwi - a.result.fwi;
    }).map(({ name, lat, lng, result: r, fbp }) => ({
      name, lat, lng,
      temp: r.weather?.temp, rh: r.weather?.rh, wind: r.weather?.wind,
      dc: r.dc, fwi: r.fwi, danger: r.danger,
      sector: sectorMap[name] || '—',
      hfi: fbp?.hfi, hfiClass: fbp ? _hfiClass(fbp.hfi) : '—',
    }));
  } else {
    rows = _regionalCache.map(({ name, sector, lat, lng, result: r }) => ({
      name, lat, lng, sector: sector || '—',
      temp: r.weather?.temp, rh: r.weather?.rh, wind: r.weather?.wind,
      dc: r.dc, fwi: r.fwi, danger: r.danger,
    }));
    rows.sort((a, b) => b.fwi - a.fwi);
  }

  // ── Selected station (for regional mode) ─────────────────────────────────
  const selLat = _stationLat;
  const selLng = _stationLng;
  const selName = _stationName;

  const briefingTitle = mode === 'regional'
    ? `Pyra · Fire Weather — Regional Briefing · ${selName} Area`
    : PROVINCE.briefingTitle;

  const mapInitScript = mode === 'regional'
    ? `map.setView([${selLat}, ${selLng}], 8);`
    : `map.fitBounds(${PROVINCE.briefingBounds});`;

  // ── All station data serialised for dynamic table + Leaflet markers ───────
  const allStationData = JSON.stringify(rows.map(r => ({
    name: r.name, lat: r.lat, lng: r.lng,
    temp: r.temp, rh: r.rh, wind: r.wind,
    fwi: r.fwi != null ? +r.fwi.toFixed(1) : null,
    danger: r.danger,
    hfiClass: r.hfiClass || '—',
  })));


  // FWI danger-rating legend rows (PROVINCE.dangerLegend: label, colour, FWI range, behaviour)
  const legendRows = PROVINCE.dangerLegend.map(([label, color, range, desc], i) =>
    `<tr style="background:${i % 2 ? '#f7f8f9' : '#fff'}"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${(DANGER_TOKENS[label] || {}).solid || color};border:1px solid #000;margin-right:3px;vertical-align:middle"></span><b>${label}</b></td><td style="padding:2px 4px;text-align:center">${range}</td><td style="padding:2px 5px;color:#555">${desc}</td></tr>`
  ).join('\n      ');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${briefingTitle}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
  @media print {
    @page { size: portrait; margin: 0.7cm; }
    .no-print { display: none !important; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    #print-map { height: 295px !important; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    table { page-break-inside: auto; break-inside: auto; }
  }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 9pt; color: #000; margin: 0; padding: 10px 12px; }
  .hdr { border: 2px solid #2d3748; padding: 7px 12px; margin-bottom: 8px; display:flex; justify-content:space-between; align-items:center; }
  .hdr-title { font-size: 12pt; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; }
  .hdr-meta { font-size: 7.5pt; color: #555; text-align:right; line-height:1.5; }
  #print-map { width: 100%; height: 295px; border: 1px solid #ccc; margin-bottom: 4px; }
  .leaflet-control-attribution { font-size: 5.5pt !important; }
  .legend { display:flex; gap:10px; margin-bottom:6px; align-items:center; flex-wrap:wrap; font-size:7.5pt; }
  .ld { display:flex; align-items:center; gap:3px; }
  .lc { width:11px; height:11px; border-radius:50%; display:inline-block; }
  .pill-demo { display:inline-flex; border-radius:3px; overflow:hidden; font-size:7pt; font-weight:800; line-height:1.35; vertical-align:middle; }
  .station-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 6px; }
  .station-grid table { border-collapse: collapse; width: 100%; }
  .zone-bar { background:#f0f2f5; border:1px solid #ccc; padding:4px 8px; font-size:8pt; margin-top:6px; }
  .sign-row { display:flex; gap:30px; margin-top:6px; border-top:1px solid #ccc; padding-top:5px; font-size:8pt; }
  .sign-line { border-bottom:1px solid #333; min-width:140px; display:inline-block; }
</style>
</head>
<body>

<div class="hdr">
  <div class="hdr-title">${briefingTitle}</div>
  <div class="hdr-meta">
    ${today} · 0600–1800 ${PROVINCE.tzLabel}<br>
    Prepared: ${prepared} · CWFIS / MSC SWOB / Open-Meteo NWP · FWI = daily value at noon LST<br>
    <strong>Pyra (unofficial — verify with FBAN)</strong>
  </div>
</div>

<!-- Leaflet OSM map -->
<div id="print-map" style="width:700px;height:295px;border:1px solid #ccc;margin-bottom:4px"></div>
<script>
setTimeout(function() {
(function() {
  // Same palettes as the live site: danger tokens (left half) and the HFI
  // card palette (right half) — previously a third, different set.
  const FWI_COLORS = ${JSON.stringify(Object.fromEntries(Object.entries(DANGER_TOKENS).map(([k, t]) => [k, t.solid])))};
  const HFI_COLORS = { '1-Low':'#1a3a7a','2-Mod':'#5bb8d4','3-High':'#1e6b35','4-VH':'#f5c518','5-Ext':'#e07820','6-Cat':'#cc2200','—':'#9e9e9e' };
  const HFI_TEXT   = { '1-Low':'#ffffff','2-Mod':'#0a2a50','3-High':'#ffffff','4-VH':'#2a1a00','5-Ext':'#2a1a00','6-Cat':'#ffffff','—':'#000000' };
  const PRINT_COLORS = ${JSON.stringify(PRINT_DANGER_COLORS)};
  const CLASSES = ${JSON.stringify(PROVINCE.dangerClasses)}; // province danger classes, low → high
  const allStations = ${allStationData};

  const map = L.map('print-map', { zoomControl: true });
  ${mapInitScript}
  // CARTO basemaps now require an API key (tiles render "API KEY REQUIRED");
  // Esri Light Gray Canvas is keyless, like the imagery layer used elsewhere.
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community',
    maxNativeZoom: 16, maxZoom: 19
  }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 16, maxZoom: 19
  }).addTo(map);

  // Draw all station markers (always visible regardless of zoom)
  allStations.forEach(s => {
    const fc = FWI_COLORS[s.danger] || '#2980b9';
    const hc = HFI_COLORS[s.hfiClass] || '#9e9e9e';
    const r = ['Extreme','Very High'].includes(s.danger) ? 20 : 17;
    const label = s.fwi != null ? (+s.fwi).toFixed(1) : '—';
    const [hn] = (s.hfiClass || '—').split('-');
    const d = r * 2;
    const icon = L.divIcon({
      html: '<svg width="' + d + '" height="' + d + '" viewBox="0 0 ' + d + ' ' + d + '" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,0.45))">'
        + '<path d="M ' + r + ',0 A ' + r + ',' + r + ' 0 0,0 ' + r + ',' + d + ' Z" fill="' + fc + '"/>'
        + '<path d="M ' + r + ',0 A ' + r + ',' + r + ' 0 0,1 ' + r + ',' + d + ' Z" fill="' + hc + '"/>'
        + '<line x1="' + r + '" y1="0" x2="' + r + '" y2="' + d + '" stroke="rgba(0,0,0,0.2)" stroke-width="0.8"/>'
        + '<text x="' + (r*0.52) + '" y="' + (r*0.72) + '" font-size="' + (r*0.48) + '" font-weight="700" fill="rgba(0,0,0,0.5)" text-anchor="middle">FWI</text>'
        + '<text x="' + (r*0.52) + '" y="' + (r*1.38) + '" font-size="' + (r*0.72) + '" font-weight="800" fill="rgba(0,0,0,0.85)" text-anchor="middle">' + label + '</text>'
        + '<text x="' + (r*1.48) + '" y="' + (r*0.72) + '" font-size="' + (r*0.48) + '" font-weight="700" fill="' + (HFI_TEXT[s.hfiClass] || '#000') + '" text-anchor="middle">HFI</text>'
        + '<text x="' + (r*1.48) + '" y="' + (r*1.38) + '" font-size="' + (r*0.68) + '" font-weight="800" fill="' + (HFI_TEXT[s.hfiClass] || '#000') + '" text-anchor="middle">' + hn + '</text>'
        + '</svg>',
      iconSize: [d, d], iconAnchor: [r, r], className: ''
    });
    L.marker([s.lat, s.lng], { icon }).bindTooltip(s.name, { permanent: false, direction: 'top' }).addTo(map);
  });

  // Dynamic table: rebuilds whenever map is panned/zoomed
  const colHeader = '<tr style="background:#2d3748;color:#fff">'
    + '<th style="padding:3px 4px;text-align:left;font-size:6.5pt;text-transform:uppercase;letter-spacing:.05em">Station</th>'
    + '<th style="padding:3px;text-align:center;font-size:6.5pt">T\u00b0C</th>'
    + '<th style="padding:3px;text-align:center;font-size:6.5pt">RH</th>'
    + '<th style="padding:3px;text-align:center;font-size:6.5pt">W</th>'
    + '<th style="padding:3px;text-align:center;font-size:6.5pt">FWI/HFI</th>'
    + '<th style="padding:3px;text-align:center;font-size:6.5pt">Rating</th>'
    + '</tr>';

  function buildRow(s, i) {
    const bg = i % 2 === 0 ? '#fff' : '#f7f8f9';
    const dc = PRINT_COLORS[s.danger] || PRINT_COLORS['Moderate'];
    const [hn] = (s.hfiClass || '—').split('-');
    const fc = FWI_COLORS[s.danger] || '#2980b9';
    const hc = HFI_COLORS[s.hfiClass] || '#9e9e9e';
    return '<tr style="background:' + bg + ';border-bottom:1px solid #e8e8e8">'
      + '<td style="padding:2px 4px;font-weight:600;white-space:nowrap;font-size:7pt;max-width:85px;overflow:hidden">' + s.name + '</td>'
      + '<td style="padding:2px 3px;text-align:center;font-size:7pt">' + (s.temp != null ? (+s.temp).toFixed(0) + '\u00b0' : '—') + '</td>'
      + '<td style="padding:2px 3px;text-align:center;font-size:7pt">' + (s.rh != null ? Math.round(s.rh) + '%' : '—') + '</td>'
      + '<td style="padding:2px 3px;text-align:center;font-size:7pt">' + (s.wind != null ? Math.round(s.wind) : '—') + '</td>'
      + '<td style="padding:2px 3px;text-align:center">'
      + '<span style="display:inline-flex;border-radius:3px;overflow:hidden;font-size:7.5pt;font-weight:800;line-height:1.35;box-shadow:0 1px 3px rgba(0,0,0,0.25)">'
      + '<span style="padding:0 4px;background:' + fc + ';color:rgba(0,0,0,0.78)">' + (s.fwi != null ? (+s.fwi).toFixed(1) : '—') + '</span>'
      + '<span style="padding:0 4px;background:' + hc + ';color:' + (HFI_TEXT[s.hfiClass] || '#000') + (/^[56]/.test(s.hfiClass) ? ';outline:1.5px solid #000;outline-offset:-1.5px' : '') + '">' + hn + '</span>'
      + '</span></td>'
      + '<td style="padding:2px 5px;text-align:center;background:' + dc.bg + ';color:' + dc.text + ';font-weight:700;font-size:7pt">' + s.danger + '</td>'
      + '</tr>';
  }

  function updateTable() {
    const bounds = map.getBounds();
    const visible = allStations.filter(s => bounds.contains(L.latLng(s.lat, s.lng)));
    const third = Math.ceil(visible.length / 3) || 1;
    const cols = [visible.slice(0, third), visible.slice(third, third * 2), visible.slice(third * 2)];
    document.getElementById('station-grid').innerHTML =
      cols.map(col => '<table><thead>' + colHeader + '</thead><tbody>' + col.map(buildRow).join('') + '</tbody></table>').join('');
    const tally = {};
    CLASSES.forEach(d => { tally[d] = 0; });
    visible.forEach(s => { if (tally[s.danger] !== undefined) tally[s.danger]++; });
    const parts = CLASSES.slice().reverse().filter(d => tally[d] > 0).map(d => tally[d] + ' ' + d).join(' · ');
    document.getElementById('zone-bar').innerHTML = '<strong>Zone Summary (' + visible.length + ' stations · pan/zoom to adjust):</strong> ' + (parts || 'No data');
  }
  map.on('moveend zoomend', updateTable);

  // Trigger print after tiles load; also run initial table build
  let printed = false;
  function doPrint() { if (!printed) { printed = true; window.print(); } }
  map.eachLayer(l => { if (l.on) l.on('load', () => { updateTable(); setTimeout(doPrint, 400); }); });
  setTimeout(() => { updateTable(); doPrint(); }, 3000);
})();
}, 0);
<\/script>

<!-- Rating reference tables -->
<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:5px">
  <table style="border-collapse:collapse;width:100%;font-size:6.5pt">
    <thead><tr style="background:#2d3748;color:#fff">
      <th colspan="3" style="padding:3px 5px;text-align:left;letter-spacing:.05em;text-transform:uppercase">FWI Danger Rating (marker left half)</th>
    </tr>
    <tr style="background:#f0f2f5">
      <th style="padding:2px 5px;text-align:left">Rating</th>
      <th style="padding:2px 4px;text-align:center">FWI</th>
      <th style="padding:2px 5px;text-align:left">Fire Behaviour</th>
    </tr></thead>
    <tbody>
      ${legendRows}
    </tbody>
  </table>
  <table style="border-collapse:collapse;width:100%;font-size:6.5pt">
    <thead><tr style="background:#2d3748;color:#fff">
      <th colspan="4" style="padding:3px 5px;text-align:left;letter-spacing:.05em;text-transform:uppercase">HFI Byram Intensity Class (marker right half)</th>
    </tr>
    <tr style="background:#f0f2f5">
      <th style="padding:2px 5px;text-align:left">Class</th>
      <th style="padding:2px 4px;text-align:center">kW/m</th>
      <th style="padding:2px 4px;text-align:center">Flame</th>
      <th style="padding:2px 5px;text-align:left">Suppression</th>
    </tr></thead>
    <tbody>
      <tr style="background:#fff"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#1a3a7a;border:1px solid #000;margin-right:3px;vertical-align:middle"></span><b>1-Low</b></td><td style="padding:2px 4px;text-align:center">&lt; 10</td><td style="padding:2px 4px;text-align:center">&lt; 0.2 m</td><td style="padding:2px 5px;color:#555">Hand tools</td></tr>
      <tr style="background:#f7f8f9"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#5bb8d4;border:1px solid #000;margin-right:3px;vertical-align:middle"></span><b>2-Mod</b></td><td style="padding:2px 4px;text-align:center">10–500</td><td style="padding:2px 4px;text-align:center">0.2–1.5 m</td><td style="padding:2px 5px;color:#555">Hand tools / ground tanker</td></tr>
      <tr style="background:#fff"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#1e6b35;border:1px solid #000;margin-right:3px;vertical-align:middle"></span><b>3-High</b></td><td style="padding:2px 4px;text-align:center">500–2,000</td><td style="padding:2px 4px;text-align:center">1.5–2.5 m</td><td style="padding:2px 5px;color:#555">Pump/hose or air support</td></tr>
      <tr style="background:#f7f8f9"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f5c518;border:1px solid #000;margin-right:3px;vertical-align:middle"></span><b>4-VH</b></td><td style="padding:2px 4px;text-align:center">2,000–4,000</td><td style="padding:2px 4px;text-align:center">2.5–3.5 m</td><td style="padding:2px 5px;color:#555">Indirect — air on head still effective</td></tr>
      <tr style="background:#fff"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#e07820;border:1px solid #000;margin-right:3px;vertical-align:middle"></span><b>5-Ext</b></td><td style="padding:2px 4px;text-align:center">4,000–10,000</td><td style="padding:2px 4px;text-align:center">3.5–5.5 m</td><td style="padding:2px 5px;color:#555">Indirect — suppress flanks; coordinate air</td></tr>
      <tr style="background:#f7f8f9"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#cc2200;border:1px solid #000;margin-right:3px;vertical-align:middle"></span><b>6-Cat</b></td><td style="padding:2px 4px;text-align:center">&gt; 10,000</td><td style="padding:2px 4px;text-align:center">&gt; 5.5 m</td><td style="padding:2px 5px;color:#555">Air attack fails on head — evacuate</td></tr>
    </tbody>
  </table>
</div>

<!-- 3-column station grid: populated dynamically from map extent -->
<div id="station-grid" class="station-grid"></div>

<div id="zone-bar" class="zone-bar"></div>
<div class="sign-row">
  <div>Prepared by: <span class="sign-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div>
  <div>Position/ICS Title: <span class="sign-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div>
  <div>Date/Time: <span class="sign-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div>
</div>
<button class="no-print" onclick="window.print()" style="margin-top:8px;padding:6px 18px;cursor:pointer;font-size:9pt">Print / Save PDF</button>

</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('Pop-up blocked — please allow pop-ups for this site.'); return; }
  win.document.write(html);
  win.document.close();
  // Print triggered inside the popup after Leaflet tiles load
}

/**
 * Print Station Briefing — portrait A4/Letter, ICS-formatted.
 * Uses _lastFWI, _lastWeather, _lastVWCalc, _forecastCache.
 */
async function printStationBriefing() {
  if (!_lastFWI) { alert('Load a station first.'); return; }

  // Fetch forecast on-demand if not yet loaded (user printing from station detail without visiting forecast page)
  if (_forecastCache.results.length === 0) {
    try {
      const { days } = await fetchForecastDays(_stationLat, _stationLng);
      const chainStart = (_lastFWI?.ffmc != null) ? {
        ffmc: _lastFWI.ffmc,
        dmc:  _lastFWI.dmc,
        dc:   applyDCFloor(_lastFWI.dc ?? getStartupDC(_stationName), _stationLat, _stationLng).dc,
        obsDate: _lastFWI._obsDate ?? null,
      } : null;
      const printFuelCode = (typeof document !== 'undefined' && document.getElementById('fwi-fuel-picker')?.value) || PROVINCE.fuelDefaults.a;
      const printCuring = _savedCuring ? _savedCuring() : 100;
      const printPS = _savedPS ? _savedPS() : 50;
      const results = calcMultiDayFBP(days, getStartupDC(_stationName), chainStart, printFuelCode, printCuring, printPS);
      _forecastCache = { days, results, fuelCode: printFuelCode, curing: printCuring, ps: printPS, lat: _stationLat, lng: _stationLng };
    } catch (e) {
      console.warn('[FWI] printStationBriefing: forecast fetch failed', e);
    }
  }

  const r = _lastFWI;
  const w = _lastWeather || r.weather;
  const now   = new Date();
  const today = now.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const prepared = now.toLocaleString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });

  const stationDisplayName = _stationName || PROVINCE.stationFallbackName;
  const lat = _stationLat;
  const lng = _stationLng;
  const fuelCode = (typeof document !== 'undefined' && document.getElementById('fwi-fuel-picker')?.value) || 'C2';
  const fuelName = FUEL_TYPES[fuelCode]?.name || fuelCode;
  const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const fmc = calcFMC(lat, lng, doy, _stationElev ?? 0);

  // FBP prediction
  const fbp = calculateFBP(fuelCode, r.ffmc, r.dmc, r.dc, w?.wind || 0, 0);

  // DC source
  const dcSource = w?.fwiFromCWFIS ? 'CWFIS carry-over' : 'Regional estimate';

  // Danger colour for print
  const PRINT_BG = PRINT_DANGER_COLORS;
  const dc = PRINT_BG[r.danger] || PRINT_BG['Moderate'];

  // Province danger class helper (PROVINCE.dangerClassNum) — inline badge HTML
  // (abbreviated labels for table fit)
  const classBadge = (fwi) => {
    const cl = PROVINCE.dangerClassNum(fwi);
    const short = cl.label === 'Moderate' ? 'Mod' : cl.label === 'Very High' ? 'V. High' : cl.label;
    return `<span style="display:inline-block;min-width:22px;padding:1px 6px;border-radius:3px;background:${cl.bg};color:${cl.text};font-size:9pt;font-weight:900;text-align:center">${cl.num}</span> ${short}`;
  };
  // HFI class badge — number + plain-language label + operational descriptor
  const hfiBadge = (hfi) => {
    const cl = hfiClassInfo(hfi);
    return `<span style="display:inline-block;min-width:22px;padding:1px 6px;border-radius:3px;background:${cl.bg};color:${cl.text};font-size:9pt;font-weight:900;text-align:center">${cl.num}</span> <strong>${cl.label}</strong> <span style="font-size:8pt;font-weight:400">${cl.desc}</span>`;
  };

  // Source label
  const srcLabel = (w?.stationName && (w?.source || '').startsWith('CWFIS'))
    ? `CWFIS · ${w.stationName}` : (w?.source || 'Open-Meteo NWP');

  // Forecast source label — NAEFS days carry a stationName; Open-Meteo/ECMWF days do not
  const { days: fDays, results: fResults } = _forecastCache;
  const fSrcLabel = fDays[0]?.stationName ? 'NAEFS CDA' : 'ECMWF IFS 0.25° · Open-Meteo';
  let forecastRows = '';
  if (fResults.length > 0) {
    const _todayLocal    = _localDateStr();
    const _tomorrowLocal = _localDateStr(Date.now() + 86400000);
    forecastRows = fResults.map((fr, i) => {
      const fd  = fDays[i] || {};
      const fpw = fd.peak || fd; // peak (16:00) conditions for FBP
      const fdc = PRINT_BG[fr.danger] || PRINT_BG['Moderate'];
      const ffbp = fr.fbp;
      const hfiTxt = ffbp ? Math.round(ffbp.hfi).toLocaleString() : '—';
      const hfiClassTxt = !ffbp ? '—' : (() => { const cl = hfiClassInfo(ffbp.hfi); return `<span style="display:inline-block;min-width:20px;padding:1px 6px;border-radius:3px;background:${cl.bg};color:${cl.text};font-weight:900;font-size:9pt;text-align:center">${cl.num}</span>`; })();
      // Skip past days and tag TOMORROW by local date
      const dayLocal = fd._ts ? _localDateStr(fd._ts) : null;
      if (dayLocal && dayLocal < _todayLocal) return '';
      const isD1 = dayLocal === _tomorrowLocal;
      return `<tr style="background:${isD1 ? '#f0f4ff' : i % 2 === 0 ? '#fff' : '#f9f9f9'}">
        <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;font-weight:700">${fr.label || `D+${i+1}`}${isD1 ? ' <span style="font-size:7pt;color:#0066cc;font-weight:400">← TOMORROW</span>' : ''}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;text-align:center">${fpw.temp != null ? (+fpw.temp).toFixed(1) + '°C' : '—'}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;text-align:center">${fpw.rh != null ? Math.round(fpw.rh) + '%' : '—'}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;text-align:center;font-weight:700">${Math.round(fr.fwi)}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;text-align:center">${classBadge(fr.fwi)}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;text-align:center">${ffbp ? ffbp.ros.toFixed(1) : '—'}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;text-align:center">${hfiTxt}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;text-align:center">${hfiClassTxt}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;text-align:center;font-size:8pt">${ffbp ? ffbp.fireType : '—'}</td>
      </tr>`;
    }).join('\n');
  } else {
    forecastRows = `<tr><td colspan="9" style="padding:8px;text-align:center;color:#888">Forecast data not loaded — visit Forecast page first</td></tr>`;
  }

  // D+1 peak burn block — first day strictly after today by local date
  // (not the viewer's local midnight).
  const _pTodayLocal = _localDateStr();
  const _pd1Idx = fDays.findIndex(d => d._ts && _localDateStr(d._ts) > _pTodayLocal);
  const _pd1Safe   = _pd1Idx >= 0 ? _pd1Idx : 0;
  const d1r  = fResults[_pd1Safe];
  const d1d  = fDays[_pd1Safe];
  const d1pw = d1d?.peak || d1d || {};
  const d1fbp = d1r?.fbp;
  const tomorrowDate = d1r?.label || 'D+1';
  const d1HfiRating = !d1fbp ? '—' : d1fbp.hfi >= 4000 ? 'EXTREME' : d1fbp.hfi >= 2000 ? 'VERY HIGH' : d1fbp.hfi >= 500 ? 'HIGH' : 'LOW';
  const d1HfiColor  = !d1fbp ? '#333' : d1fbp.hfi >= 10000 ? '#cc2200' : d1fbp.hfi >= 4000 ? '#c05000' : d1fbp.hfi >= 2000 ? '#a07800' : d1fbp.hfi >= 500 ? '#1e6b35' : d1fbp.hfi >= 10 ? '#1a6a8a' : '#1a3a7a';
  const d1EscapeNote = d1fbp && d1fbp.hfi >= 4000
    ? `<p style="margin:8px 0 0;padding:6px 10px;background:#f8d7da;border-left:4px solid #c0392b;color:#721c24;font-weight:700;font-size:9pt">⚠ D+1 HFI ≥ 4,000 kW/m — potential for escaped fire tomorrow during peak burn period</p>` : '';
  const d1Section = d1r ? `
<div class="section">
  <div class="section-title" style="background:#1a3a5c">Next Operational Period · ${tomorrowDate} · Predicted Peak Burn (~16:00 ${PROVINCE.tzLabel}) &nbsp;·&nbsp; ${fuelCode} — ${fuelName}</div>
  <div class="section-body">
    <div class="grid-2">
      <p class="kv"><span class="label">Weather (~16:00 ${PROVINCE.tzLabel})</span><br><span class="val">${(+d1pw.temp||0).toFixed(1)}°C / ${Math.round(d1pw.rh||0)}% RH / ${Math.round(d1pw.wind||0)} km/h</span></p>
      <p class="kv"><span class="label">FWI</span><br><span class="val" style="color:${d1HfiColor}">${Math.round(d1r.fwi)} — ${d1r.danger}</span></p>
      <p class="kv"><span class="label">Head ROS</span><br><span class="val">${d1fbp ? d1fbp.ros.toFixed(1) + ' m/min' : '—'}</span></p>
      <p class="kv"><span class="label">Head Fire Intensity</span><br><span class="val" style="color:${d1HfiColor}">${d1fbp ? Math.round(d1fbp.hfi).toLocaleString('en-CA') + ' kW/m' : '—'}</span></p>
      <p class="kv"><span class="label">Flame Length</span><br><span class="val">${d1fbp ? d1fbp.flameLength.toFixed(1) + ' m' : '—'}</span></p>
      <p class="kv"><span class="label">Fire Type / CFB</span><br><span class="val">${d1fbp ? d1fbp.fireType + ' / ' + (d1fbp.cfb*100).toFixed(0) + '%' : '—'}</span></p>
    </div>
    ${d1fbp ? `<div style="margin-top:6px;padding:5px 8px;border-left:4px solid #1a3a5c;background:#f0f4ff"><span style="font-size:8pt;color:#555;text-transform:uppercase;letter-spacing:0.04em">FBP System HFI Class &nbsp;</span>${hfiBadge(d1fbp.hfi)}</div>` : ''}
    ${d1EscapeNote}
    <p style="font-size:7.5pt;color:#888;margin-top:4px">FWI chain: hour 12 (noon LST) · FBP peak: hour 16 (16:00 ${PROVINCE.tzLabel}) · ${fSrcLabel} · Forecast valid: ${tomorrowDate} · Prepared: ${prepared}</p>
  </div>
</div>` : '';

  // Escaped fire note
  const escapedNote = fbp && fbp.hfi >= 4000
    ? `<p style="margin:8px 0 0;padding:6px 10px;background:#f8d7da;border-left:4px solid #c0392b;color:#721c24;font-weight:700;font-size:9pt">⚠ HFI ≥ 4,000 kW/m — potential for escaped fire / extreme fire behaviour</p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Fire Weather — Station Briefing · ${stationDisplayName}</title>
<style>
  @media print {
    @page { size: portrait; margin: 1.5cm; }
    body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; }
    .no-print { display: none; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; margin: 0; padding: 14px; max-width: 720px; }
  .header-box { border: 2px solid #333; padding: 10px 14px; margin-bottom: 10px; }
  .header-title { font-size: 14pt; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; margin: 0 0 4px; }
  .header-meta { font-size: 9pt; color: #444; margin: 0; line-height: 1.5; }
  .section { border: 1px solid #ccc; margin-bottom: 8px; }
  .section-title { background: #333; color: #fff; padding: 5px 10px; font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
  .section-body { padding: 8px 10px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px 16px; }
  .kv { margin: 0; }
  .kv .label { font-size: 8pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
  .kv .val { font-size: 12pt; font-weight: 700; }
  .danger-badge { display: inline-block; padding: 6px 16px; border-radius: 4px; font-size: 16pt; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; margin-top: 6px; }
  .fwi-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
  .fwi-cell { text-align: center; background: #f5f5f5; padding: 6px 4px; border-radius: 3px; }
  .fwi-cell .label { font-size: 7.5pt; color: #555; text-transform: uppercase; letter-spacing: 0.04em; }
  .fwi-cell .val { font-size: 13pt; font-weight: 700; margin-top: 2px; }
  .sign-block { display: flex; gap: 32px; margin-top: 8px; padding-top: 8px; border-top: 1px solid #ccc; font-size: 9pt; }
  .sign-line { border-bottom: 1px solid #333; min-width: 140px; display: inline-block; }
  table { border-collapse: collapse; width: 100%; font-size: 9pt; }
  th { background: #444; color: #fff; padding: 4px 6px; text-align: center; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.04em; }
  th:first-child { text-align: left; }
</style>
</head>
<body>
<div class="header-box">
  <p class="header-title">Fire Weather — Station Briefing</p>
  <p class="header-meta">
    Station: <strong>${stationDisplayName}</strong> &nbsp;·&nbsp; ${Math.abs(lat).toFixed(4)}°N ${Math.abs(lng).toFixed(4)}°W<br>
    Operational Period: ${today} 0600–1800 ${PROVINCE.tzLabel}<br>
    Prepared: ${prepared} &nbsp;·&nbsp; Source: ${srcLabel}
  </p>
</div>

<div class="section">
  <div class="section-title">Current Conditions</div>
  <div class="section-body">
    <div class="grid-3">
      <p class="kv"><span class="label">Temp</span><br><span class="val">${w?.temp != null ? (+w.temp).toFixed(1) + '°C' : '—'}</span></p>
      <p class="kv"><span class="label">Rel. Humidity</span><br><span class="val">${w?.rh != null ? Math.round(w.rh) + '%' : '—'}</span></p>
      <p class="kv"><span class="label">Wind</span><br><span class="val">${w?.wind != null ? Math.round(w.wind) + ' km/h' : '—'}${w?.wdir != null ? ' ' + compassDir(w.wdir) : ''}</span></p>
    </div>
    <div style="margin-top:6px">
      <span style="font-size:9pt">Rain: <strong>${w?.rain != null ? (+w.rain).toFixed(1) + ' mm' : '—'}</strong></span>
      &nbsp;&nbsp;
      <span style="font-size:9pt">DC Source: <strong>${dcSource}</strong></span>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">FWI System (Van Wagner CFFDRS)</div>
  <div class="section-body">
    <div class="fwi-grid">
      <div class="fwi-cell"><div class="label">FFMC</div><div class="val">${r.ffmc.toFixed(1)}</div></div>
      <div class="fwi-cell"><div class="label">DMC</div><div class="val">${r.dmc.toFixed(1)}</div></div>
      <div class="fwi-cell"><div class="label">DC</div><div class="val">${r.dc.toFixed(0)}</div></div>
      <div class="fwi-cell"><div class="label">ISI</div><div class="val">${r.isi.toFixed(1)}</div></div>
      <div class="fwi-cell"><div class="label">BUI</div><div class="val">${r.bui.toFixed(0)}</div></div>
      <div class="fwi-cell"><div class="label">FWI</div><div class="val" style="font-size:16pt">${r.fwi.toFixed(1)}</div></div>
    </div>
    <div>
      <span class="danger-badge" style="background:${dc.bg};color:${dc.text}">${r.danger} Risk</span>
    </div>
  </div>
</div>

<p style="font-size:8pt;color:#444;margin:0 0 6px;padding:5px 10px;background:#f0f0f0;border-left:3px solid #888;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">Fuel Model: ${fuelCode} — ${fuelName} &nbsp;·&nbsp; FBP ST-X-3 &nbsp;·&nbsp; FMC: ${fmc.toFixed(0)}% (seasonal · DOY ${doy})${(fuelCode==='O1a'||fuelCode==='O1b') ? ` &nbsp;·&nbsp; Curing: ${_savedCuring()}% (CF=${(_savedCuring() < 58.8 ? 0.005*(Math.exp(0.061*_savedCuring())-1) : 0.176+0.02*(_savedCuring()-58.8)).toFixed(3)})` : ''}</p>

<div class="section">
  <div class="section-title">Current Fire Behaviour · ${fuelCode} — ${fuelName} · Today · ${today}</div>
  <div class="section-body">
    <div class="grid-2">
      <p class="kv"><span class="label">Weather (Noon LST)</span><br><span class="val">${w?.temp != null ? (+w.temp).toFixed(1) : '—'}°C / ${Math.round(w?.rh??0)}% RH / ${Math.round(w?.wind??0)} km/h</span></p>
      <p class="kv"><span class="label">FWI</span><br><span class="val">${Math.round(r.fwi)} — ${r.danger}</span></p>
      <p class="kv"><span class="label">Head ROS</span><br><span class="val">${fbp ? fbp.ros.toFixed(1) + ' m/min' : '—'}</span></p>
      <p class="kv"><span class="label">Head Fire Intensity</span><br><span class="val">${fbp ? Math.round(fbp.hfi).toLocaleString('en-CA') + ' kW/m' : '—'}</span></p>
      <p class="kv"><span class="label">Flame Length</span><br><span class="val">${fbp ? fbp.flameLength.toFixed(1) + ' m' : '—'}</span></p>
      <p class="kv"><span class="label">Fire Type / CFB</span><br><span class="val">${fbp ? fbp.fireType + ' / ' + (fbp.cfb*100).toFixed(0) + '%' : '—'}</span></p>
    </div>
    ${fbp ? `<div style="margin-top:6px;padding:5px 8px;border-left:4px solid ${hfiClassInfo(fbp.hfi).bg};background:#fafafa"><span style="font-size:8pt;color:#555;text-transform:uppercase;letter-spacing:0.04em">FBP System HFI Class &nbsp;</span>${hfiBadge(fbp.hfi)}</div>` : ''}
    ${escapedNote}
    <p style="font-size:7.5pt;color:#888;margin-top:4px">Observed: 12:00 noon LST (CFFDRS standard) · ${srcLabel} · Prepared: ${prepared}</p>
  </div>
</div>

${d1Section}

<div class="section">
  <div class="section-title">Forecast Outlook — Fire Behaviour by Day · ${fuelCode} — ${fuelName} · Peak ~16:00 ${PROVINCE.tzLabel}</div>
  <div class="section-body" style="padding:0">
    <table>
      <thead>
        <tr>
          <th style="text-align:left">Day</th>
          <th>Temp</th>
          <th>RH</th>
          <th>FWI</th>
          <th>Rating</th>
          <th>ROS m/min</th>
          <th>HFI kW/m</th>
          <th>HFI Class</th>
          <th>Fire Type</th>
        </tr>
      </thead>
      <tbody>
        ${forecastRows}
      </tbody>
    </table>
  </div>
</div>

<div style="border:1px solid #ccc;margin-bottom:8px;page-break-inside:avoid">
  <div style="background:#444;color:#fff;padding:4px 10px;font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em">FBP System HFI Class — Intensity Class Legend</div>
  <table style="width:100%;border-collapse:collapse;font-size:8.5pt">
    <thead>
      <tr style="background:#f0f0f0">
        <th style="padding:4px 8px;text-align:center;font-size:7.5pt;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #ccc;width:52px">Class</th>
        <th style="padding:4px 8px;text-align:left;font-size:7.5pt;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #ccc;width:140px">kW/m Range</th>
        <th style="padding:4px 8px;text-align:left;font-size:7.5pt;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #ccc">Operational Meaning</th>
      </tr>
    </thead>
    <tbody>
      ${[{n:1,r:'< 10',          h:5},
         {n:2,r:'10 – 500',      h:200},
         {n:3,r:'500 – 2,000',   h:1000},
         {n:4,r:'2,000 – 4,000', h:3000},
         {n:5,r:'4,000 – 10,000',h:6000},
         {n:6,r:'10,000+',       h:20000}]
        .map(c => { const ci = hfiClassInfo(c.h); return { ...c, d: `${ci.label} — ${ci.size} · ${ci.desc}` }; })
        .map((c,i)=>`<tr style="background:${i%2===0?'#fff':'#fafafa'}">
          <td style="padding:4px 8px;text-align:center;border-bottom:1px solid #eee"><span style="display:inline-block;min-width:24px;padding:2px 6px;border-radius:3px;${hfiChipStyle(c.n)};font-weight:900;font-size:9.5pt;text-align:center">${c.n}</span></td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;font-weight:600">${c.r} kW/m</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee">${c.d}</td>
        </tr>`).join('')}
    </tbody>
  </table>
</div>

<div class="sign-block">
  <div>Prepared by: <span class="sign-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div>
  <div>Position: <span class="sign-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div>
  <div>Date/Time: <span class="sign-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div>
</div>
<button class="no-print" onclick="window.print()" style="margin-top:10px;padding:8px 20px;cursor:pointer">Print / Save PDF</button>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('Pop-up blocked — please allow pop-ups for this site.'); return; }
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

// ─── Live Station Map (Leaflet) ───────────────────────────────────────────────

// Marker fills come from DANGER_TOKENS (solid) — kept as a lookup for callers.
const MARKER_COLORS = Object.fromEntries(Object.entries(DANGER_TOKENS).map(([k, t]) => [k, t.solid]));

/**
 * Build a Leaflet map with CartoDB Voyager tiles.
 * Custom divIcon markers show FWI value + HFI class text, coloured by danger.
 * Active fires and hotspot overlay toggles preserved.
 */
async function buildStationMap(containerId, mapOpts = {}) {
  const container = document.getElementById(containerId);
  if (!container || typeof L === 'undefined') return;
  _mapStationCache = [];

  // Pre-load yesterday's CWFIS carry-over values for Van Wagner accuracy
  if (!_cwfisPrev.stations) await loadCWFISPrev();

  // Zoom-responsive pill sizes: sm=provincial, md=regional, lg=municipal
  const PILL_SIZES = {
    sm: { w:46, h:30, r:15, lbl:6,  fv:11, hn:11, hw:0  },
    md: { w:60, h:40, r:20, lbl:7,  fv:13, hn:12, hw:6.5},
    lg: { w:72, h:48, r:24, lbl:8,  fv:15, hn:14, hw:7.5},
  };
  function _zoomScale(zoom) { return zoom <= 5 ? 'sm' : zoom <= 7 ? 'md' : 'lg'; }

  // Bicolor pill: left half = FWI danger (DANGER_TOKENS), right half = HFI class
  // (card palette HFI_STYLE, safe text; classes 5/6 add a hatch + black outline
  // so they never rely on colour alone). Shape encodes the source tier:
  // square = agency chain (CWFIS/BCWS), rounded = SWOB sensor, pill = model.
  function _makeIcon(danger, fwiVal, hfiCls, scale, srcType) {
    const [hfiNum, hfiWord] = (hfiCls || '—').split('-');
    const hn = _hfiNumOf(hfiCls);
    const hs = HFI_STYLE[hn] || { fill: '#d1d5db', text: '#0b1326', pattern: '' };
    const dt = _dangerTok(danger);
    const sz = PILL_SIZES[scale] || PILL_SIZES.md;
    const half = Math.floor(sz.w / 2);
    const br = (srcType === 'CWFIS' || srcType === 'CWFIS D-1' || srcType === 'BCWS') ? 3 : srcType === 'SWOB' ? 8 : sz.r;
    const ring = hn >= 6 ? '0 0 0 2.5px #000,0 0 0 4px #fff' : hn === 5 ? '0 0 0 2px #2a1a00' : '0 0 0 1.5px rgba(0,0,0,0.25)';
    const hfiBg = hs.pattern ? `${hs.pattern},${hs.fill}` : hs.fill;
    return L.divIcon({
      className: '',
      html: `<div role="img" aria-label="FWI ${fwiVal} ${danger || ''}, HFI class ${hfiCls || 'unknown'}" style="width:${sz.w}px;height:${sz.h}px;border-radius:${br}px;overflow:hidden;display:flex;` +
            `box-shadow:0 2px 8px rgba(0,0,0,0.4),${ring};` +
            `font-family:'Space Grotesk',sans-serif;cursor:pointer">` +
            `<div style="width:${half}px;height:100%;background:${dt.solid};color:${dt.on};display:flex;flex-direction:column;` +
            `align-items:center;justify-content:center;gap:1px">` +
            `<span style="font-size:${sz.lbl}px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;line-height:1">FWI</span>` +
            `<span style="font-size:${sz.fv}px;font-weight:800;letter-spacing:-.03em;line-height:1">${fwiVal}</span>` +
            `</div>` +
            `<div style="width:1px;background:rgba(0,0,0,0.25);flex-shrink:0"></div>` +
            `<div style="width:${sz.w - half - 1}px;height:100%;background:${hfiBg};color:${hs.text};display:flex;flex-direction:column;` +
            `align-items:center;justify-content:center;gap:1px">` +
            `<span style="font-size:${sz.lbl}px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;line-height:1">HFI</span>` +
            `<span style="font-size:${sz.hn}px;font-weight:900;line-height:1">${hfiNum || '—'}</span>` +
            (sz.hw ? `<span style="font-size:${sz.hw}px;font-weight:700;line-height:1">${hfiWord || ''}</span>` : '') +
            `</div>` +
            `</div>`,
      iconSize: [sz.w, sz.h], iconAnchor: [sz.w/2, sz.h/2], popupAnchor: [0, -(sz.h/2 + 4)],
    });
  }

  function _makeLoadingIcon(scale) {
    const sz = PILL_SIZES[scale] || PILL_SIZES.md;
    return L.divIcon({
      className: '',
      html: `<div style="width:${sz.w}px;height:${sz.h}px;border-radius:${sz.r}px;background:#374151;display:flex;` +
            `align-items:center;justify-content:center;` +
            `box-shadow:0 2px 8px rgba(0,0,0,0.3);font-size:${sz.lbl+2}px;color:#6b7280">…</div>`,
      iconSize: [sz.w, sz.h], iconAnchor: [sz.w/2, sz.h/2], popupAnchor: [0, -(sz.h/2 + 4)],
    });
  }

  // Initialise Leaflet map — CartoDB Voyager tiles (clean, no API key)
  const map = L.map(containerId, {
    center: mapOpts.center || PROVINCE.mapCenter,
    zoom:   mapOpts.zoom   || 5,
    zoomControl: true, attributionControl: true,
  });
  // CARTO basemaps now require an API key — Esri Light Gray Canvas is keyless.
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community',
    maxNativeZoom: 16, maxZoom: 19,
  }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 16, maxZoom: 19,
  }).addTo(map);

  // MarkerCluster group — separates overlapping stations at low zoom
  const clusterGroup = L.markerClusterGroup
    ? L.markerClusterGroup({
        maxClusterRadius: 20,
        disableClusteringAtZoom: 7,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        iconCreateFunction(cluster) {
          const n = cluster.getChildCount();
          return L.divIcon({
            className: '',
            html: `<div style="width:36px;height:36px;border-radius:50%;background:#1e3a8a;border:2px solid #7bd0ff;
                   display:flex;align-items:center;justify-content:center;
                   font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:700;color:#7bd0ff;
                   box-shadow:0 2px 8px rgba(0,0,0,0.5)">${n}</div>`,
            iconSize: [36, 36], iconAnchor: [18, 18],
          });
        },
      })
    : null;
  if (clusterGroup) map.addLayer(clusterGroup);

  // Place all loading markers immediately at nominal coords
  const markers = {};
  for (const s of getStationList()) {
    const m = L.marker([s.lat, s.lng], { icon: _makeLoadingIcon(_zoomScale(map.getZoom())) })
      .bindPopup(`<b style="font-family:'Space Grotesk',sans-serif">${s.name}</b><br><small style="color:#9ca3af">Loading…</small>`, { maxWidth: 260 });
    markers[s.name] = m;
    if (clusterGroup) clusterGroup.addLayer(m); else m.addTo(map);
  }

  // PROVINCE.mapBulkCWFIS: one province-wide CWFIS query, reused for all
  // stations — replaces ~200 sequential per-station tier chains (a minute+ of
  // serial network → seconds). Stations with no usable bulk match fall back
  // to the per-station tier chain (fetchWeatherPrimary).
  let allFeatures = null;
  if (PROVINCE.mapBulkCWFIS) {
    if (!_cwfisPrev.stations) await loadCWFISPrev();
    allFeatures = [];
    try { allFeatures = await PROVINCE.mapBulkCWFIS(); }
    catch (e) { console.warn('[FWI Map] province CWFIS query failed, falling back per-station', e); }
  }

  // Fetch data and update each marker as it arrives
  for (const s of getStationList()) {
    try {
      // PROVINCE.mapPick applies the province's tier rule to the bulk data
      // (BC: today-dated BCWS or CWFIS, nearest wins); default nearest CWFIS.
      let w = allFeatures
        ? await (PROVINCE.mapPick ? PROVINCE.mapPick(allFeatures, s.lat, s.lng) : _mapPickNearest(allFeatures, s.lat, s.lng))
        : null;
      // Fall back to the full per-station tier chain only when the province
      // query found nothing usable nearby (rare — off-season or sparse north).
      if (!w) w = await fetchWeatherPrimary(s.lat, s.lng);

      // Carry-over: use cached CWFIS prev-day values when Van Wagner is needed (SWOB/NWP tier)
      let prevFWI = { ffmc: STARTUP.ffmc, dmc: STARTUP.dmc, dc: getStartupDC(s.name) };
      let usedCachedPrev = false;
      let cachedPrevEntry = null;
      let coFinal = false;
      if (!w.fwiFromCWFIS) {
        // Same dated carry-over as station_detail: today's codes as-is, earlier stepped once
        const co = _carryOverFor(s.lat, s.lng, s.name);
        if (co) {
          prevFWI = { ffmc: co.ffmc, dmc: co.dmc, dc: co.dc };
          usedCachedPrev = true;
          cachedPrevEntry = { ...co, stationName: co.stationName || s.name };
          coFinal = co.final;
        }
      }
      const r = coFinal
        ? calculateFWI({ ...w, fwiFromCWFIS: true, ...prevFWI }, prevFWI)
        : calculateFWI(w, prevFWI);
      // Before noon LST the CWFIS layer still serves yesterday's chain — label it
      // as such instead of presenting it as today's (station_detail steps it forward).
      const cwfisPrevDay = w.fwiFromCWFIS && w.repDate && String(w.repDate).slice(0, 10) < _lstDateStr();
      const fuelCode = _seasonalFuel(PROVINCE.stationFuel(s.name, s.lat), s.lat);
      // FMC at this map station (its own lat/lng — previously the selected
      // station's — and the CWFIS station elevation when that station is ≤ 25 km away)
      const fbp      = calculateFBP(fuelCode, r.ffmc, r.dmc, r.dc, w.wind ?? 10, 0, _savedCuring(), 50,
        { lat: s.lat, lng: s.lng, elev: (w.distKm ?? 999) <= 25 ? (w.elev ?? 0) : 0 });
      // BCWS chains also set fwiFromCWFIS — check the chain's actual source first
      const chainSrc = w.chainSource || w.source || '';
      const srcBadge = chainSrc.startsWith('BCWS') ? 'BCWS'
                     : w.fwiFromCWFIS ? (cwfisPrevDay ? 'CWFIS D-1' : 'CWFIS')
                     : (w.source?.startsWith('MSC') ? 'SWOB' : 'NWP');

      // Use actual station coords from data response if available; otherwise keep nominal
      const stnLat = w.stationLat ?? s.lat;
      const stnLng = w.stationLng ?? s.lng;

      // Map marker moves to the sensor position, but the table row link must use
      // the NOMINAL picker coords (navLat/navLng) — station_detail resolves the
      // saved station by matching the station list within 0.01°, which the
      // CWFIS-corrected sensor coords would miss, landing on the wrong station.
      const prov = _provenance(w, usedCachedPrev ? cachedPrevEntry : null);
      _mapStationCache.push({ name: s.name, lat: stnLat, lng: stnLng, navLat: s.lat, navLng: s.lng, result: r, fbp, srcBadge, prov });
      _updateStationTableRow({ name: s.name, lat: stnLat, lng: stnLng, navLat: s.lat, navLng: s.lng, result: r, fbp, srcBadge, prov });

      // Move marker to actual station position.
      // markerClusterGroup requires remove→setLatLng→add to re-index spatial position.
      if (clusterGroup) {
        clusterGroup.removeLayer(markers[s.name]);
        markers[s.name].setLatLng([stnLat, stnLng]);
        clusterGroup.addLayer(markers[s.name]);
      } else {
        markers[s.name].setLatLng([stnLat, stnLng]);
      }

      const scale    = _zoomScale(map.getZoom());
      const hfiCls   = fbp ? _hfiClass(fbp.hfi) : '—';
      markers[s.name].setIcon(_makeIcon(r.danger, r.fwi.toFixed(1), hfiCls, scale, srcBadge));
      const dTok = _dangerTok(r.danger);

      // Popup — full station detail card
      const hfiNumStr  = fbp?.hfi != null ? Math.round(fbp.hfi).toLocaleString() + ' kW/m' : '—';
      const fwiMethod  = w.fwiFromCWFIS ? 'CWFIS carry-over' : 'Van Wagner calc';
      const coordStr   = `${Math.abs(stnLat).toFixed(4)}°${stnLat>=0?'N':'S'} ${Math.abs(stnLng).toFixed(4)}°${stnLng>=0?'E':'W'}`;
      const distNote   = w.distKm != null ? ` · ${w.distKm} km offset` : '';
      // Observation/report timestamp — use CWFIS repDate, SWOB obsTime, or current time for NWP
      const rawTs = w.repDate || w.obsTime || null;
      // CWFIS rep_date is a date stamp (T12:00Z), not a clock time
      const obsTs = w.repDate
        ? new Date(String(w.repDate).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' noon LST' + (cwfisPrevDay ? ' (previous day)' : '')
        : rawTs
        ? new Date(rawTs).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: PROVINCE.tzName }) + ` ${PROVINCE.tzLabel}`
        : new Date().toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: PROVINCE.tzName }) + ` ${PROVINCE.tzLabel} (calc)`;
      const sourceStnLine = w.stationName
        ? `<div style="font-size:11px;color:#475569;margin-bottom:1px">Data source: <strong>${w.stationName}</strong></div>`
        : '';
      markers[s.name].setPopupContent(
        `<div style="font-family:'Space Grotesk',sans-serif;min-width:220px">` +
        `<div style="font-size:13px;font-weight:700;color:#1e3a8a;margin-bottom:1px">${s.name}</div>` +
        sourceStnLine +
        `<div style="font-size:11px;color:#475569;font-family:monospace;margin-bottom:1px">${coordStr}</div>` +
        `<div style="margin:3px 0 4px"><span title="${_esc(prov.detail)}" style="display:inline-block;font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px;background:${prov.level === 'red' ? '#fee2e2' : prov.level === 'amber' ? '#fef3c7' : prov.level === 'ok' ? '#dcfce7' : '#f1f5f9'};color:${prov.level === 'red' ? '#7f1d1d' : prov.level === 'amber' ? '#78350f' : prov.level === 'ok' ? '#14532d' : '#334155'}">${prov.kind}${prov.age ? ' · ' + prov.age : ''}</span> <span style="font-size:11px;color:#475569">${prov.network}</span></div>` +
        `<div style="font-size:11px;color:#475569;margin-bottom:2px">${srcBadge}${distNote} · ${fuelCode} fuel · ${fwiMethod}</div>` +
        `<div style="font-size:11px;color:#475569;margin-bottom:${usedCachedPrev ? '2' : '6'}px">Obs: <strong>${obsTs}</strong></div>` +
        (usedCachedPrev ? (() => {
          const cp = cachedPrevEntry;
          const cdStr = cp.repDate
            ? new Date(String(cp.repDate).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }) // date stamp, not a clock time
            : 'prev day';
          return `<div style="font-size:11px;color:#475569;margin-bottom:6px">` +
                 `Carry-over: <strong>${cp.stationName || 'CWFIS'}</strong> · ${cdStr}</div>`;
        })() : '') +
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;font-size:11px;margin-bottom:6px">` +
        `<div><span style="color:#475569">FWI (noon LST)</span><br><strong style="color:#0f172a;font-size:17px">${r.fwi.toFixed(1)}</strong></div>` +
        `<div><span style="color:#475569">Danger</span><br><strong style="display:inline-block;padding:1px 6px;border-radius:4px;background:${dTok.solid};color:${dTok.on}">${r.danger}</strong></div>` +
        `<div><span style="color:#475569">HFI</span><br><span style="color:#1e293b">${hfiNumStr}</span></div>` +
        `<div><span style="color:#475569">HFI Class</span><br><strong style="display:inline-block;padding:1px 6px;border-radius:4px;${hfiChipStyle(_hfiNumOf(hfiCls))}">${hfiCls}</strong></div>` +
        `</div>` +
        `<div style="border-top:1px solid #e2e8f0;padding-top:5px;display:grid;grid-template-columns:1fr 1fr;gap:3px 14px;font-size:11px">` +
        `<div><span style="color:#475569">Temp</span> <span style="color:#1e293b">${fmt(w.temp)}°C</span></div>` +
        `<div><span style="color:#475569">RH</span> <span style="color:#1e293b">${fmt(w.rh,0)}%</span></div>` +
        `<div><span style="color:#475569">Wind</span> <span style="color:#1e293b">${fmt(w.wind,0)} km/h</span></div>` +
        `<div><span style="color:#475569">Rain</span> <span style="color:#1e293b">${fmt(w.rain)} mm</span></div>` +
        `<div><span style="color:#475569">FFMC</span> <span style="color:#1e293b">${r.ffmc?.toFixed(1) ?? '—'}</span></div>` +
        `<div><span style="color:#475569">DMC</span> <span style="color:#1e293b">${r.dmc?.toFixed(1) ?? '—'}</span></div>` +
        `<div><span style="color:#475569">DC</span> <span style="color:#1e293b">${r.dc?.toFixed(0) ?? '—'}</span></div>` +
        `<div><span style="color:#475569">BUI</span> <span style="color:#1e293b">${r.bui?.toFixed(1) ?? '—'}</span></div>` +
        `</div></div>`
      );
    } catch (e) {
      console.warn(`[FWI Map] ${s.name}:`, e);
      // Mark the row as errored instead of leaving an infinite loading shimmer
      {
        const tr = document.getElementById('srow-' + s.name.replace(/\s+/g, '-'));
        if (tr) {
          tr.dataset.state = 'error';
          tr.innerHTML =
            `<td class="py-2 pl-3 pr-2 font-semibold text-xs">${s.name}</td>` +
            `<td class="py-2 pr-2 text-slate-400 text-[11px]">${stationSector(s.lat, s.lng)}</td>` +
            `<td colspan="7" class="py-2 pr-3 text-[11px] text-slate-400"><span class="pyra-chip" style="${PROV_LEVEL_STYLE.neutral}">No data</span><span class="ml-2">data unavailable from every source</span></td>`;
        }
        markers[s.name]?.setPopupContent(`<b>${s.name}</b><br><small style="color:#9ca3af">Data unavailable</small>`);
      }
    }
  }

  // Any table row the loop never reached gets an explicit grey "No data" state
  _markUnloadedRows(true);

  // Final sweep — ensure all markers reflect current zoom after async loading completes
  {
    const finalScale = _zoomScale(map.getZoom());
    for (const entry of _mapStationCache) {
      if (!entry.result) continue;
      const hfiCls   = entry.fbp ? _hfiClass(entry.fbp.hfi) : '—';
      markers[entry.name]?.setIcon(_makeIcon(entry.result.danger, entry.result.fwi.toFixed(1), hfiCls, finalScale, entry.srcBadge));
    }
  }

  // Rescale all loaded markers on zoom change
  map.on('zoomend', () => {
    const scale = _zoomScale(map.getZoom());
    for (const entry of _mapStationCache) {
      if (!entry.result) continue;
      const hfiCls   = entry.fbp ? _hfiClass(entry.fbp.hfi) : '—';
      markers[entry.name]?.setIcon(_makeIcon(entry.result.danger, entry.result.fwi.toFixed(1), hfiCls, scale, entry.srcBadge));
    }
  });

  // Active fires layer
  const activeFiresLayer = L.layerGroup();
  fetchActiveFires().then(fires => {
    fires.forEach(f => {
      const ha = f.hectares || 1;
      const r  = Math.max(4, Math.min(12, Math.sqrt(ha) * 0.25));
      L.circleMarker([f.lat, f.lon], { radius: r, fillColor: '#ff3333', color: '#ff8888', weight: 1.5, fillOpacity: 0.5 })
        .bindPopup(`<b>${_esc(f.firename || 'Active Fire')}</b><br>${ha >= 1 ? ha.toLocaleString('en-CA',{maximumFractionDigits:0}) + ' ha' : '&lt; 1 ha'}<br><small>${_esc(f.stage_of_control || '')} · ${_esc(f.agency?.toUpperCase() || '')}</small>`)
        .addTo(activeFiresLayer);
    });
  }).catch(e => console.warn('[FWI Map] active fires layer failed:', e));

  // Hotspots layer
  const hotspotsLayer = L.layerGroup();
  fetchHotspots().then(spots => {
    spots.forEach(h => {
      const hfiTip = h.hfi != null ? `<br>HFI: ${Math.round(h.hfi).toLocaleString()} kW/m` : '';
      L.circleMarker([h.lat, h.lon], { radius: 4, fillColor: '#ff8c00', color: '#ffaa44', weight: 1, fillOpacity: 0.8 })
        .bindPopup(`<b>Satellite Hotspot</b><br><small>${_esc(h.satellite || h.sensor || '')}</small>${hfiTip}`)
        .addTo(hotspotsLayer);
    });
  }).catch(e => console.warn('[FWI Map] hotspots layer failed:', e));

  // Toggle buttons
  const setupToggle = (btnId, layer) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (map.hasLayer(layer)) { map.removeLayer(layer); btn.classList.remove('map-layer-active'); }
      else { map.addLayer(layer); btn.classList.add('map-layer-active'); }
    });
  };
  setupToggle('btn-activefires', activeFiresLayer);
  setupToggle('btn-hotspots',    hotspotsLayer);
}

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

function renderSCRIBE(scribe) {
  const el = document.getElementById('fwi-scribe-section');
  if (!el) return;
  if (!scribe || !scribe.records.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  const nameEl = document.getElementById('fwi-scribe-station');
  if (nameEl) nameEl.textContent = `${scribe.name} · ${scribe.distKm} km`;
  const grid = document.getElementById('fwi-scribe-grid');
  if (!grid) return;
  grid.innerHTML = scribe.records.map(r => {
    const dt = new Date(r.rep_date);
    const label = dt.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
    const danger = dangerRatingProv(r.fwi);
    return `<div class="bg-surface-container-lowest rounded-lg p-4">
      <p class="text-[11px] font-label uppercase tracking-wider text-slate-300 mb-1">NRCan SCRIBE forecast · valid noon LST ${label}</p>
      <p class="font-headline text-2xl font-bold text-white">${r.fwi.toFixed(1)}</p>
      <span class="pyra-chip text-[11px] font-bold" style="${dangerChipStyle(danger)}">${danger}</span>
      <div class="grid grid-cols-2 gap-x-3 mt-2 text-xs text-on-surface-variant">
        <span>FFMC ${r.ffmc?.toFixed(1) ?? '—'}</span><span>DC ${r.dc?.toFixed(0) ?? '—'}</span>
        <span>ISI ${r.isi?.toFixed(1) ?? '—'}</span><span>BUI ${r.bui?.toFixed(0) ?? '—'}</span>
      </div>
    </div>`;
  }).join('');
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

/** Populate the D+1 Tomorrow card on station_detail. Called from initFWI after _lastFWI is set. */
async function buildD1Card() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('fwi-d1-preview-date', 'Loading…');
  const gen = _initGeneration; // discard the result if the station changes mid-fetch

  let days, results, resultsB;
  try {
    const fuelCode  = _savedFuelCode();
    const fuelCodeB = _savedFuelCode2();
    const curing    = _savedCuring();
    const ps        = _savedPS();
    // The cache only hits for the station it was built for
    const sameStation = _forecastCache.lat === _stationLat && _forecastCache.lng === _stationLng;
    const cacheHit  = _forecastCache.results?.length && sameStation &&
                      _forecastCache.fuelCode  === fuelCode  &&
                      _forecastCache.fuelCodeB === fuelCodeB &&
                      _forecastCache.curing    === curing    &&
                      _forecastCache.ps        === ps;
    if (cacheHit) {
      ({ days, results, resultsB } = _forecastCache);
    } else {
      if (!(_forecastCache.days?.length && sameStation)) {
        ({ days } = await fetchForecastDays(_stationLat, _stationLng));
      } else {
        days = _forecastCache.days; // reuse weather; only recalc FBP
      }
      if (!days?.length) throw new Error('[D+1] Forecast fetch returned no days');
      // Only carry the chain if we have a real FFMC — null coerces to 0, giving
      // artificially low forecast fire behaviour (same root cause as wireFBP bug).
      const chainStart = (_lastFWI?.ffmc != null) ? {
        ffmc: _lastFWI.ffmc,
        dmc:  _lastFWI.dmc,
        dc:   applyDCFloor(_lastFWI.dc ?? getStartupDC(_stationName), _stationLat, _stationLng).dc,
        obsDate: _lastFWI._obsDate ?? null,
      } : null;
      const startupDC  = getStartupDC(_stationName);
      results  = calcMultiDayFBP(days, startupDC, chainStart, fuelCode,  curing, ps);
      resultsB = calcMultiDayFBP(days, startupDC, chainStart, fuelCodeB, curing, ps);
      _forecastCache = { days, results, resultsB, fuelCode, fuelCodeB, curing, ps, lat: _stationLat, lng: _stationLng };
    }
  } catch(e) {
    console.error('[D+1] Forecast fetch failed:', e);
    set('fwi-d1-preview-date', 'Unavailable');
    set('fwi-d1-preview-fwi-score', '—');
    set('fwi-d1-preview-danger', 'Forecast unavailable — tap to retry');
    const card = document.getElementById('fwi-d1-card');
    if (card) { card.style.cursor = 'pointer'; card.onclick = () => { _forecastCache = { days: [], results: [], resultsB: [] }; buildD1Card(); }; }
    return;
  }

  if (gen !== _initGeneration) return;
  // Find today and tomorrow indices using local daylight-time dates
  const _nowLocal   = _localDateStr();
  const todayIdx    = days.findIndex(d => d._ts && _localDateStr(d._ts) === _nowLocal);
  const tomorrowIdx = days.findIndex(d => d._ts && _localDateStr(d._ts) > _nowLocal);

  // Populate LEFT card (today peak burn).
  // Weather display uses _lastWeather (from fetchWeatherPrimary) — already the peak
  // burn forecast when pre-noon, or real obs when post-noon. NAEFS/forecast peak
  // values are NOT used for display because NAEFS uses daily max-T (biased high)
  // and its date_time is UTC-keyed, making it unreliable for same-day display.
  if (todayIdx >= 0) {
    const t0pw = _lastWeather || days[todayIdx]?.peak || days[todayIdx] || {};
    const setW = (attr, val) => { const el = document.querySelector(`[data-fwi="${attr}"]`); if (el) el.textContent = val; };
    setW('temp', `${(+(t0pw.temp)||0).toFixed(1)}°C`);
    setW('rh',   `${Math.round(+(t0pw.rh)||0)}%`);
    setW('wind', `${Math.round(+(t0pw.wind)||0)} km/h`);
    setW('wdir', t0pw.wdir != null ? windCompass(t0pw.wdir) : '—');
    setW('rain', '—');

    const setEl2 = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const fuelA0 = _savedFuelCode();
    const fuelB0 = _savedFuelCode2();
    setEl2('fwi-fbp-fuel-name-a', FUEL_TYPES[fuelA0]?.name || fuelA0);
    setEl2('fwi-fbp-fuel-name-b', FUEL_TYPES[fuelB0]?.name || fuelB0);

    const populateTodaySection = (suffix, r) => {
      const fbp = r?.fbp;
      if (!fbp) { setEl2('fwi-fbp-hfi-label' + suffix, 'N/A'); return; }
      const cl = hfiClassInfo(fbp.hfi);
      const numEl = document.getElementById('fwi-fbp-hfi-rating' + suffix);
      const lblEl = document.getElementById('fwi-fbp-hfi-label'  + suffix);
      const szEl  = document.getElementById('fwi-fbp-hfi-size'   + suffix);
      const dscEl = document.getElementById('fwi-fbp-hfi-desc'   + suffix);
      if (numEl) { numEl.textContent = cl.num; numEl.style.color = ''; }
      if (lblEl) { lblEl.textContent = 'HFI'; lblEl.style.color = ''; }
      if (szEl)  { szEl.textContent  = cl.size; szEl.style.color = ''; }
      if (dscEl) { dscEl.textContent = cl.desc; }
      setEl2('fwi-fbp-hfi'   + suffix, `${Math.round(fbp.hfi).toLocaleString()} kW/m`);
      setEl2('fwi-fbp-ros'   + suffix, `${fbp.ros.toFixed(1)} m/min`);
      setEl2('fwi-fbp-flame' + suffix, `${fbp.flameLength.toFixed(1)} m`);
      setEl2('fwi-fbp-type'  + suffix, fbp.fireType);
      setEl2('fwi-fbp-cfb'   + suffix, `${(fbp.cfb*100).toFixed(0)}%`);
      const sectionEl = document.getElementById('fwi-fbp-section' + suffix);
      _paintHfiSection(sectionEl, cl.num);
    };
    // Show today's FBP only when the FWI chain has real data; otherwise N/A
    // (consistent with the main wireDOM/wireFBP guard for null ffmc).
    const todayFBPA = (_lastFWI?.ffmc != null) ? results[todayIdx]  : null;
    const todayFBPB = (_lastFWI?.ffmc != null) ? resultsB?.[todayIdx] : null;
    populateTodaySection('-a', todayFBPA);
    populateTodaySection('-b', todayFBPB);
    // Summary row = exactly the inputs these Today cards just rendered:
    // the day's chain codes + its 16:00 peak wind (calcMultiDayFBP).
    if (todayFBPA?.fbp) {
      _renderPeakSummary({
        ffmc: todayFBPA.ffmc, dmc: todayFBPA.dmc, dc: todayFBPA.dc,
        wind: todayFBPA.peakWeather?.wind ?? todayFBPA.weather?.wind ?? 10,
        fbpA: todayFBPA.fbp, fbpB: todayFBPB?.fbp || null, fuelA: fuelA0, fuelB: fuelB0, peak: true,
      });
    }
  }

  // RIGHT card — always tomorrow
  const idx = tomorrowIdx >= 0 ? tomorrowIdx : (todayIdx >= 0 ? todayIdx + 1 : 0);
  const labelEl = document.getElementById('fwi-d1-peak-label');
  if (labelEl) labelEl.textContent = `Tomorrow · Peak Burn · ~16:00 ${PROVINCE.tzLabel}`;
  const d1r = results[idx], d1d = days[idx];
  if (!d1r) return;

  const d1pw = d1d?.peak || d1d || {};

  // Card background driven by FWI danger of primary fuel chain
  const d1Card = document.getElementById('fwi-d1-card');
  // D+1 card background driven by individual fuel section gradients; outer card stays neutral

  set('fwi-d1-preview-date',      `${d1r.label || 'D+1'}`);
  set('fwi-d1-preview-fwi-score', `${Math.round(d1r.fwi)}`);
  set('fwi-d1-preview-danger',    `${d1r.danger} Risk`);
  set('fwi-d1-preview-temp',  `${(+d1pw.temp||0).toFixed(1)}°C`);
  set('fwi-d1-preview-rh',    `${Math.round(d1pw.rh||0)}%`);
  set('fwi-d1-preview-wind',  `${Math.round(d1pw.wind||0)} km/h`);
  set('fwi-d1-preview-wdir',  d1pw.wdir != null ? windCompass(d1pw.wdir) : '—');

  // Populate fuel sections A and B
  const populateD1Section = (suffix, r) => {
    const fbp = r?.fbp;
    if (!fbp) { set('fwi-d1-preview-hfi-label' + suffix, 'N/A'); return; }
    const cl    = hfiClassInfo(fbp.hfi);
    const numEl = document.getElementById('fwi-d1-preview-hfi-num'   + suffix);
    const lblEl = document.getElementById('fwi-d1-preview-hfi-label' + suffix);
    const szEl  = document.getElementById('fwi-d1-preview-hfi-size'  + suffix);
    const dscEl = document.getElementById('fwi-d1-preview-hfi-desc'  + suffix);
    if (numEl) { numEl.textContent = cl.num; numEl.style.color = ''; }
    if (lblEl) { lblEl.textContent = 'HFI'; lblEl.style.color = ''; }
    if (szEl)  { szEl.textContent  = cl.size; szEl.style.color = ''; }
    if (dscEl) { dscEl.textContent = cl.desc; }
    set('fwi-d1-preview-hfi-kwm' + suffix, `${Math.round(fbp.hfi).toLocaleString()} kW/m`);
    set('fwi-d1-preview-ros'     + suffix, `${fbp.ros.toFixed(1)} m/min`);
    set('fwi-d1-preview-flame'   + suffix, `${fbp.flameLength.toFixed(1)} m`);
    set('fwi-d1-preview-type'    + suffix, fbp.fireType);
    set('fwi-d1-preview-cfb'     + suffix, `${(fbp.cfb*100).toFixed(0)}%`);
    const sectionEl = document.getElementById('fwi-d1-preview-section' + suffix);
    _paintHfiSection(sectionEl, cl.num);
  };

  const fuelA = _savedFuelCode();
  const fuelB = _savedFuelCode2();
  const setLbl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setLbl('fwi-d1-preview-fuel-name-a', FUEL_TYPES[fuelA]?.name || fuelA);
  setLbl('fwi-d1-preview-fuel-name-b', FUEL_TYPES[fuelB]?.name || fuelB);
  populateD1Section('-a', results[idx]);
  populateD1Section('-b', resultsB?.[idx]);
}

window.FWI = { initFWI, calcFMC, calcSFC, _hffmc, buildStationPicker, buildRegionalSummary, buildForecastTrends, buildHourlyChart, buildStationMap, buildD1Card, calculateFWI, calculateFBP, calcMultiDayFBP, wireFBP, refreshFBP, fetchWeather, fetchCWFIS, fetchWeatherPrimary, fetchStationData, fetchStationDataForecast, dangerRating, exportRegionalDataset, exportForecastReport, printProvincialBriefing, printStationBriefing, FUEL_TYPES, FUEL_PAIR_COMPLEMENT, hfiClassInfo, _stationSector, _updateAlarmStrip,
  get _idwMode() { return _idwMode; },
  set _idwMode(v) { _idwMode = v; },
};

// Province-specific window.FWI members (AB: ALBERTA_STATIONS; BC: BC_STATIONS, dangerRatingBC, …).
if (typeof PROVINCE.exports === 'function') Object.assign(window.FWI, PROVINCE.exports());
