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
// Spring startup defaults (Van Wagner 1987).
// DC=300 reflects carry-over drought typical for Alberta's AG/RM fuel zones
// (High–VeryHigh at season open); Van Wagner's dc=15 assumes fully saturated soils.
const STARTUP = { ffmc: 85.0, dmc: 6.0, dc: 300.0 };

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

// FWI danger thresholds (Van Wagner 1987 / CFFDRS)
function dangerRating(fwi) {
  if (fwi < 5)  return 'Low';
  if (fwi < 10) return 'Moderate';
  if (fwi < 20) return 'High';
  if (fwi < 30) return 'Very High';
  return 'Extreme';
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
function calculateFBP(fuelCode, ffmc, dmc, dc, windSpeed, slope = 0) {
  const ft = FUEL_TYPES[fuelCode];
  if (!ft) return null;

  // ISI — identical to Van Wagner formula used in FWI system
  const m   = 147.2 * (101.0 - ffmc) / (59.5 + ffmc);
  const ff  = 91.9 * Math.exp(-0.1386 * m) * (1.0 + Math.pow(m, 5.31) / 4.93e7);
  const isi = 0.208 * ff * Math.exp(0.05039 * windSpeed);

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

  // Surface ROS (m/min): RSI = a × (1 − e^{−b·ISI})^c × BE
  let ros = ft.a * Math.pow(1.0 - Math.exp(-ft.b * isi), ft.c) * be;

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
  const fmc = 100; // foliar moisture content (%), typical mid-season
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
  const result = calculateFBP(fuelCode, fwi.ffmc, fwi.dmc, fwi.dc, weather.wind, 0);
  if (!result) return;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('fwi-fbp-ros',   result.ros.toFixed(1) + ' m/min');
  set('fwi-fbp-hfi',   Math.round(result.hfi).toLocaleString() + ' kW/m');
  set('fwi-fbp-flame', result.flameLength.toFixed(1) + ' m');
  set('fwi-fbp-type',  result.fireType);
  set('fwi-fbp-cfb',   (result.cfb * 100).toFixed(0) + '%');

  const badge = document.getElementById('fwi-fbp-hfi-rating');
  if (badge) {
    let rating, cls;
    if      (result.hfi < 500)  { rating = 'Low';       cls = 'text-secondary'; }
    else if (result.hfi < 2000) { rating = 'High';      cls = 'text-yellow-400'; }
    else if (result.hfi < 4000) { rating = 'Very High'; cls = 'text-orange-400'; }
    else                        { rating = 'Extreme';   cls = 'text-tertiary'; }
    badge.textContent = rating;
    badge.className = `px-2 py-1 rounded-full text-[10px] font-bold bg-surface-container ${cls}`;
  }
}

/** Re-run FBP with cached last weather/FWI when fuel picker changes. */
let _lastWeather = null;
let _lastFWI     = null;

function refreshFBP() {
  if (_lastWeather && _lastFWI) wireFBP(_lastWeather, _lastFWI);
}

/** Null-safe number formatter — returns '—' if value is null/undefined. */
const fmt = (v, d = 1) => v != null ? (+v).toFixed(d) : '—';

/** Fetch current weather from Open-Meteo (no API key, CORS-enabled). */
async function fetchWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation` +
    `&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const d = await res.json();
  const c = d.current;
  return {
    temp:  c.temperature_2m,
    rh:    c.relative_humidity_2m,
    wind:  c.wind_speed_10m,
    rain:  c.precipitation,
    month: new Date().getMonth() + 1,
  };
}

/** Run all six FWI equations from weather + optional previous-day state. */
function calculateFWI(w, prev = STARTUP) {
  const ffmc = _ffmc(w.temp, w.rh, w.wind, w.rain, prev.ffmc);
  const dmc  = _dmc(w.temp, w.rh, w.rain, w.month, prev.dmc);
  const dc   = _dc(w.temp, w.rain, w.month, prev.dc);
  const isi  = _isi(ffmc, w.wind);
  const bui  = _bui(dmc, dc);
  const fwi  = _fwi(isi, bui);
  return { ffmc, dmc, dc, isi, bui, fwi, danger: dangerRating(fwi), weather: w };
}

/** Fill all [data-fwi="key"] elements with the computed values. */
function wireDOM(r) {
  const set = (key, val) =>
    document.querySelectorAll(`[data-fwi="${key}"]`).forEach(el => el.textContent = val);

  const pct = (key, val, max) =>
    document.querySelectorAll(`[data-fwi-bar="${key}"]`).forEach(el => {
      el.style.width = Math.min(100, (val / max) * 100).toFixed(1) + '%';
    });

  // Weather
  set('temp',  fmt(r.weather.temp) + '°C');
  set('rh',    fmt(r.weather.rh, 0) + '%');
  set('wind',  fmt(r.weather.wind) + ' km/h');
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

  // Timestamp
  set('updated', `Live · ${new Date().toLocaleTimeString()}`);

  // Cache for FBP re-runs on fuel picker change
  _lastWeather = r.weather;
  _lastFWI     = r;

  // FBP fire behaviour (station_detail only — silently no-ops on other pages)
  wireFBP(r.weather, r);
}

/**
 * Main entry point. Call from any FWI screen.
 *
 * @param {number} lat       Latitude (default: Edmonton)
 * @param {number} lng       Longitude (default: Edmonton)
 * @param {string} station   Station label for [data-fwi="station"] elements
 */
async function initFWI(lat = 53.5344, lng = -113.4903, station = 'Edmonton Area') {
  document.querySelectorAll('[data-fwi="station"]').forEach(el => el.textContent = station);
  document.querySelectorAll('[data-fwi="updated"]').forEach(el => el.textContent = 'Loading…');

  try {
    const weather = await fetchWeather(lat, lng);
    const result  = calculateFWI(weather);
    wireDOM(result);
    console.log('[FWI]', result);
  } catch (err) {
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
    if (s.name === 'Slave Lake') opt.selected = true;
    sel.appendChild(opt);
  });

  function loadStation() {
    const [lat, lng] = sel.value.split(',').map(Number);
    const name = sel.options[sel.selectedIndex].textContent;
    // Update map iframe
    const frame = document.getElementById('fwi-map-frame');
    if (frame) {
      const pad = 0.5;
      frame.src = `https://www.openstreetmap.org/export/embed.html` +
        `?bbox=${(lng-pad).toFixed(4)},${(lat-pad).toFixed(4)},${(lng+pad).toFixed(4)},${(lat+pad).toFixed(4)}` +
        `&layer=mapnik&marker=${lat.toFixed(4)},${lng.toFixed(4)}`;
    }
    // Update coords overlay
    const coords = document.getElementById('fwi-map-coords');
    if (coords) coords.textContent = `${Math.abs(lat).toFixed(4)}° ${lat>=0?'N':'S'}, ${Math.abs(lng).toFixed(4)}° ${lng>=0?'E':'W'}`;
    const stLabel = document.getElementById('fwi-map-station');
    if (stLabel) stLabel.textContent = name;
    initFWI(lat, lng, name);
    buildHourlyChart(lat, lng);
  }

  sel.addEventListener('change', loadStation);
  loadStation();
}

// ─── Regional Summary ────────────────────────────────────────────────────────

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

  // Load sequentially to avoid rate-limiting; update DOM as each arrives
  list.innerHTML = REGIONS.map(r =>
    `<div id="fwi-region-${r.name.replace(/\s+/g,'-')}" class="bg-surface-container rounded-xl p-6 flex items-center gap-4 text-slate-500 text-sm">
      <span class="material-symbols-outlined animate-pulse text-primary">sync</span> Loading ${r.name}…
    </div>`
  ).join('');

  const loaded = [];
  for (const reg of REGIONS) {
    const id = `fwi-region-${reg.name.replace(/\s+/g,'-')}`;
    const el = document.getElementById(id);
    try {
      const w = await fetchWeather(reg.lat, reg.lng);
      const result = calculateFWI(w);
      loaded.push({ ...reg, result });
      _regionalCache.push({ ...reg, result });
      if (el) el.outerHTML = regionCard(reg.name, reg.sector, result);
    } catch (e) {
      console.warn(`[FWI] ${reg.name}:`, e);
      if (el) el.innerHTML = `<span class="text-slate-600 text-xs">${reg.name} — unavailable</span>`;
    }
  }

  // Update header stats from whatever loaded
  if (loaded.length) {
    const extremeCount = loaded.filter(r => r.result.danger === 'Extreme').length;
    const avgRH = loaded.reduce((s, r) => s + r.result.weather.rh, 0) / loaded.length;
    const el1 = document.getElementById('fwi-extreme-count');
    const el2 = document.getElementById('fwi-avg-rh');
    if (el1) el1.textContent = `${extremeCount} Extreme`;
    if (el2) el2.textContent = `${avgRH.toFixed(0)}%`;
  }
}

// ─── Forecast & Trends ───────────────────────────────────────────────────────

/** Fetch 7-day hourly forecast from Open-Meteo, return noon obs for each day. */
async function fetchForecast(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lng}` +
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation` +
    `&timezone=auto&forecast_days=7`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo forecast ${res.status}`);
  const d = await res.json();
  const h = d.hourly;
  const days = [];
  // Pick hour index 12 (noon) for each of 7 days
  for (let day = 0; day < 7; day++) {
    const i = day * 24 + 12;
    if (i >= (h.time?.length ?? 0)) continue;
    const date = new Date(h.time[i]);
    days.push({
      temp:  h.temperature_2m[i]       ?? 15,
      rh:    h.relative_humidity_2m[i]  ?? 40,
      wind:  h.wind_speed_10m[i]        ?? 10,
      rain:  h.precipitation[i]         ?? 0,
      month: date.getMonth() + 1,
      label: date.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }),
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
async function buildHourlyChart(lat, lng) {
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

  let prev = { ...STARTUP };
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
}

/** Chain Van Wagner through multiple days, returning FWI result per day. */
function calcMultiDay(days) {
  let prev = { ...STARTUP };
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

function trendLabel(fwi, prevFwi) {
  const delta = fwi - prevFwi;
  if (delta > 5)  return 'ESCALATING';
  if (delta < -5) return 'IMPROVING';
  return 'STABLE';
}

async function buildForecastTrends(lat = 53.5344, lng = -113.4903) {
  try {
    const days = await fetchForecast(lat, lng);
    const results = calcMultiDay(days);
    _forecastCache = { days, results };
    const maxFWI = Math.max(...results.map(r => r.fwi), 1);

    // T+24h (day index 1), T+48h (2), T+72h (3)
    const setCard = (valId, barId, labelId, r, prev) => {
      const v = document.getElementById(valId);
      const b = document.getElementById(barId);
      const l = document.getElementById(labelId);
      if (v) v.textContent = r.fwi.toFixed(1);
      if (b) b.style.width = Math.min(100, (r.fwi / 50) * 100).toFixed(1) + '%';
      if (l) l.textContent = trendLabel(r.fwi, prev.fwi);
    };
    setCard('fwi-f24-val', 'fwi-f24-bar', 'fwi-f24-label', results[1], results[0]);
    setCard('fwi-f48-val', 'fwi-f48-bar', 'fwi-f48-label', results[2], results[1]);
    setCard('fwi-f72-val', 'fwi-f72-bar', 'fwi-f72-label', results[3], results[2]);

    // Forecast summary paragraph
    const sumEl = document.getElementById('fwi-forecast-summary');
    if (sumEl) sumEl.textContent = forecastSummaryText(days, results);

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

    // Bar chart — all 7 days
    const barContainer = document.getElementById('fwi-trend-bars');
    if (barContainer) {
      barContainer.innerHTML = results.map((r, i) => {
        const h = Math.max(4, (r.fwi / maxFWI) * 100).toFixed(1);
        const isCurrent = i === 0;
        const bg = isCurrent ? 'bg-primary' : 'bg-surface-container hover:bg-primary/50';
        return `<div class="w-full ${bg} rounded-t-sm transition-colors relative group" style="height:${h}%">
          <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-[9px] text-primary opacity-0 group-hover:opacity-100 whitespace-nowrap">${r.fwi.toFixed(1)}</div>
        </div>`;
      }).join('');
    }

    // Trend table — top 5 stations, loaded sequentially to avoid rate-limiting
    const tbody = document.getElementById('fwi-trend-tbody');
    if (tbody) {
      const tableStations = REGIONS.slice(0, 5);
      let tableHTML = '';
      for (const reg of tableStations) {
        try {
          const w = await fetchWeather(reg.lat, reg.lng);
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

function forecastSummaryText(days, results) {
  const peakDay  = results.reduce((a, b) => b.fwi > a.fwi ? b : a);
  const trend    = results[results.length - 1].fwi > results[0].fwi ? 'increasing' : 'decreasing';
  const maxDanger = peakDay.danger;
  const peakTemp  = Math.max(...days.map(d => d.temp ?? -99)).toFixed(1);
  const minRH     = Math.min(...days.map(d => d.rh  ?? 999)).toFixed(0);
  return `7-day outlook: FWI peaks at ${peakDay.fwi.toFixed(1)} (${maxDanger}) on ${peakDay.label}. ` +
    `Forecast trend is ${trend}. Peak temperature ${peakTemp}°C, minimum relative humidity ${minRH}%. ` +
    `Values derived from Open-Meteo NWP forecast using Van Wagner CFFDRS equations.`;
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

window.FWI = { initFWI, buildStationPicker, buildRegionalSummary, buildForecastTrends, buildHourlyChart, calculateFWI, calculateFBP, wireFBP, refreshFBP, fetchWeather, dangerRating, exportRegionalDataset, exportForecastReport, ALBERTA_STATIONS, FUEL_TYPES };
