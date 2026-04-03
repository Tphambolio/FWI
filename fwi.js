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
const STARTUP = { ffmc: 85.0, dmc: 6.0, dc: 15.0 };

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

function dangerRating(fwi) {
  if (fwi < 5)  return 'Low';
  if (fwi < 10) return 'Moderate';
  if (fwi < 20) return 'High';
  if (fwi < 30) return 'Very High';
  return 'Extreme';
}

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
  set('temp',  r.weather.temp.toFixed(1) + '°C');
  set('rh',    r.weather.rh.toFixed(0) + '%');
  set('wind',  r.weather.wind.toFixed(1) + ' km/h');
  set('rain',  r.weather.rain.toFixed(1) + ' mm');

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

  // Rating badges (all get the same danger string)
  document.querySelectorAll('[data-fwi-rating]').forEach(el => {
    el.textContent = r.danger.toUpperCase();
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

  sel.addEventListener('change', () => {
    const [lat, lng] = sel.value.split(',').map(Number);
    const name = sel.options[sel.selectedIndex].textContent;
    initFWI(lat, lng, name);
  });

  // Trigger initial load with selected station
  const [lat, lng] = sel.value.split(',').map(Number);
  const name = sel.options[sel.selectedIndex].textContent;
  initFWI(lat, lng, name);
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
        <span class="font-headline text-lg text-on-surface font-medium">${r.weather.temp.toFixed(1)}°C</span>
      </div>
      <div>
        <span class="font-label text-[10px] text-on-surface-variant uppercase block">Wind</span>
        <span class="font-headline text-lg text-on-surface font-medium">${r.weather.wind.toFixed(0)} km/h</span>
      </div>
      <div>
        <span class="font-label text-[10px] text-on-surface-variant uppercase block">FWI</span>
        <span class="font-headline text-lg text-on-surface font-medium">${r.fwi.toFixed(1)}</span>
      </div>
      <div>
        <span class="font-label text-[10px] text-on-surface-variant uppercase block">RH</span>
        <span class="font-headline text-lg text-on-surface font-medium">${r.weather.rh.toFixed(0)}%</span>
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
  try {
    const results = await Promise.all(REGIONS.map(async reg => {
      const w = await fetchWeather(reg.lat, reg.lng);
      return { ...reg, result: calculateFWI(w) };
    }));

    list.innerHTML = results.map(r => regionCard(r.name, r.sector, r.result)).join('');

    // Update header stats
    const extremeCount = results.filter(r => r.result.danger === 'Extreme').length;
    const avgRH = results.reduce((s, r) => s + r.result.weather.rh, 0) / results.length;
    const el1 = document.getElementById('fwi-extreme-count');
    const el2 = document.getElementById('fwi-avg-rh');
    if (el1) el1.textContent = `${extremeCount} Extreme`;
    if (el2) el2.textContent = `${avgRH.toFixed(0)}%`;
  } catch (e) {
    list.innerHTML = '<p class="text-red-400 text-sm">Failed to load regional data.</p>';
    console.warn('[FWI Regional]', e);
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
  const d = await res.json();
  const h = d.hourly;
  const days = [];
  // Pick hour index 12 (noon) for each of 7 days
  for (let day = 0; day < 7; day++) {
    const i = day * 24 + 12;
    const date = new Date(h.time[i]);
    days.push({
      temp:  h.temperature_2m[i],
      rh:    h.relative_humidity_2m[i],
      wind:  h.wind_speed_10m[i],
      rain:  h.precipitation[i],
      month: date.getMonth() + 1,
      label: date.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }),
    });
  }
  return days;
}

/** Chain Van Wagner through multiple days, returning FWI result per day. */
function calcMultiDay(days) {
  let prev = { ...STARTUP };
  return days.map(w => {
    const r = calculateFWI(w, prev);
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

    // Trend table — top 5 stations sampled from REGIONS
    const tbody = document.getElementById('fwi-trend-tbody');
    if (tbody) {
      const tableStations = REGIONS.slice(0, 5);
      const tableResults = await Promise.all(tableStations.map(async reg => {
        const w = await fetchWeather(reg.lat, reg.lng);
        return { name: reg.name.toUpperCase(), result: calculateFWI(w) };
      }));
      tbody.innerHTML = tableResults.map(({ name, result: r }) => `
<tr class="hover:bg-surface-container transition-colors">
  <td class="py-5 pl-6">
    <span class="block text-white font-bold font-headline">${name}</span>
    <span class="text-outline text-xs">${r.weather.lat ? '' : ''}</span>
  </td>
  <td class="py-5 font-headline font-bold text-white">${r.weather.temp.toFixed(1)}°C</td>
  <td class="py-5 font-bold ${r.weather.rh < 30 ? 'text-tertiary' : 'text-secondary'}">RH ${r.weather.rh.toFixed(0)}%</td>
  <td class="py-5">
    <span class="px-3 py-1 rounded-full text-[10px] font-bold ${r.danger === 'Extreme' ? 'bg-tertiary-container text-tertiary' : r.danger === 'High' || r.danger === 'Very High' ? 'bg-[#fbabff]/10 text-tertiary' : 'bg-secondary-container/20 text-secondary border border-secondary/20'}">${r.danger.toUpperCase()}</span>
  </td>
  <td class="py-5 pr-6">
    <div class="w-24 h-1 bg-surface-container-highest rounded-full overflow-hidden">
      <div class="h-full bg-primary" style="width:${Math.min(100, r.fwi * 2).toFixed(1)}%"></div>
    </div>
    <span class="text-xs text-outline mt-1 block">${r.fwi.toFixed(1)}</span>
  </td>
</tr>`).join('');
    }
  } catch (e) {
    console.warn('[FWI Forecast]', e);
  }
}

window.FWI = { initFWI, buildStationPicker, buildRegionalSummary, buildForecastTrends, calculateFWI, fetchWeather, dangerRating, ALBERTA_STATIONS };
