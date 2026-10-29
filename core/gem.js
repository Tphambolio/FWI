/**
 * Pyra — ECCC GEM point-series loader (classic script, no dependencies).
 *
 * Reads data/gem/<prov>.json, written every 6 h by .github/workflows/gem-points.yml
 * from MSC GeoMet (HRDPS 2.5 km → RDPS 10 km → GDPS 15 km; see tools/gem/ and
 * docs/data-sources.md), and serves hourly model weather for a station in the
 * same shape the engine's Open-Meteo parsers consume:
 *
 *   { time: ['YYYY-MM-DDTHH:00', …] (UTC), temperature_2m, relative_humidity_2m,
 *     wind_speed_10m (km/h), wind_direction_10m, precipitation (mm/h),
 *     _source: 'gem' | 'gem-stale', _gem: { generated, ageH, runs, src } }
 *
 * Load order on a page: province module → config/weather.js → core/gem.js →
 * core/fwi-core.js. The core calls window.PyraGEM.hourly() first and only
 * falls back to api.open-meteo.com when config/weather.js allows it
 * (fallback: 'open-meteo') and the file is missing, stale or lacks the point.
 * Nothing here decides science: windows are plain UTC hour ranges; the
 * noon-LST / 16:00 sampling stays in core/fwi-core.js.
 *
 * Attribution: Data Source: Environment and Climate Change Canada
 * (https://eccc-msc.github.io/open-data/licence/readme_en/).
 */
(function () {
  'use strict';
  var HOUR = 3600000;
  var DEFAULTS = { source: 'gem-file', fallback: 'open-meteo', max_age_h: 9, max_point_km: 1, elevation: 'file',
                   path: 'data/gem/', elevation_path: 'data/station_elevation.json' };
  var RAW = 'https://raw.githubusercontent.com/Tphambolio/FWI/main/';

  // Repo root from this script's own URL (…/core/gem.js) — the pages live one or two levels down.
  var base = '';
  try {
    var el = (typeof document !== 'undefined') && (document.currentScript || document.querySelector('script[src*="core/gem.js"]'));
    if (el && el.src) base = el.src.replace(/core\/gem\.js.*$/, '');
  } catch (_) {}

  function config() {
    var user = (typeof window !== 'undefined' && window.PYRA_WEATHER) || {};
    var c = {};
    for (var k in DEFAULTS) c[k] = DEFAULTS[k];
    for (var j in user) if (user[j] != null) c[j] = user[j];
    return c;
  }
  function fallbackAllowed() { return config().fallback === 'open-meteo'; }
  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371, rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.asin(Math.sqrt(a));
  }

  function fetchJson(url, ms) {
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms) : null;
    return fetch(url, ctl ? { signal: ctl.signal, cache: 'no-cache' } : { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url); return r.json(); })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  // ─── Province file ─────────────────────────────────────────────────────────
  var files = {};   // prov → { promise, file, error, loadedAt }

  function provinceOf(opts) {
    var p = (opts && opts.prov) || (typeof PROVINCE !== 'undefined' && PROVINCE && PROVINCE.code) || 'AB';
    return String(p).toLowerCase();
  }

  /** Fetch data/gem/<prov>.json once per page (same origin first, GitHub raw second). Resolves to the file or null. */
  function load(prov) {
    var cfg = config();
    if (cfg.source !== 'gem-file') return Promise.resolve(null);
    var slot = files[prov];
    if (slot && slot.promise) return slot.promise;
    slot = files[prov] = { promise: null, file: null, error: null };
    var local = base + cfg.path + prov + '.json';
    slot.promise = fetchJson(local, 15000)
      .catch(function (e1) { return fetchJson(RAW + cfg.path + prov + '.json', 15000).catch(function (e2) { throw e1 || e2; }); })
      .then(function (f) {
        if (!f || !f.stations || !f.start || f.step_h !== 1 || !f.n) throw new Error('data/gem/' + prov + '.json: unexpected shape');
        slot.file = f; slot.loadedAt = Date.now();
        return f;
      })
      .catch(function (e) { slot.error = String(e && e.message || e); return null; });
    return slot.promise;
  }

  function points(file) {
    if (file._pts) return file._pts;
    var out = [];
    for (var name in file.stations) {
      var s = file.stations[name];
      if (!s || s.alias) continue;
      out.push({ name: name, lat: s.lat, lon: s.lon, s: s });
    }
    file._pts = out;
    return out;
  }

  /** Nearest stored point within maxKm, or null. */
  function nearest(file, lat, lng, maxKm) {
    var best = null, bestD = maxKm == null ? 1 : maxKm;
    var pts = points(file);
    for (var i = 0; i < pts.length; i++) {
      var d = haversineKm(lat, lng, pts[i].lat, pts[i].lon);
      if (d <= bestD) { bestD = d; best = pts[i]; }
    }
    return best;
  }

  function ageH(file, nowMs) { return (nowMs - Date.parse(file.generated)) / HOUR; }
  function isStale(file, nowMs) { var a = ageH(file, nowMs == null ? Date.now() : nowMs); return !(a <= config().max_age_h); }

  /**
   * Hourly window for one stored point, Open-Meteo shaped.
   *   days mode   { pastDays, forecastDays }: from 00:00 UTC (today − pastDays) for (pastDays + forecastDays) × 24 h
   *   hours mode  { pastHours, forecastHours }: the pastHours hours ending at the current hour, plus forecastHours after it
   * Hours outside the file's span are null.
   */
  function windowOf(file, point, opts, nowMs) {
    opts = opts || {};
    var now = nowMs == null ? Date.now() : nowMs;
    var fromMs, count;
    if (opts.pastHours != null || opts.forecastHours != null) {
      var cur = Math.floor(now / HOUR) * HOUR, ph = +(opts.pastHours || 0), fh = +(opts.forecastHours || 0);
      fromMs = cur - Math.max(0, ph - 1) * HOUR;
      count = Math.max(0, ph - 1) + 1 + fh;
    } else {
      var pd = +(opts.pastDays || 0), fd = +(opts.forecastDays == null ? 2 : opts.forecastDays);
      var d0 = new Date(now);
      fromMs = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) - pd * 24 * HOUR;
      count = (pd + fd) * 24;
    }
    var start = Date.parse(file.start), n = file.n, s = point.s;
    var out = { time: [], temperature_2m: [], relative_humidity_2m: [], wind_speed_10m: [], wind_direction_10m: [], precipitation: [], src: [] };
    var covered = 0;
    for (var i = 0; i < count; i++) {
      var t = fromMs + i * HOUR, j = Math.round((t - start) / HOUR), inside = j >= 0 && j < n;
      out.time.push(new Date(t).toISOString().slice(0, 16));
      out.temperature_2m.push(inside ? nz(s.temp[j]) : null);
      out.relative_humidity_2m.push(inside ? nz(s.rh[j]) : null);
      out.wind_speed_10m.push(inside ? nz(s.wind[j]) : null);
      out.wind_direction_10m.push(inside ? nz(s.wdir[j]) : null);
      out.precipitation.push(inside ? nz(s.rain[j]) : null);
      out.src.push(inside ? (file.src || '').charAt(j) || '-' : '-');
      if (inside && s.temp[j] != null) covered++;
    }
    out._covered = covered;
    out._gem = { generated: file.generated, ageH: +ageH(file, now).toFixed(1), runs: file.model_runs, station: point.name,
                 src: out.src.join('').replace(/(.)\1*/g, function (m) { return m[0] + m.length; }) };
    return out;
  }
  function nz(v) { return v == null ? null : v; }

  /**
   * Hourly model weather for (lat, lng). Resolves to the Open-Meteo-shaped
   * payload with _source 'gem' or 'gem-stale', or null when the file is
   * unavailable, has no point within max_point_km, or no hour of the window.
   */
  function hourly(lat, lng, opts) {
    opts = opts || {};
    var prov = provinceOf(opts);
    return load(prov).then(function (file) {
      if (!file) return null;
      var pt = nearest(file, lat, lng, config().max_point_km);
      if (!pt) return null;
      var w = windowOf(file, pt, opts, opts.nowMs);
      if (!w._covered) return null;
      w._source = isStale(file, opts.nowMs) ? 'gem-stale' : 'gem';
      return w;
    });
  }

  /** Plain-language state of the province file for provenance chips / tests. */
  function status(prov) {
    var slot = files[prov || provinceOf()];
    if (!slot) return { state: 'unloaded' };
    if (!slot.file) return { state: slot.promise && !slot.error ? 'loading' : 'missing', error: slot.error || null };
    var a = ageH(slot.file, Date.now());
    return { state: isStale(slot.file) ? 'stale' : 'ok', generated: slot.file.generated, ageH: +a.toFixed(1), runs: slot.file.model_runs, stations: points(slot.file).length };
  }

  // ─── Station elevations (NRCan CDEM, data/station_elevation.json) ──────────
  var elevP = null;
  function loadElevation() {
    var cfg = config();
    if (cfg.elevation !== 'file') return Promise.resolve(null);
    if (elevP) return elevP;
    elevP = fetchJson(base + cfg.elevation_path, 10000)
      .catch(function () { return fetchJson(RAW + cfg.elevation_path, 10000); })
      .then(function (f) { return f && f.stations ? f : null; })
      .catch(function () { return null; });
    return elevP;
  }
  /** Elevation (m) of the stored station nearest (lat, lng) within max_point_km; null = not in file; undefined = file unavailable. */
  function elevation(lat, lng) {
    return loadElevation().then(function (f) {
      if (!f) return undefined;
      var best = null, bestD = config().max_point_km;
      for (var name in f.stations) {
        var s = f.stations[name];
        if (!s || s.elev == null) continue;
        var d = haversineKm(lat, lng, s.lat, s.lon);
        if (d <= bestD) { bestD = d; best = s.elev; }
      }
      return best;
    });
  }

  function reset() { files = {}; elevP = null; }

  var api = { config: config, fallbackAllowed: fallbackAllowed, load: load, hourly: hourly, elevation: elevation, status: status,
              _window: windowOf, _nearest: nearest, _isStale: isStale, _reset: reset, _base: function () { return base; } };
  if (typeof window !== 'undefined') window.PyraGEM = api;
  if (typeof globalThis !== 'undefined') globalThis.PyraGEM = api;
})();
