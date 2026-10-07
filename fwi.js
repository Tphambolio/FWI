/**
 * Pyra FWI — Alberta province module.
 *
 * Loaded BEFORE core/fwi-core.js. Defines the PROVINCE config read by the core,
 * plus genuinely Alberta-specific code: station lists, fuel table, AEF pmwx
 * tier, regional DC floors and startup DC zones. Do not call core functions
 * at the top level here — the core is not loaded yet.
 */

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
  'Edmonton': 300,
  'Edmonton Blatchford': 300, 'Edmonton Int\'l A': 300, 'Edmonton International CS': 300,
  'Edmonton Stony Plain CS': 290, 'Edmonton Villeneuve': 290, 'Oliver AGDM': 290,
  'Elk Island Nat Park': 275, 'New Sarepta AGCM': 300, 'Thorsby AGCM': 275,
  'Wetaskiwin AGCM': 300, 'Drayton Valley': 275, 'Camrose': 275,
  'Vegreville': 275, 'Lloydminster': 250, 'Red Deer': 275, 'Stettler': 275,
  'Calgary': 375, 'Lethbridge': 425, 'Medicine Hat': 450, 'Brooks': 425,
  'Cardston': 400, 'Claresholm': 375, 'Drumheller': 425, 'Pincher Creek': 375,
};

/**
 * Regional spring DC floor by coordinate (Alberta only, March–June).
 * Based on Lawson & Armitage (2008) overwinter carryover expectations for each
 * climate zone, calibrated against CWFIS April 2026 well-initialized station data.
 * Stations reporting DC below 70% of their regional floor are considered
 * underinitialized (spring startup DC=15 default instead of overwinter equation).
 */
function getRegionalDCFloor(lat, lon) {
  // Month in Mountain Standard Time, NOT the viewer's browser clock — a viewer
  // in another timezone must not flip the correction a day early/late.
  const mo = new Date(Date.now() - 7 * 3600000).getUTCMonth() + 1;
  if (mo < 3 || mo > 6) return 0; // only enforce floor in spring startup window
  if (lat < 48.8 || lat > 60.5 || lon < -120.5 || lon > -109.5) return 0; // AB only
  if (lat < 50.5 && lon > -113.5) return 450; // SE prairies: Lethbridge/Medicine Hat/Taber
  if (lat < 50.5) return 300;                  // SW foothills: Pincher Creek/Crowsnest
  if (lat < 51.5 && lon > -112.5) return 360; // Drumheller/Stettler/Oyen corridor
  if (lat < 51.5) return 280;                  // Calgary metro/Strathmore/Claresholm
  if (lat < 52.5) return 290;                  // Red Deer/Lacombe/Wetaskiwin/Camrose
  if (lat < 54.0) return 300;                  // Edmonton metro and surrounds (calibrated Apr 2026)
  if (lat < 56.5) return 180;                  // Slave Lake/Athabasca/Fort McMurray south
  return 120;                                   // Northern boreal
}

/**
 * Correct a raw CWFIS DC only when it is the spring cold-start artifact.
 * Provenance-based: requires the value to be implausibly low (≤ the cold-start
 * ceiling) AND in the spring window AND in Alberta. Returns the (possibly
 * raised) DC and whether a correction was applied.
 *
 * NOTE: this is an estimate, not the published overwinter equation (which
 * needs fall DC + winter precip, unavailable from this feed). It corrects a
 * documented CWFIS initialization artifact; it never lowers a value and never
 * touches a station already reading a plausible DC. There is a step at the
 * July 1 window edge, but by then real DC is far above these floors so the
 * correction no longer binds in practice.
 */
function applyDCFloor(rawDC, lat, lon) {
  if (rawDC == null) return { dc: rawDC, corrected: false };
  const floor = getRegionalDCFloor(lat, lon);
  if (floor > 0 && rawDC <= DC_COLDSTART_CEILING && rawDC < floor) {
    return { dc: floor, corrected: true };
  }
  return { dc: rawDC, corrected: false };
}

// Alberta Wildfire fire weather station coordinates.
// Source: CWFIS allstn2026 (AESRD agency) + station name geocoding.
// These stations use proper Lawson & Armitage (2008) overwinter DC initialization,
// giving significantly higher spring DC than some MSC airport stations in CWFIS.
// Observations at: https://wildfire.alberta.ca/files/pmwx.csv (1300 MDT daily)
const AEF_STATION_COORDS = {
  'B1':   { lat: 50.41, lon: -114.73, name: 'Highwood' },
  'B8':   { lat: 51.57, lon: -114.86, name: 'North Ghost' },
  'C1':   { lat: 49.88, lon: -114.38, name: 'Livingston Gap' },
  'C4':   { lat: 49.61, lon: -114.45, name: 'Blairmore' },
  'C5':   { lat: 49.64, lon: -110.33, name: 'Cypress Hills' },
  'BARN': { lat: 49.80, lon: -112.30, name: 'Barnwell' },
  'BDIA': { lat: 49.87, lon: -111.38, name: 'Bow Island' },
  'BROO': { lat: 50.56, lon: -111.85, name: 'Brooks' },
  'CLA':  { lat: 50.00, lon: -113.63, name: 'Claresholm' },
  'CLAK': { lat: 49.98, lon: -113.61, name: 'Claresholm Lake' },
  'CNA':  { lat: 52.07, lon: -111.45, name: 'Coronation' },
  'CONS': { lat: 51.94, lon: -110.71, name: 'Consort' },
  'FTMC': { lat: 56.65, lon: -111.22, name: 'Fort McMurray' },
  'GHA':  { lat: 50.93, lon: -112.94, name: 'Gleichen' },
  'HAND': { lat: 51.45, lon: -112.14, name: 'Hand Hills' },
  'LODG': { lat: 49.46, lon: -110.34, name: 'Lodge Creek' },
  'MHAT': { lat: 50.02, lon: -110.72, name: 'Medicine Hat' },
  'OYEN': { lat: 51.38, lon: -110.36, name: 'Oyen' },
  'PCI':  { lat: 49.52, lon: -114.00, name: 'Pincher Creek' },
  'SOCP': { lat: 49.45, lon: -110.68, name: 'South Cypress Prairie' },
  'STRA': { lat: 51.04, lon: -113.29, name: 'Strathmore' },
  'VULC': { lat: 50.41, lon: -113.26, name: 'Vulcan' },
  'WARN': { lat: 49.28, lon: -112.16, name: 'Warner' },
  'WGM':  { lat: 52.83, lon: -111.10, name: 'Wainwright' },
  'YQL':  { lat: 49.63, lon: -112.80, name: 'Lethbridge' },
};

// In-memory cache for pmwx data (30-minute TTL — file updates once daily at ~1500 MDT)
let _aefCache = null;
let _aefCacheTs = 0;

/**
 * Fetch Alberta Wildfire (AEF) fire weather station observations from pmwx.csv.
 * Returns CWFIS-compatible GeoJSON feature objects for the IDW blend.
 * Only stations with known coordinates in AEF_STATION_COORDS are included.
 */
async function fetchAEFStations() {
  const now = Date.now();
  if (_aefCache && (now - _aefCacheTs) < 30 * 60 * 1000) return _aefCache;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    // wildfire.alberta.ca sends no CORS header — browsers can't fetch it
    // directly, which left this feature silently dead in production. The
    // daily GitHub Action mirrors pmwx.csv into the repo (data/aef_pmwx.csv);
    // raw.githubusercontent.com serves it CORS-enabled and fast.
    const res = await fetch(
      'https://raw.githubusercontent.com/Tphambolio/FWI/main/data/aef_pmwx.csv',
      { signal: controller.signal, cache: 'no-cache' }
    );
    clearTimeout(timer);
    if (!res.ok) return _aefCache ?? [];
    const text = await res.text();
    const lines = text.trim().split('\n');
    const features = [];
    for (let i = 1; i < lines.length; i++) {
      const f = lines[i].split(',');
      if (f.length < 35) continue;
      const sid    = f[34]?.trim();
      const coords = AEF_STATION_COORDS[sid];
      if (!coords) continue;
      const temp = parseFloat(f[6]);
      const rh   = parseFloat(f[10]);
      const ws   = parseFloat(f[12]);
      if (isNaN(temp) || isNaN(rh) || isNaN(ws)) continue;
      const dc   = parseFloat(f[29]);
      const dmc  = parseFloat(f[27]);
      const ffmc = parseFloat(f[25]);
      const isi  = parseFloat(f[26]);
      const bui  = parseFloat(f[28]);
      const fwi  = parseFloat(f[31]);
      features.push({ properties: {
        lat: String(coords.lat), lon: String(coords.lon), name: coords.name,
        temp, rh, ws, wdir: null, precip: parseFloat(f[14]) || 0,
        ffmc: isNaN(ffmc) ? null : ffmc, dmc: isNaN(dmc) ? null : dmc,
        dc:   isNaN(dc)   ? null : dc,   isi: isNaN(isi) ? null : isi,
        bui:  isNaN(bui)  ? null : bui,  fwi: isNaN(fwi) ? null : fwi,
        aef: true,
      }});
    }
    _aefCache = features;
    _aefCacheTs = now;
    return features;
  } catch (e) {
    return _aefCache ?? [];
  }
}

/**
 * Station-level dominant FBP fuel type derived from CWFIS WMS
 * cffdrs_fbp_fuel_types (NRCan 30m national grid) — full 199-station table
 * sampled 2026-06-10 (point sample + 2 km offsets where the centre pixel was
 * non-fuel). "curated" entries carry forward the original hand-verified table
 * (including deliberate corrections of airport-grass artifacts). D-1/D-2 grid
 * cells map to D1 (leafless baseline) — flip to D2 seasonally via the picker.
 * Users can override via the fuel picker at any time.
 */
const STATION_FUEL_TYPES = {
  "Acadia Valley AGCM"            : "O1a" , // WMS: O-1a Matted Grass
  "Andrew AGDM"                   : "O1a" , // WMS: O-1a Matted Grass
  "Athabasca AGCM"                : "C2"  , // curated (original table)
  "Atlee AGCM"                    : "D1"  , // WMS: D-1/D-2 Aspen
  "Atmore AGDM"                   : "O1a" , // WMS: O-1a Matted Grass
  "Azure AGCM"                    : "O1a" , // WMS: O-1a Matted Grass
  "Banff CS"                      : "C3"  , // curated (original table)
  "Barnwell AGDM"                 : "D1"  , // WMS: D-1/D-2 Aspen
  "Barons AGCM"                   : "O1a" , // WMS: O-1a Matted Grass
  "Bassano AGCM"                  : "D1"  , // WMS: D-1/D-2 Aspen
  "Beaver Mines"                  : "D1"  , // WMS: D-1/D-2 Aspen
  "Beaverlodge RCS"               : "C2"  , // regional default (WMS: Non-fuel)
  "Beiseker AGCM"                 : "D1"  , // WMS: D-1/D-2 Aspen
  "Bellshill AGCM"                : "O1a" , // WMS: O-1a Matted Grass
  "Big Valley AGCM"               : "O1a" , // WMS: O-1a Matted Grass
  "Black Diamond AGCM"            : "O1a" , // WMS: O-1a Matted Grass
  "Blood Tribe Ag. Project"       : "D1"  , // WMS: D-1/D-2 Aspen
  "Bodo AGDM"                     : "O1a" , // WMS: O-1a Matted Grass
  "Bonnyville"                    : "O1a" , // curated (original table)
  "Bow Island"                    : "O1a" , // regional default (WMS: Non-fuel)
  "Bow Valley"                    : "O1a" , // WMS: O-1a Matted Grass
  "Breton Plots"                  : "O1a" , // WMS: O-1a Matted Grass
  "Brocket AGDM"                  : "O1a" , // regional default (WMS: Non-fuel)
  "Brooks"                        : "O1a" , // curated (original table)
  "Brownvale AGCM"                : "O1a" , // WMS: O-1a Matted Grass
  "Busby AGCM"                    : "O1a" , // WMS: O-1a Matted Grass
  "Cadogan AGCM"                  : "O1a" , // WMS: O-1a Matted Grass
  "Calgary Int'l CS"              : "D1"  , // curated (original table)
  "Calgary Springbank A"          : "D1"  , // curated (original table)
  "Campsie Auto"                  : "O1a" , // WMS: O-1a Matted Grass
  "Camrose"                       : "O1a" , // curated (original table)
  "Cardston"                      : "O1a" , // curated (original table)
  "Carway"                        : "D1"  , // WMS: D-1/D-2 Aspen
  "Champion AGDM"                 : "D1"  , // WMS: D-1/D-2 Aspen
  "Claresholm"                    : "O1a" , // curated (original table)
  "Cleardale AGDM"                : "O1a" , // WMS: O-1a Matted Grass
  "Cold Lake A"                   : "C3"  , // curated (original table)
  "Consort AGDM"                  : "O1a" , // regional default (WMS: Non-fuel)
  "Coronation Climate"            : "D1"  , // regional default (WMS: Water)
  "Cowpar Lake Auto"              : "D1"  , // WMS: D-1 Leafless Aspen
  "Craigmyle AGCM"                : "D1"  , // WMS: D-1/D-2 Aspen
  "Crestomere AGCM"               : "O1a" , // WMS: O-1a Matted Grass
  "Crestomere AGCM"               : "O1a" , // WMS: O-1a Matted Grass
  "Crowsnest"                     : "O1a" , // regional default (WMS: Non-fuel)
  "Del Bonita AGDM"               : "O1a" , // regional default (WMS: Non-fuel)
  "Delburne AGCM"                 : "O1a" , // WMS: O-1a Matted Grass
  "Dewberry AGCM"                 : "O1a" , // WMS: O-1a Matted Grass
  "Drayton Valley"                : "D1"  , // curated (original table)
  "Drumheller East"               : "O1a" , // curated (original table)
  "Duck Lake AGCM"                : "O1a" , // WMS: O-1a Matted Grass
  "Dunkirk Auto"                  : "M1"  , // WMS: M-1/M-2 Boreal Mixedwood (75% Conifer)
  "Dupre LITE"                    : "D1"  , // regional default (WMS: Non-fuel)
  "Eaglesham AGCM"                : "O1a" , // WMS: O-1a Matted Grass
  "Edgerton AGCM"                 : "O1a" , // WMS: O-1a Matted Grass
  "Edmonton Blatchford"           : "D2"  , // curated (original table)
  "Edmonton Int'l A"              : "D2"  , // curated (original table)
  "Edmonton International CS"     : "D2"  , // curated (original table)
  "Edmonton Stony Plain CS"       : "D2"  , // curated (original table)
  "Edmonton Villeneuve"           : "D2"  , // curated (original table)
  "Edson"                         : "C2"  , // curated (original table)
  "Edson Climate"                 : "C2"  , // curated (original table)
  "Egg Island"                    : "C2"  , // regional default (WMS: Water)
  "Elk Island Nat Park"           : "D1"  , // regional default (WMS: Non-fuel)
  "Enchant 2 AGCM"                : "O1a" , // WMS: O-1a Matted Grass
  "Entrance Auto"                 : "C3"  , // WMS: C-3 Mature Jack or Lodgepole Pine
  "Esther 1"                      : "D1"  , // WMS: D-1/D-2 Aspen
  "Eta Lake Auto"                 : "D1"  , // WMS: D-1 Leafless Aspen
  "Etzikom AGCM"                  : "D1"  , // WMS: D-1/D-2 Aspen
  "Evansburg 2 AGCM"              : "O1a" , // WMS: O-1a Matted Grass
  "Fairview AGDM"                 : "O1a" , // WMS: O-1a Matted Grass
  "Ferintosh AGCM"                : "O1a" , // WMS: O-1a Matted Grass
  "Fincastle IMCIN"               : "O1a" , // WMS: O-1a Matted Grass
  "Foremost AGDM"                 : "O1a" , // regional default (WMS: Non-fuel)
  "Forestburg AGCM"               : "O1a" , // WMS: O-1a Matted Grass
  "Fort Assiniboine AGCM"         : "O1a" , // WMS: O-1a Matted Grass
  "Fort Chipewyan"                : "C2"  , // curated (original table)
  "Fort Chipewyan RCS"            : "C2"  , // curated (original table)
  "Fort Macleod AGCM"             : "O1a" , // WMS: O-1a Matted Grass
  "Fort McMurray A"               : "C4"  , // curated (original table)
  "Fort McMurray CS"              : "C4"  , // curated (original table)
  "Fort Vermilion"                : "C2"  , // curated (original table)
  "Fox Creek"                     : "C2"  , // curated (original table)
  "Garden River"                  : "D1"  , // WMS: D-1/D-2 Aspen
  "Gleichen AGCM"                 : "O1a" , // WMS: O-1a Matted Grass
  "Glenevis AGCM"                 : "O1a" , // WMS: O-1a Matted Grass
  "Grande Cache"                  : "C2"  , // curated (original table)
  "Grande Prairie A"              : "O1a" , // curated (original table)
  "Grassy Lake IMCIN"             : "O1a" , // WMS: O-1a Matted Grass
  "Ground Zero Auto"              : "C3"  , // WMS: C-3 Mature Jack or Lodgepole Pine
  "Halkirk AGCM"                  : "O1a" , // WMS: O-1a Matted Grass
  "Hawk Hills AGCM"               : "O1a" , // WMS: O-1a Matted Grass
  "Heart Lake Auto"               : "D1"  , // WMS: D-1 Leafless Aspen
  "Hemaruka AGCM"                 : "D1"  , // WMS: D-1/D-2 Aspen
  "Hendrickson Creek"             : "C3"  , // WMS: C-3 Mature Jack or Lodgepole Pine
  "Hespero AGCM"                  : "D1"  , // WMS: D-1/D-2 Aspen
  "High Level A"                  : "C2"  , // curated (original table)
  "High Prairie AGDM"             : "D2"  , // curated (original table)
  "Highwood Auto"                 : "C3"  , // WMS: C-3 Mature Jack or Lodgepole Pine
  "Hinton"                        : "C2"  , // curated (original table)
  "Holden AGDM"                   : "O1a" , // WMS: O-1a Matted Grass
  "Hughendon AGCM"                : "D1"  , // WMS: D-1/D-2 Aspen
  "Hussar AGDM"                   : "O1a" , // WMS: O-1a Matted Grass
  "Irvine AGCM"                   : "O1a" , // WMS: O-1a Matted Grass
  "Island Lake South"             : "O1a" , // WMS: O-1a Matted Grass
  "Jasper Warden"                 : "C3"  , // curated (original table)
  "Jean Cote AGCM"                : "O1a" , // WMS: O-1a Matted Grass
  "Kessler AGCM"                  : "D1"  , // WMS: D-1/D-2 Aspen
  "Killam AGDM"                   : "O1a" , // WMS: O-1a Matted Grass
  "Kitscoty AGCM"                 : "O1a" , // WMS: O-1a Matted Grass
  "La Crete AGCM"                 : "O1a" , // WMS: O-1a Matted Grass
  "La Glace AGCM"                 : "O1a" , // WMS: O-1a Matted Grass
  "Lac La Biche Climate"          : "D1"  , // curated (original table)
  "Lacombe CDA 2"                 : "O1a" , // WMS: O-1a Matted Grass
  "Leedale AGDM"                  : "O1a" , // WMS: O-1a Matted Grass
  "Legal AGCM"                    : "D1"  , // regional default (WMS: Non-fuel)
  "Lethbridge"                    : "O1a" , // curated (original table)
  "Lethbridge CDA"                : "O1a" , // curated (original table)
  "Lethbridge Demo Farm"          : "O1a" , // curated (original table)
  "Lindbergh AGDM"                : "O1a" , // WMS: O-1a Matted Grass
  "Linden AGCM"                   : "O1a" , // WMS: O-1a Matted Grass
  "Livingston Gap Auto"           : "M1"  , // WMS: M-1/M-2 Boreal Mixedwood (75% Conifer)
  "Lloydminster"                  : "O1a" , // curated (original table)
  "Manning AGDM"                  : "C2"  , // curated (original table)
  "Mannville AGCM"                : "O1a" , // WMS: O-1a Matted Grass
  "Manyberries AGCM"              : "O1a" , // regional default (WMS: Non-fuel)
  "Masinasin AGDM"                : "O1a" , // regional default (WMS: Non-fuel)
  "Medicine Hat"                  : "O1a" , // curated (original table)
  "Medicine Hat RCS"              : "O1a" , // curated (original table)
  "Mildred Lake"                  : "C2"  , // regional default (WMS: Non-fuel)
  "Milk River"                    : "D1"  , // WMS: D-1/D-2 Aspen
  "Morrin AGDM"                   : "O1a" , // WMS: O-1a Matted Grass
  "Mossleigh AGCM"                : "O1a" , // WMS: O-1a Matted Grass
  "Mundare AGDM"                  : "O1a" , // WMS: O-1a Matted Grass
  "Myrnam LITE"                   : "O1a" , // WMS: O-1a Matted Grass
  "Nakiska Ridgetop"              : "C3"  , // WMS: C-3 Mature Jack or Lodgepole Pine
  "New Sarepta AGCM"              : "O1a" , // WMS: O-1a Matted Grass
  "Nier AGDM"                     : "O1a" , // WMS: O-1a Matted Grass
  "Nordegg CS"                    : "C3"  , // WMS: C-3 Mature Jack or Lodgepole Pine
  "North Ghost"                   : "C4"  , // WMS: C-4 Immature Jack or Lodgepole Pine
  "Olds College AGDM"             : "O1a" , // WMS: O-1a Matted Grass
  "Oliver AGDM"                   : "D1"  , // regional default (WMS: Non-fuel)
  "Oyen AGDM"                     : "O1a" , // regional default (WMS: Non-fuel)
  "Pakowki Lake AGCM"             : "O1a" , // WMS: O-1a Matted Grass
  "Peace River A"                 : "D2"  , // curated (original table)
  "Peoria AGDM"                   : "C2"  , // regional default (WMS: Non-fuel)
  "Pincher Creek"                 : "O1a" , // curated (original table)
  "Pincher Creek Climate"         : "O1a" , // curated (original table)
  "Pollockville AGDM"             : "D1"  , // WMS: D-1/D-2 Aspen
  "Prentiss"                      : "O1a" , // WMS: O-1a Matted Grass
  "Radway LITE"                   : "O1a" , // WMS: O-1a Matted Grass
  "Ranfurly Auto"                 : "O1a" , // WMS: O-1a Matted Grass
  "Raymond IMCIN"                 : "O1a" , // WMS: O-1a Matted Grass
  "Red Deer A"                    : "D1"  , // curated (original table)
  "Ribstone South AGCM"           : "O1a" , // WMS: O-1a Matted Grass
  "Rich Lake AGDM"                : "O1a" , // WMS: O-1a Matted Grass
  "Rivercourse AGCM"              : "O1a" , // WMS: O-1a Matted Grass
  "Rocky Mtn House Aut"           : "C2"  , // curated (original table)
  "Rolling Hills AGCM"            : "D1"  , // WMS: D-1/D-2 Aspen
  "Roma"                          : "C2"  , // regional default (WMS: Non-fuel)
  "Rosalind AGCM"                 : "O1a" , // WMS: O-1a Matted Grass
  "Rosemary IMCIN"                : "D1"  , // WMS: D-1/D-2 Aspen
  "Savanna AGCM"                  : "O1a" , // WMS: O-1a Matted Grass
  "Schuler AGDM"                  : "O1a" , // WMS: O-1a Matted Grass
  "Sedalia AGCM"                  : "O1a" , // WMS: O-1a Matted Grass
  "Seven Persons IMCIN"           : "D1"  , // WMS: D-1/D-2 Aspen
  "Shonts AGCM"                   : "O1a" , // WMS: O-1a Matted Grass
  "Slave Lake"                    : "C2"  , // curated (original table)
  "Slave Lake RCS"                : "C2"  , // curated (original table)
  "Smoky Lake AGDM"               : "O1a" , // WMS: O-1a Matted Grass
  "Spondin AGCM"                  : "O1a" , // WMS: O-1a Matted Grass
  "St. Lina AGCM"                 : "O1a" , // WMS: O-1a Matted Grass
  "St. Paul AGDM"                 : "D1"  , // regional default (WMS: Non-fuel)
  "Standard AGCM"                 : "O1a" , // WMS: O-1a Matted Grass
  "Stavely AAFC"                  : "D1"  , // WMS: D-1/D-2 Aspen
  "Stettler"                      : "O1a" , // curated (original table)
  "Stettler AGDM"                 : "O1a" , // curated (original table)
  "Strathmore IMCIN"              : "O1a" , // regional default (WMS: Non-fuel)
  "Sundre A"                      : "O1a" , // regional default (WMS: Non-fuel)
  "Tawatinaw AGCM"                : "O1a" , // WMS: O-1a Matted Grass
  "Teepee Creek AGCM"             : "O1a" , // WMS: O-1a Matted Grass
  "Thorsby AGCM"                  : "O1a" , // WMS: O-1a Matted Grass
  "Three Hills AGCM"              : "O1a" , // WMS: O-1a Matted Grass
  "Tomahawk AGDM"                 : "O1a" , // WMS: O-1a Matted Grass
  "Travers AGCM"                  : "O1a" , // WMS: O-1a Matted Grass
  "Tulliby Lake AGCM"             : "O1a" , // WMS: O-1a Matted Grass
  "Two Hills AGDM"                : "O1a" , // WMS: O-1a Matted Grass
  "Valleyview AGDM"               : "D1"  , // curated (original table)
  "Vegreville"                    : "O1a" , // curated (original table)
  "Vermilion AGDM"                : "O1a" , // WMS: O-1a Matted Grass
  "Viking AGCM"                   : "O1a" , // WMS: O-1a Matted Grass
  "Wabasca"                       : "C2"  , // curated (original table)
  "Wainwright CFB"                : "D1"  , // regional default (WMS: Non-fuel)
  "Waterton Park Gate"            : "O1a" , // regional default (WMS: Non-fuel)
  "Wetaskiwin AGCM"               : "O1a" , // curated (original table)
  "Whitecourt"                    : "C2"  , // curated (original table)
  "Whitecourt A"                  : "C2"  , // curated (original table)
  "Willow Creek 1"                : "C2"  , // WMS: C-2 Boreal Spruce
  "Wimborne AGCM"                 : "O1a" , // WMS: O-1a Matted Grass
  "Wrentham AGDM"                 : "O1a" , // WMS: O-1a Matted Grass
};

/** Regional default when a station has no STATION_FUEL_TYPES entry. */
function _defaultFuelFor(lat) {
  return lat > 54.5 ? 'C2' : lat > 52 ? 'D1' : 'O1a';
}

/**
 * One province-wide CWFIS query — every station in a single request, instead
 * of one bbox query per station. Returns the raw feature array (cached for the
 * page session) so buildStationMap can resolve all 199 stations locally.
 */
let _allCWFISFeatures = null;
async function fetchAllCWFIS(latMin = 48.8, latMax = 60.5, lonMin = -120.5, lonMax = -109.5) {
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
 * AB tier chain (PROVINCE.fetchPrimary — core fetchWeatherPrimary delegates here).
 * CWFIS firewx_stns_current updates once daily at noon LST (19:00 UTC for AB).
 * Before noon, the layer serves yesterday's obs — use chain values for holding
 * cache init but fall through to the peak-burn forecast for today's weather.
 * "Pre-noon" is evaluated in MST (UTC−7): the old `getUTCHours() < 19` test
 * wrapped past midnight UTC and treated 18:00 MDT–midnight as pre-noon,
 * discarding today's real obs every evening.
 */
async function _fetchWeatherPrimaryAB(lat, lng) {
  const mstHour   = new Date(Date.now() - PROVINCE.lstOffset * 3600000).getUTCHours();
  const isPreNoon = mstHour < 12;

  try {
    // Post-noon: fetch CWFIS and SWOB in parallel so we can cross-validate weather obs.
    let cwfis, swob = null;
    if (!isPreNoon && !_idwMode) {
      [cwfis, swob] = await Promise.all([
        fetchCWFIS(lat, lng, false).catch(() => null),
        fetchSWOB(lat, lng).catch(() => null),
      ]);
    } else {
      cwfis = await fetchCWFIS(lat, lng, _idwMode);
    }

    if (cwfis) {
      if (isPreNoon && !_idwMode) {
        // CWFIS layer serves yesterday's noon obs until 19:00 UTC — always fall through
        // to today's peak burn forecast for weather inputs.
        // Cache FWI chain if present so initFWI uses real carry-over instead of startup constants.
        if (cwfis.fwiFromCWFIS) {
          try {
            localStorage.setItem(_holdKey(lat, lng), JSON.stringify({
              ffmc: cwfis.ffmc, dmc: cwfis.dmc, dc: cwfis.dc,
              isi: cwfis.isi, bui: cwfis.bui, fwi: cwfis.fwi,
              stationName: cwfis.stationName, distKm: cwfis.distKm,
              repDate: cwfis.repDate, cachedAt: new Date().toISOString(),
            }));
          } catch (_) {}
        }
        // Fall through — use today's peak burn forecast for weather inputs
      } else {
        return _swobCrossCheck(cwfis, swob);
      }
    }
    // Post-noon SWOB already fetched above — return it if valid
    if (!isPreNoon && swob) return swob;
  } catch (e) { /* fall through */ }

  // Pre-noon: skip SWOB — real-time morning obs are not useful for peak burn prediction
  if (!isPreNoon) {
    try {
      const swob = await fetchSWOB(lat, lng);
      if (swob) return swob;
    } catch (e) { /* fall through */ }
  }

  return fetchWeather(lat, lng);
}

// Alberta CWFIS fire weather stations — full list from CWFIS WFS (193 stations)
const ALBERTA_STATIONS = [
  // ── Far North ──────────────────────────────────────────────────────────────
  { name: 'Fort Chipewyan',             lat: 58.767, lng: -111.117 },
  { name: 'Fort Chipewyan RCS',         lat: 58.767, lng: -111.117 },
  { name: 'Fort Vermilion',             lat: 58.383, lng: -116.033 },
  { name: 'High Level A',               lat: 58.617, lng: -117.167 },
  { name: 'Garden River',               lat: 58.711, lng: -113.867 },
  { name: 'Egg Island',                 lat: 58.981, lng: -110.440 },
  { name: 'Dunkirk Auto',               lat: 56.769, lng: -112.489 },
  { name: 'La Crete AGCM',              lat: 58.172, lng: -116.343 },
  // ── Northwest ──────────────────────────────────────────────────────────────
  { name: 'Peace River A',              lat: 56.233, lng: -117.450 },
  { name: 'Grande Prairie A',           lat: 55.183, lng: -118.883 },
  { name: 'Beaverlodge RCS',            lat: 55.200, lng: -119.400 },
  { name: 'Manning AGDM',               lat: 56.974, lng: -117.451 },
  { name: 'Brownvale AGCM',             lat: 56.118, lng: -117.887 },
  { name: 'Cleardale AGDM',             lat: 56.320, lng: -119.748 },
  { name: 'Savanna AGCM',               lat: 56.076, lng: -119.345 },
  { name: 'Peoria AGDM',                lat: 55.621, lng: -118.293 },
  { name: 'La Glace AGCM',              lat: 55.422, lng: -119.255 },
  { name: 'Teepee Creek AGCM',          lat: 55.352, lng: -118.408 },
  { name: 'Fairview AGDM',              lat: 56.082, lng: -118.440 },
  { name: 'Jean Cote AGCM',             lat: 55.913, lng: -117.120 },
  { name: 'Hawk Hills AGCM',            lat: 57.265, lng: -117.298 },
  { name: 'Roma',                       lat: 56.193, lng: -117.452 },
  // ── North-Central ──────────────────────────────────────────────────────────
  { name: 'Fort McMurray A',            lat: 56.650, lng: -111.217 },
  { name: 'Fort McMurray CS',           lat: 56.650, lng: -111.217 },
  { name: 'Mildred Lake',               lat: 57.033, lng: -111.567 },
  { name: 'Wabasca',                    lat: 55.967, lng: -113.833 },
  { name: 'Slave Lake',                 lat: 55.300, lng: -114.783 },
  { name: 'Slave Lake RCS',             lat: 55.300, lng: -114.783 },
  { name: 'High Prairie AGDM',          lat: 55.395, lng: -116.483 },
  { name: 'Island Lake South',          lat: 54.817, lng: -113.550 },
  { name: 'Heart Lake Auto',            lat: 54.915, lng: -111.340 },
  { name: 'Ground Zero Auto',           lat: 55.005, lng: -110.608 },
  { name: 'Cowpar Lake Auto',           lat: 55.953, lng: -110.497 },
  { name: 'Campsie Auto',               lat: 54.133, lng: -114.683 },
  { name: 'Eaglesham AGCM',             lat: 55.808, lng: -117.887 },
  { name: 'Valleyview AGDM',            lat: 55.098, lng: -117.199 },
  // ── Northeast ──────────────────────────────────────────────────────────────
  { name: 'Cold Lake A',                lat: 54.417, lng: -110.283 },
  { name: 'Lac La Biche Climate',       lat: 54.767, lng: -112.017 },
  { name: 'Bonnyville',                 lat: 54.267, lng: -110.733 },
  { name: 'Atmore AGDM',                lat: 54.780, lng: -112.825 },
  { name: 'Duck Lake AGCM',             lat: 54.686, lng: -113.939 },
  { name: 'Athabasca AGCM',             lat: 54.635, lng: -113.382 },
  { name: 'Smoky Lake AGDM',            lat: 54.265, lng: -112.504 },
  { name: 'Rich Lake AGDM',             lat: 54.501, lng: -111.691 },
  { name: 'Fort Assiniboine AGCM',      lat: 54.410, lng: -114.769 },
  { name: 'Tawatinaw AGCM',             lat: 54.300, lng: -113.520 },
  { name: 'Dupre LITE',                 lat: 54.363, lng: -110.880 },
  { name: 'St. Lina AGCM',              lat: 54.282, lng: -111.452 },
  { name: 'St. Paul AGDM',              lat: 54.011, lng: -111.272 },
  { name: 'Legal AGCM',                 lat: 54.003, lng: -113.474 },
  { name: 'Lindbergh AGDM',             lat: 53.943, lng: -110.579 },
  { name: 'Andrew AGDM',                lat: 53.918, lng: -112.278 },
  { name: 'Busby AGCM',                 lat: 53.931, lng: -113.922 },
  { name: 'Radway LITE',                lat: 54.018, lng: -112.977 },
  // ── Edmonton Metro ─────────────────────────────────────────────────────────
  { name: 'Edmonton Blatchford',        lat: 53.567, lng: -113.517 },
  { name: 'Edmonton Int\'l A',          lat: 53.317, lng: -113.583 },
  { name: 'Edmonton International CS',  lat: 53.300, lng: -113.600 },
  { name: 'Edmonton Stony Plain CS',    lat: 53.550, lng: -114.117 },
  { name: 'Edmonton Villeneuve',        lat: 53.668, lng: -113.856 },
  { name: 'Oliver AGDM',                lat: 53.647, lng: -113.355 },
  { name: 'Elk Island Nat Park',        lat: 53.683, lng: -112.867 },
  { name: 'Glenevis AGCM',              lat: 53.833, lng: -114.539 },
  { name: 'Evansburg 2 AGCM',           lat: 53.638, lng: -115.062 },
  // ── Central-West ───────────────────────────────────────────────────────────
  { name: 'Whitecourt A',               lat: 54.150, lng: -115.783 },
  { name: 'Fox Creek',                  lat: 54.400, lng: -116.800 },
  { name: 'Edson',                      lat: 53.583, lng: -116.467 },
  { name: 'Edson Climate',              lat: 53.583, lng: -116.450 },
  { name: 'Hendrickson Creek',          lat: 53.800, lng: -118.450 },
  { name: 'Grande Cache',               lat: 53.916, lng: -118.867 },
  { name: 'Entrance Auto',              lat: 53.380, lng: -117.701 },
  { name: 'Hinton',                     lat: 53.400, lng: -117.567 },
  { name: 'Jasper Warden',              lat: 52.927, lng: -118.030 },
  { name: 'Willow Creek 1',             lat: 53.383, lng: -118.350 },
  { name: 'Eta Lake Auto',              lat: 53.183, lng: -115.689 },
  // ── Central ────────────────────────────────────────────────────────────────
  { name: 'Whitecourt',                 lat: 54.150, lng: -115.683 },
  { name: 'Drayton Valley',             lat: 53.217, lng: -114.983 },
  { name: 'Tomahawk AGDM',              lat: 53.439, lng: -114.718 },
  { name: 'Breton Plots',               lat: 53.089, lng: -114.443 },
  { name: 'Crestomere AGCM',            lat: 52.733, lng: -113.903 },
  { name: 'Lacombe CDA 2',              lat: 52.450, lng: -113.750 },
  { name: 'Prentiss',                   lat: 52.433, lng: -113.600 },
  { name: 'Hespero AGCM',               lat: 52.247, lng: -114.447 },
  { name: 'Leedale AGDM',               lat: 52.553, lng: -114.473 },
  { name: 'Rocky Mtn House Aut',        lat: 52.417, lng: -114.917 },
  { name: 'Nordegg CS',                 lat: 52.500, lng: -116.033 },
  // ── East-Central ───────────────────────────────────────────────────────────
  { name: 'Vegreville',                 lat: 53.500, lng: -112.100 },
  { name: 'Mundare AGDM',               lat: 53.561, lng: -112.296 },
  { name: 'Shonts AGCM',                lat: 53.333, lng: -112.540 },
  { name: 'Mannville AGCM',             lat: 53.456, lng: -111.256 },
  { name: 'Holden AGDM',                lat: 53.185, lng: -112.246 },
  { name: 'Vermilion AGDM',             lat: 53.344, lng: -110.882 },
  { name: 'Kitscoty AGCM',              lat: 53.353, lng: -110.416 },
  { name: 'Lloydminster',               lat: 53.317, lng: -110.067 },
  { name: 'Ranfurly Auto',              lat: 53.417, lng: -111.733 },
  { name: 'Dewberry AGCM',              lat: 53.659, lng: -110.588 },
  { name: 'Myrnam LITE',                lat: 53.708, lng: -111.133 },
  { name: 'Two Hills AGDM',             lat: 53.625, lng: -111.678 },
  { name: 'Tulliby Lake AGCM',          lat: 53.664, lng: -110.081 },
  { name: 'Camrose',                    lat: 53.050, lng: -112.817 },
  { name: 'Viking AGCM',                lat: 53.182, lng: -111.732 },
  { name: 'Ferintosh AGCM',             lat: 52.744, lng: -112.858 },
  { name: 'New Sarepta AGCM',           lat: 53.262, lng: -113.165 },
  { name: 'Wetaskiwin AGCM',            lat: 52.980, lng: -113.444 },
  { name: 'Thorsby AGCM',               lat: 53.217, lng: -113.895 },
  { name: 'Rivercourse AGCM',           lat: 53.019, lng: -110.102 },
  // ── Southeast ──────────────────────────────────────────────────────────────
  { name: 'Wainwright CFB',             lat: 52.833, lng: -111.100 },
  { name: 'Stettler AGDM',              lat: 52.347, lng: -112.596 },
  { name: 'Forestburg AGCM',            lat: 52.548, lng: -112.123 },
  { name: 'Killam AGDM',                lat: 52.848, lng: -111.872 },
  { name: 'Big Valley AGCM',            lat: 51.998, lng: -112.803 },
  { name: 'Morrin AGDM',                lat: 51.660, lng: -112.675 },
  { name: 'Edgerton AGCM',              lat: 52.778, lng: -110.433 },
  { name: 'Rosalind AGCM',              lat: 52.792, lng: -112.422 },
  { name: 'Bellshill AGCM',             lat: 52.582, lng: -111.465 },
  { name: 'Bodo AGDM',                  lat: 52.124, lng: -110.101 },
  { name: 'Oyen AGDM',                  lat: 51.380, lng: -110.355 },
  { name: 'Hemaruka AGCM',              lat: 51.780, lng: -111.212 },
  { name: 'Consort AGDM',               lat: 51.937, lng: -110.713 },
  { name: 'Sedalia AGCM',               lat: 51.591, lng: -110.755 },
  { name: 'Ribstone South AGCM',        lat: 52.587, lng: -110.343 },
  { name: 'Kessler AGCM',               lat: 52.290, lng: -111.113 },
  { name: 'Spondin AGCM',               lat: 51.816, lng: -111.683 },
  { name: 'Hughendon AGCM',             lat: 52.578, lng: -110.784 },
  { name: 'Drumheller East',            lat: 51.450, lng: -112.683 },
  { name: 'Craigmyle AGCM',             lat: 51.775, lng: -112.252 },
  { name: 'Pollockville AGDM',          lat: 51.125, lng: -111.705 },
  { name: 'Acadia Valley AGCM',         lat: 51.066, lng: -110.317 },
  { name: 'Atlee AGCM',                 lat: 50.810, lng: -111.006 },
  { name: 'Esther 1',                   lat: 51.667, lng: -110.200 },
  { name: 'Schuler AGDM',               lat: 50.307, lng: -110.091 },
  { name: 'Cadogan AGCM',               lat: 52.334, lng: -110.510 },
  { name: 'Halkirk AGCM',               lat: 52.117, lng: -112.164 },
  // ── Red Deer / Central South ───────────────────────────────────────────────
  { name: 'Red Deer A',                 lat: 52.183, lng: -113.900 },
  { name: 'Delburne AGCM',              lat: 52.183, lng: -113.176 },
  { name: 'Three Hills AGCM',           lat: 51.767, lng: -113.206 },
  { name: 'Wimborne AGCM',              lat: 51.936, lng: -113.591 },
  { name: 'Linden AGCM',                lat: 51.619, lng: -113.656 },
  { name: 'Stettler',                   lat: 52.317, lng: -112.717 },
  { name: 'Coronation Climate',         lat: 52.067, lng: -111.450 },
  { name: 'Olds College AGDM',          lat: 51.759, lng: -114.085 },
  { name: 'Beiseker AGCM',              lat: 51.379, lng: -113.357 },
  { name: 'Sundre A',                   lat: 51.783, lng: -114.683 },
  { name: 'Stavely AAFC',               lat: 50.183, lng: -113.883 },
  { name: 'North Ghost',                lat: 51.574, lng: -114.855 },
  { name: 'Gleichen AGCM',              lat: 50.935, lng: -112.941 },
  { name: 'Standard AGCM',              lat: 51.228, lng: -112.982 },
  { name: 'Hussar AGDM',                lat: 51.191, lng: -112.503 },
  { name: 'Strathmore IMCIN',           lat: 51.039, lng: -113.290 },
  { name: 'Crestomere AGCM',            lat: 52.733, lng: -113.903 },
  // ── Calgary ────────────────────────────────────────────────────────────────
  { name: 'Calgary Int\'l CS',          lat: 51.117, lng: -114.000 },
  { name: 'Calgary Springbank A',       lat: 51.100, lng: -114.367 },
  { name: 'Bow Valley',                 lat: 51.083, lng: -115.067 },
  { name: 'Nakiska Ridgetop',           lat: 50.950, lng: -115.183 },
  { name: 'Highwood Auto',              lat: 50.415, lng: -114.726 },
  { name: 'Black Diamond AGCM',         lat: 50.707, lng: -114.152 },
  { name: 'Nier AGDM',                  lat: 51.369, lng: -114.099 },
  { name: 'Champion AGDM',              lat: 50.295, lng: -113.347 },
  { name: 'Travers AGCM',               lat: 50.304, lng: -112.863 },
  { name: 'Mossleigh AGCM',             lat: 50.673, lng: -113.349 },
  { name: 'Azure AGCM',                 lat: 50.512, lng: -114.013 },
  // ── Southwest / Rockies ────────────────────────────────────────────────────
  { name: 'Banff CS',                   lat: 51.200, lng: -115.550 },
  { name: 'Crowsnest',                  lat: 49.633, lng: -114.483 },
  { name: 'Beaver Mines',               lat: 49.467, lng: -114.183 },
  { name: 'Livingston Gap Auto',        lat: 49.879, lng: -114.383 },
  { name: 'Pincher Creek',              lat: 49.517, lng: -114.000 },
  { name: 'Pincher Creek Climate',      lat: 49.517, lng: -114.000 },
  { name: 'Waterton Park Gate',         lat: 49.133, lng: -113.817 },
  { name: 'Carway',                     lat: 49.000, lng: -113.383 },
  { name: 'Brocket AGDM',               lat: 49.611, lng: -113.759 },
  { name: 'Blood Tribe Ag. Project',    lat: 49.559, lng: -113.064 },
  // ── South ──────────────────────────────────────────────────────────────────
  { name: 'Claresholm',                 lat: 50.000, lng: -113.633 },
  { name: 'Fort Macleod AGCM',          lat: 49.786, lng: -113.380 },
  { name: 'Lethbridge',                 lat: 49.633, lng: -112.800 },
  { name: 'Lethbridge CDA',             lat: 49.700, lng: -112.767 },
  { name: 'Lethbridge Demo Farm',       lat: 49.687, lng: -112.745 },
  { name: 'Cardston',                   lat: 49.200, lng: -113.283 },
  { name: 'Del Bonita AGDM',            lat: 49.050, lng: -112.810 },
  { name: 'Barons AGCM',                lat: 50.022, lng: -113.221 },
  { name: 'Foremost AGDM',              lat: 49.483, lng: -111.486 },
  { name: 'Wrentham AGDM',              lat: 49.495, lng: -112.112 },
  { name: 'Raymond IMCIN',              lat: 49.487, lng: -112.675 },
  { name: 'Masinasin AGDM',             lat: 49.137, lng: -111.652 },
  { name: 'Barnwell AGDM',              lat: 49.802, lng: -112.302 },
  { name: 'Fincastle IMCIN',            lat: 49.802, lng: -112.046 },
  { name: 'Milk River',                 lat: 49.133, lng: -112.050 },
  { name: 'Seven Persons IMCIN',        lat: 49.918, lng: -110.915 },
  // ── Southeast ──────────────────────────────────────────────────────────────
  { name: 'Brooks',                     lat: 50.555, lng: -111.849 },
  { name: 'Medicine Hat',               lat: 50.017, lng: -110.717 },
  { name: 'Medicine Hat RCS',           lat: 50.033, lng: -110.717 },
  { name: 'Rolling Hills AGCM',         lat: 50.265, lng: -111.701 },
  { name: 'Bassano AGCM',               lat: 50.893, lng: -112.465 },
  { name: 'Rosemary IMCIN',             lat: 50.834, lng: -112.057 },
  { name: 'Manyberries AGCM',           lat: 49.364, lng: -110.678 },
  { name: 'Etzikom AGCM',               lat: 49.553, lng: -111.054 },
  { name: 'Pakowki Lake AGCM',          lat: 49.225, lng: -111.126 },
  { name: 'Irvine AGCM',                lat: 49.989, lng: -110.262 },
  { name: 'Bow Island',                 lat: 49.733, lng: -111.450 },
  { name: 'Grassy Lake IMCIN',          lat: 49.874, lng: -111.733 },
  { name: 'Enchant 2 AGCM',             lat: 50.179, lng: -112.414 },
].sort((a, b) => a.name.localeCompare(b.name));

// ─── Pin-Drop Fuel Lookup ─────────────────────────────────────────────────────

const REGIONS = [
  { name: 'Fort McMurray',  sector: 'Northeast Boreal',  lat: 56.650, lng: -111.217 },
  { name: 'Peace River',    sector: 'Northwest Sector',  lat: 56.233, lng: -117.283 },
  { name: 'Slave Lake',     sector: 'Lesser Slave Zone', lat: 55.283, lng: -114.767 },
  { name: 'Athabasca',      sector: 'Central-North',     lat: 54.717, lng: -113.283 },
  { name: 'Edmonton',       sector: 'Central Alberta',   lat: 53.534, lng: -113.490 },
  { name: 'Lethbridge',     sector: 'Southern Alberta',  lat: 49.700, lng: -112.833 },
];

// ─── Export ──────────────────────────────────────────────────────────────────

// ─── ICS Print Briefings ─────────────────────────────────────────────────────

// ─── P4: SCRIBE 48-hr FWI validation ────────────────────────────────────────
// NRCan SCRIBE gives pre-computed FWI for today / +24h / +48h at met stations.
// Sentinel value -101 means no data for that station (off-season or not computed).

// ─── P3: Active fires + satellite hotspot layers ─────────────────────────────

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

/** "YYYY-MM-DD" in Mountain Daylight Time (UTC−6) — AB name for the core's _localDateStr. */
function _mdtDateStr(ts) { return _localDateStr(ts); }

// ─── Province config — read by core/fwi-core.js at load and call time ───────
// Defined last so it can reference this module's data tables directly.
const PROVINCE = {
  code: 'AB',
  // ── Time ──
  lstOffset: 7,          // hours behind UTC for noon LST (MST) — the CFFDRS day
  localOffset: 6,        // hours behind UTC for local daylight time (MDT) — Today/Tomorrow, 16:00 peak burn
  noonUTC: 19,           // UTC hour of noon LST (CFFDRS observation hour)
  peakUTC: 22,           // UTC hour of 16:00 MDT peak burn
  tzLabel: 'MDT',        // local daylight-time label in UI / briefings
  tzName: 'America/Edmonton', // IANA zone for map popup obs times
  updatedLabel: 'obs',   // station 'updated' line: CWFIS obs date / peak-burn forecast / live time
  // ── Data tiers ──
  fetchPrimary: (lat, lng) => _fetchWeatherPrimaryAB(lat, lng),   // tier chain + pre-noon policy
  preNoonNWP: 'peak',    // Open-Meteo hour before noon: today's 16:00 peak-burn forecast
  cwfisNoCache: true,    // CWFIS station query sent with cache: 'no-cache'
  trimFeedProperties: true,  // request only the read properties from SWOB / hotspot feeds
  idwExtraFeatures: async (lat, lng) =>                            // IDW blend augmentation: AEF pmwx stations in AB
    (lat >= 48.8 && lat <= 60.5 && lng >= -120.5 && lng <= -109.5) ? fetchAEFStations() : [],
  idwDivergentDC: 'max', // divergent (≥ 75) DC in the IDW blend → highest floored chain DC
  prevSection: 'stations', prevTimeoutMs: 10000,                  // cwfis_prev.json section, fetch timeout
  naefsStations: NAEFS_AB_STATIONS,                                // NAEFS ensemble point list
  // ── Defaults / persistence ──
  defaultStation: { lat: 53.5, lng: -113.5, name: 'Edmonton' },   // module-level _station* before initFWI
  initDefaults: { lat: 53.5344, lng: -113.4903, name: 'Edmonton Area' }, // initFWI() default arguments
  holdKeyPrefix: 'fwi-cached-cwfis:',                              // per-station holding-cache key prefix
  storageKeys: { station: 'fwi-station', fuelA: 'fwi-fuel-type', fuelB: 'fwi-fuel-type-2', curing: 'fwi-grass-curing', ps: 'fwi-ps-percent' },
  fuelDefaults: { a: 'C2', b: 'D1' },                              // fuel pickers' fallback codes
  // ── Stations / regions ──
  stations: ALBERTA_STATIONS,                                      // picker / map / summary station list
  regions: REGIONS,                                                // regional representatives (trend table)
  stationSector: (lat, lng) => _stationSector(lat),                // latitude-band fire sector
  startupDC: STATION_STARTUP_DC, startupDCDefault: 300,            // cold-start DC zones, fallback
  sectorOrder: ['Far North', 'North', 'Central', 'Central-South', 'South'], // sector sort order
  pickerDefaultNames: ['Edmonton Blatchford', 'Edmonton'],         // picker placeholder before geolocation
  // ── Fuels / pin-drop ──
  stationFuel: (name, lat) => STATION_FUEL_TYPES[name] || _defaultFuelFor(lat), // station's FBP fuel (before leaf-state)
  autoFuelOnSelect: true,       // picking a station sets fuel A/B from the station table
  fuelSlashNotation: true,      // WMS "D-1/D-2" codes resolve to the part before "/"
  edmontonFuelRaster: true,     // pin-drop queries the Edmonton LiDAR fuel raster first
  pinMapCenter: [54.5, -115],   // pin-drop map view with no station selected
  csvSlug: 'alberta',           // regional CSV export filename part
  // ── Station map ──
  mapCenter: [54.5, -114.5],    // buildStationMap default centre
  mapBulkCWFIS: () => fetchAllCWFIS(), // one province-wide CWFIS query for all map stations
  mapRowErrors: true,           // failed stations get an ERR table row + popup
  // ── Forecast / D+1 ──
  highDangerFWI: 15.5,          // FWI where 'High' starts (forecast "days at risk")
  trendTableCount: 5,           // regions shown in the forecast trend table (first N)
  localDateLabels: false,       // Today/Tomorrow labels from the 16:00 clock (not the day's date)
  forecastCacheByStation: false, // D+1 forecast cache keyed on fuel/curing/PS only
  // ── Danger classes ──
  dangerRating: fwi => dangerRating(fwi),                          // CWFIS FWI-map 5-class
  dangerClassNum: fwi => dangerClassNum(fwi),                      // {num,label,bg,text} for briefing badges
  dangerClasses: ['Low', 'Moderate', 'High', 'Very High', 'Extreme'], // classes low → high (briefing tallies)
  dangerLegend: [                                                  // provincial briefing legend: label, colour, FWI, behaviour
    ['Low',       '#2d9e5f', '0–8',   'Isolated fires; initial attack effective'],
    ['Moderate',  '#2980b9', '9–17',  'Fires start easily; control feasible'],
    ['High',      '#f5c518', '18–32', 'Intense surface fire; difficult to control'],
    ['Very High', '#e67e22', '33–49', 'Spotting likely; indirect attack only'],
    ['Extreme',   '#c0392b', '≥ 50',  'Crown fire conditions; evacuate'],
  ],
  // ── Briefings ──
  briefingTitle: 'Pyra · Alberta Fire Weather Index — Provincial Briefing',
  briefingBounds: '[[49.0, -120.0], [60.0, -110.0]]',             // provincial briefing map fitBounds
  stationFallbackName: 'Alberta Station',                          // station briefing name when none loaded
  briefingEmptyColspan: 9,                                         // "forecast not loaded" row span
  exports: () => ({ ALBERTA_STATIONS }),                           // province extras on window.FWI
};
