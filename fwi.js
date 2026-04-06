/**
 * Alberta FWI Dashboard — Live Data Engine
 *
 * Van Wagner FWI System ported to JavaScript.
 * Reference: Van Wagner & Pickett (1985), Forestry Canada (1992).
 *
 * Weather source: Open-Meteo (https://open-meteo.com) — free, CORS-enabled, no key.
 * FWI calculation: client-side Van Wagner equations (CFFDRS-compliant).
 */

// Day-length factors by month (index 0 unused, months 1-12)
const DMC_LL = [0,6.5,7.5,9.0,12.8,13.9,13.9,12.4,10.9,9.4,8.0,7.0,6.0];
const DC_LL  = [0,-1.6,-1.6,-1.6,0.9,3.8,5.8,6.4,5.0,2.4,0.4,-1.6,-1.6];

// Spring startup defaults (Van Wagner 1987)
// Spring startup defaults — FFMC and DMC are uniform; DC varies by Alberta fuel zone.
const STARTUP = { ffmc: 85.0, dmc: 6.0, dc: 300.0 };

// P1: Per-station spring startup DC by Alberta fuel/climate zone.
// Boreal North (high precip, good snowpack) → low carry-over.
// Southern AB (dry winters, low snowpack) → high carry-over.
// Moot during fire season when CWFIS provides live DC; applies to cold-start
// fallback and the NAEFS forecast carry-forward chain.
const STATION_STARTUP_DC = {
  'Fort Chipewyan': 100, 'Fort Vermilion': 100, 'High Level': 100,
  'Manning': 100, 'Wabasca': 130,
  'Athabasca': 150, 'Fort McMurray': 150, 'Lac La Biche': 150,
  'Slave Lake': 150, 'High Prairie': 150, 'Fox Creek': 150,
  'Edson': 150, 'Hinton': 150, 'Whitecourt': 150, 'Valleyview': 150,
  'Grande Cache': 150, 'Rocky Mtn House': 150, 'Bonnyville': 150, 'Cold Lake': 150,
  'Banff': 175, 'Jasper': 175, 'Grande Prairie': 175, 'Peace River': 200,
  'Edmonton': 300, 'Drayton Valley': 275, 'Wetaskiwin': 300, 'Camrose': 275,
  'Vegreville': 275, 'Lloydminster': 250, 'Red Deer': 275, 'Stettler': 275,
  'Calgary': 375, 'Lethbridge': 425, 'Medicine Hat': 450, 'Brooks': 425,
  'Cardston': 400, 'Claresholm': 375, 'Drumheller': 425, 'Pincher Creek': 375,
};
function getStartupDC(stationName) { return STATION_STARTUP_DC[stationName] ?? 300; }

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
  if (temp > -2.8) d += 0.5 * Math.max(0, 0.36*(temp+2.8) + DC_LL[month]);
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

// Wind degrees → compass direction + arrow
function windCompass(deg) {
  if (deg == null) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const arrows = ['↓','↓','↙','↙','←','↖','↖','↑','↑','↑','↗','↗','→','↘','↘','↓'];
  const i = Math.round(deg / 22.5) % 16;
  return `${arrows[i]} ${dirs[i]} (${Math.round(deg)}°)`;
}

// FWI danger thresholds (Van Wagner 1987 / CFFDRS)
function dangerRating(fwi) {
  if (fwi < 5)  return 'Low';
  if (fwi < 10) return 'Moderate';
  if (fwi < 20) return 'High';
  if (fwi < 30) return 'Very High';
  return 'Extreme';
}

// Alberta Wildfire danger class 1–6 (CIFFC operational scale)
// Returns { num, label, bg, text } for colour-coded display in briefings
function dangerClassNum(fwi) {
  if (fwi <  6) return { num: 1, label: 'Low',       bg: '#d4edda', text: '#155724' };
  if (fwi < 12) return { num: 2, label: 'Moderate',  bg: '#cce5ff', text: '#004085' };
  if (fwi < 25) return { num: 3, label: 'High',      bg: '#fff3cd', text: '#856404' };
  if (fwi < 38) return { num: 4, label: 'Very High', bg: '#ffe5cc', text: '#7d3200' };
  if (fwi < 50) return { num: 5, label: 'Extreme',   bg: '#f8d7da', text: '#721c24' };
  return           { num: 6, label: 'Extreme+',  bg: '#4a0010', text: '#ffccdd' };
}

// HFI intensity class 1–6 — operational plain-language scale (Glenn, FBAN)
// "No one understands kW/m" — show the number + what it means in the field
// FBP System HFI Intensity Class 1–6
// Source: Alberta WUI Pocket Guide (Gov. of Alberta, Forestry & Parks);
// Cole & Alexander (1995), CFS Northern Forestry Centre, Edmonton.
function hfiClassInfo(hfi) {
  if (hfi <   10) return { num: 1, label: 'Low',        size: 'Flame length < 0.2 m',             desc: 'Direct attack with hand tools',                     bg: '#d4edda', text: '#155724' };
  if (hfi <  500) return { num: 2, label: 'Moderate',   size: 'Flame length 0.2 – 1.5 m',         desc: 'Direct attack with hand tools',                     bg: '#cce5ff', text: '#004085' };
  if (hfi < 2000) return { num: 3, label: 'High',       size: 'Flame length 1.5 – 2.5 m',         desc: 'Direct attack with pump/hose or air support',       bg: '#fff3cd', text: '#856404' };
  if (hfi < 4000) return { num: 4, label: 'Very High',  size: 'Flame length 2.5 – 3.5 m',         desc: 'Indirect attack — air attack successful on head',   bg: '#ffe5cc', text: '#7d3200' };
  if (hfi <10000) return { num: 5, label: 'Extreme',    size: 'Flame length 3.5 – 5.5 m',         desc: 'Indirect attack — suppress flanks, coordinate air', bg: '#f8d7da', text: '#721c24' };
  return           { num: 6, label: 'Catastrophic', size: 'Flame length > 5.5 m',             desc: 'Air attack likely to fail on head — evacuate',      bg: '#4a0010', text: '#ffccdd' };
}

// Behaviour card gradient per danger level — used on full-height cards so keep tones rich, not neon
const DANGER_GRADIENTS = {
  'Low':       'linear-gradient(135deg, #2d9e58 0%, #175c30 100%)',
  'Moderate':  'linear-gradient(135deg, #7bd0ff 0%, #008abb 100%)',
  'High':      'linear-gradient(135deg, #c97ae0 0%, #7a28a8 100%)',
  'Very High': 'linear-gradient(135deg, #f07030 0%, #9e3800 100%)',
  'Extreme':   'linear-gradient(135deg, #e03030 0%, #8c0a0a 100%)',
};

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

// ─── FBP System (ST-X-3, Forestry Canada 1992) ───────────────────────────────
// Parameters ported from wildfire-simulator-v3/engine/src/firesim/fbp/constants.py

const FUEL_TYPES = {
  C1:  { name:'Spruce-Lichen Woodland',       a:90,  b:0.0649, c:4.5, q:0.90, bui0:72,  cbh:2,  cfl:0.75, sfc:0.75 },
  C2:  { name:'Boreal Spruce',                a:110, b:0.0282, c:1.5, q:0.70, bui0:64,  cbh:3,  cfl:0.80, sfc:0.80 },
  C3:  { name:'Mature Jack/Lodgepole Pine',   a:110, b:0.0444, c:3.0, q:0.75, bui0:62,  cbh:8,  cfl:1.15, sfc:1.15 },
  C4:  { name:'Immature Jack/Lodgepole Pine', a:110, b:0.0293, c:1.5, q:0.75, bui0:66,  cbh:4,  cfl:1.20, sfc:1.20 },
  C5:  { name:'Red and White Pine',           a:30,  b:0.0697, c:4.0, q:0.80, bui0:56,  cbh:18, cfl:1.20, sfc:1.20 },
  C6:  { name:'Conifer Plantation',           a:30,  b:0.0800, c:3.0, q:0.80, bui0:62,  cbh:7,  cfl:1.80, sfc:1.80 },
  C7:  { name:'Ponderosa Pine/Douglas-fir',   a:45,  b:0.0305, c:2.0, q:0.85, bui0:106, cbh:10, cfl:0.50, sfc:0.50 },
  D1:  { name:'Leafless Aspen',               a:30,  b:0.0232, c:1.6, q:0.90, bui0:32,  cbh:0,  cfl:0.00, sfc:0.35 },
  D2:  { name:'Green Aspen',                  a:6,   b:0.0232, c:1.6, q:0.90, bui0:32,  cbh:0,  cfl:0.00, sfc:0.35 },
  O1a: { name:'Matted Grass',                 a:190, b:0.0310, c:1.4, q:1.00, bui0:1,   cbh:0,  cfl:0.00, sfc:0.35 },
  O1b: { name:'Standing Grass',               a:250, b:0.0350, c:1.7, q:1.00, bui0:1,   cbh:0,  cfl:0.00, sfc:0.35 },
  S1:  { name:'Jack/Lodgepole Pine Slash',    a:75,  b:0.0297, c:1.3, q:0.75, bui0:38,  cbh:0,  cfl:0.00, sfc:4.50 },
  S2:  { name:'White Spruce/Balsam Slash',    a:40,  b:0.0438, c:1.7, q:0.75, bui0:63,  cbh:0,  cfl:0.00, sfc:4.50 },
  S3:  { name:'Cedar/Hemlock/DF Slash',       a:55,  b:0.0829, c:3.2, q:0.75, bui0:31,  cbh:0,  cfl:0.00, sfc:4.50 },
};

/**
 * Station-level dominant FBP fuel type derived from CWFIS WMS
 * cffdrs_fbp_fuel_types (NRCan 30m national grid), sampled Apr 2026.
 * Method: modal fuel type within 5 km radius of each CWFIS station coordinate.
 * Corrections: M1/M2 (mixedwood) mapped to C2; northern boreal airport stations
 * where sampled pixel was agricultural grass corrected to regional forest type.
 * Users can override via the fuel picker at any time.
 */
const STATION_FUEL_TYPES = {
  'Athabasca':      'C2',   // boreal — airport grass corrected
  'Banff':          'C3',   // WMS: Mature Jack/Lodgepole Pine ✓
  'Bonnyville':     'O1a',  // WMS: agricultural Peace Country
  'Brooks':         'O1a',  // WMS: SE Alberta grassland ✓
  'Calgary':        'D1',   // WMS: Aspen parkland ✓
  'Camrose':        'O1a',  // WMS: agricultural central AB
  'Cardston':       'O1a',  // WMS: SW Alberta grassland ✓
  'Claresholm':     'O1a',  // WMS: foothills grassland ✓
  'Cold Lake':      'C3',   // WMS: Mature Jack Pine ✓
  'Drayton Valley': 'D1',   // WMS: Aspen parkland ✓
  'Drumheller':     'O1a',  // WMS: badlands/grassland ✓
  'Edmonton':       'D2',   // WMS area: Aspen parkland; D2 (green) for WUI context
  'Edson':          'C2',   // M1→C2: mixedwood boreal ✓
  'Fort Chipewyan': 'C2',   // WMS: Northern Boreal Spruce ✓
  'Fort McMurray':  'C4',   // WMS: Immature Jack Pine (post-2016 reburn) ✓
  'Fort Vermilion': 'C2',   // boreal — airport grass corrected
  'Fox Creek':      'C2',   // WMS: Boreal Spruce ✓
  'Grande Cache':   'C2',   // WMS: Boreal Spruce ✓
  'Grande Prairie': 'O1a',  // WMS: Peace Country grass ✓
  'High Level':     'C2',   // WMS: Northern Boreal Spruce ✓
  'High Prairie':   'D2',   // boreal transition — corrected from airport grass
  'Hinton':         'C2',   // WMS: Boreal Spruce ✓
  'Jasper':         'C3',   // WMS: Rocky Mountain Jack/Lodgepole ✓
  'Lac La Biche':   'D1',   // WMS: Leafless Aspen ✓
  'Lethbridge':     'O1a',  // WMS: Grassland ✓
  'Lloydminster':   'O1a',  // WMS: agricultural boundary ✓
  'Manning':        'C2',   // boreal — airport grass corrected
  'Medicine Hat':   'O1a',  // WMS: SE Alberta grassland ✓
  'Peace River':    'D2',   // Peace Country transition — corrected
  'Pincher Creek':  'O1a',  // WMS: foothills grassland ✓
  'Red Deer':       'D1',   // WMS: Aspen parkland ✓
  'Rocky Mtn House':'C2',   // M1→C2: mixedwood foothills
  'Slave Lake':     'C2',   // M1→C2: Lesser Slave mixedwood
  'Stettler':       'O1a',  // WMS: agricultural ✓
  'Valleyview':     'D1',   // WMS: Peace Country ✓
  'Vegreville':     'O1a',  // WMS: agricultural ✓
  'Wabasca':        'C2',   // M1→C2: boreal mixedwood
  'Wetaskiwin':     'O1a',  // WMS: agricultural ✓
  'Whitecourt':     'C2',   // M1→C2: boreal mixedwood ✓
};

/**
 * Calculate FBP fire behaviour from FWI codes + wind speed.
 * Equations: ST-X-3 (Forestry Canada 1992), Van Wagner 1977 (crown fire).
 *
 * @param {string} fuelCode  FBP fuel type code (e.g. 'C2')
 * @param {number} ffmc      Fine Fuel Moisture Code
 * @param {number} dmc       Duff Moisture Code
 * @param {number} dc        Drought Code
 * @param {number} windSpeed 10-m open wind speed (km/h)
 * @param {number} slope     Percent slope (default 0)
 * @returns {{ isi, bui, ros, hfi, cfb, tfc, flameLength, fireType } | null}
 */
// P5: Van Wagner (1987) seasonal foliar moisture content equation.
// FMC declines from ~120 (early spring) toward ~85 (peak summer) as foliage matures.
// Affects crown fire initiation threshold (CSI) — lower FMC = easier crown fire.
function calcFMC(lat, doy) {
  const latn = lat < 60
    ? 46 + 0.234 * (Math.cos(0.0171 * (doy - 200)) - 1) * (lat - 46)
    : lat;
  const D0 = 2.6286 * (90 - latn) - 21.626;
  return Math.min(120, Math.max(85, 85 + 0.0189 * Math.pow(doy - D0, 2)));
}

let _stationLat = 53.5; // module-level; set by initFWI for FMC calculation
let _stationLng = -113.5; // module-level; set by initFWI
let _stationName = 'Edmonton'; // module-level; set by initFWI
let _initGeneration = 0; // increments each initFWI call; only latest call writes to DOM

function calculateFBP(fuelCode, ffmc, dmc, dc, windSpeed, slope = 0, curing = 100) {
  const ft = FUEL_TYPES[fuelCode];
  if (!ft) return null;

  // ISI — identical to Van Wagner formula used in FWI system
  const m   = 147.2 * (101.0 - ffmc) / (59.5 + ffmc);
  const ff  = 91.9 * Math.exp(-0.1386 * m) * (1.0 + Math.pow(m, 5.31) / 4.93e7);
  const isi = 0.208 * ff * Math.exp(0.05039 * windSpeed);

  // Grass curing factor — FBP ST-X-3 (O1a/O1b only)
  // CF = 0.005 × (exp(0.061 × PC) − 1); modifies effective ISI before ROS calc.
  // At PC=0 → CF=0 (no spread); PC=80 → CF≈0.65; PC=100 → CF≈2.22
  let isiForROS = isi;
  if (fuelCode === 'O1a' || fuelCode === 'O1b') {
    const pc = Math.max(0, Math.min(100, curing));
    isiForROS = 0.005 * (Math.exp(0.061 * pc) - 1) * isi;
  }

  // BUI — same formula as _bui()
  let bui;
  if (dmc <= 0.4 * dc) {
    bui = 0.8 * dmc * dc / (dmc + 0.4 * dc);
  } else {
    bui = dmc - (1.0 - 0.8 * dc / (dmc + 0.4 * dc)) * (0.92 + Math.pow(0.0114 * dmc, 1.7));
  }
  bui = Math.max(0, bui);

  // BUI effect: BE = exp(50 × ln(q) × (1/BUI − 1/BUI₀))
  let be = 1.0;
  if (bui > 0 && ft.q < 1.0) {
    be = Math.exp(50.0 * Math.log(ft.q) * (1.0 / bui - 1.0 / ft.bui0));
  }

  // Surface ROS (m/min): RSI = a × (1 − e^{−b·ISI_eff})^c × BE
  let ros = ft.a * Math.pow(1.0 - Math.exp(-ft.b * isiForROS), ft.c) * be;

  // Slope factor — Butler (2007), capped at 2×
  if (slope > 0) {
    const sf = Math.min(Math.exp(3.533 * Math.pow(slope / 100.0, 1.2)), 2.0);
    ros *= sf;
  }

  // Surface fire intensity (kW/m): SFI = H × SFC × ROS / 60
  const H   = 18000; // kJ/kg, low heat of combustion
  const sfi = H * ft.sfc * ros / 60.0;

  // Crown fraction burned — Van Wagner (1977)
  // CSI (critical surface intensity) = 0.001 × CBH^1.5 × (460 + 25.9 × FMC)^1.5
  const doy = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const fmc = calcFMC(_stationLat, doy); // P5: seasonal FMC from station lat + day-of-year
  const csi = ft.cbh > 0 ? 0.001 * Math.pow(ft.cbh, 1.5) * Math.pow(460 + 25.9 * fmc, 1.5) : Infinity;
  const rso = ft.sfc > 0 ? csi / (H * ft.sfc) : Infinity;
  const cfb = (ft.cbh > 0 && ros > rso) ? Math.max(0, 1.0 - Math.exp(-0.23 * (ros - rso))) : 0.0;

  // Total fuel consumption and head fire intensity
  const cfc = cfb * ft.cfl;
  const tfc = ft.sfc + cfc;
  const hfi = H * tfc * ros / 60.0;

  // Flame length — Byram (1959): L = 0.0775 × I^0.46
  const flameLength = hfi > 0 ? 0.0775 * Math.pow(hfi, 0.46) : 0.0;

  // Fire type classification
  let fireType = 'Surface';
  if      (cfb > 0.9)             fireType = 'Active Crown';
  else if (cfb > 0.1)             fireType = 'Passive Crown';
  else if (ft.cbh > 0 && sfi > csi) fireType = 'Torching';

  return { isi, bui, ros, hfi, cfb, tfc, flameLength, fireType };
}

/** Render FBP results into the station_detail FBP section. */
function wireFBP(weather, fwi) {
  const fuelCode = document.getElementById('fwi-fuel-picker')?.value || 'C2';
  localStorage.setItem('fwi-fuel-type', fuelCode); // persist for forecast page
  const curing = _savedCuring();
  const result = calculateFBP(fuelCode, fwi.ffmc, fwi.dmc, fwi.dc, weather.wind, 0, curing);
  if (!result) return;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('fwi-fbp-ros',   result.ros.toFixed(1) + ' m/min');
  set('fwi-fbp-hfi',   Math.round(result.hfi).toLocaleString() + ' kW/m');
  set('fwi-fbp-flame', result.flameLength.toFixed(1) + ' m');
  set('fwi-fbp-type',  result.fireType);
  set('fwi-fbp-cfb',   (result.cfb * 100).toFixed(0) + '%');

  const cl = hfiClassInfo(result.hfi);
  // On the gradient card, all text is white
  const numEl = document.getElementById('fwi-fbp-hfi-rating');
  if (numEl) { numEl.textContent = cl.num; numEl.style.color = 'white'; }
  const lblEl = document.getElementById('fwi-fbp-hfi-label');
  if (lblEl) { lblEl.textContent = cl.label; lblEl.style.color = 'rgba(255,255,255,0.9)'; }
  const sizeEl = document.getElementById('fwi-fbp-hfi-size');
  if (sizeEl) { sizeEl.textContent = cl.size; sizeEl.style.color = 'rgba(255,255,255,0.85)'; }
  const desc = document.getElementById('fwi-fbp-hfi-desc');
  if (desc) { desc.textContent = cl.desc; }
}

/** Re-run FBP with cached last weather/FWI when fuel picker changes. */
let _lastWeather = null;
let _lastFWI     = null;
let _lastVWCalc  = null; // Van Wagner cold-start result for compare panel

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

// ─── CWFIS WFS fetch ──────────────────────────────────────────────────────────
/**
 * Fetch live fire weather from CWFIS WFS (NRCan/MSC physical sensors).
 * Returns observed weather + pre-computed FWI codes when in-season (Apr–Oct).
 * Returns null on failure — caller falls back to Open-Meteo.
 *
 * Layer: public:firewx_stns_current (GeoServer WFS 2.0.0)
 * Reference: CWFIS, Natural Resources Canada
 */
async function fetchCWFIS(lat, lng) {
  const bbox = 2.0; // ±2 degrees ≈ 220 km
  const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows` +
    `?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeName=public:firewx_stns_current&outputFormat=application/json&count=50` +
    `&CQL_FILTER=lat+BETWEEN+${lat - bbox}+AND+${lat + bbox}` +
    `+AND+lon+BETWEEN+${lng - bbox}+AND+${lng + bbox}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.features?.length) return null;

    // Find nearest station with valid weather observations
    let nearest = null, minDist = Infinity;
    for (const feat of data.features) {
      const p = feat.properties;
      if (p.temp == null || p.rh == null || p.ws == null) continue;
      const d = _haversineKm(lat, lng, +p.lat, +p.lon);
      if (d < minDist) { minDist = d; nearest = p; }
    }
    if (!nearest) return null;

    const hasFWI = nearest.ffmc != null && nearest.dmc != null && nearest.dc != null;
    // CWFIS WFS encodes spaces as '+' in station name strings
    const stationName = (nearest.name || '').replace(/\+/g, ' ').trim().replace(/\s+/g, ' ');

    return {
      temp:  nearest.temp,
      rh:    nearest.rh,
      wind:  nearest.ws,
      wdir:  nearest.wdir ?? null,
      rain:  nearest.precip ?? 0,
      month: new Date().getMonth() + 1,
      // FWI codes from CWFIS daily carry-over chain (null off-season)
      ffmc: hasFWI ? nearest.ffmc : null,
      dmc:  hasFWI ? nearest.dmc  : null,
      dc:   hasFWI ? nearest.dc   : null,
      isi:  hasFWI ? nearest.isi  : null,
      bui:  hasFWI ? nearest.bui  : null,
      fwi:  hasFWI ? nearest.fwi  : null,
      fwiFromCWFIS: hasFWI,
      repDate: nearest.rep_date || null,
      source: hasFWI
        ? `CWFIS · ${stationName}`
        : `CWFIS · ${stationName} · FWI calc`,
      stationName,
      distKm: Math.round(minDist),
    };
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
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
  const url = `https://api.weather.gc.ca/collections/swob-realtime/items` +
    `?bbox=${(lng-bbox).toFixed(2)},${(lat-bbox).toFixed(2)},${(lng+bbox).toFixed(2)},${(lat+bbox).toFixed(2)}` +
    `&datetime=${fmt(past)}/${fmt(now)}&limit=50&f=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
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
  const rain = p['pcpn_amt_pst1hr']             ?? 0;
  if (temp == null || rh == null || wind == null) return null;

  const obsTime    = new Date(p['date_tm-value'] || p['obs_date_tm']);
  const obsUTCHour = obsTime.getUTCHours();
  const isNoonLST  = obsUTCHour >= 18 && obsUTCHour <= 20; // ±1 hr of noon LST (19:00 UTC)
  const stnName    = (p['stn_nam-value'] || '').replace(/\+/g,' ').trim();
  const srcLabel   = isNoonLST
    ? `MSC SWOB · ${stnName} (noon LST)`
    : `MSC SWOB · ${stnName} (latest obs)`;

  return {
    temp, rh, wind, wdir, rain,
    month:       new Date().getMonth() + 1,
    source:      srcLabel,
    stationName: stnName,
    fwiFromCWFIS: false,
    distKm:      Math.round(minDist),
  };
}

/**
 * Fetch weather — three-tier hierarchy:
 *   1. CWFIS firewx_stns_current — fire weather stations, pre-computed FWI chain
 *   2. MSC SWOB realtime         — real sensor obs, noon LST targeted
 *   3. Open-Meteo NWP            — model output, noon LST targeted, last resort
 */
async function fetchWeatherPrimary(lat, lng) {
  try {
    const cwfis = await fetchCWFIS(lat, lng);
    if (cwfis) return cwfis;
  } catch (e) { /* fall through */ }
  try {
    const swob = await fetchSWOB(lat, lng);
    if (swob) return swob;
  } catch (e) { /* fall through */ }
  return fetchWeather(lat, lng);
}

/**
 * Fetch weather from Open-Meteo targeting the noon LST observation.
 * CFFDRS specifies noon Local Standard Time (UTC−7 year-round for Alberta)
 * for daily FWI calculations. We request today's hourly array and select
 * the 19:00 UTC hour (= noon LST). If noon hasn't occurred yet today,
 * we use the most recent available hour as best-available.
 */
async function fetchWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lng}` +
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation` +
    `&forecast_days=1&timezone=UTC`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const d = await res.json();
  const times = d.hourly.time; // ISO strings, UTC

  // Noon LST = 19:00 UTC (Alberta is UTC−7 standard time year-round for CFFDRS)
  const noonUTC = 19;
  const nowUTC  = new Date().getUTCHours();
  // Use noon if it has passed; otherwise use the most recent available hour
  const targetHour = nowUTC >= noonUTC ? noonUTC : nowUTC;
  const idx = times.findIndex(t => new Date(t).getUTCHours() === targetHour);
  const i = idx >= 0 ? idx : times.length - 1;

  const sourceNote = targetHour === noonUTC ? 'Open-Meteo NWP (noon LST)' : 'Open-Meteo NWP (pre-noon — best available)';
  return {
    temp:  d.hourly.temperature_2m[i],
    rh:    d.hourly.relative_humidity_2m[i],
    wind:  d.hourly.wind_speed_10m[i],
    wdir:  d.hourly.wind_direction_10m[i] ?? null,
    rain:  d.hourly.precipitation[i],
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
    return { ffmc: w.ffmc, dmc: w.dmc, dc: w.dc, isi, bui, fwi, danger: dangerRating(fwi), weather: w };
  }
  // Van Wagner equations — spring startup constants when no carry-over available
  const ffmc = _ffmc(w.temp, w.rh, w.wind, w.rain, prev.ffmc);
  const dmc  = _dmc(w.temp, w.rh, w.rain, w.month, prev.dmc);
  const dc   = _dc(w.temp, w.rain, w.month, prev.dc);
  const isi  = _isi(ffmc, w.wind);
  const bui  = _bui(dmc, dc);
  const fwi  = _fwi(isi, bui);
  return { ffmc, dmc, dc, isi, bui, fwi, danger: dangerRating(fwi), weather: w };
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

  // FWI components
  set('ffmc',  r.ffmc.toFixed(1));
  set('dmc',   r.dmc.toFixed(1));
  set('dc',    r.dc.toFixed(1));
  set('isi',   r.isi.toFixed(1));
  set('bui',   r.bui.toFixed(1));
  set('fwi',   r.fwi.toFixed(1));

  // Danger labels
  set('danger',       r.danger.toUpperCase() + ' RISK');
  set('danger-label', r.danger + ' Risk Level');

  // Hero card colour
  const scoreCard = document.getElementById('fwi-score-card');
  if (scoreCard) scoreCard.style.background = DANGER_GRADIENTS[r.danger] || DANGER_GRADIENTS['Moderate'];

  // Rating badges — per-component thresholds
  document.querySelectorAll('[data-fwi-rating]').forEach(el => {
    const key = el.dataset.fwiRating;
    const val = { ffmc: r.ffmc, dmc: r.dmc, dc: r.dc, isi: r.isi, bui: r.bui, fwi: r.fwi }[key];
    el.textContent = (val != null ? componentRating(key, val) : r.danger).toUpperCase();
  });

  // Progress bars — typical operating ranges
  pct('ffmc', r.ffmc, 101);   // 0-101 scale
  pct('dmc',  r.dmc,  200);   // 0-200 typical
  pct('dc',   r.dc,   800);   // 0-800 typical
  pct('isi',  r.isi,  25);    // 0-25 typical
  pct('bui',  r.bui,  200);   // 0-200 typical
  pct('fwi',  r.fwi,  50);    // 0-50 typical

  // Timestamp (line 1) + source label (line 2, station_detail only)
  set('updated', `Live · ${new Date().toLocaleTimeString()}`);
  const srcLabel = r.weather.stationName
    ? `CWFIS · ${r.weather.stationName}`
    : (r.weather.source || 'Open-Meteo NWP');
  set('source-station', srcLabel);

  // DC source indicator
  const dcBadge = document.getElementById('fwi-dc-source');
  if (dcBadge) {
    if (r.weather.fwiFromCWFIS) {
      // Store the CWFIS rep_date so we can show it when falling back later
      if (r.weather.repDate) localStorage.setItem('fwi-cwfis-last-valid', r.weather.repDate);
      dcBadge.textContent = 'CWFIS carry-over';
      dcBadge.className = 'mt-2 inline-block text-[9px] font-label font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary';
    } else {
      // Show when CWFIS was last valid so users know it will return after noon obs are processed
      const lastValid = localStorage.getItem('fwi-cwfis-last-valid');
      let lastStr = '';
      if (lastValid) {
        const d = new Date(lastValid);
        lastStr = ` · CWFIS last: ${d.toLocaleDateString('en-CA', { month:'short', day:'numeric' })} ${d.toLocaleTimeString('en-CA', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'America/Edmonton' })} MDT`;
      } else {
        lastStr = ' · CWFIS available ~14:00 MDT';
      }
      dcBadge.textContent = 'Regional estimate' + lastStr;
      dcBadge.className = 'mt-2 inline-block text-[9px] font-label font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400';
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

  // FBP fire behaviour (station_detail only — silently no-ops on other pages)
  wireFBP(r.weather, r);

  // D+1 tomorrow card (station_detail only — silently no-ops on other pages)
  if (document.getElementById('fwi-d1-preview-section')) buildD1Card();

  // P4: SCRIBE 48-hr validation — async, non-blocking
  fetchSCRIBE(lat, lng).then(renderSCRIBE);
}

/**
 * Main entry point. Call from any FWI screen.
 *
 * @param {number} lat       Latitude (default: Edmonton)
 * @param {number} lng       Longitude (default: Edmonton)
 * @param {string} station   Station label for [data-fwi="station"] elements
 */
async function initFWI(lat = 53.5344, lng = -113.4903, station = 'Edmonton Area') {
  _stationLat  = lat; // P5: update for seasonal FMC calculation
  _stationLng  = lng;
  _stationName = station;
  const gen = ++_initGeneration; // this call's generation token
  document.querySelectorAll('[data-fwi="station"]').forEach(el => el.textContent = station);
  document.querySelectorAll('[data-fwi="updated"]').forEach(el => el.textContent = 'Loading…');

  try {
    const weather = await fetchWeatherPrimary(lat, lng);
    if (gen !== _initGeneration) return; // a newer initFWI started; discard stale result
    const result  = calculateFWI(weather);
    wireDOM(result, lat, lng);
    console.log('[FWI]', result);
  } catch (err) {
    if (gen !== _initGeneration) return; // stale failure — don't overwrite newer success
    console.warn('[FWI] Load failed:', err);
    document.querySelectorAll('[data-fwi="updated"]').forEach(el => el.textContent = 'Data unavailable');
  }
}

// Alberta CWFIS fire weather stations (name, lat, lng)
const ALBERTA_STATIONS = [
  // Northern
  { name: 'High Level',        lat: 58.517, lng: -117.133 },
  { name: 'Fort Chipewyan',    lat: 58.767, lng: -111.117 },
  { name: 'Peace River',       lat: 56.233, lng: -117.283 },
  { name: 'Grande Prairie',    lat: 55.167, lng: -118.883 },
  { name: 'Valleyview',        lat: 55.083, lng: -117.283 },
  { name: 'High Prairie',      lat: 55.433, lng: -116.483 },
  { name: 'Wabasca',           lat: 55.967, lng: -113.833 },
  { name: 'Slave Lake',        lat: 55.283, lng: -114.767 },
  { name: 'Fort McMurray',     lat: 56.650, lng: -111.217 },
  { name: 'Fort Vermilion',    lat: 58.383, lng: -116.017 },
  { name: 'Manning',           lat: 56.917, lng: -117.617 },
  // Central-North
  { name: 'Lac La Biche',      lat: 54.767, lng: -111.967 },
  { name: 'Athabasca',         lat: 54.717, lng: -113.283 },
  { name: 'Bonnyville',        lat: 54.267, lng: -110.733 },
  { name: 'Cold Lake',         lat: 54.417, lng: -110.283 },
  { name: 'Fox Creek',         lat: 54.400, lng: -116.800 },
  { name: 'Whitecourt',        lat: 54.150, lng: -115.683 },
  { name: 'Edson',             lat: 53.583, lng: -116.433 },
  { name: 'Hinton',            lat: 53.400, lng: -117.567 },
  { name: 'Jasper',            lat: 52.867, lng: -118.083 },
  { name: 'Grande Cache',      lat: 53.883, lng: -119.000 },
  // Central
  { name: 'Edmonton',          lat: 53.534, lng: -113.490 },
  { name: 'Drayton Valley',    lat: 53.217, lng: -114.983 },
  { name: 'Rocky Mtn House',   lat: 52.367, lng: -114.917 },
  { name: 'Vegreville',        lat: 53.500, lng: -112.050 },
  { name: 'Camrose',           lat: 53.017, lng: -112.833 },
  { name: 'Lloydminster',      lat: 53.283, lng: -110.000 },
  { name: 'Wetaskiwin',        lat: 52.967, lng: -113.367 },
  { name: 'Stettler',          lat: 52.317, lng: -112.717 },
  // South
  { name: 'Red Deer',          lat: 52.267, lng: -113.800 },
  { name: 'Drumheller',        lat: 51.467, lng: -112.717 },
  { name: 'Calgary',           lat: 51.050, lng: -114.067 },
  { name: 'Banff',             lat: 51.183, lng: -115.567 },
  { name: 'Claresholm',        lat: 50.017, lng: -113.583 },
  { name: 'Brooks',            lat: 50.567, lng: -111.900 },
  { name: 'Medicine Hat',      lat: 50.033, lng: -110.683 },
  { name: 'Pincher Creek',     lat: 49.483, lng: -113.950 },
  { name: 'Lethbridge',        lat: 49.700, lng: -112.833 },
  { name: 'Cardston',          lat: 49.200, lng: -113.300 },
].sort((a, b) => a.name.localeCompare(b.name));

/** Populate a <select id="fwi-station-picker"> and wire change events. */
function buildStationPicker() {
  const sel = document.getElementById('fwi-station-picker');
  if (!sel) return;

  sel.innerHTML = '';
  ALBERTA_STATIONS.forEach(s => {
    const opt = document.createElement('option');
    opt.value = `${s.lat},${s.lng}`;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });

  function loadStation(save = true) {
    const [lat, lng] = sel.value.split(',').map(Number);
    const name = sel.options[sel.selectedIndex].textContent;
    if (save) localStorage.setItem('fwi-station', sel.value);
    const frame = document.getElementById('fwi-map-frame');
    if (frame) {
      const pad = 0.5;
      frame.src = `https://www.openstreetmap.org/export/embed.html` +
        `?bbox=${(lng-pad).toFixed(4)},${(lat-pad).toFixed(4)},${(lng+pad).toFixed(4)},${(lat+pad).toFixed(4)}` +
        `&layer=mapnik&marker=${lat.toFixed(4)},${lng.toFixed(4)}`;
    }
    const coords = document.getElementById('fwi-map-coords');
    if (coords) coords.textContent = `${Math.abs(lat).toFixed(4)}° ${lat>=0?'N':'S'}, ${Math.abs(lng).toFixed(4)}° ${lng>=0?'E':'W'}`;
    const stLabel = document.getElementById('fwi-map-station');
    if (stLabel) stLabel.textContent = name;
    // Auto-set fuel type from station lookup; sync both pickers
    const derivedFuel = STATION_FUEL_TYPES[name] || 'C2';
    ['fwi-fuel-picker', 'fwi-fuel-picker-mobile'].forEach(id => {
      const fp = document.getElementById(id);
      if (fp) fp.value = derivedFuel;
    });
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
    ALBERTA_STATIONS.forEach(s => {
      const d = _haversineKm(userLat, userLng, s.lat, s.lng);
      if (d < minDist) { minDist = d; nearest = s; }
    });
    if (nearest) {
      const val = `${nearest.lat},${nearest.lng}`;
      sel.value = val;
      localStorage.setItem('fwi-station', val);
      loadStation(false);
    }
  }

  sel.addEventListener('change', () => loadStation(true));

  const saved = localStorage.getItem('fwi-station');
  if (selectByValue(saved)) {
    // Returning user — load saved station immediately, no geo prompt
    loadStation(false);
  } else if (navigator.geolocation) {
    // First visit — show Edmonton as placeholder, then auto-detect
    const edm = Array.from(sel.options).find(o => o.textContent === 'Edmonton') || sel.options[0];
    if (edm) sel.value = edm.value;
    loadStation(false);
    navigator.geolocation.getCurrentPosition(
      pos => selectNearest(pos.coords.latitude, pos.coords.longitude),
      ()  => loadStation(true),  // denied — save current default
      { timeout: 8000, maximumAge: 300000 }
    );
  } else {
    const edm = Array.from(sel.options).find(o => o.textContent === 'Edmonton') || sel.options[0];
    if (edm) sel.value = edm.value;
    loadStation(true);
  }
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

/** Update a single skeleton row in fwi-station-tbody with live data. */
function _updateStationTableRow(entry) {
  const id = 'srow-' + entry.name.replace(/\s+/g, '-');
  const tr = document.getElementById(id);
  if (!tr) return;
  const r = entry.result;
  const fbp = entry.fbp;
  const srcBadge = entry.srcBadge || 'NWP';
  const srcStyle = {
    'CWFIS': 'background:#14532d40;color:#4ade80;border:1px solid #166534',
    'SWOB':  'background:#17255440;color:#93c5fd;border:1px solid #1e40af',
    'NWP':   'background:#451a0340;color:#fcd34d;border:1px solid #92400e',
    'Error': 'background:#1c191740;color:#78716c;border:1px solid #44403c',
  }[srcBadge] || 'background:#1c191740;color:#78716c;border:1px solid #44403c';
  const dangerColor = {
    'Low': '#2d9e58', 'Moderate': '#7bd0ff', 'High': '#c084fc',
    'Very High': '#f97316', 'Extreme': '#ef4444',
  }[r.danger] || '#7bd0ff';
  const hfiLabel = fbp ? _hfiClass(fbp.hfi) : '—';
  const hfiNum   = fbp?.hfi != null ? Math.round(fbp.hfi).toLocaleString() : '—';
  tr.innerHTML =
    `<td class="py-2 pl-3 pr-2 font-semibold text-[#dae2fd] text-xs">${entry.name}</td>` +
    `<td class="py-2 pr-2 text-slate-500 text-[10px]">${_stationSector(entry.lat)}</td>` +
    `<td class="py-2 pr-2"><span style="font-size:8px;font-weight:700;letter-spacing:.06em;padding:1px 5px;border-radius:4px;${srcStyle}">${srcBadge}</span></td>` +
    `<td class="py-2 pr-2 text-right text-xs">${r.weather?.temp != null ? (+r.weather.temp).toFixed(1) : '—'}°</td>` +
    `<td class="py-2 pr-2 text-right text-xs">${r.weather?.rh != null ? Math.round(r.weather.rh) : '—'}%</td>` +
    `<td class="py-2 pr-2 text-right text-xs">${r.weather?.wind != null ? Math.round(r.weather.wind) : '—'}</td>` +
    `<td class="py-2 pr-2 text-right text-xs font-bold text-[#dae2fd]">${r.fwi != null ? r.fwi.toFixed(1) : '—'}</td>` +
    `<td class="py-2 pr-2 text-xs font-bold" style="color:${dangerColor}">${r.danger}</td>` +
    `<td class="py-2 pr-3 text-right text-[10px] text-slate-400">${hfiLabel}<br><span class="text-[9px] text-slate-600">${hfiNum!=='—' ? hfiNum+' kW/m' : ''}</span></td>`;

  // Update header stats from running cache
  const valid = _mapStationCache.filter(e => e.result?.fwi != null);
  const extCnt = valid.filter(e => e.result.danger === 'Extreme').length;
  const avgRH  = valid.length ? valid.reduce((s, e) => s + (e.result.weather?.rh ?? 0), 0) / valid.length : null;
  const el1 = document.getElementById('fwi-extreme-count');
  const el2 = document.getElementById('fwi-avg-rh');
  if (el1) el1.textContent = `${extCnt} Extreme`;
  if (el2 && avgRH != null) el2.textContent = `${avgRH.toFixed(0)}%`;
}

/** Sort station table by column key (asc/desc). */
function _sortStationTable(col, asc) {
  const tbody = document.getElementById('fwi-station-tbody');
  if (!tbody) return;
  const sectorOrder = ['Far North', 'North', 'Central', 'Central-South', 'South'];
  const dangerOrder = ['Low', 'Moderate', 'High', 'Very High', 'Extreme'];
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
      case 'sector':  va = sectorOrder.indexOf(_stationSector(ea.lat)); vb = sectorOrder.indexOf(_stationSector(eb.lat)); break;
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

const REGIONS = [
  { name: 'Fort McMurray',  sector: 'Northeast Boreal',  lat: 56.650, lng: -111.217 },
  { name: 'Peace River',    sector: 'Northwest Sector',  lat: 56.233, lng: -117.283 },
  { name: 'Slave Lake',     sector: 'Lesser Slave Zone', lat: 55.283, lng: -114.767 },
  { name: 'Athabasca',      sector: 'Central-North',     lat: 54.717, lng: -113.283 },
  { name: 'Edmonton',       sector: 'Central Alberta',   lat: 53.534, lng: -113.490 },
  { name: 'Lethbridge',     sector: 'Southern Alberta',  lat: 49.700, lng: -112.833 },
];

// Cache populated by buildRegionalSummary — used by exportRegionalDataset
let _regionalCache = [];
// Cache populated by buildStationMap — stores all 39 station FWI results
let _mapStationCache = [];
// Cache populated by buildForecastTrends — used by exportForecastReport
let _forecastCache = { days: [], results: [] };

const DANGER_COLORS = {
  'Low':       { bar: 'bg-secondary',         badge: 'bg-on-secondary-container/20 text-secondary',       dot: 'bg-secondary shadow-[0_0_8px_#4ae176]' },
  'Moderate':  { bar: 'bg-primary',            badge: 'bg-primary-container border border-primary/20 text-primary', dot: 'bg-primary shadow-[0_0_8px_#7bd0ff]' },
  'High':      { bar: 'bg-tertiary-fixed-dim', badge: 'bg-[#fbabff]/10 text-tertiary',                    dot: 'bg-tertiary-fixed-dim shadow-[0_0_8px_#fbabff]' },
  'Very High': { bar: 'bg-tertiary',           badge: 'bg-tertiary-container text-tertiary-fixed-dim',    dot: 'bg-tertiary-fixed-dim shadow-[0_0_8px_#fbabff]' },
  'Extreme':   { bar: 'bg-tertiary',           badge: 'bg-tertiary-container text-tertiary',              dot: 'bg-tertiary shadow-[0_0_8px_#fbabff]' },
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

  const sectorOrder = ['Far North', 'North', 'Central', 'Central-South', 'South'];
  const sorted = [...ALBERTA_STATIONS].sort((a, b) => {
    const sa = sectorOrder.indexOf(_stationSector(a.lat));
    const sb = sectorOrder.indexOf(_stationSector(b.lat));
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });

  let _sortCol = 'sector', _sortAsc = true;

  list.innerHTML = `
    <div class="overflow-x-auto rounded-xl border border-outline-variant/10">
      <table id="fwi-station-table" class="w-full text-sm">
        <thead class="bg-[#131b2e] sticky top-0">
          <tr>
            <th class="text-left py-2.5 pl-3 pr-2 font-label text-[9px] uppercase tracking-widest text-slate-500 cursor-pointer hover:text-[#7bd0ff] select-none whitespace-nowrap" data-sort="name">Station ↕</th>
            <th class="text-left py-2.5 pr-2 font-label text-[9px] uppercase tracking-widest text-slate-500 cursor-pointer hover:text-[#7bd0ff] select-none" data-sort="sector">Sector</th>
            <th class="py-2.5 pr-2 font-label text-[9px] uppercase tracking-widest text-slate-500 whitespace-nowrap">Src</th>
            <th class="text-right py-2.5 pr-2 font-label text-[9px] uppercase tracking-widest text-slate-500 cursor-pointer hover:text-[#7bd0ff] select-none" data-sort="temp">Temp</th>
            <th class="text-right py-2.5 pr-2 font-label text-[9px] uppercase tracking-widest text-slate-500 cursor-pointer hover:text-[#7bd0ff] select-none" data-sort="rh">RH</th>
            <th class="text-right py-2.5 pr-2 font-label text-[9px] uppercase tracking-widest text-slate-500 cursor-pointer hover:text-[#7bd0ff] select-none" data-sort="wind">Wind</th>
            <th class="text-right py-2.5 pr-2 font-label text-[9px] uppercase tracking-widest text-slate-500 cursor-pointer hover:text-[#7bd0ff] select-none" data-sort="fwi">FWI</th>
            <th class="text-left py-2.5 pr-2 font-label text-[9px] uppercase tracking-widest text-slate-500 cursor-pointer hover:text-[#7bd0ff] select-none" data-sort="danger">Danger</th>
            <th class="text-right py-2.5 pr-3 font-label text-[9px] uppercase tracking-widest text-slate-500 cursor-pointer hover:text-[#7bd0ff] select-none whitespace-nowrap" data-sort="hfi">HFI Cls</th>
          </tr>
        </thead>
        <tbody id="fwi-station-tbody" class="divide-y divide-[#1e2740]">
          ${sorted.map(s =>
            `<tr id="srow-${s.name.replace(/\s+/g,'-')}" class="bg-[#0f1829] hover:bg-[#131b2e] transition-colors">
              <td class="py-2 pl-3 pr-2 font-semibold text-[#dae2fd] text-xs">${s.name}</td>
              <td class="py-2 pr-2 text-slate-500 text-[10px]">${_stationSector(s.lat)}</td>
              <td colspan="7" class="py-2 pr-3 text-slate-700 text-[10px]"><span class="inline-flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-slate-700 animate-pulse inline-block"></span>loading</span></td>
            </tr>`
          ).join('')}
        </tbody>
      </table>
    </div>`;

  // Wire sortable column headers
  list.querySelectorAll('#fwi-station-table th[data-sort]').forEach(th => {
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

/** Return nearest NAEFS station within 150 km, or null. */
function findNearestNAEFS(lat, lng) {
  let best = null, bestDist = Infinity;
  for (const st of NAEFS_AB_STATIONS) {
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NAEFS WFS ${res.status}`);
  const d = await res.json();
  return d.features
    .map(f => {
      const p = f.properties;
      const dt = new Date(p.date_time);
      const label = dt.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
      // NAEFS max_temp / min_rh / median_ws already represent peak afternoon conditions
      const peakTemp = p.max_temp ?? 15;
      const peakRh   = p.min_rh   ?? 40;
      const peakWind = p.median_ws ?? 10;
      return {
        temp:  peakTemp,
        rh:    peakRh,
        wind:  peakWind,
        rain:  p.median_pcp  ?? 0,
        month: dt.getMonth() + 1,
        label,
        _ts: dt.getTime(),  // preserve original timestamp for reliable sort
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
    `&timezone=auto&forecast_days=7&models=ecmwf_ifs025`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo forecast ${res.status}`);
  const d = await res.json();
  const h = d.hourly;
  const days = [];
  // Pick hour index 12 (noon) for FWI chain (CFFDRS standard) and hour 14 for peak burn FBP
  for (let day = 0; day < 7; day++) {
    const i12 = day * 24 + 12;
    const i14 = day * 24 + 14;
    if (i12 >= (h.time?.length ?? 0)) continue;
    const date = new Date(h.time[i12]);
    days.push({
      temp:  h.temperature_2m[i12]       ?? 15,
      rh:    h.relative_humidity_2m[i12]  ?? 40,
      wind:  h.wind_speed_10m[i12]        ?? 10,
      rain:  h.precipitation[i12]         ?? 0,
      month: date.getMonth() + 1,
      label: date.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }),
      _ts: date.getTime(),
      peak: {
        temp: h.temperature_2m[i14]        ?? h.temperature_2m[i12]        ?? 15,
        rh:   h.relative_humidity_2m[i14]  ?? h.relative_humidity_2m[i12]  ?? 40,
        wind: h.wind_speed_10m[i14]        ?? h.wind_speed_10m[i12]        ?? 10,
        wdir: h.wind_direction_10m?.[i14]  ?? h.wind_direction_10m?.[i12]  ?? null,
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo hourly ${res.status}`);
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
 * Chains Van Wagner hour-by-hour from STARTUP defaults.
 */
async function buildHourlyChart(lat, lng, stationName = 'Edmonton') {
  const container = document.getElementById('fwi-chart-bars');
  if (!container) return;

  let hours;
  try {
    hours = await fetchHourly(lat, lng);
  } catch (e) {
    console.warn('[FWI Chart]', e);
    return;
  }
  if (!hours.length) return;

  let prev = { ffmc: STARTUP.ffmc, dmc: STARTUP.dmc, dc: getStartupDC(stationName) };
  const results = hours.map(w => {
    const r = calculateFWI(w, prev);
    prev = { ffmc: r.ffmc, dmc: r.dmc, dc: r.dc };
    return { fwi: r.fwi, danger: r.danger, time: w.time };
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
      `<div class="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 bg-surface-container-highest px-2 py-1 rounded text-[10px] whitespace-nowrap z-10">${timeLabel} — ${fmt(r.fwi)}</div>` +
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
  // Guard against null values propagating through chain
  return days.map(w => {
    const safe = {
      temp:  w.temp  ?? 15,
      rh:    w.rh    ?? 40,
      wind:  w.wind  ?? 10,
      rain:  w.rain  ?? 0,
      month: w.month ?? (new Date().getMonth() + 1),
    };
    const r = calculateFWI(safe, prev);
    prev = { ffmc: r.ffmc, dmc: r.dmc, dc: r.dc };
    return { ...r, label: w.label };
  });
}

/** Read persisted fuel type (set by station_detail fuel picker), default C2. */
function _savedFuelCode() {
  return (typeof localStorage !== 'undefined' && localStorage.getItem('fwi-fuel-type')) || 'C2';
}
function _savedCuring() {
  return parseInt((typeof localStorage !== 'undefined' && localStorage.getItem('fwi-grass-curing')) || '80', 10);
}

/** Chain Van Wagner + FBP per day. FBP uses each day's peak (14:00) conditions.
 *  Returns results array where each element has { ...fwiResult, fbp, peakWeather }. */
function calcMultiDayFBP(days, startupDC = 300, startState = null, fuelCode = 'C2', curing = 100) {
  const results = calcMultiDay(days, startupDC, startState);
  return results.map((r, i) => {
    const pw = days[i]?.peak || days[i]; // peak = 14:00; fallback to noon
    const fbp = calculateFBP(fuelCode, r.ffmc, r.dmc, r.dc, pw.wind ?? r.weather?.wind ?? 10, 0, curing);
    return { ...r, fbp, peakWeather: pw };
  });
}

function trendLabel(fwi, prevFwi) {
  const delta = fwi - prevFwi;
  if (delta > 5)  return 'ESCALATING';
  if (delta < -5) return 'IMPROVING';
  return 'STABLE';
}

async function buildForecastTrends(lat = 53.5344, lng = -113.4903, stationName = 'Edmonton') {
  try {
    // Prefer NAEFS (Environment Canada 14-day ensemble at fire weather stations)
    // Fall back to Open-Meteo if no NAEFS station within 150 km
    let days, forecastSource;
    const naefsSt = findNearestNAEFS(lat, lng);
    if (naefsSt) {
      try {
        days = await fetchForecastNAEFS(naefsSt.code);
        forecastSource = `NAEFS 14-day ensemble (${naefsSt.name})`;
      } catch (e) {
        console.warn('[FWI] NAEFS fetch failed, falling back to Open-Meteo:', e);
        days = await fetchForecast(lat, lng);
        forecastSource = 'ECMWF IFS 0.25° (Open-Meteo)';
      }
    } else {
      days = await fetchForecast(lat, lng);
      forecastSource = 'Open-Meteo NWP';
    }
    // Start the chain from today's observed FFMC/DMC/DC if available; otherwise cold-start
    const chainStart = _lastFWI ? { ffmc: _lastFWI.ffmc, dmc: _lastFWI.dmc, dc: _lastFWI.dc } : null;
    const fuelCode = _savedFuelCode();
    const results = calcMultiDayFBP(days, getStartupDC(stationName), chainStart, fuelCode, _savedCuring());
    _forecastCache = { days, results, fuelCode };
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
      const c = DANGER_COLORS[peakDay.danger] || DANGER_COLORS['Moderate'];
      elPWR.textContent = peakDay.danger;
      elPWR.className   = `text-[10px] font-bold uppercase px-2 py-1 rounded-full ${c.badge}`;
    }

    // Days at elevated risk (FWI ≥ 19 = High)
    const daysAtRisk = results.filter(r => r.fwi >= 20).length;
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

    // Data source pill
    const elSrc = document.getElementById('fwi-source-label');
    if (elSrc) elSrc.textContent = forecastSource;

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

    // D+1 Peak Burn section — first forecast day that is strictly after today
    // NAEFS can include past days; find the first day with _ts >= tomorrow midnight
    const _todayMid = new Date(); _todayMid.setHours(0,0,0,0);
    const _tomorrowMid = new Date(_todayMid); _tomorrowMid.setDate(_tomorrowMid.getDate() + 1);
    const d1Idx = days.findIndex(d => d._ts && d._ts >= _tomorrowMid.getTime());
    const d1SafeIdx = d1Idx >= 0 ? d1Idx : 0;
    if (results.length > 0) {
      const d1 = results[d1SafeIdx];
      const d1fbp = d1.fbp;
      const d1pw  = d1.peakWeather || d1;
      const d1c   = DANGER_COLORS[d1.danger] || DANGER_COLORS['Moderate'];
      const setD1 = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      setD1('fwi-d1-label', d1.label || 'D+1');
      setD1('fwi-d1-temp',  fmt(d1pw.temp) + '°C');
      setD1('fwi-d1-rh',    fmt(d1pw.rh, 0) + '%');
      setD1('fwi-d1-wind',  fmt(d1pw.wind, 0) + ' km/h');
      setD1('fwi-d1-isi',   d1.isi.toFixed(1));
      setD1('fwi-d1-fwi',   d1.fwi.toFixed(1));
      const d1RatingEl = document.getElementById('fwi-d1-rating');
      if (d1RatingEl) { d1RatingEl.textContent = d1.danger; d1RatingEl.className = `ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${d1c.badge}`; }
      if (d1fbp) {
        const hfiColour = d1fbp.hfi >= 4000 ? 'text-tertiary' : d1fbp.hfi >= 2000 ? 'text-orange-400' : d1fbp.hfi >= 500 ? 'text-yellow-400' : 'text-secondary';
        setD1('fwi-d1-ros',   d1fbp.ros.toFixed(1));
        const d1HfiEl = document.getElementById('fwi-d1-hfi');
        if (d1HfiEl) { d1HfiEl.textContent = Math.round(d1fbp.hfi).toLocaleString(); d1HfiEl.className = `font-headline text-2xl font-bold ${hfiColour}`; }
        setD1('fwi-d1-flame', d1fbp.flameLength.toFixed(1) + ' m');
        setD1('fwi-d1-type',  d1fbp.fireType);
        setD1('fwi-d1-cfb',   (d1fbp.cfb * 100).toFixed(0) + '%');
      }
      const fuelName = FUEL_TYPES[fuelCode]?.name || fuelCode;
      setD1('fwi-d1-fuel', `${fuelCode} — ${fuelName}`);
      // Escape warning
      const d1WarnEl = document.getElementById('fwi-d1-escape-warn');
      if (d1WarnEl) d1WarnEl.style.display = (d1fbp && d1fbp.hfi >= 4000) ? 'block' : 'none';
    }

    // Bar chart — all 7 days, coloured by danger rating
    const barContainer = document.getElementById('fwi-trend-bars');
    if (barContainer) {
      barContainer.innerHTML = results.map(r => {
        const h = Math.max(4, (r.fwi / maxFWI) * 100).toFixed(1);
        const c = DANGER_COLORS[r.danger] || DANGER_COLORS['Moderate'];
        return `<div class="w-full ${c.bar} rounded-t-sm transition-colors relative group cursor-help" style="height:${h}%">` +
          `<div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-[9px] text-on-surface bg-surface-container-highest px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">${r.label} — ${r.fwi.toFixed(1)} (${r.danger})</div>` +
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
        const dc  = DANGER_COLORS[r.danger] || DANGER_COLORS['Moderate'];
        const hfiColour = !fbp ? '' : fbp.hfi >= 4000 ? 'color:#ff4d4d' : fbp.hfi >= 2000 ? 'color:#fb923c' : fbp.hfi >= 500 ? 'color:#facc15' : 'color:#4ae176';
        const isD1 = i === 0;
        return `<tr class="hover:bg-surface-container transition-colors ${isD1 ? 'bg-surface-container/50' : ''}">
  <td class="py-3 pl-4 font-headline font-bold text-white text-sm">${r.label}${isD1 ? ' <span class="text-[9px] font-label text-primary ml-1">D+1</span>' : ''}</td>
  <td class="py-3 text-sm text-on-surface-variant">${fmt(pw?.temp ?? days[i]?.temp)}°C</td>
  <td class="py-3 text-sm ${(pw?.rh ?? days[i]?.rh) < 30 ? 'text-tertiary font-bold' : 'text-on-surface-variant'}">${fmt(pw?.rh ?? days[i]?.rh, 0)}%</td>
  <td class="py-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${dc.badge}">${r.fwi.toFixed(1)}</span></td>
  <td class="py-3 text-sm text-on-surface-variant">${fbp ? fbp.ros.toFixed(1) : '—'}</td>
  <td class="py-3 text-sm font-bold" style="${hfiColour}">${fbp ? Math.round(fbp.hfi).toLocaleString() : '—'}</td>
  <td class="py-3 text-sm text-on-surface-variant">${fbp ? fbp.fireType : '—'}</td>
</tr>`;
      }).join('');
    }

    // Trend table — top 5 stations, loaded sequentially to avoid rate-limiting
    const tbody = document.getElementById('fwi-trend-tbody');
    if (tbody) {
      const tableStations = REGIONS.slice(0, 5);
      let tableHTML = '';
      for (const reg of tableStations) {
        try {
          const w = await fetchWeatherPrimary(reg.lat, reg.lng);
          const r = calculateFWI(w);
          const name = reg.name.toUpperCase();
          tableHTML += `
<tr class="hover:bg-surface-container transition-colors">
  <td class="py-5 pl-6">
    <span class="block text-white font-bold font-headline">${name}</span>
  </td>
  <td class="py-5 font-headline font-bold text-white">${fmt(r.weather.temp)}°C</td>
  <td class="py-5 font-bold ${r.weather.rh < 30 ? 'text-tertiary' : 'text-secondary'}">RH ${fmt(r.weather.rh, 0)}%</td>
  <td class="py-5">
    <span class="px-3 py-1 rounded-full text-[10px] font-bold ${r.danger === 'Extreme' ? 'bg-tertiary-container text-tertiary' : r.danger === 'High' || r.danger === 'Very High' ? 'bg-[#fbabff]/10 text-tertiary' : 'bg-secondary-container/20 text-secondary border border-secondary/20'}">${r.danger.toUpperCase()}</span>
  </td>
  <td class="py-5 pr-6">
    <div class="w-24 h-1 bg-surface-container-highest rounded-full overflow-hidden">
      <div class="h-full bg-primary" style="width:${Math.min(100, r.fwi * 2).toFixed(1)}%"></div>
    </div>
    <span class="text-xs text-outline mt-1 block">${fmt(r.fwi)}</span>
  </td>
</tr>`;
        } catch (e) {
          console.warn(`[FWI Trend Table] ${reg.name}:`, e);
          tableHTML += `<tr><td colspan="5" class="py-3 pl-6 text-slate-600 text-xs">${reg.name} — unavailable</td></tr>`;
        }
      }
      tbody.innerHTML = tableHTML;
    }
  } catch (e) {
    console.warn('[FWI Forecast]', e);
    const tbody = document.getElementById('fwi-trend-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center text-slate-500 py-6">Forecast unavailable — check connection</td></tr>`;
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

// ─── Export ──────────────────────────────────────────────────────────────────

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
  _triggerCSVDownload(rows, `fwi-alberta-${new Date().toISOString().slice(0,10)}.csv`);
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

// ─── ICS Print Briefings ─────────────────────────────────────────────────────

/**
 * Print Provincial Briefing — landscape A4/Letter, ICS-formatted.
 * Uses _mapStationCache (all 39 stations) if populated, else _regionalCache (5 zones).
 */
function printProvincialBriefing() {
  // Determine data source
  const useMap = _mapStationCache.length > 0;
  const useRegional = !useMap && _regionalCache.length > 0;
  if (!useMap && !useRegional) { alert('Data still loading — try again in a moment.'); return; }

  const now   = new Date();
  const today = now.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const prepared = now.toLocaleString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });

  // Print-safe danger colours
  const PRINT_COLORS = {
    'Low':       { bg: '#d4edda', text: '#155724' },
    'Moderate':  { bg: '#cce5ff', text: '#004085' },
    'High':      { bg: '#e2d9f3', text: '#4a235a' },
    'Very High': { bg: '#ffe5cc', text: '#7d3200' },
    'Extreme':   { bg: '#f8d7da', text: '#721c24' },
  };
  const SVG_COLORS = {
    'Low':       '#2d9e5f',
    'Moderate':  '#2980b9',
    'High':      '#8e44ad',
    'Very High': '#e67e22',
    'Extreme':   '#c0392b',
  };

  // Build station rows — sort by FWI descending within each sector grouping
  let rows;
  if (useMap) {
    // Assign sector from ALBERTA_STATIONS lookup
    const sectorMap = {};
    ALBERTA_STATIONS.forEach(s => {
      // Derive sector from lat bands
      if (s.lat >= 56.5) sectorMap[s.name] = 'Far North';
      else if (s.lat >= 54.5) sectorMap[s.name] = 'North';
      else if (s.lat >= 53.0) sectorMap[s.name] = 'Central';
      else if (s.lat >= 51.5) sectorMap[s.name] = 'Central-South';
      else sectorMap[s.name] = 'South';
    });
    const sectorOrder = ['Far North', 'North', 'Central', 'Central-South', 'South'];
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

  // Tally danger counts
  const tally = { Low: 0, Moderate: 0, High: 0, 'Very High': 0, Extreme: 0 };
  rows.forEach(r => { if (tally[r.danger] !== undefined) tally[r.danger]++; });

  // Build SVG Alberta map
  const SVG_RING = { '3-High':'#c8960c','4-VH':'#c84b00','5-Ext':'#b71c1c','6-Cat':'#880e4f' };
  const LABEL_STNS = new Set(['Fort McMurray','Edmonton','Calgary','Lethbridge','Medicine Hat','Grande Prairie','Fort Chipewyan','High Level']);
  // Each station: circle + FWI number + HFI class text inside
  const svgPoints = rows.map(r => {
    const x = +((r.lng - (-120)) / 10 * 300).toFixed(1);
    const y = +((60 - r.lat) / 11 * 340).toFixed(1);
    const fill = SVG_COLORS[r.danger] || '#2980b9';
    const ring = SVG_RING[r.hfiClass] || fill;
    const rw = SVG_RING[r.hfiClass] ? '2' : '1';
    const rad = ['Extreme','Very High'].includes(r.danger) ? 12 : 10;
    const fwiLabel = r.fwi != null ? r.fwi.toFixed(1) : '—';
    const hfiLabel = r.hfiClass || '—';
    return `<g><circle cx="${x}" cy="${y}" r="${rad}" fill="${fill}" stroke="${ring}" stroke-width="${rw}" opacity="0.95"/>` +
           `<text x="${x}" y="${y - 1}" font-size="6.5" font-weight="700" fill="white" text-anchor="middle" dominant-baseline="middle" style="text-shadow:0 0 2px rgba(0,0,0,0.6)">${fwiLabel}</text>` +
           `<text x="${x}" y="${y + 5.5}" font-size="5" fill="rgba(255,255,255,0.88)" text-anchor="middle" dominant-baseline="middle">${hfiLabel}</text>` +
           `<title>${r.name}: FWI ${fwiLabel} (${r.danger})${r.hfi != null ? ' · HFI ' + Math.round(r.hfi).toLocaleString() + ' kW/m (' + r.hfiClass + ')' : ''}</title>` +
           `</g>`;
  }).join('\n    ');
  const svgLabels = rows.filter(r => LABEL_STNS.has(r.name)).map(r => {
    const x = parseFloat(((r.lng - (-120)) / 10 * 300).toFixed(1));
    const y = parseFloat(((60 - r.lat) / 11 * 340).toFixed(1));
    const right = x > 200;
    const short = r.name.replace('Fort McMurray','Ft McMurray').replace('Fort Chipewyan','Ft Chipewyan').replace('Grande Prairie','Gde Prairie');
    return `<text x="${(x + (right ? -14 : 14)).toFixed(0)}" y="${(y + 4).toFixed(0)}" font-size="7" fill="#333" text-anchor="${right ? 'end' : 'start'}" font-style="italic">${short}</text>`;
  }).join('\n    ');

  // Build table rows HTML
  const tableRows = rows.map((r, i) => {
    const bg = i % 2 === 0 ? '#ffffff' : '#f9f9f9';
    const dc = PRINT_COLORS[r.danger] || PRINT_COLORS['Moderate'];
    const hfiBg = { '3-High': '#fff9c4', '4-VH': '#ffe0b2', '5-Ext': '#ffcdd2', '6-Cat': '#ef9a9a' }[r.hfiClass] || '';
    return `<tr style="background:${bg}">
      <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;font-weight:600">${r.name}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;text-align:center">${r.sector}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;text-align:center">${r.temp != null ? (+r.temp).toFixed(1) + '°C' : '—'}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;text-align:center">${r.rh != null ? Math.round(r.rh) + '%' : '—'}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;text-align:center">${r.wind != null ? Math.round(r.wind) + ' km/h' : '—'}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;text-align:center">${r.dc != null ? r.dc.toFixed(0) : '—'}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;text-align:center;font-weight:700">${r.fwi != null ? r.fwi.toFixed(1) : '—'}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #e0e0e0;text-align:center;font-size:8pt;${hfiBg ? 'background:'+hfiBg+';' : ''}font-weight:600">${r.hfiClass}${r.hfi != null ? '<br><span style="font-size:7.5pt;font-weight:400;color:#555">' + Math.round(r.hfi).toLocaleString() + ' kW/m</span>' : ''}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e0e0e0;text-align:center;background:${dc.bg};color:${dc.text};font-weight:700;font-size:9pt">${r.danger}</td>
    </tr>`;
  }).join('\n');

  const summaryParts = ['Extreme', 'Very High', 'High', 'Moderate', 'Low']
    .filter(d => tally[d] > 0)
    .map(d => `${tally[d]} ${d}`).join(' · ');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Alberta FWI — Provincial Briefing</title>
<style>
  @media print {
    @page { size: landscape; margin: 1cm; }
    body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; }
    .no-print { display: none; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; margin: 0; padding: 12px; }
  .header-box { border: 2px solid #333; padding: 10px 14px; margin-bottom: 10px; }
  .header-title { font-size: 14pt; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; margin: 0 0 4px; }
  .header-meta { font-size: 9pt; color: #444; margin: 0; }
  .content-wrap { display: flex; gap: 16px; align-items: flex-start; }
  .table-wrap { flex: 1 1 auto; overflow: hidden; }
  .map-wrap { flex: 0 0 310px; }
  table { border-collapse: collapse; width: 100%; font-size: 9pt; }
  th { background: #333; color: #fff; padding: 5px 6px; text-align: center; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
  th:first-child { text-align: left; }
  .zone-summary { border: 1px solid #ccc; padding: 7px 10px; margin-top: 10px; font-size: 9pt; background: #f5f5f5; }
  .sign-block { display: flex; gap: 40px; margin-top: 8px; border-top: 1px solid #ccc; padding-top: 8px; font-size: 9pt; }
  .sign-line { border-bottom: 1px solid #333; min-width: 160px; display: inline-block; margin-right: 4px; }
  .legend-row { display: flex; gap: 12px; margin-top: 6px; flex-wrap: wrap; font-size: 8pt; }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
</style>
</head>
<body>
<div class="header-box">
  <p class="header-title">Alberta Fire Weather Index — Provincial Briefing</p>
  <p class="header-meta">
    Operational Period: ${today} 0600–1800 MDT &nbsp;·&nbsp;
    Prepared: ${prepared} &nbsp;·&nbsp;
    Source: CWFIS / MSC SWOB / Open-Meteo NWP &nbsp;·&nbsp;
    tphambolio.github.io/FWI
  </p>
</div>
<div class="content-wrap">
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th style="text-align:left">Station</th>
          <th>Sector</th>
          <th>Temp</th>
          <th>RH</th>
          <th>Wind</th>
          <th>DC</th>
          <th>FWI</th>
          <th>HFI Class</th>
          <th>Rating</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </div>
  <div class="map-wrap">
    <svg viewBox="0 0 300 340" width="300" height="340" style="border:1px solid #bbb;display:block">
      <!-- Background -->
      <rect x="0" y="0" width="300" height="340" fill="#e8eef4"/>
      <!-- Alberta approximate outline: NW→NE→SE then west boundary (continental divide) -->
      <polygon points="0,0 300,0 300,340 165,340 150,309 120,278 75,247 45,216 20,185 0,155"
               fill="#f0f4f0" stroke="#888" stroke-width="1.2"/>
      <!-- Grid lines at lat 50, 52, 54, 56, 58 -->
      <line x1="0" y1="${((60-50)/11*340).toFixed(0)}" x2="300" y2="${((60-50)/11*340).toFixed(0)}" stroke="#ccc" stroke-width="0.5" stroke-dasharray="4,3"/>
      <line x1="0" y1="${((60-52)/11*340).toFixed(0)}" x2="300" y2="${((60-52)/11*340).toFixed(0)}" stroke="#ccc" stroke-width="0.5" stroke-dasharray="4,3"/>
      <line x1="0" y1="${((60-54)/11*340).toFixed(0)}" x2="300" y2="${((60-54)/11*340).toFixed(0)}" stroke="#ccc" stroke-width="0.5" stroke-dasharray="4,3"/>
      <line x1="0" y1="${((60-56)/11*340).toFixed(0)}" x2="300" y2="${((60-56)/11*340).toFixed(0)}" stroke="#ccc" stroke-width="0.5" stroke-dasharray="4,3"/>
      <line x1="0" y1="${((60-58)/11*340).toFixed(0)}" x2="300" y2="${((60-58)/11*340).toFixed(0)}" stroke="#ccc" stroke-width="0.5" stroke-dasharray="4,3"/>
      <!-- Lat labels -->
      <text x="2" y="${((60-58)/11*340-2).toFixed(0)}" font-size="6.5" fill="#999">58°N</text>
      <text x="2" y="${((60-56)/11*340-2).toFixed(0)}" font-size="6.5" fill="#999">56°N</text>
      <text x="2" y="${((60-54)/11*340-2).toFixed(0)}" font-size="6.5" fill="#999">54°N</text>
      <text x="2" y="${((60-52)/11*340-2).toFixed(0)}" font-size="6.5" fill="#999">52°N</text>
      <text x="2" y="${((60-50)/11*340-2).toFixed(0)}" font-size="6.5" fill="#999">50°N</text>
      <!-- Station labels -->
      ${svgLabels}
      <!-- Station dots (fill=FWI danger, ring=HFI class) -->
      ${svgPoints}
    </svg>
    <!-- FWI danger legend -->
    <div class="legend-row">
      <div class="legend-item"><span class="legend-dot" style="background:#2d9e5f"></span>Low</div>
      <div class="legend-item"><span class="legend-dot" style="background:#2980b9"></span>Moderate</div>
      <div class="legend-item"><span class="legend-dot" style="background:#8e44ad"></span>High</div>
      <div class="legend-item"><span class="legend-dot" style="background:#e67e22"></span>V.High</div>
      <div class="legend-item"><span class="legend-dot" style="background:#c0392b"></span>Extreme</div>
    </div>
    <!-- HFI ring legend -->
    <div class="legend-row" style="margin-top:4px">
      <span style="font-size:7pt;color:#555;font-weight:700;margin-right:4px">HFI ring:</span>
      <div class="legend-item"><span class="legend-dot" style="background:#fff;border:1.5px solid #999"></span>Low/Mod</div>
      <div class="legend-item"><span class="legend-dot" style="background:#fff;border:2px solid #ffee58"></span>High</div>
      <div class="legend-item"><span class="legend-dot" style="background:#fff;border:2px solid #ffa726"></span>V.High</div>
      <div class="legend-item"><span class="legend-dot" style="background:#fff;border:2.5px solid #ef5350"></span>Extreme+</div>
    </div>
  </div>
</div>
<div class="zone-summary">
  <strong>Zone Summary (${rows.length} stations):</strong> ${summaryParts || 'No data'}
</div>
<div class="sign-block">
  <div>Prepared by: <span class="sign-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div>
  <div>Position/ICS Title: <span class="sign-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div>
  <div>Date/Time: <span class="sign-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div>
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

/**
 * Print Station Briefing — portrait A4/Letter, ICS-formatted.
 * Uses _lastFWI, _lastWeather, _lastVWCalc, _forecastCache.
 */
async function printStationBriefing() {
  if (!_lastFWI) { alert('Load a station first.'); return; }

  // Fetch forecast on-demand if not yet loaded (user printing from station detail without visiting forecast page)
  if (_forecastCache.results.length === 0) {
    try {
      const naefsSt = findNearestNAEFS(_stationLat, _stationLng);
      let days;
      if (naefsSt) {
        try { days = await fetchForecastNAEFS(naefsSt.code); }
        catch (e) { days = await fetchForecast(_stationLat, _stationLng); }
      } else {
        days = await fetchForecast(_stationLat, _stationLng);
      }
      const chainStart = _lastFWI ? { ffmc: _lastFWI.ffmc, dmc: _lastFWI.dmc, dc: _lastFWI.dc } : null;
      const results = calcMultiDay(days, getStartupDC(_stationName), chainStart);
      _forecastCache = { days, results };
    } catch (e) {
      console.warn('[FWI] printStationBriefing: forecast fetch failed', e);
    }
  }

  const r = _lastFWI;
  const w = _lastWeather || r.weather;
  const now   = new Date();
  const today = now.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const prepared = now.toLocaleString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });

  const stationDisplayName = _stationName || 'Alberta Station';
  const lat = _stationLat;
  const lng = _stationLng;
  const fuelCode = (typeof document !== 'undefined' && document.getElementById('fwi-fuel-picker')?.value) || 'C2';
  const fuelName = FUEL_TYPES[fuelCode]?.name || fuelCode;
  const doy = Math.ceil((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const fmc = calcFMC(lat, doy);

  // FBP prediction
  const fbp = calculateFBP(fuelCode, r.ffmc, r.dmc, r.dc, w?.wind || 0, 0);

  // DC source
  const dcSource = w?.fwiFromCWFIS ? 'CWFIS carry-over' : 'Regional estimate';

  // Danger colour for print
  const PRINT_BG = {
    'Low':       { bg: '#d4edda', text: '#155724' },
    'Moderate':  { bg: '#cce5ff', text: '#004085' },
    'High':      { bg: '#e2d9f3', text: '#4a235a' },
    'Very High': { bg: '#ffe5cc', text: '#7d3200' },
    'Extreme':   { bg: '#f8d7da', text: '#721c24' },
  };
  const dc = PRINT_BG[r.danger] || PRINT_BG['Moderate'];

  // Alberta danger class helper — inline badge HTML (abbreviated labels for table fit)
  const classBadge = (fwi) => {
    const cl = dangerClassNum(fwi);
    const short = cl.label === 'Moderate' ? 'Mod' : cl.label === 'Very High' ? 'V. High' : cl.label;
    return `<span style="display:inline-block;min-width:22px;padding:1px 6px;border-radius:3px;background:${cl.bg};color:${cl.text};font-size:9pt;font-weight:900;text-align:center">${cl.num}</span> ${short}`;
  };
  // HFI class badge — number + plain-language label + operational descriptor
  const hfiBadge = (hfi) => {
    const cl = hfiClassInfo(hfi);
    return `<span style="display:inline-block;min-width:22px;padding:1px 6px;border-radius:3px;background:${cl.bg};color:${cl.text};font-size:9pt;font-weight:900;text-align:center">${cl.num}</span> <strong>${cl.label}</strong> <span style="font-size:8pt;font-weight:400">${cl.desc}</span>`;
  };

  // Source label
  const srcLabel = w?.stationName ? `CWFIS · ${w.stationName}` : (w?.source || 'Open-Meteo NWP');

  // Forecast source label — NAEFS days carry a stationName; Open-Meteo/ECMWF days do not
  const { days: fDays, results: fResults } = _forecastCache;
  const fSrcLabel = fDays[0]?.stationName ? 'NAEFS CDA' : 'ECMWF IFS 0.25° · Open-Meteo';
  let forecastRows = '';
  if (fResults.length > 0) {
    forecastRows = fResults.map((fr, i) => {
      const fd  = fDays[i] || {};
      const fpw = fd.peak || fd; // peak (14:00) conditions for FBP
      const fdc = PRINT_BG[fr.danger] || PRINT_BG['Moderate'];
      const ffbp = fr.fbp;
      const hfiTxt = ffbp ? Math.round(ffbp.hfi).toLocaleString() : '—';
      const hfiClassTxt = !ffbp ? '—' : (() => { const cl = hfiClassInfo(ffbp.hfi); return `<span style="display:inline-block;min-width:20px;padding:1px 6px;border-radius:3px;background:${cl.bg};color:${cl.text};font-weight:900;font-size:9pt;text-align:center">${cl.num}</span>`; })();
      const isD1 = i === 0;
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
    forecastRows = '<tr><td colspan="8" style="padding:8px;text-align:center;color:#888">Forecast data not loaded — visit Forecast page first</td></tr>';
  }

  // D+1 peak burn block — find first day strictly after today
  const _pTodayMid = new Date(); _pTodayMid.setHours(0,0,0,0);
  const _pTomMid   = new Date(_pTodayMid); _pTomMid.setDate(_pTomMid.getDate() + 1);
  const _pd1Idx    = fDays.findIndex(d => d._ts && d._ts >= _pTomMid.getTime());
  const _pd1Safe   = _pd1Idx >= 0 ? _pd1Idx : 0;
  const d1r  = fResults[_pd1Safe];
  const d1d  = fDays[_pd1Safe];
  const d1pw = d1d?.peak || d1d || {};
  const d1fbp = d1r?.fbp;
  const tomorrowDate = d1r?.label || 'D+1';
  const d1HfiRating = !d1fbp ? '—' : d1fbp.hfi >= 4000 ? 'EXTREME' : d1fbp.hfi >= 2000 ? 'VERY HIGH' : d1fbp.hfi >= 500 ? 'HIGH' : 'LOW';
  const d1HfiColor  = !d1fbp ? '#333' : d1fbp.hfi >= 4000 ? '#c0392b' : d1fbp.hfi >= 2000 ? '#d35400' : d1fbp.hfi >= 500 ? '#856404' : '#155724';
  const d1EscapeNote = d1fbp && d1fbp.hfi >= 4000
    ? `<p style="margin:8px 0 0;padding:6px 10px;background:#f8d7da;border-left:4px solid #c0392b;color:#721c24;font-weight:700;font-size:9pt">⚠ D+1 HFI ≥ 4,000 kW/m — potential for escaped fire tomorrow during peak burn period</p>` : '';
  const d1Section = d1r ? `
<div class="section">
  <div class="section-title" style="background:#1a3a5c">Next Operational Period · ${tomorrowDate} · Predicted Peak Burn (~14:00 MDT)</div>
  <div class="section-body">
    <div class="grid-2">
      <p class="kv"><span class="label">Weather (~14:00 MDT)</span><br><span class="val">${(+d1pw.temp||0).toFixed(1)}°C / ${Math.round(d1pw.rh||0)}% RH / ${Math.round(d1pw.wind||0)} km/h</span></p>
      <p class="kv"><span class="label">FWI</span><br><span class="val" style="color:${d1HfiColor}">${Math.round(d1r.fwi)} — ${d1r.danger}</span></p>
      <p class="kv"><span class="label">Head ROS</span><br><span class="val">${d1fbp ? d1fbp.ros.toFixed(1) + ' m/min' : '—'}</span></p>
      <p class="kv"><span class="label">Head Fire Intensity</span><br><span class="val" style="color:${d1HfiColor}">${d1fbp ? Math.round(d1fbp.hfi).toLocaleString('en-CA') + ' kW/m' : '—'}</span></p>
      <p class="kv"><span class="label">Flame Length</span><br><span class="val">${d1fbp ? d1fbp.flameLength.toFixed(1) + ' m' : '—'}</span></p>
      <p class="kv"><span class="label">Fire Type / CFB</span><br><span class="val">${d1fbp ? d1fbp.fireType + ' / ' + (d1fbp.cfb*100).toFixed(0) + '%' : '—'}</span></p>
    </div>
    ${d1fbp ? `<div style="margin-top:6px;padding:5px 8px;border-left:4px solid #1a3a5c;background:#f0f4ff"><span style="font-size:8pt;color:#555;text-transform:uppercase;letter-spacing:0.04em">FBP System HFI Class &nbsp;</span>${hfiBadge(d1fbp.hfi)}</div>` : ''}
    ${d1EscapeNote}
    <p style="font-size:7.5pt;color:#888;margin-top:4px">FWI chain: hour 12 (noon LST) · FBP peak: hour 14 (14:00 MDT) · ${fSrcLabel} · Forecast valid: ${tomorrowDate} · Prepared: ${prepared}</p>
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
    Operational Period: ${today} 0600–1800 MDT<br>
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

<p style="font-size:8pt;color:#444;margin:0 0 6px;padding:5px 10px;background:#f0f0f0;border-left:3px solid #888;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">Fuel Model: ${fuelCode} — ${fuelName} &nbsp;·&nbsp; FBP ST-X-3 &nbsp;·&nbsp; FMC: ${fmc.toFixed(0)}% (seasonal · DOY ${doy})${(fuelCode==='O1a'||fuelCode==='O1b') ? ` &nbsp;·&nbsp; Curing: ${_savedCuring()}% (CF=${(0.005*(Math.exp(0.061*_savedCuring())-1)).toFixed(3)})` : ''}</p>

<div class="section">
  <div class="section-title">Current Fire Behaviour · Today · ${today}</div>
  <div class="section-body">
    <div class="grid-2">
      <p class="kv"><span class="label">Weather (Noon LST)</span><br><span class="val">${w?.temp != null ? (+w.temp).toFixed(1) : '—'}°C / ${Math.round(w?.rh??0)}% RH / ${Math.round(w?.wind??0)} km/h</span></p>
      <p class="kv"><span class="label">FWI</span><br><span class="val">${Math.round(r.fwi)} — ${r.danger}</span></p>
      <p class="kv"><span class="label">Head ROS</span><br><span class="val">${fbp ? fbp.ros.toFixed(1) + ' m/min' : '—'}</span></p>
      <p class="kv"><span class="label">Head Fire Intensity</span><br><span class="val">${fbp ? Math.round(fbp.hfi).toLocaleString('en-CA') + ' kW/m' : '—'}</span></p>
      <p class="kv"><span class="label">Flame Length</span><br><span class="val">${fbp ? fbp.flameLength.toFixed(1) + ' m' : '—'}</span></p>
      <p class="kv"><span class="label">Fire Type / CFB</span><br><span class="val">${fbp ? fbp.fireType + ' / ' + (fbp.cfb*100).toFixed(0) + '%' : '—'}</span></p>
    </div>
    ${fbp ? `<div style="margin-top:6px;padding:5px 8px;border-left:4px solid ${hfiClassInfo(fbp.hfi).bg === '#d4edda' ? '#28a745' : hfiClassInfo(fbp.hfi).bg === '#cce5ff' ? '#0066cc' : hfiClassInfo(fbp.hfi).bg === '#fff3cd' ? '#856404' : hfiClassInfo(fbp.hfi).bg === '#ffe5cc' ? '#d35400' : '#c0392b'};background:#fafafa"><span style="font-size:8pt;color:#555;text-transform:uppercase;letter-spacing:0.04em">FBP System HFI Class &nbsp;</span>${hfiBadge(fbp.hfi)}</div>` : ''}
    ${escapedNote}
    <p style="font-size:7.5pt;color:#888;margin-top:4px">Observed: 12:00 noon LST (CFFDRS standard) · ${srcLabel} · Prepared: ${prepared}</p>
  </div>
</div>

${d1Section}

<div class="section">
  <div class="section-title">Forecast Outlook — Fire Behaviour by Day (Peak ~14:00 MDT)</div>
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
      ${[{n:1,r:'< 200',        d:'Walk-in direct attack',                           bg:'#d4edda',t:'#155724'},
         {n:2,r:'200 – 500',    d:'Direct attack with hand tools',                   bg:'#cce5ff',t:'#004085'},
         {n:3,r:'500 – 2,000',  d:'Tallest firefighter flame length — direct attack limit', bg:'#fff3cd',t:'#856404'},
         {n:4,r:'2,000 – 4,000',d:'Fire truck height — consider indirect attack',    bg:'#ffe5cc',t:'#7d3200'},
         {n:5,r:'4,000 – 10,000',d:'Bungalow roofline — aircraft ineffective at the head', bg:'#f8d7da',t:'#721c24'},
         {n:6,r:'10,000+',      d:'Catastrophic — uncontrollable',                   bg:'#4a0010',t:'#ffccdd'}]
        .map((c,i)=>`<tr style="background:${i%2===0?'#fff':'#fafafa'}">
          <td style="padding:4px 8px;text-align:center;border-bottom:1px solid #eee"><span style="display:inline-block;min-width:24px;padding:2px 6px;border-radius:3px;background:${c.bg};color:${c.t};font-weight:900;font-size:9.5pt;text-align:center">${c.n}</span></td>
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

const MARKER_COLORS = {
  'Low':       '#4ae176',
  'Moderate':  '#7bd0ff',
  'High':      '#fbabff',
  'Very High': '#ff8c42',
  'Extreme':   '#ff4d4d',
};

/**
 * Build a Leaflet map with CartoDB Voyager tiles.
 * Custom divIcon markers show FWI value + HFI class text, coloured by danger.
 * Active fires and hotspot overlay toggles preserved.
 */
async function buildStationMap(containerId) {
  const container = document.getElementById(containerId);
  if (!container || typeof L === 'undefined') return;
  _mapStationCache = [];

  // HFI class → marker ring color
  const HFI_RING_MAP = {
    '1-Low':'rgba(0,0,0,0.15)','2-Mod':'rgba(0,0,0,0.15)',
    '3-High':'#d4a017','4-VH':'#e65c00','5-Ext':'#c62828','6-Cat':'#880e4f',
  };

  // Build divIcon marker HTML: FWI number on top, HFI class below
  function _makeIcon(fill, ring, rw, fwiLabel, hfiCls, big) {
    const sz = big ? 42 : 36;
    const shadow = `0 2px 6px rgba(0,0,0,0.45),0 0 0 ${rw}px ${ring}`;
    return L.divIcon({
      className: '',
      html: `<div style="width:${sz}px;height:${sz}px;background:${fill};border-radius:50%;` +
            `display:flex;flex-direction:column;align-items:center;justify-content:center;` +
            `box-shadow:${shadow};font-family:'Space Grotesk',sans-serif;cursor:pointer;line-height:1">` +
            `<span style="font-size:${big?12:11}px;font-weight:800;color:#fff;letter-spacing:-.02em;` +
            `text-shadow:0 1px 3px rgba(0,0,0,0.5)">${fwiLabel}</span>` +
            `<span style="font-size:${big?7.5:6.5}px;font-weight:600;color:rgba(255,255,255,0.85);` +
            `text-shadow:0 1px 2px rgba(0,0,0,0.5);margin-top:1px">${hfiCls}</span>` +
            `</div>`,
      iconSize: [sz, sz],
      iconAnchor: [sz/2, sz/2],
      popupAnchor: [0, -(sz/2 + 4)],
    });
  }

  function _makeLoadingIcon() {
    return L.divIcon({
      className: '',
      html: `<div style="width:30px;height:30px;background:#374151;border-radius:50%;` +
            `display:flex;align-items:center;justify-content:center;` +
            `box-shadow:0 1px 4px rgba(0,0,0,0.3);font-size:10px;color:#6b7280">…</div>`,
      iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -18],
    });
  }

  // Initialise Leaflet map — CartoDB Voyager tiles (clean, no API key)
  const map = L.map(containerId, {
    center: [54.5, -114.5], zoom: 5,
    zoomControl: true, attributionControl: true,
  });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(map);

  // Place all loading markers immediately
  const markers = {};
  for (const s of ALBERTA_STATIONS) {
    markers[s.name] = L.marker([s.lat, s.lng], { icon: _makeLoadingIcon() })
      .bindPopup(`<b style="font-family:'Space Grotesk',sans-serif">${s.name}</b><br><small style="color:#9ca3af">Loading…</small>`, { maxWidth: 240 })
      .addTo(map);
  }

  // Fetch data and update each marker as it arrives
  for (const s of ALBERTA_STATIONS) {
    try {
      const w   = await fetchWeatherPrimary(s.lat, s.lng);
      const r   = calculateFWI(w);
      const fuelCode = STATION_FUEL_TYPES[s.name] || 'C2';
      const fbp = calculateFBP(fuelCode, r.ffmc, r.dmc, r.dc, w.wind ?? 10, 0, _savedCuring());
      const srcBadge = w.fwiFromCWFIS ? 'CWFIS' : (w.source?.startsWith('MSC') ? 'SWOB' : 'NWP');
      _mapStationCache.push({ name: s.name, lat: s.lat, lng: s.lng, result: r, fbp, srcBadge });
      _updateStationTableRow({ name: s.name, lat: s.lat, lng: s.lng, result: r, fbp, srcBadge });

      const fill   = MARKER_COLORS[r.danger] || '#7bd0ff';
      const hfiCls = fbp ? _hfiClass(fbp.hfi) : '—';
      const ring   = HFI_RING_MAP[hfiCls] || 'rgba(0,0,0,0.15)';
      const rw     = ['4-VH','5-Ext','6-Cat'].includes(hfiCls) ? 4 : 2;
      const big    = r.danger === 'Extreme' || r.danger === 'Very High';
      markers[s.name].setIcon(_makeIcon(fill, ring, rw, r.fwi.toFixed(1), hfiCls, big));

      const hfiNum     = fbp?.hfi != null ? Math.round(fbp.hfi).toLocaleString() + ' kW/m' : '—';
      const fwiMethod  = w.fwiFromCWFIS ? 'CWFIS carry-over chain' : 'Van Wagner calc';
      const distNote   = w.distKm != null ? ` · ${w.distKm} km` : '';
      markers[s.name].setPopupContent(
        `<div style="font-family:'Space Grotesk',sans-serif;min-width:190px">` +
        `<div style="font-size:13px;font-weight:700;color:#1e3a8a;margin-bottom:2px">${s.name}</div>` +
        `<div style="font-size:9px;color:#94a3b8;margin-bottom:7px;text-transform:uppercase;letter-spacing:.08em">${w.source || srcBadge}${distNote} · ${fwiMethod}</div>` +
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:11px">` +
        `<div><span style="color:#94a3b8">FWI</span><br><strong style="color:${fill};font-size:17px">${r.fwi.toFixed(1)}</strong></div>` +
        `<div><span style="color:#94a3b8">Danger</span><br><strong style="color:${fill}">${r.danger}</strong></div>` +
        `<div><span style="color:#94a3b8">HFI</span><br><span style="color:#1e293b">${hfiNum}</span></div>` +
        `<div><span style="color:#94a3b8">HFI Class</span><br><strong style="color:#1e293b">${hfiCls}</strong></div>` +
        `<div><span style="color:#94a3b8">Temp</span><br><span style="color:#1e293b">${fmt(w.temp)}°C</span></div>` +
        `<div><span style="color:#94a3b8">RH</span><br><span style="color:#1e293b">${fmt(w.rh,0)}%</span></div>` +
        `<div><span style="color:#94a3b8">Wind</span><br><span style="color:#1e293b">${fmt(w.wind,0)} km/h</span></div>` +
        `<div><span style="color:#94a3b8">Rain</span><br><span style="color:#1e293b">${fmt(w.rain)} mm</span></div>` +
        `</div></div>`
      );
    } catch (e) {
      console.warn(`[FWI Map] ${s.name}:`, e);
    }
  }

  // Active fires layer
  const activeFiresLayer = L.layerGroup();
  fetchActiveFires().then(fires => {
    fires.forEach(f => {
      const ha = f.hectares || 1;
      const r  = Math.max(4, Math.min(12, Math.sqrt(ha) * 0.25));
      L.circleMarker([f.lat, f.lon], { radius: r, fillColor: '#ff3333', color: '#ff8888', weight: 1.5, fillOpacity: 0.5 })
        .bindPopup(`<b>${f.firename || 'Active Fire'}</b><br>${ha >= 1 ? ha.toLocaleString('en-CA',{maximumFractionDigits:0}) + ' ha' : '< 1 ha'}<br><small>${f.stage_of_control || ''} · ${f.agency?.toUpperCase() || ''}</small>`)
        .addTo(activeFiresLayer);
    });
  });

  // Hotspots layer
  const hotspotsLayer = L.layerGroup();
  fetchHotspots().then(spots => {
    spots.forEach(h => {
      const hfiTip = h.hfi != null ? `<br>HFI: ${Math.round(h.hfi).toLocaleString()} kW/m` : '';
      L.circleMarker([h.lat, h.lon], { radius: 4, fillColor: '#ff8c00', color: '#ffaa44', weight: 1, fillOpacity: 0.8 })
        .bindPopup(`<b>Satellite Hotspot</b><br><small>${h.satellite || h.sensor || ''}</small>${hfiTip}`)
        .addTo(hotspotsLayer);
    });
  });

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

// ─── P4: SCRIBE 48-hr FWI validation ────────────────────────────────────────
// NRCan SCRIBE gives pre-computed FWI for today / +24h / +48h at met stations.
// Sentinel value -101 means no data for that station (off-season or not computed).

async function fetchSCRIBE(lat, lng) {
  try {
    const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs` +
      `?service=WFS&version=2.0.0&request=GetFeature&typeNames=public:firewx_scribe_fcst` +
      `&outputFormat=application/json` +
      `&CQL_FILTER=latitude+BETWEEN+${(lat-2).toFixed(2)}+AND+${(lat+2).toFixed(2)}` +
      `+AND+longitude+BETWEEN+${(lng-2).toFixed(2)}+AND+${(lng+2).toFixed(2)}&count=100`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    // Group valid records by station name
    const byStation = {};
    for (const f of d.features) {
      const p = f.properties;
      if (!p.fwi || p.fwi < 0) continue;
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
    const danger = dangerRating(r.fwi);
    const c = DANGER_COLORS[danger] || DANGER_COLORS['Moderate'];
    return `<div class="bg-surface-container-lowest rounded-lg p-4">
      <p class="text-[10px] font-label uppercase tracking-widest text-outline mb-1">${label}</p>
      <p class="font-headline text-2xl font-bold text-white">${r.fwi.toFixed(1)}</p>
      <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${c.badge}">${danger}</span>
      <div class="grid grid-cols-2 gap-x-3 mt-2 text-xs text-on-surface-variant">
        <span>FFMC ${r.ffmc?.toFixed(1) ?? '—'}</span><span>DC ${r.dc?.toFixed(0) ?? '—'}</span>
        <span>ISI ${r.isi?.toFixed(1) ?? '—'}</span><span>BUI ${r.bui?.toFixed(0) ?? '—'}</span>
      </div>
    </div>`;
  }).join('');
}

// ─── P3: Active fires + satellite hotspot layers ─────────────────────────────

async function fetchActiveFires() {
  const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs` +
    `?service=WFS&version=2.0.0&request=GetFeature&typeNames=public:activefires_current` +
    `&outputFormat=application/json&count=200`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const d = await res.json();
  return d.features.map(f => f.properties).filter(p => p.lat && p.lon);
}

async function fetchHotspots() {
  // Filter to Canada/northern US bounding box to limit results
  const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs` +
    `?service=WFS&version=2.0.0&request=GetFeature&typeNames=public:hotspots_24h` +
    `&outputFormat=application/json` +
    `&CQL_FILTER=lat+BETWEEN+48+AND+70+AND+lon+BETWEEN+-140+AND+-50&count=500`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const d = await res.json();
  return d.features.map(f => f.properties).filter(p => p.lat && p.lon);
}

/** Populate the D+1 Tomorrow card on station_detail. Called from initFWI after _lastFWI is set. */
async function buildD1Card() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('fwi-d1-preview-date', 'Loading…');

  let days, results;
  try {
    if (_forecastCache.results.length) {
      ({ days, results } = _forecastCache);
    } else {
      // Try ECMWF first (faster, point-specific); fall back to NAEFS
      try { days = await fetchForecast(_stationLat, _stationLng); }
      catch(e) {
        console.warn('[D+1] ECMWF failed, trying NAEFS:', e);
        days = await fetchForecastNAEFS(_stationLat, _stationLng);
      }
      const chainStart = _lastFWI ? { ffmc: _lastFWI.ffmc, dmc: _lastFWI.dmc, dc: _lastFWI.dc } : null;
      const fuelCode = _savedFuelCode();
      results = calcMultiDayFBP(days, getStartupDC(_stationName), chainStart, fuelCode, _savedCuring());
      _forecastCache = { days, results, fuelCode };
    }
  } catch(e) { console.error('[D+1] Forecast fetch failed:', e); set('fwi-d1-preview-date', 'Forecast unavailable'); return; }

  const todayMid = new Date(); todayMid.setHours(0,0,0,0);
  const tomMid = new Date(todayMid); tomMid.setDate(tomMid.getDate() + 1);
  const d1Idx = days.findIndex(d => d._ts && d._ts >= tomMid.getTime());
  const idx = d1Idx >= 0 ? d1Idx : 0;
  const d1r = results[idx], d1d = days[idx];
  if (!d1r) return;

  const d1pw = d1d?.peak || d1d || {};
  const d1fbp = d1r.fbp;

  // Set tomorrow card background to danger colour
  const d1Card = document.getElementById('fwi-d1-card');
  if (d1Card) d1Card.style.background = DANGER_GRADIENTS[d1r.danger] || DANGER_GRADIENTS['Moderate'];

  set('fwi-d1-preview-date',      `${d1r.label || 'D+1'}`);
  set('fwi-d1-preview-fwi-score', `${Math.round(d1r.fwi)}`);
  set('fwi-d1-preview-danger',    `${d1r.danger} Risk`);
  set('fwi-d1-preview-temp',  `${(+d1pw.temp||0).toFixed(1)}°C`);
  set('fwi-d1-preview-rh',    `${Math.round(d1pw.rh||0)}%`);
  set('fwi-d1-preview-wind',  `${Math.round(d1pw.wind||0)} km/h`);
  set('fwi-d1-preview-wdir',  d1pw.wdir != null ? windCompass(d1pw.wdir) : '—');

  if (d1fbp) {
    const cl = hfiClassInfo(d1fbp.hfi);
    const numEl = document.getElementById('fwi-d1-preview-hfi-num');
    const lblEl = document.getElementById('fwi-d1-preview-hfi-label');
    const szEl  = document.getElementById('fwi-d1-preview-hfi-size');
    const dscEl = document.getElementById('fwi-d1-preview-hfi-desc');
    // All white text on gradient card
    if (numEl) { numEl.textContent = cl.num;   numEl.style.color = 'white'; }
    if (lblEl) { lblEl.textContent = cl.label; lblEl.style.color = 'rgba(255,255,255,0.9)'; }
    if (szEl)  { szEl.textContent  = cl.size;  szEl.style.color  = 'rgba(255,255,255,0.85)'; }
    if (dscEl) { dscEl.textContent = cl.desc; }
    set('fwi-d1-preview-hfi-kwm',  `${Math.round(d1fbp.hfi).toLocaleString()} kW/m`);
    set('fwi-d1-preview-ros',      `${d1fbp.ros.toFixed(1)} m/min`);
    set('fwi-d1-preview-flame',    `${d1fbp.flameLength.toFixed(1)} m`);
    set('fwi-d1-preview-type',     d1fbp.fireType);
    set('fwi-d1-preview-cfb',      `${(d1fbp.cfb*100).toFixed(0)}%`);
  }
}

window.FWI = { initFWI, buildStationPicker, buildRegionalSummary, buildForecastTrends, buildHourlyChart, buildStationMap, buildD1Card, calculateFWI, calculateFBP, calcMultiDayFBP, wireFBP, refreshFBP, fetchWeather, fetchCWFIS, fetchWeatherPrimary, dangerRating, exportRegionalDataset, exportForecastReport, printProvincialBriefing, printStationBriefing, ALBERTA_STATIONS, FUEL_TYPES };
