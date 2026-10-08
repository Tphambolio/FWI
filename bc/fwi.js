/**
 * Pyra FWI — British Columbia province module.
 *
 * Loaded BEFORE core/fwi-core.js. Defines the PROVINCE config read by the core,
 * plus genuinely BC-specific code: station lists, fuel table, BCWS noon-mirror
 * tier, BC danger classes, regional DC floors and startup DC zones. Do not call
 * core functions at the top level here — the core is not loaded yet.
 */

// Standalone BC app — province is fixed (window.FWI keeps the historical API).
function setProvince(p) {} // no-op in standalone BC build
function getProvince() { return 'BC'; }

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

/**
 * Correct a raw CWFIS DC that is the spring cold-start artifact (BC version).
 * Mirrors the AB applyDCFloor logic with BC-appropriate regional floors.
 * Only corrects when rawDC ≤ DC_COLDSTART_CEILING and within spring window (Mar–Jul).
 */
function applyDCFloor(rawDC, lat, lon) {
  if (rawDC == null) return { dc: rawDC, corrected: false };
  const mo = new Date(Date.now() - 8 * 3600000).getUTCMonth() + 1; // PST
  if (mo < 3 || mo > 7) return { dc: rawDC, corrected: false };
  if (lat == null || lon == null) return { dc: rawDC, corrected: false };
  if (lat < 48.0 || lat > 60.5 || lon < -140 || lon > -114) return { dc: rawDC, corrected: false };
  if (rawDC > DC_COLDSTART_CEILING) return { dc: rawDC, corrected: false };
  // BC regional startup floors — lower than AB due to higher precip / snowpack recharge.
  const floor = lat < 50.0 ? 50   // South coast / Okanagan
              : lat < 52.0 ? 75   // Thompson / Kootenay
              : lat < 56.0 ? 80   // Cariboo / Skeena
              : 60;                // NW boreal
  if (rawDC < floor) return { dc: floor, corrected: true };
  return { dc: rawDC, corrected: false };
}

// BC display classes — 5 classes, no "Very High", adds "Very Low".
// CAVEAT: this is a raw-FWI proxy of the BCWS station danger class. BCWS
// actually derives danger class from BUI×ISI danger-region tables (Lawson &
// Armitage 2008), so labels here can differ from official BCWS ratings.
function dangerRatingBC(fwi) {
  if (fwi <  5) return 'Very Low';
  if (fwi < 12) return 'Low';
  if (fwi < 21) return 'Moderate';
  if (fwi < 34) return 'High';
  return 'Extreme';
}

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
  // The Datamart CSV (www.for.gov.bc.ca) sends no CORS header, so browsers can't
  // read it. The daily Action mirrors today's noon-PST rows — the only rows that
  // carry the daily FWI codes — into data/bcws_noon.json. Only a mirror dated
  // today (PST) is used; earlier days are covered by the cwfis_prev carry-over.
  const today = _lstDateStr();
  if (_bcwsCache && _bcwsCacheDate === today) return _bcwsCache;
  if (_bcwsFetchPromise) return _bcwsFetchPromise; // dedupe concurrent callers

  _bcwsFetchPromise = (async () => {
    try {
      const res = await fetchWithTimeout(
        'https://raw.githubusercontent.com/Tphambolio/FWI/main/data/bcws_noon.json',
        { cache: 'no-cache' }, 10000
      );
      const data = await res.json();
      if (data?.date !== today || !data.stations) return null;
      const byCode = {};
      for (const [code, r] of Object.entries(data.stations)) {
        if (r.ffmc == null || r.dmc == null || r.dc == null) continue;
        const isi = r.isi ?? _isi(r.ffmc, r.wind ?? 0);
        const bui = r.bui ?? _bui(r.dmc, r.dc);
        byCode[code] = {
          _hour: 12,
          ffmc: r.ffmc, dmc: r.dmc, dc: r.dc,
          isi, bui, fwi: r.fwi ?? _fwi(isi, bui),
          temp: r.temp, rh: r.rh, wind: r.wind, wdir: r.wdir ?? null,
          rain: r.rain ?? 0,
          stationName: r.name,
          month: Number(today.slice(5, 7)),
          fwiFromCWFIS: true,
        };
      }
      _bcwsCache     = byCode;
      _bcwsCacheDate = today;
      return byCode;
    } catch (_) {
      return null;
    } finally {
      _bcwsFetchPromise = null;
    }
  })();
  return _bcwsFetchPromise;
}

/** BC 5-class number + print colours for briefing badges (BC counterpart of dangerClassNum). */
function _dangerClassNumBC(fwi) {
  const label = dangerRatingBC(fwi);
  const cl = PRINT_DANGER_COLORS[label] || PRINT_DANGER_COLORS['Moderate'];
  const num = ['Very Low', 'Low', 'Moderate', 'High', 'Extreme'].indexOf(label) + 1;
  return { num, label, bg: cl.bg, text: cl.text };
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

/**
 * BC map picker (PROVINCE.mapPick) — the tier rule of _fetchWeatherPrimaryBC
 * applied to the bulk data, so ~240 map stations need no per-station network:
 * today-dated BCWS (cached mirror) or CWFIS chain, nearest wins; otherwise the
 * latest CWFIS chain within 100 km (badged "CWFIS D-1" before noon, as on the
 * AB map). null → the map falls back to the per-station tier chain.
 */
async function _mapPickBC(features, lat, lng) {
  const today = _lstDateStr();
  const bcws = await fetchBCWSForCoords(lat, lng).catch(() => null);
  const cw = _selectCWFIS(features, lat, lng);
  const isToday = r => r?.fwiFromCWFIS && r.repDate && String(r.repDate).slice(0, 10) === today;
  const todays = [bcws, cw].filter(isToday).sort((a, b) => (a.distKm ?? 999) - (b.distKm ?? 999))[0];
  if (todays) return todays;
  return (cw?.fwiFromCWFIS && (cw.distKm ?? 999) <= 100) ? cw : null;
}

/**
 * BC tier chain (PROVINCE.fetchPrimary — core fetchWeatherPrimary delegates here).
 * Tier 0+1: BCWS noon mirror and CWFIS fetched in parallel. Only a chain dated
 * today (PST) counts — before noon CWFIS still serves yesterday's chain, which
 * initFWI steps forward via the dated carry-over instead. If both have today's
 * chain, the nearer station wins (deterministic; the old Promise.any took
 * whichever responded first). SWOB runs alongside for cross-validation: if the
 * chain station disagrees by > 8 °C with a close MSC station, the chain is kept
 * but SWOB weather is used.
 */
async function _fetchWeatherPrimaryBC(lat, lng) {
  if (!_idwMode) {
    try {
      const today = _lstDateStr();
      const [bcws, cwfis, swob] = await Promise.all([
        fetchBCWSForCoords(lat, lng).catch(() => null),
        fetchCWFIS(lat, lng, false).catch(() => null),
        fetchSWOB(lat, lng).catch(() => null),
      ]);
      const isToday = r => r?.fwiFromCWFIS && r.repDate && String(r.repDate).slice(0, 10) === today;
      const primary = [bcws, cwfis].filter(isToday)
        .sort((a, b) => (a.distKm ?? 999) - (b.distKm ?? 999))[0] || null;
      if (primary) return _swobCrossCheck(primary, swob);
      if (swob) return swob;
      // CWFIS weather-only obs from today (no codes) are still real observations
      if (cwfis && !cwfis.fwiFromCWFIS && cwfis.repDate && String(cwfis.repDate).slice(0, 10) === today) return cwfis;
    } catch (e) { /* fall through */ }
  } else {
    try {
      const cwfis = await fetchCWFIS(lat, lng, true);
      if (cwfis) return cwfis;
    } catch (e) { /* fall through */ }
  }
  try {
    const swob = await fetchSWOB(lat, lng);
    if (swob) return swob;
  } catch (e) { /* fall through */ }
  return fetchWeather(lat, lng);
}

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

// ─── Pin-Drop Fuel Lookup ─────────────────────────────────────────────────────

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

const BC_REGIONS = [
  { name: 'Terrace',        sector: 'Northwest Fire Centre',      lat: 54.47, lng: -128.58 },
  { name: 'Prince George',  sector: 'Prince George Fire Centre',  lat: 53.88, lng: -122.68 },
  { name: 'Williams Lake',  sector: 'Cariboo Fire Centre',        lat: 52.18, lng: -122.05 },
  { name: 'Kamloops',       sector: 'Kamloops Fire Centre',       lat: 50.70, lng: -120.45 },
  { name: 'Cranbrook',      sector: 'Southeast Fire Centre',      lat: 49.60, lng: -115.78 },
  { name: 'Campbell River', sector: 'Coastal Fire Centre',        lat: 50.02, lng: -125.27 },
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

// ─── Export ──────────────────────────────────────────────────────────────────

// ─── ICS Print Briefings ─────────────────────────────────────────────────────

// ─── P4: SCRIBE 48-hr FWI validation ────────────────────────────────────────
// NRCan SCRIBE gives pre-computed FWI for today / +24h / +48h at met stations.
// Sentinel value -101 means no data for that station (off-season or not computed).

// ─── P3: Active fires + satellite hotspot layers ─────────────────────────────

/** "YYYY-MM-DD" in Pacific Daylight Time (UTC−7) — BC name for the core's _localDateStr. */
function _pdtDateStr(ts) { return _localDateStr(ts); }

// ─── Province config — read by core/fwi-core.js at load and call time ───────
// Defined last so it can reference this module's data tables directly.
const PROVINCE = {
  code: 'BC',
  // ── Time ──
  lstOffset: 8,          // hours behind UTC for noon LST (PST) — the CFFDRS day
  localOffset: 7,        // hours behind UTC for local daylight time (PDT) — Today/Tomorrow, 16:00 peak burn
  noonUTC: 20,           // UTC hour of noon LST (CFFDRS observation hour)
  peakUTC: 23,           // UTC hour of 16:00 PDT peak burn
  tzLabel: 'PDT',        // local daylight-time label in UI / briefings
  tzName: 'America/Vancouver', // IANA zone for map popup obs times
  // ── Data tiers ──
  fetchPrimary: (lat, lng) => _fetchWeatherPrimaryBC(lat, lng),   // tier chain (BCWS ∥ CWFIS, date-checked)
  preNoonNWP: 'latest',  // Open-Meteo hour before noon: most recent available hour
  cwfisNoCache: false,   // CWFIS station query sent with default caching
  trimFeedProperties: false, // full SWOB / hotspot records
  idwExtraFeatures: async () => [],                                // no provincial IDW augmentation
  idwDivergentDC: 'nearest', // divergent (≥ 75) DC in the IDW blend → nearest chain station's DC
  prevSection: 'bcStations', prevTimeoutMs: 15000,                 // cwfis_prev.json section, fetch timeout
  naefsStations: NAEFS_BC_STATIONS,                                // NAEFS ensemble point list
  // ── Defaults / persistence ──
  defaultStation: { lat: 50.70, lng: -120.45, name: 'Kamloops' },  // module-level _station* before initFWI
  initDefaults: { lat: 50.70, lng: -120.45, name: 'Kamloops' },    // initFWI() default arguments
  holdKeyPrefix: 'bc-fwi-cached-cwfis:',                           // per-station holding-cache key prefix
  storageKeys: { station: 'bc-fwi-station', fuelA: 'fwi-bc-fuel-type', fuelB: 'fwi-bc-fuel-type-2', curing: 'bc-fwi-grass-curing', ps: 'bc-fwi-ps-percent' },
  fuelDefaults: { a: 'C3', b: 'C7' },                              // fuel pickers' fallback codes
  // ── Stations / regions ──
  stations: BC_STATIONS,                                           // picker / map / summary station list
  regions: BC_REGIONS,                                             // regional representatives (trend table)
  stationSector: (lat, lng) => _stationFireCentre(lat, lng),       // BC Fire Centre
  startupDC: BC_STATION_STARTUP_DC, startupDCDefault: 100,         // cold-start DC zones, fallback
  sectorOrder: ['Coastal', 'Kamloops', 'Cariboo', 'Prince George', 'Northwest', 'Southeast'], // fire-centre sort order
  pickerDefaultNames: ['Kamloops'],                                // picker placeholder before geolocation
  // ── Fuels / pin-drop ──
  stationFuel: (name, lat) => STATION_FUEL_TYPES[name] || 'C3',   // station's FBP fuel (before leaf-state)
  autoFuelOnSelect: false,      // picking a station keeps the user's fuel selection
  edmontonFuelRaster: false,    // no Edmonton LiDAR raster in BC
  pinMapCenter: [52.5, -122.5], // pin-drop map view with no station selected
  csvSlug: 'bc',                // regional CSV export filename part
  // ── Station map ──
  mapCenter: [52.5, -122.5],    // buildStationMap default centre
  mapBulkCWFIS: () => fetchAllCWFIS(), // one province-wide CWFIS query for all map stations
  cwfisBBox: [48.2, 60.05, -139.1, -114.0], // province-wide CWFIS query box [latMin, latMax, lonMin, lonMax]
  mapPick: (features, lat, lng) => _mapPickBC(features, lat, lng), // BC tier rule on bulk data
  // ── Forecast / D+1 ──
  highDangerFWI: 21,            // FWI where 'High' starts (forecast "days at risk")
  trendTableCount: undefined,   // regions shown in the forecast trend table (all)
  // ── Danger classes ──
  dangerRating: fwi => dangerRatingBC(fwi),                        // BC 5-class (Very Low … Extreme)
  dangerClassNum: fwi => _dangerClassNumBC(fwi),                   // {num,label,bg,text} for briefing badges
  dangerClasses: ['Very Low', 'Low', 'Moderate', 'High', 'Extreme'], // classes low → high (briefing tallies)
  dangerLegend: [                                                  // provincial briefing legend: label, colour, FWI, behaviour
    ['Very Low', '#a7f3d0', '0–4',   'Fuels wet; spread very unlikely'],
    ['Low',      '#4ae176', '5–11',  'Isolated fires; initial attack effective'],
    ['Moderate', '#7bd0ff', '12–20', 'Fires start easily; control feasible'],
    ['High',     '#f5c518', '21–33', 'Rapid spread; spotting; control difficult'],
    ['Extreme',  '#ef4444', '≥ 34',  'Crown fire conditions; evacuate structure zone'],
  ],
  // ── Briefings ──
  briefingTitle: 'Pyra · BC Wildfire FWI — Provincial Briefing',
  briefingBounds: '[[48.0, -140.0], [60.0, -114.0]]',             // provincial briefing map fitBounds
  stationFallbackName: 'BC Station',                               // station briefing name when none loaded
  exports: () => ({ dangerRatingBC, dangerRatingProv, BC_STATIONS, getStationList, stationSector, getRegions, setProvince, getProvince }),
};
