/**
 * BC Wildfire FWI Dashboard — Live Data Engine (standalone BC build)
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

// Standalone BC app — province is hardcoded. No localStorage, no province switching.
const _province = 'BC';
function setProvince(p) {} // no-op in standalone BC build
function getProvince() { return 'BC'; }

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
// BC spring DC startup — lower than Alberta due to higher precip and snowpack recharge.
// Provincial overwinter DC calc (Van Wagner 1985 App.) requires fall DC + winter precip;
// these are practical cold-start defaults by Fire Centre for browser fallback.
// BCWS station names used (actual network names, not generic city names).
const BC_STATION_STARTUP_DC = {
  // Coastal Fire Centre — very high winter precip, near-zero carry-over
  'Summit': 50, 'Menzies Camp': 50, 'Woss Camp': 50, 'Beaver Creek': 50,
  'Saltspring 2': 50, 'Bowser': 50, 'Cedar': 50, 'Haig Camp': 50,
  'UBC Research': 50, 'Toba Camp': 50, 'Scar Creek': 50,
  'Honna (Haida Gwaii)': 50, 'Machmell': 50, 'Theodosia': 50,
  'Big Silver 2': 50, 'McNabb': 50, 'Meager Creek': 50,
  'Quinsam Base': 50, 'Powell River West Lake': 50, 'Mount Cayley': 50,
  'Cheakamus': 50, 'Boothroyd': 50, 'Klinaklini': 50, 'Homathko': 50,
  'Frank Creek': 50, 'Atluck': 50, 'Nahmint': 50, 'Blackwater': 50,
  'Mashiter': 50, 'Cobble Hill': 50,
  // Kamloops Fire Centre — rain-shadow interior, moderate carry-over
  'Lillooet': 125, 'Thynne': 100, 'Brenda Mines': 100, 'Turtle': 100,
  'Glimpse': 100, 'Darcy': 75, 'Fintry': 100, 'Pemberton Base': 75,
  'Aspen Grove': 100, 'Sparks Lake': 100, 'Leighton Lake': 100,
  'Gwyneth Lake': 75, 'McLean Lake': 100, 'Nahatlatch': 75,
  'Allison Pass': 100, 'Afton': 125, 'Paska Lake': 100,
  'Penticton RS': 100, 'Ashnola': 125, 'McCuddy': 125,
  'Revelstoke': 75, 'Five Mile': 75, 'Splintlum': 100,
  'Mayson': 100, 'Blue River 2': 75, 'Mudpit': 100,
  'West Kelowna': 100, 'Larch Hills West': 100, 'Station Bay 2': 100,
  'Merritt 2 Hub': 100, 'Willis': 100, 'Xetolacow': 75,
  // Cariboo Fire Centre — moderate precip, significant snowpack recharge
  'Tautri': 100, 'Tatla Lake': 100, 'Alexis Creek': 100,
  'Riske Creek': 100, 'Nazko': 100, 'Place Lake': 100,
  'Anahim Lake': 100, 'Nemiah': 100, 'Lone Butte': 100,
  'Baldface': 100, 'Gaspard': 100, 'Knife': 100,
  'Middle Lake': 100, 'Gavin': 100, 'Benson': 100,
  'Horsefly': 100, 'Coldscaur Lake': 100, 'Talchako': 100,
  'Timothy': 100, 'Young Lake': 100, 'Meadow Lake': 100,
  'Clearwater Hub': 100, 'East Barriere': 100, 'Windy Mountain': 100,
  'Deception': 100, 'Cahilty': 100, 'Likely RS': 100,
  'Big Valley': 100, 'Prairie Creek': 100, 'Wells Gray': 100,
  'Gosnel': 100, 'French Bar': 100, 'Churn Creek': 100,
  'Hagensborg 2': 75, 'Skoonka': 100, 'Deer Park': 125,
  'Brunson': 100, 'Bond Lake': 100,
  // Prince George Fire Centre — moderate boreal snowpack
  'Manson': 100, 'Ingenika Point': 75, 'Fort St James': 100,
  'Blackpine': 75, 'Bear Lake': 100, 'Nabeshe': 75,
  'Sifton': 75, 'McLeod Lake': 100, 'Witch': 100,
  'Mackenzie FS': 100, 'Vanderhoof Hub': 100, 'North Chilco': 100,
  'Lovell Cove': 75, 'Moose Lake': 100, 'Augier Lake': 100,
  'Bednesti': 100, 'Peden': 100, 'Parrott': 100,
  'Hixon': 100, 'Chilako': 100, 'Jerry': 100,
  'McGregor 2': 100, 'Bowron Haggen': 100, 'McBride': 75,
  'Catfish': 100, 'Valemount 2': 75, 'Mathew': 100,
  'Holy Cross 2': 100, 'Osborn': 75, 'Severeid': 100,
  'Valemount Airport': 75, 'Ape Lake': 100, 'Machmell Kliniklini': 100,
  'Goatlick': 100, 'Chetwynd FB': 100, 'Blueberry': 100, 'Baker Creek': 100,
  // Northwest Fire Centre — high precip coastal/mountain, low carry-over
  'Rosswood': 50, 'Kitpark': 50, 'Dease Lake FS': 75,
  'Atlin': 75, 'Bob Quinn Lake': 75, 'Sustut': 75,
  'Grassy Plains Hub': 75, 'Houston': 75, 'Kluskus': 100,
  'Upper Fulton': 75, 'East Ootsa': 75, 'Leo Creek': 75,
  'Nilkitkwa': 75, 'North Babine': 75, 'Nadina': 75,
  'McBride Lake': 75, 'Burns Lake 850m': 75, 'Ganokwa': 75,
  'Nass Camp': 50, 'Kispiox Hub': 50, 'Cedarvale': 50,
  'Van Dyke': 50, 'Upper Kispiox': 50, 'Bell-Irving': 50,
  'Cranberry': 50, 'Pine Creek': 75, 'Old Faddy': 75,
  'Sawtooth': 75, 'Terrace': 50, 'Gitanyow': 50,
  'Telegraph Creek': 75, 'Iskut': 75,
  'Elk Mountain': 75, 'Fireside': 75, 'Boya Lake': 75, 'Komie': 75,
  // Northeast (Peace/Fort St. John) — continental interior, moderate carry-over
  'Sierra': 100, 'Helmut': 100, 'Nelson Forks': 100,
  'Silver': 100, 'Paddy': 100, 'Graham': 100,
  'Toad River': 75, 'Tumbler Hub': 100, 'Pink Mountain': 100,
  'Muskwa': 75, 'Hudson Hope': 100, 'Wonowon': 100,
  'Red Deer': 100, 'Lemoray': 100, 'Noel': 100, 'Fort Nelson FS': 75,
  // Southeast Fire Centre — interior dry, higher carry-over
  'Seymour Arm': 100, 'Tsar Creek': 125, 'Mabel Lake 2': 125,
  'Whiskey': 150, 'Marion': 150, 'Succour Creek': 125,
  'Gold Hill': 150, 'Powder Creek': 150, 'Falls Creek': 125,
  'Duncan': 150, 'Trout Lake': 125, 'Kettle 2': 150,
  'Beaverdell': 150, 'Eight Mile': 150, 'Grand Forks': 150,
  'Nicoll': 150, 'Rock Creek': 150, 'Octopus Creek': 150,
  'Goatfell': 175, 'Pendoreille': 175, 'Smallwood': 175,
  'Slocan': 150, 'Nancy Greene': 175, 'Norns': 175,
  'Palliser': 150, 'Elko': 175, 'Toby Hub': 150,
  'Flathead 2': 175, 'Johnson Lake': 175, 'Dewar Creek': 175,
  'Emily Creek': 150, 'Cranbrook': 175, 'Cherry Lake': 175,
  'August Lake': 150, 'Akokli Creek': 175, 'Brisco': 150,
  'Blaeberry': 125, 'Big Mouth 2': 125, 'Crawford': 150,
  'Idabel Lake 3': 150, 'Sicamous': 100, 'Goathaven': 175,
  'Downie': 125, 'Goldstream 2': 125, 'Koocanusa': 175,
  'Rory Creek': 150, 'Darkwoods': 175, 'Cariboo Creek': 150,
  'Bigattini': 175, 'Sparwood': 175, 'Little Chopaka': 150, 'Creston': 175,
};
function getStartupDC(stationName) {
  if (_province === 'BC') return BC_STATION_STARTUP_DC[stationName] ?? 100;
  return STATION_STARTUP_DC[stationName] ?? 300;
}

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

// FWI danger thresholds (NRCan CWFIS operational scale — Alberta)
function dangerRating(fwi) {
  if (fwi <  9) return 'Low';
  if (fwi < 18) return 'Moderate';
  if (fwi < 33) return 'High';
  if (fwi < 50) return 'Very High';
  return 'Extreme';
}
// BC Wildfire Service danger classes — 5 classes, no "Very High", adds "Very Low"
// Source: BCWS CFFDRS Implementation (B.C. Ministry of Forests, Lands & NRO)
function dangerRatingBC(fwi) {
  if (fwi <  5) return 'Very Low';
  if (fwi < 12) return 'Low';
  if (fwi < 21) return 'Moderate';
  if (fwi < 34) return 'High';
  return 'Extreme';
}
// Province-aware danger rating — used throughout for display; AB math unchanged
function dangerRatingProv(fwi) {
  return _province === 'BC' ? dangerRatingBC(fwi) : dangerRating(fwi);
}

// Alberta Wildfire danger class 1–6 (CIFFC operational scale)
// Returns { num, label, bg, text } for colour-coded display in briefings
function dangerClassNum(fwi) {
  if (fwi <  9) return { num: 1, label: 'Low',       bg: '#d4edda', text: '#155724' };
  if (fwi < 18) return { num: 2, label: 'Moderate',  bg: '#cce5ff', text: '#004085' };
  if (fwi < 33) return { num: 3, label: 'High',      bg: '#fff3cd', text: '#856404' };
  if (fwi < 50) return { num: 4, label: 'Very High', bg: '#ffe5cc', text: '#7d3200' };
  return           { num: 5, label: 'Extreme',   bg: '#f8d7da', text: '#721c24' };
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
  // M1/M2 — Boreal Mixedwood (ST-X-3). No a/b/c — ROS blends C2 (softwood) + D1/D2 (hardwood) by PS%.
  M1:  { name:'Boreal Mixedwood \u2014 Leafless', softwood:'C2', hardwood:'D1', mixedwood:true },
  M2:  { name:'Boreal Mixedwood \u2014 Green',    softwood:'C2', hardwood:'D2', mixedwood:true },
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
  'Edmonton':            'D2',   // Aspen parkland WUI context
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

// Ecologically associated fuel pair for pin-drop auto-selection (Fuel A → Fuel B complement)
const FUEL_PAIR_COMPLEMENT = {
  C1:'C2',  C2:'M1',  C3:'C2',  C4:'C3',  C5:'C4',  C6:'C5',  C7:'D1',
  D1:'D2',  D2:'D1',
  M1:'C2',  M2:'M1',
  S1:'S2',  S2:'S3',  S3:'S2',
  O1a:'O1b', O1b:'O1a',
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

let _stationLat = 50.70; // module-level; set by initFWI for FMC calculation (default: Kamloops)
let _stationLng = -120.45; // module-level; set by initFWI
let _stationName = 'Kamloops'; // module-level; set by initFWI
let _initGeneration = 0; // increments each initFWI call; only latest call writes to DOM

function calculateFBP(fuelCode, ffmc, dmc, dc, windSpeed, slope = 0, curing = 100, ps = 50) {
  const ft = FUEL_TYPES[fuelCode];
  if (!ft) return null;

  // Mixedwood blend — M1/M2 (ST-X-3 §M1/M2)
  // ROS = PS% × ROS_C2 + (1−PS%) × ROS_D1/D2; crown fire from softwood component only.
  if (ft.mixedwood) {
    const r  = Math.max(0, Math.min(100, ps)) / 100;
    const sw = calculateFBP(ft.softwood, ffmc, dmc, dc, windSpeed, slope, curing, ps);
    const hw = calculateFBP(ft.hardwood, ffmc, dmc, dc, windSpeed, slope, curing, ps);
    if (!sw || !hw) return null;
    const ros         = r * sw.ros + (1 - r) * hw.ros;
    const cfb         = sw.cfb; // crown fire from softwood only
    const sfc         = r * FUEL_TYPES[ft.softwood].sfc + (1 - r) * FUEL_TYPES[ft.hardwood].sfc;
    const cfl         = r * FUEL_TYPES[ft.softwood].cfl; // hardwood cfl = 0
    const tfc         = sfc + cfb * cfl;
    const hfi         = 18000 * tfc * ros / 60;
    const flameLength = hfi > 0 ? 0.0775 * Math.pow(hfi, 0.46) : 0;
    let fireType = 'Surface';
    if      (cfb > 0.9) fireType = 'Active Crown';
    else if (cfb > 0.1) fireType = 'Passive Crown';
    return { isi: sw.isi, bui: sw.bui, ros, hfi, cfb, tfc, flameLength, fireType };
  }

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

/** Render FBP results for both fuels into the station_detail dual-fuel sections. */
function wireFBP(weather, fwi) {
  const fuelA = document.getElementById('fwi-fuel-picker')?.value   || 'C2';
  const fuelB = document.getElementById('fwi-fuel-picker-2')?.value || 'D1';
  localStorage.setItem('fwi-bc-fuel-type',   fuelA);
  localStorage.setItem('fwi-bc-fuel-type-2', fuelB);
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
    if (numEl) { numEl.textContent = cl.num;   numEl.style.color = 'white'; }
    if (lblEl) { lblEl.textContent = 'HFI'; lblEl.style.color = 'rgba(255,255,255,0.9)'; }
    if (szEl)  { szEl.textContent  = cl.size;  szEl.style.color  = 'rgba(255,255,255,0.85)'; }
    if (dscEl) { dscEl.textContent = cl.desc; }
    const sectionEl = document.getElementById('fwi-fbp-section' + suffix);
    if (sectionEl) sectionEl.style.background = HFI_GRADIENTS[cl.num] || HFI_GRADIENTS[1];
  };

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('fwi-fbp-fuel-name-a', FUEL_TYPES[fuelA]?.name || fuelA);
  setEl('fwi-fbp-fuel-name-b', FUEL_TYPES[fuelB]?.name || fuelB);
  populateSection('-a', calculateFBP(fuelA, fwi.ffmc, fwi.dmc, fwi.dc, weather.wind, 0, curing, ps));
  populateSection('-b', calculateFBP(fuelB, fwi.ffmc, fwi.dmc, fwi.dc, weather.wind, 0, curing, ps));
}

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

// ─── BCWS Datamart fetch (BC Tier 0) ─────────────────────────────────────────
/**
 * Fetch today's FWI data from BC Wildfire Service Weather Datamart.
 * Returns a map of STATION_CODE → noon-LST FWI record.
 * Pre-computed by BCWS — covers 200+ BC fire weather stations.
 * URL: https://www.for.gov.bc.ca/ftp/HPR/external/!publish/BCWS_DATA_MART/YYYY/YYYY-MM-DD.csv
 * Date-keyed daily CSVs; noon = DATE_TIME hour 12 (local BC time).
 * Reference: BC Ministry of Forests, Wildfire Management Branch.
 */
let _bcwsCache = null;
let _bcwsCacheDate = '';
let _bcwsFetchPromise = null; // deduplicates concurrent requests
let _bcwsCORSFailed = false;  // true if CORS blocked — skip all future attempts this session

// BCWS station coordinates — from openmaps.gov.bc.ca PROT_WEATHER_STATIONS_SP WFS.
// Used to match a selected station lat/lng to the nearest BCWS STATION_CODE.
const BCWS_STATION_COORDS = {
  11:   [48.9276, -124.6469],  19:   [50.0486, -125.7887],
  21:   [50.2132, -126.6071],  37:   [49.3776, -124.9337],
  45:   [48.7729, -123.4745],  56:   [49.4368, -124.7022],
  59:   [49.0476, -123.8747],  67:   [49.3806, -121.5259],
  72:   [49.2645, -122.5732],  75:   [50.5711, -124.0777],
  82:   [50.3317, -122.5658],  93:   [53.2532, -132.1156],
  101:  [51.5931, -126.4508],  105:  [54.9168, -128.8597],
  106:  [54.1696, -128.5759],  108:  [58.4258, -130.0187],
  110:  [57.9141, -131.1711],  111:  [59.5845, -133.6643],
  112:  [57.8617, -130.0181],  113:  [56.9809, -130.2510],
  117:  [58.8381, -121.3967],  118:  [59.4211, -120.7889],
  119:  [59.6173, -124.0985],  120:  [57.3745, -121.4069],
  121:  [57.7818, -120.2368],  124:  [56.4346, -122.4576],
  126:  [58.8659, -125.3107],  127:  [55.0274, -120.9340],
  129:  [57.0874, -122.5912],  131:  [57.8842, -123.6164],
  132:  [56.0347, -121.9903],  136:  [56.7184, -121.7654],
  138:  [54.6330, -120.5762],  140:  [55.5250, -122.5172],
  141:  [55.3800, -122.5500],  145:  [57.0194, -125.1804],
  146:  [54.3942, -124.2611],  148:  [56.3188, -125.3680],
  149:  [54.4824, -122.6829],  151:  [56.3643, -123.3655],
  152:  [57.8517, -126.1168],  153:  [54.7442, -123.0187],
  154:  [55.0230, -124.2666],  155:  [55.2864, -123.1359],
  156:  [56.3288, -127.0339],  158:  [54.0554, -124.0102],
  159:  [54.1546, -123.7542],  161:  [53.9454, -125.8761],
  162:  [54.3939, -126.6175],  163:  [55.6881, -126.0525],
  165:  [53.0715, -125.4121],  166:  [53.3830, -124.5121],
  167:  [54.3619, -125.5253],  169:  [55.0340, -126.7996],
  170:  [53.5025, -125.7793],  171:  [55.0817, -125.4773],
  172:  [55.5380, -126.5775],  173:  [55.1350, -126.2073],
  175:  [53.8654, -123.3232],  178:  [53.9868, -126.5174],
  179:  [53.9425, -126.9278],  180:  [54.0747, -127.3994],
  181:  [54.2591, -125.7598],  182:  [54.8013, -126.9484],
  183:  [54.0186, -126.3890],  187:  [53.4114, -122.5961],
  189:  [53.4937, -123.6089],  190:  [53.5264, -122.1064],
  192:  [53.9289, -120.6355],  193:  [53.4630, -121.5603],
  195:  [53.2948, -120.1530],  199:  [53.5764, -120.8585],
  200:  [52.7883, -119.3147],  206:  [52.5387, -123.3433],
  208:  [51.9062, -124.6067],  209:  [52.0838, -123.2733],
  210:  [51.9596, -122.5041],  211:  [52.9575, -123.5958],
  212:  [51.8182, -122.0057],  213:  [52.4609, -125.3067],
  216:  [51.4800, -123.8181],  218:  [51.5070, -121.1620],
  221:  [52.7101, -124.4823],  222:  [51.4508, -122.6603],
  225:  [52.0497, -121.8738],  226:  [51.7017, -124.8750],
  227:  [52.4709, -121.7430],  228:  [52.9100, -122.0667],
  230:  [52.3278, -121.3983],  232:  [51.7238, -120.3899],
  233:  [52.2514, -126.0284],  234:  [51.9132, -121.3887],
  235:  [51.2378, -120.9976],  236:  [51.3750, -121.7200],
  239:  [51.6289, -120.0946],  243:  [51.2531, -119.8817],
  244:  [51.6645, -120.6575],  251:  [51.9674, -120.6078],
  253:  [50.8879, -119.8383],  255:  [52.6145, -121.5139],
  262:  [53.2622, -121.7628],  263:  [52.9084, -120.9172],
  264:  [52.3917, -120.9850],  266:  [52.3425, -120.2434],
  270:  [52.4526, -119.1753],  279:  [49.7152, -120.8661],
  280:  [50.6720, -121.8882],  283:  [49.8684, -119.9925],
  286:  [50.8036, -119.6307],  291:  [50.2705, -120.2883],
  292:  [50.5217, -122.4978],  298:  [50.2062, -119.4804],
  301:  [50.3059, -122.7287],  302:  [49.9481, -120.6211],
  305:  [50.9237, -120.8672],  306:  [51.1775, -122.2489],
  307:  [50.6153, -120.8362],  309:  [50.7963, -122.8805],
  311:  [50.7923, -121.3582],  316:  [49.9018, -122.0209],
  317:  [49.0625, -120.7668],  322:  [50.6727, -120.4822],
  326:  [50.5040, -120.6740],  328:  [49.5177, -119.5529],
  331:  [49.1391, -120.1844],  334:  [49.1483, -119.4150],
  344:  [51.2735, -118.9147],  361:  [51.9972, -118.1025],
  362:  [50.3514, -118.7735],  363:  [51.0603, -118.2172],
  366:  [51.0653, -116.7850],  367:  [51.0422, -116.3638],
  374:  [51.7162, -117.5417],  379:  [50.3658, -117.0645],
  380:  [49.9065, -116.8551],  383:  [50.3830, -117.8799],
  385:  [50.7808, -117.1805],  387:  [50.6053, -117.4272],
  388:  [49.9600, -118.6260],  390:  [49.4564, -119.0886],
  391:  [49.4328, -118.5783],  392:  [49.0307, -118.4156],
  393:  [49.5267, -118.3603],  394:  [49.0520, -118.9367],
  396:  [49.6990, -118.0810],  401:  [49.1253, -116.1638],
  402:  [49.0506, -117.4139],  404:  [49.4967, -117.4475],
  406:  [49.7847, -117.4400],  407:  [49.2545, -117.9942],
  408:  [49.5025, -117.7870],  411:  [50.4946, -115.6664],
  412:  [49.2876, -115.1546],  417:  [50.5128, -116.0553],
  418:  [49.0791, -114.5373],  419:  [49.9443, -115.7582],
  421:  [49.7845, -116.3830],  425:  [50.1451, -115.9772],
  426:  [49.6672, -115.8483],  427:  [55.2886, -128.9984],
  428:  [55.4343, -127.6487],  429:  [55.0301, -128.3115],
  430:  [56.0127, -129.0998],  431:  [55.6015, -128.0478],
  432:  [56.3486, -129.2929],  433:  [55.5768, -128.7048],
  437:  [55.2956, -120.4850],  438:  [59.3336, -125.5114],
  440:  [59.7226, -127.3350],  445:  [59.3673, -129.1110],
  543:  [48.5297, -123.6375],  599:  [58.8418, -122.5736],
  654:  [53.9362, -124.7765],  786:  [50.0986, -114.9006],
  788:  [50.0986, -114.9006],  790:  [50.1850, -115.2676],
  791:  [49.1878, -115.5417],  832:  [51.4027, -122.3202],
  836:  [49.4335, -120.4571],  838:  [49.4358, -116.7464],
  865:  [50.8193, -116.2449],  866:  [51.4357, -117.0571],
  868:  [51.8533, -118.5914],  873:  [50.7650, -117.9578],
  876:  [49.7672, -119.1241],  882:  [50.8635, -119.0029],
  886:  [49.6673, -115.2144],  904:  [52.3873, -126.5897],
  905:  [51.5154, -118.2721],  919:  [51.6694, -118.4871],
  934:  [48.8228, -124.1371],  938:  [54.6830, -127.3234],
  944:  [48.5713, -124.2000],  945:  [50.3701, -126.4339],
  956:  [49.1700, -125.2825],  977:  [49.6551, -121.3576],
  995:  [50.1324, -126.9282],  1024: [50.4387, -121.5515],
  1025: [50.1035, -124.6146],  1029: [50.9109, -122.6889],
  1040: [49.7234, -121.8366],  1045: [56.5553, -120.3952],
  1055: [50.3511, -121.6550],  1066: [49.5855, -123.3873],
  1075: [49.0469, -115.2253],  1082: [51.2112, -120.4120],
  1083: [50.6200, -123.4102],  1092: [50.6126, -116.7933],
  1093: [50.0267, -125.2929],  1108: [52.1223, -119.2936],
  1141: [48.5161, -123.7644],  1142: [48.4944, -123.6139],
  1143: [48.5861, -123.7494],  1144: [49.1039, -121.6376],
  1165: [54.1693, -121.6519],  1166: [48.5722, -123.7068],
  1176: [51.3127, -119.3926],  1203: [49.3576, -116.9503],
  1218: [49.8180, -124.4499],  1221: [50.0708, -123.2771],
  1268: [52.8597, -119.3386],  1270: [59.8929, -129.0939],
  1275: [52.1346, -126.2627],  1276: [51.6556, -126.1407],
  1277: [49.8832, -119.5695],  1283: [50.0835, -123.0475],
  1323: [50.6906, -119.1761],  1339: [49.9754, -121.4892],
  1345: [55.3144, -125.3484],  1348: [51.3800, -125.7695],
  1349: [51.1019, -124.9502],  1359: [50.4972, -119.7269],
  1362: [49.6102, -126.0327],  1375: [49.8747, -122.2816],
  1378: [50.2651, -127.0835],  1398: [49.2075, -125.1218],
  1399: [50.1214, -120.7442],  1408: [50.1711, -125.5757],
  1790: [51.1753, -117.1757],  2450: [49.4539, -115.9884],
  3110: [49.8330, -114.8831],  3191: [52.5074, -118.7743],
  3810: [49.0251, -119.6909],  3851: [54.4380, -128.5714],
  3873: [49.3394, -120.4071],  4232: [59.3394, -122.0718],
  4270: [55.6907, -121.6137],  4352: [53.3159, -119.6007],
  4393: [50.3752, -126.5401],  4513: [48.8199, -124.1310],
  4552: [49.7520, -123.0983],  4973: [52.9640, -122.8311],
  5154: [48.6990, -123.5929],  5796: [49.4273, -118.0512],
  5816: [52.0288, -121.9925],  5858: [49.0650, -116.5500],
  5861: [50.3361, -122.6675],  5896: [55.2660, -128.0587],
  5916: [52.0830, -122.1217],
};

async function fetchBCWSDatamart() {
  // Fast exits — avoid repeated fetch attempts
  if (_bcwsCORSFailed) return null;
  const today = new Date();
  const yyyy  = today.getFullYear();
  const mm    = String(today.getMonth() + 1).padStart(2, '0');
  const dd    = String(today.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  if (_bcwsCache && _bcwsCacheDate === dateStr) return _bcwsCache;

  // Deduplicate concurrent requests — all callers await the same in-flight promise
  if (_bcwsFetchPromise) return _bcwsFetchPromise;

  const url = `https://www.for.gov.bc.ca/ftp/HPR/external/!publish/BCWS_DATA_MART/${yyyy}/${dateStr}.csv`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  _bcwsFetchPromise = (async () => {
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();

    const lines   = text.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toUpperCase());
    const col = name => headers.indexOf(name);

    const idx = {
      code:  col('STATION_CODE'),
      name:  col('STATION_NAME'),
      dt:    col('DATE_TIME'),
      ffmc:  col('FINE_FUEL_MOISTURE_CODE'),
      dmc:   col('DUFF_MOISTURE_CODE'),
      dc:    col('DROUGHT_CODE'),
      bui:   col('BUILDUP_INDEX'),
      isi:   col('INITIAL_SPREAD_INDEX'),
      fwi:   col('FIRE_WEATHER_INDEX'),
      temp:  col('HOURLY_TEMPERATURE'),
      rh:    col('HOURLY_RELATIVE_HUMIDITY'),
      wind:  col('HOURLY_WIND_SPEED'),
      precip: col('HOURLY_PRECIPITATION'),
    };

    const nowUTC   = new Date();
    // Noon LST = 12 in BCWS local time (BC keeps PST = UTC-8 for fire weather year-round)
    // Use noon if it's passed (UTC-8 noon = 20:00 UTC), otherwise use latest available hour
    const noonPassed = nowUTC.getUTCHours() >= 20;
    const targetHour = noonPassed ? 12 : nowUTC.getUTCHours() - 8; // approximate local hour

    // Build map: code → best (noon-preferred) record
    const latestByCode = {};
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split(',');
      if (p.length < 10) continue;
      const dtStr = p[idx.dt]?.trim();
      if (!dtStr || dtStr.length < 10) continue;
      const hour = parseInt(dtStr.slice(-2), 10);
      if (isNaN(hour)) continue;

      // Keep noon row if available, else keep latest prior hour
      const code = parseInt(p[idx.code]);
      if (isNaN(code)) continue;
      const existing = latestByCode[code];
      const isNoon   = hour === 12;
      const isBetter = !existing ||
        (isNoon && existing._hour !== 12) ||
        (!isNoon && hour > (existing._hour ?? -1) && existing._hour !== 12);
      if (!isBetter) continue;

      const ffmc = parseFloat(p[idx.ffmc]);
      const dmc  = parseFloat(p[idx.dmc]);
      const dc   = parseFloat(p[idx.dc]);
      if (isNaN(ffmc) || isNaN(dmc) || isNaN(dc)) continue;

      latestByCode[code] = {
        _hour:  hour,
        ffmc,
        dmc,
        dc,
        bui:    parseFloat(p[idx.bui])  || null,
        isi:    parseFloat(p[idx.isi])  || null,
        fwi:    parseFloat(p[idx.fwi])  || null,
        temp:   parseFloat(p[idx.temp]) || null,
        rh:     parseFloat(p[idx.rh])   || null,
        wind:   parseFloat(p[idx.wind]) || null,
        rain:   parseFloat(p[idx.precip]) || 0,
        stationName: p[idx.name]?.trim().replace(/"/g, ''),
        month:  today.getMonth() + 1,
        fwiFromCWFIS: true,
        wdir:   null,
      };
    }

    // Post-process: compute missing ISI/BUI/FWI where possible
    for (const [code, rec] of Object.entries(latestByCode)) {
      if (rec.fwi == null || isNaN(rec.fwi)) {
        if (rec.isi == null) rec.isi = _isi(rec.ffmc, rec.wind ?? 0);
        if (rec.bui == null) rec.bui = _bui(rec.dmc, rec.dc);
        rec.fwi = _fwi(rec.isi, rec.bui);
      }
    }

    _bcwsCache     = latestByCode;
    _bcwsCacheDate = dateStr;
    return latestByCode;
  } catch (e) {
    clearTimeout(timer);
    // Mark CORS failure so subsequent calls skip immediately without fetching
    if (e instanceof TypeError && e.message?.toLowerCase().includes('failed to fetch')) {
      _bcwsCORSFailed = true;
    }
    return null;
  } finally {
    _bcwsFetchPromise = null; // release after completion so next-day calls work
  }
  })();
  return _bcwsFetchPromise;
}

/**
 * Look up BCWS Datamart FWI for a lat/lng by finding the nearest BCWS station.
 * Returns a weather-compatible object with fwiFromCWFIS=true, or null.
 */
async function fetchBCWSForCoords(lat, lng) {
  const datamart = await fetchBCWSDatamart();
  if (!datamart) return null;

  // Find nearest BCWS station that has valid data today
  let best = null, bestDist = Infinity;
  for (const [codeStr, coords] of Object.entries(BCWS_STATION_COORDS)) {
    const code = parseInt(codeStr);
    const rec  = datamart[code];
    if (!rec || rec.fwi == null || isNaN(rec.fwi)) continue;
    const d = _haversineKm(lat, lng, coords[0], coords[1]);
    if (d < bestDist) { bestDist = d; best = { ...rec, code, distKm: Math.round(d) }; }
  }
  if (!best || bestDist > 100) return null; // >100 km is too far

  const stName = best.stationName || `BCWS Station ${best.code}`;
  const obsHour = best._hour === 12 ? 'noon LST' : `hour ${best._hour}`;
  return {
    ...best,
    source: `BCWS Datamart · ${stName} (${best.distKm} km)`,
    repDate: _bcwsCacheDate,
    obsTime: `${_bcwsCacheDate} ${obsHour}`,
    stationName: stName,
    stationLat:  BCWS_STATION_COORDS[best.code]?.[0] ?? lat,
    stationLng:  BCWS_STATION_COORDS[best.code]?.[1] ?? lng,
    distKm: best.distKm,
  };
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.features?.length) return null;

    if (idwMode) return _computeIDWBlend(data.features, lat, lng);

    // Prefer nearest station with active FWI chain (dc+ffmc not null).
    // Fall back to nearest weather-only station if no FWI chain within 200 km.
    let fwiNearest = null, fwiDist = Infinity;
    let wxNearest  = null, wxDist  = Infinity;
    for (const feat of data.features) {
      const p = feat.properties;
      if (p.temp == null || p.rh == null || p.ws == null) continue;
      const d = _haversineKm(lat, lng, +p.lat, +p.lon);
      if (d < wxDist) { wxDist = d; wxNearest = p; }
      if (p.ffmc != null && p.dc != null && d < fwiDist) { fwiDist = d; fwiNearest = p; }
    }
    const nearest = (fwiNearest && fwiDist <= wxDist + 200) ? fwiNearest : wxNearest;
    const usedDist = (fwiNearest && fwiDist <= wxDist + 200) ? fwiDist : wxDist;
    if (!nearest) return null;

    // DC divergence: flag when nearby stations (≤75 km) differ by ≥75 DC units.
    let dcMin = Infinity, dcMax = -Infinity, dcCount = 0;
    for (const feat of data.features) {
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

    return {
      temp:  nearest.temp,
      rh:    nearest.rh,
      wind:  nearest.ws,
      wdir:  nearest.wdir ?? null,
      rain:  nearest.precip ?? 0,
      month: new Date().getMonth() + 1,
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
      stationLat: +nearest.lat,
      stationLng: +nearest.lon,
      distKm: Math.round(usedDist),
      dcDivergence,
    };
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

/**
 * IDW blend — shared with AB engine logic; see AB fwi.js _computeIDWBlend for full docs.
 */
function _computeIDWBlend(features, lat, lng, maxStations = 12) {
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

  const w   = used.map(c => 1 / (c.d * c.d));
  const wS  = w.reduce((s, v) => s + v, 0);
  const wN  = w.map(v => v / wS);
  const idw = key => used.reduce((s, c, i) => s + (+(c.p[key] ?? 0)) * wN[i], 0);

  const temp = idw('temp');
  const rh   = Math.min(100, Math.max(0, idw('rh')));
  const wind = idw('ws');
  const rain = idw('precip');

  let sinSum = 0, cosSum = 0, wdirCount = 0;
  used.forEach((c, i) => {
    if (c.p.wdir == null) return;
    const rad = (+c.p.wdir) * Math.PI / 180;
    sinSum += Math.sin(rad) * wN[i]; cosSum += Math.cos(rad) * wN[i]; wdirCount++;
  });
  const wdir = wdirCount ? Math.round(((Math.atan2(sinSum, cosSum) * 180 / Math.PI) + 360) % 360) : null;

  const chain = used.filter(c => c.p.ffmc != null && c.p.dmc != null && c.p.dc != null);
  let ffmc = null, dmc = null, dc = null, isi = null, bui = null, fwi = null;
  let fwiFromCWFIS = false, dcDivergence = null;

  if (chain.length >= 1) {
    fwiFromCWFIS = true;
    const cw  = chain.map(c => 1 / (c.d * c.d));
    const cwS = cw.reduce((s, v) => s + v, 0);
    const cwN = cw.map(v => v / cwS);
    const cidw = key => chain.reduce((s, c, i) => s + (+c.p[key]) * cwN[i], 0);
    ffmc = cidw('ffmc'); dmc = cidw('dmc'); isi = cidw('isi'); bui = cidw('bui'); fwi = cidw('fwi');
    const dcVals = chain.map(c => +c.p.dc);
    const dcSpread = Math.max(...dcVals) - Math.min(...dcVals);
    if (chain.length >= 2 && dcSpread >= 75) {
      dc = dcVals[0];
      dcDivergence = { spread: Math.round(dcSpread), min: Math.round(Math.min(...dcVals)), max: Math.round(Math.max(...dcVals)) };
    } else {
      dc = cidw('dc');
    }
  } else {
    let dcMin2 = Infinity, dcMax2 = -Infinity, dcCnt = 0;
    for (const c of cands) {
      if (c.p.dc == null || c.d > 75) continue;
      dcMin2 = Math.min(dcMin2, +c.p.dc); dcMax2 = Math.max(dcMax2, +c.p.dc); dcCnt++;
    }
    if (dcCnt >= 2 && (dcMax2 - dcMin2) >= 75)
      dcDivergence = { spread: Math.round(dcMax2 - dcMin2), min: Math.round(dcMin2), max: Math.round(dcMax2) };
  }

  const avgDist = Math.round(used.reduce((s, c) => s + c.d, 0) / used.length);
  return {
    temp, rh, wind, wdir, rain,
    month: new Date().getMonth() + 1,
    ffmc, dmc, dc, isi, bui, fwi,
    fwiFromCWFIS,
    source: `IDW · ${used.length} stations · avg ${avgDist} km`,
    stationName: null, stationLat: null, stationLng: null,
    distKm: Math.round(used[0].d),
    dcDivergence,
    idwMode: true, idwCount: used.length, idwAvgDist: avgDist,
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
 * Fetch weather — four-tier hierarchy (BC):
 *   0. BCWS Datamart              — pre-computed BCWS FWI, 200+ BC fire wx stations
 *   1. CWFIS firewx_stns_current — fire weather stations (limited BC coverage: ~11 stations)
 *   2. MSC SWOB realtime         — real sensor obs, noon LST targeted
 *   3. Open-Meteo NWP            — model output, noon LST targeted, last resort
 */
// IDW blend mode — persisted across page loads
let _idwMode = false;
try { _idwMode = localStorage.getItem('fwi_idw_mode') === '1'; } catch (_) {}

async function fetchWeatherPrimary(lat, lng) {
  // Tier 0 (BC only): BCWS Weather Datamart — authoritative BC fire weather FWI
  // IDW mode skips BCWS (single-station authoritative source) and uses CWFIS IDW blend
  if (!_idwMode) {
    try {
      const bcws = await fetchBCWSForCoords(lat, lng);
      if (bcws) return bcws;
    } catch (e) { /* fall through */ }
  }
  try {
    const cwfis = await fetchCWFIS(lat, lng, _idwMode);
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
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,thunderstorm_probability` +
    `&forecast_days=1&timezone=UTC`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const d = await res.json();
  const times = d.hourly.time; // ISO strings, UTC

  // Noon LST = 20:00 UTC (BC is UTC−8 PST; CFFDRS uses fixed standard time year-round)
  const noonUTC = 20;
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
    rain:             d.hourly.precipitation[i],
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
  // Van Wagner equations — spring startup constants when no carry-over available
  const ffmc = _ffmc(w.temp, w.rh, w.wind, w.rain, prev.ffmc);
  const dmc  = _dmc(w.temp, w.rh, w.rain, w.month, prev.dmc);
  const dc   = _dc(w.temp, w.rain, w.month, prev.dc);
  const isi  = _isi(ffmc, w.wind);
  const bui  = _bui(dmc, dc);
  const fwi  = _fwi(isi, bui);
  return { ffmc, dmc, dc, isi, bui, fwi, danger: dangerRatingProv(fwi), weather: w };
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
    el.textContent = val != null ? componentRating(key, val).toUpperCase() : '—';
  });

  // Timestamp (line 1) + source label (line 2, station_detail only)
  set('updated', `Live · ${new Date().toLocaleTimeString()}`);
  const _distStr = r.weather.distKm != null ? ` · ${r.weather.distKm} km` : '';
  const srcLabel = r.weather.stationName
    ? `CWFIS · ${r.weather.stationName}${_distStr}`
    : (r.weather.source || 'Open-Meteo NWP');
  set('source-station', srcLabel);

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
      dcBadge.textContent = 'CWFIS' + stn + dst;
      dcBadge.className = 'mt-2 inline-block text-[9px] font-label font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary';
    } else if (r._cachedFWI) {
      const cached = r._cachedFWI;
      const stn = r.weather.stationName || cached.stationName;
      const stnStr = stn ? ` · ${stn}` : '';
      const distKm = r.weather.distKm ?? cached.distKm;
      const dstStr = distKm != null ? ` · ${distKm} km` : '';
      let dateStr = '';
      if (cached.repDate) {
        const d = new Date(cached.repDate);
        dateStr = ` · ${d.toLocaleDateString('en-CA', { month:'short', day:'numeric' })} ${d.toLocaleTimeString('en-CA', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'America/Vancouver' })} PDT`;
      } else if (cached.cachedAt) {
        const d = new Date(cached.cachedAt);
        dateStr = ` · ${d.toLocaleDateString('en-CA', { month:'short', day:'numeric' })}`;
      }
      dcBadge.textContent = 'CWFIS (holding)' + stnStr + dstStr + dateStr;
      dcBadge.className = 'mt-2 inline-block text-[9px] font-label font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400';
    } else {
      dcBadge.textContent = 'Season start pending · CWFIS inactive';
      dcBadge.className = 'mt-2 inline-block text-[9px] font-label font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-400';
    }
  }

  // DC divergence warning
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
async function initFWI(lat = 50.70, lng = -120.45, station = 'Kamloops') {
  _stationLat  = lat; // P5: update for seasonal FMC calculation
  _stationLng  = lng;
  _stationName = station;
  const gen = ++_initGeneration; // this call's generation token
  document.querySelectorAll('[data-fwi="station"]').forEach(el => el.textContent = station);
  document.querySelectorAll('[data-fwi="updated"]').forEach(el => el.textContent = 'Loading…');

  try {
    if (!_cwfisPrev.stations) await loadCWFISPrev();
    const weather = await fetchWeatherPrimary(lat, lng);
    if (gen !== _initGeneration) return; // a newer initFWI started; discard stale result

    let result;
    if (weather.fwiFromCWFIS) {
      // CWFIS has today's operational FWI chain — use directly and cache for later
      result = calculateFWI(weather);
      try {
        localStorage.setItem('bc-fwi-cached-cwfis', JSON.stringify({
          ffmc: result.ffmc, dmc: result.dmc, dc: result.dc,
          isi: result.isi, bui: result.bui, fwi: result.fwi,
          danger: result.danger,
          stationName: weather.stationName,
          distKm: weather.distKm ?? null,
          repDate: weather.repDate,
          cachedAt: new Date().toISOString(),
        }));
      } catch (_) {}
    } else {
      // CWFIS has weather obs but no FWI codes yet (pre-obs / processing lag / early season).
      // Use last cached real CWFIS values instead of synthesising from startup constants.
      let cachedFWI = null;
      try { cachedFWI = JSON.parse(localStorage.getItem('bc-fwi-cached-cwfis')); } catch (_) {}

      if (cachedFWI?.ffmc != null && cachedFWI?.dc != null) {
        const isi = _isi(cachedFWI.ffmc, weather.wind ?? 0);
        const bui = _bui(cachedFWI.dmc, cachedFWI.dc);
        const fwi = _fwi(isi, bui);
        result = {
          ffmc: cachedFWI.ffmc, dmc: cachedFWI.dmc, dc: cachedFWI.dc,
          isi, bui, fwi,
          danger: dangerRatingProv(fwi),
          weather,
          _cachedFWI: cachedFWI,
        };
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
    const p = _cwfisPrev?.stations?.[station.name];
    if (p?.ffmc != null && p?.dmc != null && p?.dc != null) {
      prevFWI = { ffmc: p.ffmc, dmc: p.dmc, dc: p.dc };
    }
  }
  const fwi = calculateFWI(weather, prevFWI);
  return { station, weather, fwi };
}

/**
 * Fetch D+1 forecast weather for a station using ECMWF IFS via Open-Meteo.
 * FWI chain uses hour-12 (noon) forecast conditions with CWFIS carry-over as prev.
 * FBP wind uses hour-16 (peak burn ~16:00 PDT) — matches the D+1 peak prediction
 * shown on the station detail page.
 * Used by the Fire Safety Briefing builder for PM Forecast mode.
 */
async function fetchStationDataForecast(station) {
  _stationLat  = station.lat;
  _stationLng  = station.lng;
  _stationName = station.name;

  const days = await fetchForecast(station.lat, station.lng);

  // D+1: next operationally relevant peak burn day (today if before 16:00 PDT, tomorrow if after)
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
    source:           `ECMWF IFS 0.25° · ${day.label} · Peak ~16:00 PDT`,
    fwiFromCWFIS:     false,
  };

  // FWI carry-over: use CWFIS yesterday values as starting state
  if (!_cwfisPrev.stations) await loadCWFISPrev();
  let prevFWI = { ffmc: STARTUP.ffmc, dmc: STARTUP.dmc, dc: getStartupDC(station.name) };
  const p = _cwfisPrev?.stations?.[station.name];
  if (p?.ffmc != null && p?.dmc != null && p?.dc != null) {
    prevFWI = { ffmc: p.ffmc, dmc: p.dmc, dc: p.dc };
  }

  const fwi = calculateFWI(weather, prevFWI);
  return { station, weather, fwi, forecastDay: day };
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
  { name: 'Grande Cache',      lat: 53.883, lng: -118.433 }, // shifted east toward Hinton/SWOB corridor
  // Central
  { name: 'Edmonton',          lat: 53.534, lng: -113.490 }, // City centre — equidistant from YEG/Blatchford/City AWS SWOB
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

// BC Wildfire Service fire weather stations — actual BCWS network.
// Source: openmaps.gov.bc.ca PROT_WEATHER_STATIONS_SP WFS (260 stations);
//         coordinates are authoritative BCWS lat/lng.
// BCWS station codes (code field) enable direct BCWS Datamart lookup.
// Dominant fuel default: C3 (lodgepole pine — BC interior dominant).
const BC_STATIONS = [
  // ── Coastal Fire Centre (HQ: Victoria) ──
  { code:   11, name: 'Summit',            lat: 48.9276, lng: -124.6469 },
  { code:   19, name: 'Menzies Camp',      lat: 50.0486, lng: -125.7887 },
  { code:   21, name: 'Woss Camp',         lat: 50.2132, lng: -126.6071 },
  { code:   37, name: 'Beaver Creek',      lat: 49.3776, lng: -124.9337 },
  { code:   45, name: 'Saltspring 2',      lat: 48.7729, lng: -123.4745 },
  { code:   56, name: 'Bowser',            lat: 49.4368, lng: -124.7022 },
  { code:   59, name: 'Cedar',             lat: 49.0476, lng: -123.8747 },
  { code:   67, name: 'Haig Camp',         lat: 49.3806, lng: -121.5259 },
  { code:   72, name: 'UBC Research',      lat: 49.2645, lng: -122.5732 },
  { code:   75, name: 'Toba Camp',         lat: 50.5711, lng: -124.0777 },
  { code:   82, name: 'Scar Creek',        lat: 50.3317, lng: -122.5658 },
  { code:   93, name: 'Honna (Haida Gwaii)', lat: 53.2532, lng: -132.1156 },
  { code:  101, name: 'Machmell',          lat: 51.5931, lng: -126.4508 },
  { code: 1025, name: 'Theodosia',         lat: 50.1035, lng: -124.6146 },
  { code: 1040, name: 'Big Silver 2',      lat: 49.7234, lng: -121.8366 },
  { code: 1066, name: 'McNabb',            lat: 49.5855, lng: -123.3873 },
  { code: 1083, name: 'Meager Creek',      lat: 50.6200, lng: -123.4102 },
  { code: 1093, name: 'Quinsam Base',      lat: 50.0267, lng: -125.2929 },
  { code: 1218, name: 'Powell River West Lake', lat: 49.8180, lng: -124.4499 },
  { code: 1221, name: 'Mount Cayley',      lat: 50.0708, lng: -123.2771 },
  { code: 1283, name: 'Cheakamus',         lat: 50.0835, lng: -123.0475 },
  { code: 1339, name: 'Boothroyd',         lat: 49.9754, lng: -121.4892 },
  { code: 1348, name: 'Klinaklini',        lat: 51.3800, lng: -125.7695 },
  { code: 1349, name: 'Homathko',          lat: 51.1019, lng: -124.9502 },
  { code: 1375, name: 'Frank Creek',       lat: 49.8747, lng: -122.2816 },
  { code: 1378, name: 'Atluck',            lat: 50.2651, lng: -127.0835 },
  { code: 1398, name: 'Nahmint',           lat: 49.2075, lng: -125.1218 },
  { code: 1408, name: 'Blackwater',        lat: 50.1711, lng: -125.5757 },
  { code: 4552, name: 'Mashiter',          lat: 49.7520, lng: -123.0983 },
  { code: 5154, name: 'Cobble Hill',       lat: 48.6990, lng: -123.5929 },
  // ── Kamloops Fire Centre ──
  { code:  280, name: 'Lillooet',          lat: 50.6720, lng: -121.8882 },
  { code:  279, name: 'Thynne',            lat: 49.7152, lng: -120.8661 },
  { code:  283, name: 'Brenda Mines',      lat: 49.8684, lng: -119.9925 },
  { code:  286, name: 'Turtle',            lat: 50.8036, lng: -119.6307 },
  { code:  291, name: 'Glimpse',           lat: 50.2705, lng: -120.2883 },
  { code:  292, name: 'Darcy',             lat: 50.5217, lng: -122.4978 },
  { code:  298, name: 'Fintry',            lat: 50.2062, lng: -119.4804 },
  { code:  301, name: 'Pemberton Base',    lat: 50.3059, lng: -122.7287 },
  { code:  302, name: 'Aspen Grove',       lat: 49.9481, lng: -120.6211 },
  { code:  305, name: 'Sparks Lake',       lat: 50.9237, lng: -120.8672 },
  { code:  307, name: 'Leighton Lake',     lat: 50.6153, lng: -120.8362 },
  { code:  309, name: 'Gwyneth Lake',      lat: 50.7963, lng: -122.8805 },
  { code:  311, name: 'McLean Lake',       lat: 50.7923, lng: -121.3582 },
  { code:  316, name: 'Nahatlatch',        lat: 49.9018, lng: -122.0209 },
  { code:  317, name: 'Allison Pass',      lat: 49.0625, lng: -120.7668 },
  { code:  322, name: 'Afton',             lat: 50.6727, lng: -120.4822 },
  { code:  326, name: 'Paska Lake',        lat: 50.5040, lng: -120.6740 },
  { code:  328, name: 'Penticton RS',      lat: 49.5177, lng: -119.5529 },
  { code:  331, name: 'Ashnola',           lat: 49.1391, lng: -120.1844 },
  { code:  334, name: 'McCuddy',           lat: 49.1483, lng: -119.4150 },
  { code:  363, name: 'Revelstoke',        lat: 51.0603, lng: -118.2172 },
  { code: 1029, name: 'Five Mile',         lat: 50.9109, lng: -122.6889 },
  { code: 1055, name: 'Splintlum',         lat: 50.3511, lng: -121.6550 },
  { code: 1082, name: 'Mayson',            lat: 51.2112, lng: -120.4120 },
  { code: 1108, name: 'Blue River 2',      lat: 52.1223, lng: -119.2936 },
  { code: 1176, name: 'Mudpit',            lat: 51.3127, lng: -119.3926 },
  { code: 1277, name: 'West Kelowna',      lat: 49.8832, lng: -119.5695 },
  { code: 1323, name: 'Larch Hills West',  lat: 50.6906, lng: -119.1761 },
  { code: 1359, name: 'Station Bay 2',     lat: 50.4972, lng: -119.7269 },
  { code: 1399, name: 'Merritt 2 Hub',     lat: 50.1214, lng: -120.7442 },
  { code: 3873, name: 'Willis',            lat: 49.3394, lng: -120.4071 },
  { code: 5861, name: 'Xetolacow',         lat: 50.3361, lng: -122.6675 },
  // ── Cariboo Fire Centre (HQ: Williams Lake) ──
  { code:  206, name: 'Tautri',            lat: 52.5387, lng: -123.3433 },
  { code:  208, name: 'Tatla Lake',        lat: 51.9062, lng: -124.6067 },
  { code:  209, name: 'Alexis Creek',      lat: 52.0838, lng: -123.2733 },
  { code:  210, name: 'Riske Creek',       lat: 51.9596, lng: -122.5041 },
  { code:  211, name: 'Nazko',             lat: 52.9575, lng: -123.5958 },
  { code:  212, name: 'Place Lake',        lat: 51.8182, lng: -122.0057 },
  { code:  213, name: 'Anahim Lake',       lat: 52.4609, lng: -125.3067 },
  { code:  216, name: 'Nemiah',            lat: 51.4800, lng: -123.8181 },
  { code:  218, name: 'Lone Butte',        lat: 51.5070, lng: -121.1620 },
  { code:  221, name: 'Baldface',          lat: 52.7101, lng: -124.4823 },
  { code:  222, name: 'Gaspard',           lat: 51.4508, lng: -122.6603 },
  { code:  225, name: 'Knife',             lat: 52.0497, lng: -121.8738 },
  { code:  226, name: 'Middle Lake',       lat: 51.7017, lng: -124.8750 },
  { code:  227, name: 'Gavin',             lat: 52.4709, lng: -121.7430 },
  { code:  228, name: 'Benson',            lat: 52.9100, lng: -122.0667 },
  { code:  230, name: 'Horsefly',          lat: 52.3278, lng: -121.3983 },
  { code:  232, name: 'Coldscaur Lake',    lat: 51.7238, lng: -120.3899 },
  { code:  233, name: 'Talchako',          lat: 52.2514, lng: -126.0284 },
  { code:  234, name: 'Timothy',           lat: 51.9132, lng: -121.3887 },
  { code:  235, name: 'Young Lake',        lat: 51.2378, lng: -120.9976 },
  { code:  236, name: 'Meadow Lake',       lat: 51.3750, lng: -121.7200 },
  { code:  239, name: 'Clearwater Hub',    lat: 51.6289, lng: -120.0946 },
  { code:  243, name: 'East Barriere',     lat: 51.2531, lng: -119.8817 },
  { code:  244, name: 'Windy Mountain',    lat: 51.6645, lng: -120.6575 },
  { code:  251, name: 'Deception',         lat: 51.9674, lng: -120.6078 },
  { code:  253, name: 'Cahilty',           lat: 50.8879, lng: -119.8383 },
  { code:  255, name: 'Likely RS',         lat: 52.6145, lng: -121.5139 },
  { code:  262, name: 'Big Valley',        lat: 53.2622, lng: -121.7628 },
  { code:  264, name: 'Prairie Creek',     lat: 52.3917, lng: -120.9850 },
  { code:  266, name: 'Wells Gray',        lat: 52.3425, lng: -120.2434 },
  { code:  270, name: 'Gosnel',            lat: 52.4526, lng: -119.1753 },
  { code:  306, name: 'French Bar',        lat: 51.1775, lng: -122.2489 },
  { code:  832, name: 'Churn Creek',       lat: 51.4027, lng: -122.3202 },
  { code:  904, name: 'Hagensborg 2',      lat: 52.3873, lng: -126.5897 },
  { code: 1024, name: 'Skoonka',           lat: 50.4387, lng: -121.5515 },
  { code: 5796, name: 'Deer Park',         lat: 49.4273, lng: -118.0512 },
  { code: 5816, name: 'Brunson',           lat: 52.0288, lng: -121.9925 },
  { code: 5916, name: 'Bond Lake',         lat: 52.0830, lng: -122.1217 },
  // ── Prince George Fire Centre ──
  { code:  141, name: 'Manson',            lat: 55.3800, lng: -122.5500 },
  { code:  145, name: 'Ingenika Point',    lat: 57.0194, lng: -125.1804 },
  { code:  146, name: 'Fort St James',     lat: 54.3942, lng: -124.2611 },
  { code:  148, name: 'Blackpine',         lat: 56.3188, lng: -125.3680 },
  { code:  149, name: 'Bear Lake',         lat: 54.4824, lng: -122.6829 },
  { code:  151, name: 'Nabeshe',           lat: 56.3643, lng: -123.3655 },
  { code:  152, name: 'Sifton',            lat: 57.8517, lng: -126.1168 },
  { code:  153, name: 'McLeod Lake',       lat: 54.7442, lng: -123.0187 },
  { code:  154, name: 'Witch',             lat: 55.0230, lng: -124.2666 },
  { code:  155, name: 'Mackenzie FS',      lat: 55.2864, lng: -123.1359 },
  { code:  158, name: 'Vanderhoof Hub',    lat: 54.0554, lng: -124.0102 },
  { code:  159, name: 'North Chilco',      lat: 54.1546, lng: -123.7542 },
  { code:  163, name: 'Lovell Cove',       lat: 55.6881, lng: -126.0525 },
  { code:  165, name: 'Moose Lake',        lat: 53.0715, lng: -125.4121 },
  { code:  167, name: 'Augier Lake',       lat: 54.3619, lng: -125.5253 },
  { code:  175, name: 'Bednesti',          lat: 53.8654, lng: -123.3232 },
  { code:  178, name: 'Peden',             lat: 53.9868, lng: -126.5174 },
  { code:  183, name: 'Parrott',           lat: 54.0186, lng: -126.3890 },
  { code:  187, name: 'Hixon',             lat: 53.4114, lng: -122.5961 },
  { code:  189, name: 'Chilako',           lat: 53.4937, lng: -123.6089 },
  { code:  190, name: 'Jerry',             lat: 53.5264, lng: -122.1064 },
  { code:  192, name: 'McGregor 2',        lat: 53.9289, lng: -120.6355 },
  { code:  193, name: 'Bowron Haggen',     lat: 53.4630, lng: -121.5603 },
  { code:  195, name: 'McBride',           lat: 53.2948, lng: -120.1530 },
  { code:  199, name: 'Catfish',           lat: 53.5764, lng: -120.8585 },
  { code:  200, name: 'Valemount 2',       lat: 52.7883, lng: -119.3147 },
  { code:  263, name: 'Mathew',            lat: 52.9084, lng: -120.9172 },
  { code:  654, name: 'Holy Cross 2',      lat: 53.9362, lng: -124.7765 },
  { code: 1045, name: 'Osborn',            lat: 56.5553, lng: -120.3952 },
  { code: 1165, name: 'Severeid',          lat: 54.1693, lng: -121.6519 },
  { code: 1268, name: 'Valemount Airport', lat: 52.8597, lng: -119.3386 },
  { code: 1275, name: 'Ape Lake',          lat: 52.1346, lng: -126.2627 },
  { code: 1276, name: 'Machmell Kliniklini', lat: 51.6556, lng: -126.1407 },
  { code: 3191, name: 'Goatlick',          lat: 52.5074, lng: -118.7743 },
  { code: 4270, name: 'Chetwynd FB',       lat: 55.6907, lng: -121.6137 },
  { code: 4352, name: 'Blueberry',         lat: 53.3159, lng: -119.6007 },
  { code: 4973, name: 'Baker Creek',       lat: 52.9640, lng: -122.8311 },
  // ── Northwest Fire Centre (HQ: Smithers) ──
  { code:  105, name: 'Rosswood',          lat: 54.9168, lng: -128.8597 },
  { code:  106, name: 'Kitpark',           lat: 54.1696, lng: -128.5759 },
  { code:  108, name: 'Dease Lake FS',     lat: 58.4258, lng: -130.0187 },
  { code:  111, name: 'Atlin',             lat: 59.5845, lng: -133.6643 },
  { code:  113, name: 'Bob Quinn Lake',    lat: 56.9809, lng: -130.2510 },
  { code:  156, name: 'Sustut',            lat: 56.3288, lng: -127.0339 },
  { code:  161, name: 'Grassy Plains Hub', lat: 53.9454, lng: -125.8761 },
  { code:  162, name: 'Houston',           lat: 54.3939, lng: -126.6175 },
  { code:  166, name: 'Kluskus',           lat: 53.3830, lng: -124.5121 },
  { code:  169, name: 'Upper Fulton',      lat: 55.0340, lng: -126.7996 },
  { code:  170, name: 'East Ootsa',        lat: 53.5025, lng: -125.7793 },
  { code:  171, name: 'Leo Creek',         lat: 55.0817, lng: -125.4773 },
  { code:  172, name: 'Nilkitkwa',         lat: 55.5380, lng: -126.5775 },
  { code:  173, name: 'North Babine',      lat: 55.1350, lng: -126.2073 },
  { code:  179, name: 'Nadina',            lat: 53.9425, lng: -126.9278 },
  { code:  180, name: 'McBride Lake',      lat: 54.0747, lng: -127.3994 },
  { code:  181, name: 'Burns Lake 850m',   lat: 54.2591, lng: -125.7598 },
  { code:  182, name: 'Ganokwa',           lat: 54.8013, lng: -126.9484 },
  { code:  427, name: 'Nass Camp',         lat: 55.2886, lng: -128.9984 },
  { code:  428, name: 'Kispiox Hub',       lat: 55.4343, lng: -127.6487 },
  { code:  429, name: 'Cedarvale',         lat: 55.0301, lng: -128.3115 },
  { code:  430, name: 'Van Dyke',          lat: 56.0127, lng: -129.0998 },
  { code:  431, name: 'Upper Kispiox',     lat: 55.6015, lng: -128.0478 },
  { code:  432, name: 'Bell-Irving',       lat: 56.3486, lng: -129.2929 },
  { code:  433, name: 'Cranberry',         lat: 55.5768, lng: -128.7048 },
  { code:  938, name: 'Pine Creek',        lat: 54.6830, lng: -127.3234 },
  { code: 1270, name: 'Old Faddy',         lat: 59.8929, lng: -129.0939 },
  { code: 1345, name: 'Sawtooth',          lat: 55.3144, lng: -125.3484 },
  { code: 3851, name: 'Terrace',           lat: 54.4380, lng: -128.5714 },
  { code: 5896, name: 'Gitanyow',          lat: 55.2660, lng: -128.0587 },
  // ── Northwest (far north) ──
  { code:  110, name: 'Telegraph Creek',   lat: 57.9141, lng: -131.1711 },
  { code:  112, name: 'Iskut',             lat: 57.8617, lng: -130.0181 },
  { code:  438, name: 'Elk Mountain',      lat: 59.3336, lng: -125.5114 },
  { code:  440, name: 'Fireside',          lat: 59.7226, lng: -127.3350 },
  { code:  445, name: 'Boya Lake',         lat: 59.3673, lng: -129.1110 },
  { code: 4232, name: 'Komie',             lat: 59.3394, lng: -122.0718 },
  // ── Northeast (Peace/Fort St. John) ──
  { code:  117, name: 'Sierra',            lat: 58.8381, lng: -121.3967 },
  { code:  118, name: 'Helmut',            lat: 59.4211, lng: -120.7889 },
  { code:  119, name: 'Nelson Forks',      lat: 59.6173, lng: -124.0985 },
  { code:  120, name: 'Silver',            lat: 57.3745, lng: -121.4069 },
  { code:  121, name: 'Paddy',             lat: 57.7818, lng: -120.2368 },
  { code:  124, name: 'Graham',            lat: 56.4346, lng: -122.4576 },
  { code:  126, name: 'Toad River',        lat: 58.8659, lng: -125.3107 },
  { code:  127, name: 'Tumbler Hub',       lat: 55.0274, lng: -120.9340 },
  { code:  129, name: 'Pink Mountain',     lat: 57.0874, lng: -122.5912 },
  { code:  131, name: 'Muskwa',            lat: 57.8842, lng: -123.6164 },
  { code:  132, name: 'Hudson Hope',       lat: 56.0347, lng: -121.9903 },
  { code:  136, name: 'Wonowon',           lat: 56.7184, lng: -121.7654 },
  { code:  138, name: 'Red Deer',          lat: 54.6330, lng: -120.5762 },
  { code:  140, name: 'Lemoray',           lat: 55.5250, lng: -122.5172 },
  { code:  437, name: 'Noel',              lat: 55.2956, lng: -120.4850 },
  { code:  599, name: 'Fort Nelson FS',    lat: 58.8418, lng: -122.5736 },
  // ── Southeast Fire Centre (HQ: Castlegar) ──
  { code:  344, name: 'Seymour Arm',       lat: 51.2735, lng: -118.9147 },
  { code:  361, name: 'Tsar Creek',        lat: 51.9972, lng: -118.1025 },
  { code:  362, name: 'Mabel Lake 2',      lat: 50.3514, lng: -118.7735 },
  { code:  366, name: 'Whiskey',           lat: 51.0653, lng: -116.7850 },
  { code:  367, name: 'Marion',            lat: 51.0422, lng: -116.3638 },
  { code:  374, name: 'Succour Creek',     lat: 51.7162, lng: -117.5417 },
  { code:  379, name: 'Gold Hill',         lat: 50.3658, lng: -117.0645 },
  { code:  380, name: 'Powder Creek',      lat: 49.9065, lng: -116.8551 },
  { code:  383, name: 'Falls Creek',       lat: 50.3830, lng: -117.8799 },
  { code:  385, name: 'Duncan',            lat: 50.7808, lng: -117.1805 },
  { code:  387, name: 'Trout Lake',        lat: 50.6053, lng: -117.4272 },
  { code:  388, name: 'Kettle 2',          lat: 49.9600, lng: -118.6260 },
  { code:  390, name: 'Beaverdell',        lat: 49.4564, lng: -119.0886 },
  { code:  391, name: 'Eight Mile',        lat: 49.4328, lng: -118.5783 },
  { code:  392, name: 'Grand Forks',       lat: 49.0307, lng: -118.4156 },
  { code:  393, name: 'Nicoll',            lat: 49.5267, lng: -118.3603 },
  { code:  394, name: 'Rock Creek',        lat: 49.0520, lng: -118.9367 },
  { code:  396, name: 'Octopus Creek',     lat: 49.6990, lng: -118.0810 },
  { code:  401, name: 'Goatfell',          lat: 49.1253, lng: -116.1638 },
  { code:  402, name: 'Pendoreille',       lat: 49.0506, lng: -117.4139 },
  { code:  404, name: 'Smallwood',         lat: 49.4967, lng: -117.4475 },
  { code:  406, name: 'Slocan',            lat: 49.7847, lng: -117.4400 },
  { code:  407, name: 'Nancy Greene',      lat: 49.2545, lng: -117.9942 },
  { code:  408, name: 'Norns',             lat: 49.5025, lng: -117.7870 },
  { code:  411, name: 'Palliser',          lat: 50.4946, lng: -115.6664 },
  { code:  412, name: 'Elko',             lat: 49.2876, lng: -115.1546 },
  { code:  417, name: 'Toby Hub',          lat: 50.5128, lng: -116.0553 },
  { code:  418, name: 'Flathead 2',        lat: 49.0791, lng: -114.5373 },
  { code:  419, name: 'Johnson Lake',      lat: 49.9443, lng: -115.7582 },
  { code:  421, name: 'Dewar Creek',       lat: 49.7845, lng: -116.3830 },
  { code:  425, name: 'Emily Creek',       lat: 50.1451, lng: -115.9772 },
  { code:  426, name: 'Cranbrook',         lat: 49.6672, lng: -115.8483 },
  { code:  791, name: 'Cherry Lake',       lat: 49.1878, lng: -115.5417 },
  { code:  836, name: 'August Lake',       lat: 49.4335, lng: -120.4571 },
  { code:  838, name: 'Akokli Creek',      lat: 49.4358, lng: -116.7464 },
  { code:  865, name: 'Brisco',            lat: 50.8193, lng: -116.2449 },
  { code:  866, name: 'Blaeberry',         lat: 51.4357, lng: -117.0571 },
  { code:  868, name: 'Big Mouth 2',       lat: 51.8533, lng: -118.5914 },
  { code:  873, name: 'Crawford',          lat: 50.7650, lng: -117.9578 },
  { code:  876, name: 'Idabel Lake 3',     lat: 49.7672, lng: -119.1241 },
  { code:  882, name: 'Sicamous',          lat: 50.8635, lng: -119.0029 },
  { code:  886, name: 'Goathaven',         lat: 49.6673, lng: -115.2144 },
  { code:  905, name: 'Downie',            lat: 51.5154, lng: -118.2721 },
  { code:  919, name: 'Goldstream 2',      lat: 51.6694, lng: -118.4871 },
  { code: 1075, name: 'Koocanusa',         lat: 49.0469, lng: -115.2253 },
  { code: 1092, name: 'Rory Creek',        lat: 50.6126, lng: -116.7933 },
  { code: 1203, name: 'Darkwoods',         lat: 49.3576, lng: -116.9503 },
  { code: 1790, name: 'Cariboo Creek',     lat: 51.1753, lng: -117.1757 },
  { code: 2450, name: 'Bigattini',         lat: 49.4539, lng: -115.9884 },
  { code: 3110, name: 'Sparwood',          lat: 49.8330, lng: -114.8831 },
  { code: 3810, name: 'Little Chopaka',    lat: 49.0251, lng: -119.6909 },
  { code: 5858, name: 'Creston',           lat: 49.0650, lng: -116.5500 },
].sort((a, b) => a.name.localeCompare(b.name));

/** Province-aware station list for UI pickers. */
function getStationList() { return _province === 'BC' ? BC_STATIONS : ALBERTA_STATIONS; }

// ─── Pin-Drop Fuel Lookup ─────────────────────────────────────────────────────

/** Normalise raw WMS fuel type string to a FUEL_TYPES key, or null.
 *  Handles "O-1a Matted Grass" → "O1a", "C-2" → "C2", etc. */
function _normalizeFuelCode(raw) {
  if (!raw) return null;
  const token = raw.trim().split(/\s/)[0]; // take code only, strip description
  const s = token.toUpperCase().replace(/-/g, '').replace(/\/\d+$/, '');
  // Case-insensitive match (O1A → O1a)
  return Object.keys(FUEL_TYPES).find(k => k.toUpperCase() === s) || null;
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
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`WMS ${resp.status}`);
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
    map.setView([52.5, -122.5], 6);
  }

  // Pre-load Edmonton raster in background (AB only — BC has no Edmonton LiDAR data)
  if (_province === 'AB') _loadEdmontonFuelRaster().catch(() => {});

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
      const fuelB = FUEL_PAIR_COMPLEMENT[fuelA] || 'D1';
      ['fwi-fuel-picker', 'fwi-fuel-picker-mobile'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = fuelA;
      });
      ['fwi-fuel-picker-2', 'fwi-fuel-picker-mobile-2'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = fuelB;
      });
      localStorage.setItem('fwi-bc-fuel-type',   fuelA);
      localStorage.setItem('fwi-bc-fuel-type-2', fuelB);
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
    if (save) localStorage.setItem('bc-fwi-station', sel.value);
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
    // Auto-set fuel type from station lookup — AB only; BC respects user selection
    if (_province === 'AB') {
      const derivedFuel = STATION_FUEL_TYPES[name] || 'C2';
      ['fwi-fuel-picker', 'fwi-fuel-picker-mobile'].forEach(id => {
        const fp = document.getElementById(id);
        if (fp) fp.value = derivedFuel;
      });
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
      localStorage.setItem('bc-fwi-station', val);
      loadStation(false);
    }
  }
  _selectNearestStation = selectNearest; // expose for pin-drop map

  sel.addEventListener('change', () => loadStation(true));

  const saved = localStorage.getItem('bc-fwi-station');
  if (selectByValue(saved)) {
    // Returning user — load saved station immediately, no geo prompt
    loadStation(false);
  } else if (navigator.geolocation) {
    // First visit — show default station as placeholder, then auto-detect
    const defaultName = _province === 'BC' ? 'Kamloops' : 'Edmonton';
    const dflt = Array.from(sel.options).find(o => o.textContent === defaultName) || sel.options[0];
    if (dflt) sel.value = dflt.value;
    loadStation(false);
    navigator.geolocation.getCurrentPosition(
      pos => selectNearest(pos.coords.latitude, pos.coords.longitude),
      ()  => loadStation(true),  // denied — save current default
      { timeout: 8000, maximumAge: 300000 }
    );
  } else {
    const defaultName = _province === 'BC' ? 'Kamloops' : 'Edmonton';
    const dflt = Array.from(sel.options).find(o => o.textContent === defaultName) || sel.options[0];
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
/** Map (lat, lng) to BC Fire Centre name. */
function _stationFireCentre(lat, lng) {
  if (lat >= 57.0) return 'Northwest';                        // Far NW / Dease Lake corridor
  if (lat >= 54.0 && lng < -124.0) return 'Northwest';       // Smithers / Terrace / Prince Rupert
  if (lat >= 52.0 && lng < -127.0) return 'Northwest';       // Coastal north
  if (lat < 51.5 && lng > -118.5) return 'Southeast';        // Kootenays / Crowsnest
  if (lng < -122.5 && lat < 52.0) return 'Coastal';          // SW coast, Vancouver Island
  if (lng < -125.5) return 'Coastal';                        // Haida Gwaii, mid-coast
  if (lat >= 53.0) return 'Prince George';                   // North-central interior
  if (lat >= 51.5) return 'Cariboo';                         // Central plateau
  return 'Kamloops';                                         // Southern interior default
}
/** Province-aware sector/region label. */
function stationSector(lat, lng) {
  return _province === 'BC' ? _stationFireCentre(lat, lng) : _stationSector(lat);
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
    'BCWS':  'background:#0c304040;color:#7bd0ff;border:1px solid #1e5a7a',
    'CWFIS': 'background:#14532d40;color:#4ade80;border:1px solid #166534',
    'SWOB':  'background:#17255440;color:#93c5fd;border:1px solid #1e40af',
    'NWP':   'background:#451a0340;color:#fcd34d;border:1px solid #92400e',
    'Error': 'background:#1c191740;color:#78716c;border:1px solid #44403c',
  }[srcBadge] || 'background:#1c191740;color:#78716c;border:1px solid #44403c';
  const dangerColor = {
    'Low': '#2d9e58', 'Moderate': '#7bd0ff', 'High': '#f5c518',
    'Very Low': '#a7f3d0', 'Very High': '#f97316', 'Extreme': '#ef4444',
  }[r.danger] || '#7bd0ff';
  const hfiLabel = fbp ? _hfiClass(fbp.hfi) : '—';
  const hfiNum   = fbp?.hfi != null ? Math.round(fbp.hfi).toLocaleString() : '—';
  tr.innerHTML =
    `<td class="py-2 pl-3 pr-2 font-semibold text-xs"><a href="../station_detail/code.html" onclick="localStorage.setItem('fwi-station','${entry.lat},${entry.lng}')" class="text-[#7bd0ff] hover:underline">${entry.name}</a></td>` +
    `<td class="py-2 pr-2 text-slate-500 text-[10px]">${stationSector(entry.lat, entry.lng)}</td>` +
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
  if (el1) el1.textContent = extCnt > 0 ? `${extCnt} Extreme` : extCnt === 0 ? '0' : '—';
  if (el2 && avgRH != null) el2.textContent = `${avgRH.toFixed(0)}%`;
}

/** Sort station table by column key (asc/desc). */
function _sortStationTable(col, asc) {
  const tbody = document.getElementById('fwi-station-tbody');
  if (!tbody) return;
  const sectorOrder = ['Coastal', 'Kamloops', 'Cariboo', 'Prince George', 'Northwest', 'Southeast'];
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

const AB_REGIONS = [
  { name: 'Fort McMurray',  sector: 'Northeast Boreal',  lat: 56.650, lng: -111.217 },
  { name: 'Peace River',    sector: 'Northwest Sector',  lat: 56.233, lng: -117.283 },
  { name: 'Slave Lake',     sector: 'Lesser Slave Zone', lat: 55.283, lng: -114.767 },
  { name: 'Athabasca',      sector: 'Central-North',     lat: 54.717, lng: -113.283 },
  { name: 'Edmonton',       sector: 'Central Alberta',   lat: 53.534, lng: -113.490 },
  { name: 'Lethbridge',     sector: 'Southern Alberta',  lat: 49.700, lng: -112.833 },
];
const BC_REGIONS = [
  { name: 'Terrace',        sector: 'Northwest Fire Centre',      lat: 54.47, lng: -128.58 },
  { name: 'Prince George',  sector: 'Prince George Fire Centre',  lat: 53.88, lng: -122.68 },
  { name: 'Williams Lake',  sector: 'Cariboo Fire Centre',        lat: 52.18, lng: -122.05 },
  { name: 'Kamloops',       sector: 'Kamloops Fire Centre',       lat: 50.70, lng: -120.45 },
  { name: 'Cranbrook',      sector: 'Southeast Fire Centre',      lat: 49.60, lng: -115.78 },
  { name: 'Campbell River', sector: 'Coastal Fire Centre',        lat: 50.02, lng: -125.27 },
];
/** Province-aware regional representative stations for trend/summary displays. */
function getRegions() { return _province === 'BC' ? BC_REGIONS : AB_REGIONS; }

// Cache populated by buildRegionalSummary — used by exportRegionalDataset
let _regionalCache = [];
// Cache populated by buildStationMap — stores all 39 station FWI results
let _mapStationCache = [];
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
    const res = await fetch(
      'https://raw.githubusercontent.com/Tphambolio/FWI/main/data/cwfis_prev.json',
      { cache: 'no-cache' }
    );
    if (!res.ok) return;
    const data = await res.json();
    if (data?.stations) _cwfisPrev = data;
  } catch (_) { /* network error — fall through to STARTUP defaults */ }
}

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

async function buildRegionalSummary() {
  const list = document.getElementById('fwi-region-list');
  if (!list) return;

  const sectorOrder = _province === 'BC'
    ? ['Coastal', 'Kamloops', 'Cariboo', 'Prince George', 'Northwest', 'Southeast']
    : ['Far North', 'North', 'Central', 'Central-South', 'South'];
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
              <td class="py-2 pl-3 pr-2 font-semibold text-xs"><a href="../station_detail/code.html" onclick="localStorage.setItem('bc-fwi-station','${s.lat},${s.lng}')" class="text-[#7bd0ff] hover:underline">${s.name}</a></td>
              <td class="py-2 pr-2 text-slate-500 text-[10px]">${stationSector(s.lat, s.lng)}</td>
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

// BC NAEFS stations — codes discovered from CWFIS firewx_naefs WFS (province_state='BC')
const NAEFS_BC_STATIONS = [
  { code: 10183, name: 'Abbotsford',        lat: 49.03, lng: -122.37 },
  { code: 10184, name: 'Blue River',         lat: 52.13, lng: -119.28 },
  { code: 10185, name: 'Cape St. James',     lat: 51.93, lng: -131.02 },
  { code: 10186, name: 'Castlegar',          lat: 49.30, lng: -117.63 },
  { code: 10187, name: 'Clinton',            lat: 51.15, lng: -121.50 },
  { code: 10188, name: 'Comox',             lat: 49.72, lng: -124.90 },
  { code: 10189, name: 'Cranbrook',          lat: 49.60, lng: -115.78 },
  { code: 10190, name: 'Dease Lake',         lat: 58.42, lng: -130.02 },
  { code: 10191, name: 'Estevan Point',      lat: 49.38, lng: -126.55 },
  { code: 10192, name: 'Fort Nelson',        lat: 58.83, lng: -122.58 },
  { code: 10193, name: 'Fort St. John',      lat: 56.23, lng: -120.73 },
  { code: 10194, name: 'Hope',              lat: 49.37, lng: -121.48 },
  { code: 10195, name: 'Kamloops',           lat: 50.70, lng: -120.45 },
  { code: 10196, name: 'Kelowna',            lat: 49.97, lng: -119.38 },
  { code: 10197, name: 'Lytton',             lat: 50.23, lng: -121.58 },
  { code: 10198, name: 'Nanaimo',            lat: 49.05, lng: -123.87 },
  { code: 10199, name: 'Penticton',          lat: 49.47, lng: -119.60 },
  { code: 10200, name: 'Port Alberni',       lat: 49.25, lng: -124.83 },
  { code: 10201, name: 'Port Hardy',         lat: 50.68, lng: -127.37 },
  { code: 10202, name: 'Prince George',      lat: 53.88, lng: -122.68 },
  { code: 10203, name: 'Prince Rupert',      lat: 54.30, lng: -130.43 },
  { code: 10204, name: 'Puntzi Mountain',    lat: 52.12, lng: -124.13 },
  { code: 10205, name: 'Quesnel',            lat: 53.03, lng: -122.52 },
  { code: 10206, name: 'Revelstoke',         lat: 50.97, lng: -118.18 },
  { code: 10207, name: 'Sandspit',           lat: 53.25, lng: -131.82 },
  { code: 10208, name: 'Smithers',           lat: 54.82, lng: -127.18 },
  { code: 10209, name: 'Terrace',            lat: 54.47, lng: -128.58 },
  { code: 10210, name: 'Tofino',             lat: 49.08, lng: -125.77 },
  { code: 10211, name: 'Vancouver Intl',     lat: 49.18, lng: -123.17 },
  { code: 10212, name: 'Victoria Intl',      lat: 48.65, lng: -123.43 },
  { code: 10213, name: 'Williams Lake',      lat: 52.18, lng: -122.05 },
  { code: 10266, name: 'Callaghan Valley',   lat: 50.13, lng: -123.10 },
  { code: 10267, name: 'West Vancouver',     lat: 49.33, lng: -123.18 },
  { code: 10268, name: 'Whistler',           lat: 50.13, lng: -122.95 },
  { code: 10269, name: 'Whistler Mountain',  lat: 50.07, lng: -122.93 },
];

/** Return nearest NAEFS station within 150 km, or null. */
function findNearestNAEFS(lat, lng) {
  const list = _province === 'BC' ? NAEFS_BC_STATIONS : NAEFS_AB_STATIONS;
  let best = null, bestDist = Infinity;
  for (const st of list) {
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
    `&timezone=auto&forecast_days=7`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo forecast ${res.status}`);
  const d = await res.json();
  const h = d.hourly;
  const days = [];
  // Pick hour index 12 (noon) for FWI chain (CFFDRS standard) and hour 16 for peak burn FBP
  for (let day = 0; day < 7; day++) {
    const i12 = day * 24 + 12;
    const i16 = day * 24 + 16;
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
        temp: h.temperature_2m[i16]        ?? h.temperature_2m[i12]        ?? 15,
        rh:   h.relative_humidity_2m[i16]  ?? h.relative_humidity_2m[i12]  ?? 40,
        wind: h.wind_speed_10m[i16]        ?? h.wind_speed_10m[i12]        ?? 10,
        wdir: h.wind_direction_10m?.[i16]  ?? h.wind_direction_10m?.[i12]  ?? null,
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

/** Read persisted fuel type (set by station_detail fuel picker), default C3/C7 (BC defaults). */
function _savedFuelCode() {
  return (typeof localStorage !== 'undefined' && localStorage.getItem('fwi-bc-fuel-type'))  || 'C3';
}
function _savedFuelCode2() {
  return (typeof localStorage !== 'undefined' && localStorage.getItem('fwi-bc-fuel-type-2')) || 'C7';
}
function _savedCuring() {
  return parseInt((typeof localStorage !== 'undefined' && localStorage.getItem('bc-fwi-grass-curing')) || '80', 10);
}
function _savedPS() {
  return parseInt((typeof localStorage !== 'undefined' && localStorage.getItem('bc-fwi-ps-percent')) || '50', 10);
}

/**
 * Return "YYYY-MM-DD" in Pacific Daylight Time (UTC-7).
 * BC fire weather standard — all Today/Tomorrow labels use PDT.
 * @param {number} [ts] - Unix ms timestamp; defaults to Date.now()
 */
function _pdtDateStr(ts) {
  const d = new Date((ts ?? Date.now()) - 7 * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Index of the next operationally relevant peak burn day in a `days` array.
 * Returns today's index if 16:00 PDT has not yet passed; tomorrow's otherwise.
 * Falls back to index 0.
 *
 * All date comparisons use PDT (UTC-7) to match BC fire weather convention.
 * This avoids MDT vs PDT confusion and handles UTC-date rollovers correctly.
 */
function _nextPeakDayIdx(days) {
  // PDT hour: (UTC hour - 7 + 24) mod 24
  const pdtHour = ((new Date().getUTCHours() - 7) + 24) % 24;
  const peakPassed = pdtHour >= 16; // BC peak burn at 16:00 PDT
  const todayPDT = _pdtDateStr();
  const idx = days.findIndex(d => {
    if (!d._ts) return false;
    const dayPDT = _pdtDateStr(d._ts);
    return peakPassed ? dayPDT > todayPDT : dayPDT >= todayPDT;
  });
  return idx >= 0 ? idx : 0;
}

/** Chain Van Wagner + FBP per day. FBP uses each day's peak (16:00) conditions.
 *  Returns results array where each element has { ...fwiResult, fbp, peakWeather }. */
function calcMultiDayFBP(days, startupDC = 300, startState = null, fuelCode = 'C2', curing = 100, ps = 50) {
  const results = calcMultiDay(days, startupDC, startState);
  return results.map((r, i) => {
    const pw = days[i]?.peak || days[i]; // peak = 16:00; fallback to noon
    const fbp = calculateFBP(fuelCode, r.ffmc, r.dmc, r.dc, pw.wind ?? r.weather?.wind ?? 10, 0, curing, ps);
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
      const c = DANGER_COLORS[peakDay.danger] || DANGER_COLORS['Moderate'];
      elPWR.textContent = peakDay.danger;
      elPWR.className   = `text-[10px] font-bold uppercase px-2 py-1 rounded-full ${c.badge}`;
    }

    // Days at elevated risk (FWI ≥ 21 = High on BC scale)
    const daysAtRisk = results.filter(r => r.fwi >= 21).length;
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

    // D+1 Peak Burn section — next operationally relevant peak burn day
    // (today if before 16:00 PDT / 23:00 UTC, tomorrow if after)
    const d1SafeIdx = _nextPeakDayIdx(days);
    const d1HeadEl = document.getElementById('fwi-d1-heading');
    if (d1HeadEl) {
      const _ft_todayPDT = _pdtDateStr();
      const _ft_dayPDT   = days[d1SafeIdx]?._ts ? _pdtDateStr(days[d1SafeIdx]._ts) : null;
      const _ft_lbl      = _ft_dayPDT && _ft_dayPDT > _ft_todayPDT ? 'Tomorrow' : 'Today';
      d1HeadEl.textContent = _ft_lbl + ' — Peak Burn Prediction';
    }
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
  <td class="py-3 text-sm text-on-surface-variant">${fmt(pw?.wind ?? days[i]?.wind, 0)} km/h${pw?.wdir != null ? ' ' + compassDir(pw.wdir) : ''}</td>
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
      const tableStations = getRegions();
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
  <td class="py-5 text-sm text-on-surface-variant">${fmt(r.weather.wind, 0)} km/h${r.weather.wdir != null ? ' ' + compassDir(r.weather.wdir) : ''}</td>
  <td class="py-5">
    <span class="px-3 py-1 rounded-full text-[10px] font-bold" style="${r.danger === 'Extreme' ? 'background:#ef444420;color:#ef4444' : r.danger === 'Very High' ? 'background:#f9731620;color:#f97316' : r.danger === 'High' ? 'background:#f5c51820;color:#f5c518' : r.danger === 'Moderate' ? 'background:#7bd0ff20;color:#7bd0ff' : 'background:#4ae17620;color:#4ae176'}">${r.danger.toUpperCase()}</span>
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
  _triggerCSVDownload(rows, `fwi-bc-${new Date().toISOString().slice(0,10)}.csv`);
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
function printProvincialBriefing(mode = 'provincial') {
  // Determine data source
  const useMap = _mapStationCache.length > 0;
  const useRegional = !useMap && _regionalCache.length > 0;
  if (!useMap && !useRegional) { alert('Data still loading — try again in a moment.'); return; }

  const now   = new Date();
  const today = now.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const prepared = now.toLocaleString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });

  // Print-safe danger colours (BC 5-class — Very Low replaces Very High)
  const PRINT_COLORS = {
    'Very Low':  { bg: '#d0f4e4', text: '#0a4a2a' },
    'Low':       { bg: '#d4edda', text: '#155724' },
    'Moderate':  { bg: '#cce5ff', text: '#004085' },
    'High':      { bg: '#fff3cd', text: '#856404' },
    'Very High': { bg: '#ffe5cc', text: '#7d3200' },
    'Extreme':   { bg: '#f8d7da', text: '#721c24' },
  };
  const SVG_COLORS = {
    'Very Low':  '#a7f3d0',
    'Low':       '#2d9e5f',
    'Moderate':  '#2980b9',
    'High':      '#f5c518',
    'Very High': '#e67e22',
    'Extreme':   '#c0392b',
  };

  // Build station rows — sort by FWI descending within each sector grouping
  let rows;
  if (useMap) {
    // Assign sector from station list lookup
    const sectorMap = {};
    getStationList().forEach(s => { sectorMap[s.name] = stationSector(s.lat, s.lng); });
    const sectorOrder = _province === 'BC'
      ? ['Coastal', 'Kamloops', 'Cariboo', 'Prince George', 'Northwest', 'Southeast']
      : ['Far North', 'North', 'Central', 'Central-South', 'South'];
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

  // Tally danger counts (BC 5-class: Very Low / Low / Moderate / High / Extreme)
  const tally = { 'Very Low': 0, Low: 0, Moderate: 0, High: 0, Extreme: 0 };
  rows.forEach(r => { if (tally[r.danger] !== undefined) tally[r.danger]++; });

  // ── Selected station (for regional mode) ─────────────────────────────────
  const selLat = _stationLat;
  const selLng = _stationLng;
  const selName = _stationName;

  const briefingTitle = mode === 'regional'
    ? `Pyra · Fire Weather — Regional Briefing · ${selName} Area`
    : 'Pyra · BC Wildfire FWI — Provincial Briefing';

  const mapInitScript = mode === 'regional'
    ? `map.setView([${selLat}, ${selLng}], 8);`
    : `map.fitBounds([[48.0, -140.0], [60.0, -114.0]]);`;

  // ── All station data serialised for dynamic table + Leaflet markers ───────
  const allStationData = JSON.stringify(rows.map(r => ({
    name: r.name, lat: r.lat, lng: r.lng,
    temp: r.temp, rh: r.rh, wind: r.wind,
    fwi: r.fwi != null ? +r.fwi.toFixed(1) : null,
    danger: r.danger,
    hfiClass: r.hfiClass || '—',
  })));



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
    ${today} · 0600–1800 PDT<br>
    Prepared: ${prepared} · CWFIS / MSC SWOB / Open-Meteo NWP
  </div>
</div>

<!-- Leaflet OSM map -->
<div id="print-map" style="width:700px;height:295px;border:1px solid #ccc;margin-bottom:4px"></div>
<script>
setTimeout(function() {
(function() {
  const FWI_COLORS = { 'Very Low':'#a7f3d0', Low:'#2d9e5f', Moderate:'#2980b9', High:'#f5c518', Extreme:'#c0392b' };
  const HFI_COLORS = { '1-Low':'#27ae60','2-Mod':'#2574a9','3-High':'#c9a800','4-VH':'#d4660a','5-Ext':'#c62828','6-Cat':'#7b0000','—':'#9e9e9e' };
  const PRINT_COLORS = { 'Very Low':{bg:'#d0f4e4',text:'#0a4a2a'}, Low:{bg:'#d4edda',text:'#155724'}, Moderate:{bg:'#cce5ff',text:'#004085'}, High:{bg:'#fff3cd',text:'#856404'}, Extreme:{bg:'#f8d7da',text:'#721c24'} };
  const allStations = ${allStationData};

  const map = L.map('print-map', { zoomControl: true });
  ${mapInitScript}
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19
  }).addTo(map);

  // Draw all station markers (always visible regardless of zoom)
  allStations.forEach(s => {
    const fc = FWI_COLORS[s.danger] || '#2980b9';
    const hc = HFI_COLORS[s.hfiClass] || '#9e9e9e';
    const r = s.danger === 'Extreme' ? 20 : 17;
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
        + '<text x="' + (r*1.48) + '" y="' + (r*0.72) + '" font-size="' + (r*0.48) + '" font-weight="700" fill="rgba(0,0,0,0.5)" text-anchor="middle">HFI</text>'
        + '<text x="' + (r*1.48) + '" y="' + (r*1.38) + '" font-size="' + (r*0.68) + '" font-weight="800" fill="rgba(0,0,0,0.85)" text-anchor="middle">' + hn + '</text>'
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
      + '<span style="padding:0 4px;background:' + hc + ';color:rgba(0,0,0,0.78)">' + hn + '</span>'
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
    const tally = {'Very Low':0, Low:0, Moderate:0, High:0, Extreme:0};
    visible.forEach(s => { if (tally[s.danger] !== undefined) tally[s.danger]++; });
    const parts = ['Extreme','High','Moderate','Low','Very Low'].filter(d => tally[d] > 0).map(d => tally[d] + ' ' + d).join(' · ');
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
      <tr style="background:#fff"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#a7f3d0;margin-right:3px;vertical-align:middle"></span><b>Very Low</b></td><td style="padding:2px 4px;text-align:center">0–4</td><td style="padding:2px 5px;color:#555">Fuels wet; spread very unlikely</td></tr>
      <tr style="background:#f7f8f9"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#2d9e5f;margin-right:3px;vertical-align:middle"></span><b>Low</b></td><td style="padding:2px 4px;text-align:center">5–11</td><td style="padding:2px 5px;color:#555">Isolated fires; initial attack effective</td></tr>
      <tr style="background:#fff"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#2980b9;margin-right:3px;vertical-align:middle"></span><b>Moderate</b></td><td style="padding:2px 4px;text-align:center">12–20</td><td style="padding:2px 5px;color:#555">Fires start easily; control feasible</td></tr>
      <tr style="background:#f7f8f9"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f5c518;margin-right:3px;vertical-align:middle"></span><b>High</b></td><td style="padding:2px 4px;text-align:center">21–33</td><td style="padding:2px 5px;color:#555">Rapid spread; spotting; control difficult</td></tr>
      <tr style="background:#fff"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#c0392b;margin-right:3px;vertical-align:middle"></span><b>Extreme</b></td><td style="padding:2px 4px;text-align:center">≥ 34</td><td style="padding:2px 5px;color:#555">Crown fire conditions; evacuate structure zone</td></tr>
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
      <tr style="background:#fff"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#27ae60;margin-right:3px;vertical-align:middle"></span><b>1-Low</b></td><td style="padding:2px 4px;text-align:center">&lt; 10</td><td style="padding:2px 4px;text-align:center">&lt; 0.2 m</td><td style="padding:2px 5px;color:#555">Hand tools</td></tr>
      <tr style="background:#f7f8f9"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#2574a9;margin-right:3px;vertical-align:middle"></span><b>2-Mod</b></td><td style="padding:2px 4px;text-align:center">10–500</td><td style="padding:2px 4px;text-align:center">0.2–1.5 m</td><td style="padding:2px 5px;color:#555">Hand tools / ground tanker</td></tr>
      <tr style="background:#fff"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#c9a800;margin-right:3px;vertical-align:middle"></span><b>3-High</b></td><td style="padding:2px 4px;text-align:center">500–2,000</td><td style="padding:2px 4px;text-align:center">1.5–2.5 m</td><td style="padding:2px 5px;color:#555">Pump/hose or air support</td></tr>
      <tr style="background:#f7f8f9"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#d4660a;margin-right:3px;vertical-align:middle"></span><b>4-VH</b></td><td style="padding:2px 4px;text-align:center">2,000–4,000</td><td style="padding:2px 4px;text-align:center">2.5–3.5 m</td><td style="padding:2px 5px;color:#555">Indirect — air on head still effective</td></tr>
      <tr style="background:#fff"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#c62828;margin-right:3px;vertical-align:middle"></span><b>5-Ext</b></td><td style="padding:2px 4px;text-align:center">4,000–10,000</td><td style="padding:2px 4px;text-align:center">3.5–5.5 m</td><td style="padding:2px 5px;color:#555">Indirect — suppress flanks; coordinate air</td></tr>
      <tr style="background:#f7f8f9"><td style="padding:2px 5px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#7b0000;margin-right:3px;vertical-align:middle"></span><b>6-Cat</b></td><td style="padding:2px 4px;text-align:center">&gt; 10,000</td><td style="padding:2px 4px;text-align:center">&gt; 5.5 m</td><td style="padding:2px 5px;color:#555">Air attack fails on head — evacuate</td></tr>
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
      const naefsSt = findNearestNAEFS(_stationLat, _stationLng);
      let days;
      if (naefsSt) {
        try { days = await fetchForecastNAEFS(naefsSt.code); }
        catch (e) { days = await fetchForecast(_stationLat, _stationLng); }
      } else {
        days = await fetchForecast(_stationLat, _stationLng);
      }
      const chainStart = _lastFWI ? { ffmc: _lastFWI.ffmc, dmc: _lastFWI.dmc, dc: _lastFWI.dc } : null;
      const printFuelCode = (typeof document !== 'undefined' && document.getElementById('fwi-fuel-picker')?.value) || 'C3';
      const printCuring = _savedCuring ? _savedCuring() : 100;
      const printPS = _savedPS ? _savedPS() : 50;
      const results = calcMultiDayFBP(days, getStartupDC(_stationName), chainStart, printFuelCode, printCuring, printPS);
      _forecastCache = { days, results, fuelCode: printFuelCode, curing: printCuring, ps: printPS };
    } catch (e) {
      console.warn('[FWI] printStationBriefing: forecast fetch failed', e);
    }
  }

  const r = _lastFWI;
  const w = _lastWeather || r.weather;
  const now   = new Date();
  const today = now.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const prepared = now.toLocaleString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });

  const stationDisplayName = _stationName || 'BC Station';
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
    'Very Low':  { bg: '#d0f4e4', text: '#0a4a2a' },
    'Low':       { bg: '#d4edda', text: '#155724' },
    'Moderate':  { bg: '#cce5ff', text: '#004085' },
    'High':      { bg: '#fff3cd', text: '#856404' },
    'Extreme':   { bg: '#f8d7da', text: '#721c24' },
  };
  const dc = PRINT_BG[r.danger] || PRINT_BG['Moderate'];

  // BC danger class helper — inline badge HTML (BC 5-class scale)
  const classBadge = (fwi) => {
    const label = dangerRatingBC(fwi);
    const cl = PRINT_BG[label] || PRINT_BG['Moderate'];
    const num = ['Very Low','Low','Moderate','High','Extreme'].indexOf(label) + 1;
    const short = label === 'Moderate' ? 'Mod' : label;
    return `<span style="display:inline-block;min-width:22px;padding:1px 6px;border-radius:3px;background:${cl.bg};color:${cl.text};font-size:9pt;font-weight:900;text-align:center">${num}</span> ${short}`;
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
    const _todayPDT_p    = _pdtDateStr();
    const _tomorrowPDT_p = _pdtDateStr(Date.now() + 86400000);
    forecastRows = fResults.map((fr, i) => {
      const fd  = fDays[i] || {};
      const fpw = fd.peak || fd; // peak (16:00) conditions for FBP
      const fdc = PRINT_BG[fr.danger] || PRINT_BG['Moderate'];
      const ffbp = fr.fbp;
      const hfiTxt = ffbp ? Math.round(ffbp.hfi).toLocaleString() : '—';
      const hfiClassTxt = !ffbp ? '—' : (() => { const cl = hfiClassInfo(ffbp.hfi); return `<span style="display:inline-block;min-width:20px;padding:1px 6px;border-radius:3px;background:${cl.bg};color:${cl.text};font-weight:900;font-size:9pt;text-align:center">${cl.num}</span>`; })();
      const dayPDT = fd._ts ? _pdtDateStr(fd._ts) : null;
      if (dayPDT && dayPDT < _todayPDT_p) return ''; // skip past days
      const isD1 = dayPDT === _tomorrowPDT_p;
      const rowBg = isD1 ? '#f0f4ff' : i % 2 === 0 ? '#fff' : '#f9f9f9';
      return `<tr style="background:${rowBg}">
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

  // D+1 peak burn block — find first day strictly after today in PDT
  const _pTodayPDT = _pdtDateStr();
  const _pd1Idx    = fDays.findIndex(d => d._ts && _pdtDateStr(d._ts) > _pTodayPDT);
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
  <div class="section-title" style="background:#1a3a5c">Next Operational Period · ${tomorrowDate} · Predicted Peak Burn (~16:00 PDT) &nbsp;·&nbsp; ${fuelCode} — ${fuelName}</div>
  <div class="section-body">
    <div class="grid-2">
      <p class="kv"><span class="label">Weather (~16:00 PDT)</span><br><span class="val">${(+d1pw.temp||0).toFixed(1)}°C / ${Math.round(d1pw.rh||0)}% RH / ${Math.round(d1pw.wind||0)} km/h</span></p>
      <p class="kv"><span class="label">FWI</span><br><span class="val" style="color:${d1HfiColor}">${Math.round(d1r.fwi)} — ${d1r.danger}</span></p>
      <p class="kv"><span class="label">Head ROS</span><br><span class="val">${d1fbp ? d1fbp.ros.toFixed(1) + ' m/min' : '—'}</span></p>
      <p class="kv"><span class="label">Head Fire Intensity</span><br><span class="val" style="color:${d1HfiColor}">${d1fbp ? Math.round(d1fbp.hfi).toLocaleString('en-CA') + ' kW/m' : '—'}</span></p>
      <p class="kv"><span class="label">Flame Length</span><br><span class="val">${d1fbp ? d1fbp.flameLength.toFixed(1) + ' m' : '—'}</span></p>
      <p class="kv"><span class="label">Fire Type / CFB</span><br><span class="val">${d1fbp ? d1fbp.fireType + ' / ' + (d1fbp.cfb*100).toFixed(0) + '%' : '—'}</span></p>
    </div>
    ${d1fbp ? `<div style="margin-top:6px;padding:5px 8px;border-left:4px solid #1a3a5c;background:#f0f4ff"><span style="font-size:8pt;color:#555;text-transform:uppercase;letter-spacing:0.04em">FBP System HFI Class &nbsp;</span>${hfiBadge(d1fbp.hfi)}</div>` : ''}
    ${d1EscapeNote}
    <p style="font-size:7.5pt;color:#888;margin-top:4px">FWI chain: hour 12 (noon LST) · FBP peak: hour 16 (16:00 PDT) · ${fSrcLabel} · Forecast valid: ${tomorrowDate} · Prepared: ${prepared}</p>
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
    Operational Period: ${today} 0600–1800 PDT<br>
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
    ${fbp ? `<div style="margin-top:6px;padding:5px 8px;border-left:4px solid ${hfiClassInfo(fbp.hfi).bg === '#d4edda' ? '#28a745' : hfiClassInfo(fbp.hfi).bg === '#cce5ff' ? '#0066cc' : hfiClassInfo(fbp.hfi).bg === '#fff3cd' ? '#856404' : hfiClassInfo(fbp.hfi).bg === '#ffe5cc' ? '#d35400' : '#c0392b'};background:#fafafa"><span style="font-size:8pt;color:#555;text-transform:uppercase;letter-spacing:0.04em">FBP System HFI Class &nbsp;</span>${hfiBadge(fbp.hfi)}</div>` : ''}
    ${escapedNote}
    <p style="font-size:7.5pt;color:#888;margin-top:4px">Observed: 12:00 noon LST (CFFDRS standard) · ${srcLabel} · Prepared: ${prepared}</p>
  </div>
</div>

${d1Section}

<div class="section">
  <div class="section-title">Forecast Outlook — Fire Behaviour by Day · ${fuelCode} — ${fuelName} · Peak ~16:00 PDT</div>
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
  'High':      '#f5c518',
  'Very High': '#ff8c42',
  'Extreme':   '#ff4d4d',
};

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

  // HFI class → right-half pill color (muted palette — always visually distinct from vivid FWI left half)
  const HFI_CLASS_COLORS = {
    '1-Low':'#a8f0c0','2-Mod':'#b8e2f9','3-High':'#ffe082',
    '4-VH':'#ffb74d','5-Ext':'#ff7043','6-Cat':'#b71c1c','—':'#d1d5db',
  };

  // Zoom-responsive pill sizes: sm=provincial, md=regional, lg=municipal
  const PILL_SIZES = {
    sm: { w:46, h:30, r:15, lbl:5,  fv:10, hn:9,  hw:0  },
    md: { w:60, h:40, r:20, lbl:6,  fv:13, hn:11, hw:5.5},
    lg: { w:72, h:48, r:24, lbl:7,  fv:15, hn:13, hw:7  },
  };
  function _zoomScale(zoom) { return zoom <= 5 ? 'sm' : zoom <= 7 ? 'md' : 'lg'; }

  // Bicolor pill: left half = FWI danger color, right half = HFI class color
  function _makeIcon(fwiColor, hfiColor, fwiVal, hfiCls, scale, srcType) {
    const [hfiNum, hfiWord] = (hfiCls || '—').split('-');
    const sz = PILL_SIZES[scale] || PILL_SIZES.md;
    const half = Math.floor(sz.w / 2);
    const br = (srcType === 'CWFIS' || srcType === 'BCWS') ? 3 : srcType === 'SWOB' ? 8 : sz.r;
    return L.divIcon({
      className: '',
      html: `<div style="width:${sz.w}px;height:${sz.h}px;border-radius:${br}px;overflow:hidden;display:flex;` +
            `box-shadow:0 2px 8px rgba(0,0,0,0.4),0 0 0 1.5px rgba(0,0,0,0.12);` +
            `font-family:'Space Grotesk',sans-serif;cursor:pointer">` +
            `<div style="width:${half}px;height:100%;background:${fwiColor};display:flex;flex-direction:column;` +
            `align-items:center;justify-content:center;gap:1px">` +
            `<span style="font-size:${sz.lbl}px;font-weight:700;color:rgba(0,0,0,0.5);text-transform:uppercase;letter-spacing:.04em;line-height:1">FWI</span>` +
            `<span style="font-size:${sz.fv}px;font-weight:800;color:rgba(0,0,0,0.8);letter-spacing:-.03em;line-height:1">${fwiVal}</span>` +
            `</div>` +
            `<div style="width:1px;background:rgba(0,0,0,0.15);flex-shrink:0"></div>` +
            `<div style="width:${sz.w - half - 1}px;height:100%;background:${hfiColor};display:flex;flex-direction:column;` +
            `align-items:center;justify-content:center;gap:1px">` +
            `<span style="font-size:${sz.lbl}px;font-weight:700;color:rgba(0,0,0,0.5);text-transform:uppercase;letter-spacing:.04em;line-height:1">HFI</span>` +
            `<span style="font-size:${sz.hn}px;font-weight:800;color:rgba(0,0,0,0.8);line-height:1">${hfiNum || '—'}</span>` +
            (sz.hw ? `<span style="font-size:${sz.hw}px;font-weight:600;color:rgba(0,0,0,0.6);line-height:1">${hfiWord || ''}</span>` : '') +
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
    center: mapOpts.center || (_province === 'BC' ? [52.5, -122.5] : [54.5, -114.5]),
    zoom:   mapOpts.zoom   || 5,
    zoomControl: true, attributionControl: true,
  });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19,
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

  // Fetch data and update each marker as it arrives
  for (const s of getStationList()) {
    try {
      const w = await fetchWeatherPrimary(s.lat, s.lng);

      // Carry-over: use cached CWFIS prev-day values when Van Wagner is needed (SWOB/NWP tier)
      let prevFWI = { ffmc: STARTUP.ffmc, dmc: STARTUP.dmc, dc: getStartupDC(s.name) };
      let usedCachedPrev = false;
      if (!w.fwiFromCWFIS) {
        const p = _cwfisPrev?.stations?.[s.name];
        if (p?.ffmc != null && p?.dmc != null && p?.dc != null) {
          prevFWI = { ffmc: p.ffmc, dmc: p.dmc, dc: p.dc };
          usedCachedPrev = true;
        }
      }
      const r        = calculateFWI(w, prevFWI);
      const fuelCode = STATION_FUEL_TYPES[s.name] || 'C3';
      const fbp      = calculateFBP(fuelCode, r.ffmc, r.dmc, r.dc, w.wind ?? 10, 0, _savedCuring());
      const srcBadge = w.fwiFromCWFIS ? 'CWFIS'
                     : (w.source?.startsWith('BCWS') ? 'BCWS'
                     : (w.source?.startsWith('MSC') ? 'SWOB' : 'NWP'));

      // Use actual station coords from data response if available; otherwise keep nominal
      const stnLat = w.stationLat ?? s.lat;
      const stnLng = w.stationLng ?? s.lng;

      _mapStationCache.push({ name: s.name, lat: stnLat, lng: stnLng, result: r, fbp, srcBadge });
      _updateStationTableRow({ name: s.name, lat: stnLat, lng: stnLng, result: r, fbp, srcBadge });

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
      const fwiColor = MARKER_COLORS[r.danger] || '#7bd0ff';
      const hfiCls   = fbp ? _hfiClass(fbp.hfi) : '—';
      const hfiColor = HFI_CLASS_COLORS[hfiCls] || '#d1d5db';
      markers[s.name].setIcon(_makeIcon(fwiColor, hfiColor, r.fwi.toFixed(1), hfiCls, scale, srcBadge));

      // Popup — full station detail card
      const hfiNumStr  = fbp?.hfi != null ? Math.round(fbp.hfi).toLocaleString() + ' kW/m' : '—';
      const fwiMethod  = w.fwiFromCWFIS ? 'CWFIS carry-over' : 'Van Wagner calc';
      const coordStr   = `${Math.abs(stnLat).toFixed(4)}°${stnLat>=0?'N':'S'} ${Math.abs(stnLng).toFixed(4)}°${stnLng>=0?'E':'W'}`;
      const distNote   = w.distKm != null ? ` · ${w.distKm} km offset` : '';
      // Observation/report timestamp — use CWFIS repDate, SWOB obsTime, or current time for NWP
      const rawTs = w.repDate || w.obsTime || null;
      const obsTs = rawTs
        ? new Date(rawTs).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Vancouver' }) + ' PDT'
        : new Date().toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Vancouver' }) + ' PDT (calc)';
      const sourceStnLine = w.stationName
        ? `<div style="font-size:9px;color:#64748b;margin-bottom:1px">Data source: <strong>${w.stationName}</strong></div>`
        : '';
      markers[s.name].setPopupContent(
        `<div style="font-family:'Space Grotesk',sans-serif;min-width:220px">` +
        `<div style="font-size:13px;font-weight:700;color:#1e3a8a;margin-bottom:1px">${s.name}</div>` +
        sourceStnLine +
        `<div style="font-size:9px;color:#94a3b8;font-family:monospace;margin-bottom:1px">${coordStr}</div>` +
        `<div style="font-size:8px;color:#94a3b8;margin-bottom:2px;text-transform:uppercase;letter-spacing:.06em">${srcBadge}${distNote} · ${fuelCode} fuel · ${fwiMethod}</div>` +
        `<div style="font-size:8px;color:#64748b;margin-bottom:${usedCachedPrev ? '2' : '6'}px">Obs: <strong>${obsTs}</strong></div>` +
        (usedCachedPrev ? (() => {
          const cp = _cwfisPrev.stations[s.name];
          const cdStr = cp.repDate
            ? new Date(cp.repDate).toLocaleString('en-CA', { month: 'short', day: 'numeric', timeZone: 'America/Edmonton' })
            : 'prev day';
          return `<div style="font-size:8px;color:#6b7280;margin-bottom:6px">` +
                 `Carry-over: <strong>${cp.stationName || 'CWFIS'}</strong> · ${cdStr}</div>`;
        })() : '') +
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;font-size:11px;margin-bottom:6px">` +
        `<div><span style="color:#94a3b8">FWI</span><br><strong style="color:${fwiColor};font-size:17px">${r.fwi.toFixed(1)}</strong></div>` +
        `<div><span style="color:#94a3b8">Danger</span><br><strong style="color:${fwiColor}">${r.danger}</strong></div>` +
        `<div><span style="color:#94a3b8">HFI</span><br><span style="color:#1e293b">${hfiNumStr}</span></div>` +
        `<div><span style="color:#94a3b8">HFI Class</span><br><strong style="color:#1e293b">${hfiCls}</strong></div>` +
        `</div>` +
        `<div style="border-top:1px solid #e2e8f0;padding-top:5px;display:grid;grid-template-columns:1fr 1fr;gap:3px 14px;font-size:10px">` +
        `<div><span style="color:#94a3b8">Temp</span> <span style="color:#1e293b">${fmt(w.temp)}°C</span></div>` +
        `<div><span style="color:#94a3b8">RH</span> <span style="color:#1e293b">${fmt(w.rh,0)}%</span></div>` +
        `<div><span style="color:#94a3b8">Wind</span> <span style="color:#1e293b">${fmt(w.wind,0)} km/h</span></div>` +
        `<div><span style="color:#94a3b8">Rain</span> <span style="color:#1e293b">${fmt(w.rain)} mm</span></div>` +
        `<div><span style="color:#94a3b8">FFMC</span> <span style="color:#1e293b">${r.ffmc?.toFixed(1) ?? '—'}</span></div>` +
        `<div><span style="color:#94a3b8">DMC</span> <span style="color:#1e293b">${r.dmc?.toFixed(1) ?? '—'}</span></div>` +
        `<div><span style="color:#94a3b8">DC</span> <span style="color:#1e293b">${r.dc?.toFixed(0) ?? '—'}</span></div>` +
        `<div><span style="color:#94a3b8">BUI</span> <span style="color:#1e293b">${r.bui?.toFixed(1) ?? '—'}</span></div>` +
        `</div></div>`
      );
    } catch (e) {
      console.warn(`[FWI Map] ${s.name}:`, e);
    }
  }

  // Final sweep — ensure all markers reflect current zoom after async loading completes
  {
    const finalScale = _zoomScale(map.getZoom());
    for (const entry of _mapStationCache) {
      if (!entry.result) continue;
      const fwiColor = MARKER_COLORS[entry.result.danger] || '#7bd0ff';
      const hfiCls   = entry.fbp ? _hfiClass(entry.fbp.hfi) : '—';
      const hfiColor = HFI_CLASS_COLORS[hfiCls] || '#d1d5db';
      markers[entry.name]?.setIcon(_makeIcon(fwiColor, hfiColor, entry.result.fwi.toFixed(1), hfiCls, finalScale, entry.srcBadge));
    }
  }

  // Rescale all loaded markers on zoom change
  map.on('zoomend', () => {
    const scale = _zoomScale(map.getZoom());
    for (const entry of _mapStationCache) {
      if (!entry.result) continue;
      const fwiColor = MARKER_COLORS[entry.result.danger] || '#7bd0ff';
      const hfiCls   = entry.fbp ? _hfiClass(entry.fbp.hfi) : '—';
      const hfiColor = HFI_CLASS_COLORS[hfiCls] || '#d1d5db';
      markers[entry.name]?.setIcon(_makeIcon(fwiColor, hfiColor, entry.result.fwi.toFixed(1), hfiCls, scale, entry.srcBadge));
    }
  });

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
    const danger = dangerRatingProv(r.fwi);
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

  let days, results, resultsB;
  try {
    const fuelCode  = _savedFuelCode();
    const fuelCodeB = _savedFuelCode2();
    const curing    = _savedCuring();
    const ps        = _savedPS();
    const cacheHit  = _forecastCache.results?.length &&
                      _forecastCache.lat       === _stationLat &&
                      _forecastCache.lng       === _stationLng &&
                      _forecastCache.fuelCode  === fuelCode  &&
                      _forecastCache.fuelCodeB === fuelCodeB &&
                      _forecastCache.curing    === curing    &&
                      _forecastCache.ps        === ps;
    if (cacheHit) {
      ({ days, results, resultsB } = _forecastCache);
    } else {
      const cachedDaysAreForThisStation = _forecastCache.days?.length &&
                                          _forecastCache.lat === _stationLat &&
                                          _forecastCache.lng === _stationLng;
      if (!cachedDaysAreForThisStation) {
        const naefsSt = findNearestNAEFS(_stationLat, _stationLng);
        if (naefsSt) {
          try { days = await fetchForecastNAEFS(naefsSt.code); }
          catch(e) {
            console.warn('[D+1] NAEFS failed, trying Open-Meteo:', e);
            days = await fetchForecast(_stationLat, _stationLng);
          }
        } else {
          days = await fetchForecast(_stationLat, _stationLng);
        }
      } else {
        days = _forecastCache.days; // reuse weather for same station; only recalc FBP
      }
      if (!days?.length) throw new Error('[D+1] Forecast fetch returned no days');
      const chainStart = _lastFWI ? { ffmc: _lastFWI.ffmc, dmc: _lastFWI.dmc, dc: _lastFWI.dc } : null;
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

  // Find today and tomorrow indices using PDT dates
  const _nowPDT     = _pdtDateStr();
  const todayIdx    = days.findIndex(d => d._ts && _pdtDateStr(d._ts) === _nowPDT);
  const tomorrowIdx = days.findIndex(d => d._ts && _pdtDateStr(d._ts) > _nowPDT);

  // Populate LEFT card (today peak burn) — overwrites the CWFIS noon data set by wireFBP
  if (todayIdx >= 0) {
    const t0pw = days[todayIdx]?.peak || days[todayIdx] || {};
    const setW = (attr, val) => { const el = document.querySelector(`[data-fwi="${attr}"]`); if (el) el.textContent = val; };
    setW('temp', `${(+t0pw.temp||0).toFixed(1)}°C`);
    setW('rh',   `${Math.round(t0pw.rh||0)}%`);
    setW('wind', `${Math.round(t0pw.wind||0)} km/h`);
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
      if (numEl) { numEl.textContent = cl.num;   numEl.style.color = 'white'; }
      if (lblEl) { lblEl.textContent = 'HFI'; lblEl.style.color = 'rgba(255,255,255,0.9)'; }
      if (szEl)  { szEl.textContent  = cl.size;  szEl.style.color  = 'rgba(255,255,255,0.85)'; }
      if (dscEl) { dscEl.textContent = cl.desc; }
      setEl2('fwi-fbp-hfi'   + suffix, `${Math.round(fbp.hfi).toLocaleString()} kW/m`);
      setEl2('fwi-fbp-ros'   + suffix, `${fbp.ros.toFixed(1)} m/min`);
      setEl2('fwi-fbp-flame' + suffix, `${fbp.flameLength.toFixed(1)} m`);
      setEl2('fwi-fbp-type'  + suffix, fbp.fireType);
      setEl2('fwi-fbp-cfb'   + suffix, `${(fbp.cfb*100).toFixed(0)}%`);
      const sectionEl = document.getElementById('fwi-fbp-section' + suffix);
      if (sectionEl) sectionEl.style.background = HFI_GRADIENTS[cl.num] || HFI_GRADIENTS[1];
    };
    populateTodaySection('-a', results[todayIdx]);
    populateTodaySection('-b', resultsB?.[todayIdx]);
  }

  // RIGHT card — always tomorrow
  const idx = tomorrowIdx >= 0 ? tomorrowIdx : (todayIdx >= 0 ? todayIdx + 1 : 0);
  const labelEl = document.getElementById('fwi-d1-peak-label');
  if (labelEl) labelEl.textContent = 'Tomorrow · Peak Burn · ~16:00 PDT';

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
    if (numEl) { numEl.textContent = cl.num;   numEl.style.color = 'white'; }
    if (lblEl) { lblEl.textContent = 'HFI'; lblEl.style.color = 'rgba(255,255,255,0.9)'; }
    if (szEl)  { szEl.textContent  = cl.size;  szEl.style.color  = 'rgba(255,255,255,0.85)'; }
    if (dscEl) { dscEl.textContent = cl.desc; }
    set('fwi-d1-preview-hfi-kwm' + suffix, `${Math.round(fbp.hfi).toLocaleString()} kW/m`);
    set('fwi-d1-preview-ros'     + suffix, `${fbp.ros.toFixed(1)} m/min`);
    set('fwi-d1-preview-flame'   + suffix, `${fbp.flameLength.toFixed(1)} m`);
    set('fwi-d1-preview-type'    + suffix, fbp.fireType);
    set('fwi-d1-preview-cfb'     + suffix, `${(fbp.cfb*100).toFixed(0)}%`);
    const sectionEl = document.getElementById('fwi-d1-preview-section' + suffix);
    if (sectionEl) sectionEl.style.background = HFI_GRADIENTS[cl.num] || HFI_GRADIENTS[1];
  };

  const fuelA = _savedFuelCode();
  const fuelB = _savedFuelCode2();
  const setLbl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setLbl('fwi-d1-preview-fuel-name-a', FUEL_TYPES[fuelA]?.name || fuelA);
  setLbl('fwi-d1-preview-fuel-name-b', FUEL_TYPES[fuelB]?.name || fuelB);
  populateD1Section('-a', results[idx]);
  populateD1Section('-b', resultsB?.[idx]);
}

window.FWI = { initFWI, buildStationPicker, buildRegionalSummary, buildForecastTrends, buildHourlyChart, buildStationMap, buildD1Card, calculateFWI, calculateFBP, calcMultiDayFBP, wireFBP, refreshFBP, fetchWeather, fetchCWFIS, fetchWeatherPrimary, fetchStationData, fetchStationDataForecast, dangerRating, dangerRatingBC, dangerRatingProv, exportRegionalDataset, exportForecastReport, printProvincialBriefing, printStationBriefing, ALBERTA_STATIONS, BC_STATIONS, getStationList, FUEL_TYPES, FUEL_PAIR_COMPLEMENT, hfiClassInfo, _calcFireArea60, _stationSector, stationSector, getRegions, setProvince, getProvince,
  get _idwMode() { return _idwMode; },
  set _idwMode(v) { _idwMode = v; },
};
