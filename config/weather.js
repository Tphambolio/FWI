/**
 * Pyra model-weather (NWP) source configuration — the only file to edit.
 * Loaded by every engine page before core/gem.js and core/fwi-core.js.
 *
 * Tier 3 model weather comes from Environment and Climate Change Canada's
 * GEM models (HRDPS 2.5 km → RDPS 10 km → GDPS 15 km), read from MSC GeoMet by
 * the GitHub Action .github/workflows/gem-points.yml every 6 hours and
 * committed as one file per province: data/gem/ab.json, data/gem/bc.json.
 * The browser reads that file (same origin, cached by the service worker)
 * instead of calling a third-party weather API per station.
 *
 * fallback:
 *   'open-meteo'  If the GEM file is missing, unreadable or older than
 *                 max_age_h, or the station has no point in it, the page calls
 *                 api.open-meteo.com (models=gem_seamless) exactly as Pyra did
 *                 before v150. Open-Meteo's free tier is for non-commercial use
 *                 only (CC BY 4.0 data; its attribution stays in the footers
 *                 while this is on).
 *   'none'        Never call Open-Meteo. A stale GEM file is still used (the
 *                 provenance says so); a missing one leaves the model-weather
 *                 tier unavailable.
 *                 >>> Set to 'none' before any commercial use of Pyra. <<<
 *
 * max_age_h:     age of data/gem/<prov>.json (its `generated` stamp) beyond
 *                which the file counts as stale. The Action runs every 6 h
 *                (~3 h 40 after each model cycle); 9 h allows one missed run.
 * max_point_km:  a station must have a GEM point within this distance (the
 *                files carry every station the engines know, so normally 0 km).
 * elevation:     'file' reads station elevations (NRCan CDEM) from
 *                data/station_elevation.json, written by the same Action. The
 *                Open-Meteo elevation API is then used only for the slope of a
 *                pin dropped on the map, and only while fallback is 'open-meteo'.
 */
window.PYRA_WEATHER = {
  source: 'gem-file',
  fallback: 'open-meteo',
  max_age_h: 9,
  max_point_km: 1,
  elevation: 'file',
};
