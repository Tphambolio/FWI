/**
 * Pyra FWI — British Columbia province module.
 *
 * Loaded BEFORE core/fwi-core.js. Defines the PROVINCE config read by the core,
 * plus genuinely BC-specific code: station lists, fuel table, BCWS noon-mirror
 * tier, BC danger classes, regional DC floors and startup DC zones. Do not call
 * core functions at the top level here — the core is not loaded yet.
 */



// Standalone BC app — province is hardcoded. No localStorage, no province switching.
const _province = 'BC';
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
}/**
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

// ─── Export ──────────────────────────────────────────────────────────────────


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
      const chainStart = (_lastFWI?.ffmc != null) ? {
        ffmc: _lastFWI.ffmc,
        dmc:  _lastFWI.dmc,
        dc:   applyDCFloor(_lastFWI.dc ?? getStartupDC(_stationName), _stationLat, _stationLng).dc,
        obsDate: _lastFWI._obsDate ?? null,
      } : null;
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
  const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const fmc = calcFMC(lat, lng, doy);

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
  const srcLabel = (w?.stationName && (w?.source || '').startsWith('CWFIS'))
    ? `CWFIS · ${w.stationName}` : (w?.source || 'Open-Meteo NWP');

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
    const br = (srcType === 'CWFIS' || srcType === 'CWFIS D-1' || srcType === 'BCWS') ? 3 : srcType === 'SWOB' ? 8 : sz.r;
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

  // Fetch data and update each marker as it arrives
  for (const s of getStationList()) {
    try {
      const w = await fetchWeatherPrimary(s.lat, s.lng);

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
      const fuelCode = _seasonalFuel(STATION_FUEL_TYPES[s.name] || 'C3', s.lat);
      const fbp      = calculateFBP(fuelCode, r.ffmc, r.dmc, r.dc, w.wind ?? 10, 0, _savedCuring());
      // BCWS chains also set fwiFromCWFIS — check the chain's actual source first
      const chainSrc = w.chainSource || w.source || '';
      const srcBadge = chainSrc.startsWith('BCWS') ? 'BCWS'
                     : w.fwiFromCWFIS ? (cwfisPrevDay ? 'CWFIS D-1' : 'CWFIS')
                     : (w.source?.startsWith('MSC') ? 'SWOB' : 'NWP');

      // Use actual station coords from data response if available; otherwise keep nominal
      const stnLat = w.stationLat ?? s.lat;
      const stnLng = w.stationLng ?? s.lng;

      // Row link must use NOMINAL picker coords (navLat/navLng), not the
      // CWFIS-corrected sensor coords, or station_detail resolves to the wrong
      // station. Marker still moves to the sensor position.
      _mapStationCache.push({ name: s.name, lat: stnLat, lng: stnLng, navLat: s.lat, navLng: s.lng, result: r, fbp, srcBadge });
      _updateStationTableRow({ name: s.name, lat: stnLat, lng: stnLng, navLat: s.lat, navLng: s.lng, result: r, fbp, srcBadge });

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
      // CWFIS rep_date is a date stamp (T12:00Z), not a clock time
      const obsTs = w.repDate
        ? new Date(String(w.repDate).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' noon LST' + (cwfisPrevDay ? ' (previous day)' : '')
        : rawTs
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
          const cp = cachedPrevEntry;
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
        .bindPopup(`<b>${_esc(f.firename || 'Active Fire')}</b><br>${ha >= 1 ? ha.toLocaleString('en-CA',{maximumFractionDigits:0}) + ' ha' : '&lt; 1 ha'}<br><small>${_esc(f.stage_of_control || '')} · ${_esc(f.agency?.toUpperCase() || '')}</small>`)
        .addTo(activeFiresLayer);
    });
  });

  // Hotspots layer
  const hotspotsLayer = L.layerGroup();
  fetchHotspots().then(spots => {
    spots.forEach(h => {
      const hfiTip = h.hfi != null ? `<br>HFI: ${Math.round(h.hfi).toLocaleString()} kW/m` : '';
      L.circleMarker([h.lat, h.lon], { radius: 4, fillColor: '#ff8c00', color: '#ffaa44', weight: 1, fillOpacity: 0.8 })
        .bindPopup(`<b>Satellite Hotspot</b><br><small>${_esc(h.satellite || h.sensor || '')}</small>${hfiTip}`)
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



// ─── P3: Active fires + satellite hotspot layers ─────────────────────────────



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
  // Find today and tomorrow indices using PDT dates
  const _nowPDT     = _pdtDateStr();
  const todayIdx    = days.findIndex(d => d._ts && _pdtDateStr(d._ts) === _nowPDT);
  const tomorrowIdx = days.findIndex(d => d._ts && _pdtDateStr(d._ts) > _nowPDT);

  // Populate LEFT card (today peak burn). Use _lastWeather (fetchWeatherPrimary)
  // for the display — it's already the peak burn forecast (pre-noon) or real obs
  // (post-noon). NAEFS daily max-T is biased high and not suitable for same-day display.
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
    const todayFBPA = (_lastFWI?.ffmc != null) ? results[todayIdx]  : null;
    const todayFBPB = (_lastFWI?.ffmc != null) ? resultsB?.[todayIdx] : null;
    populateTodaySection('-a', todayFBPA);
    populateTodaySection('-b', todayFBPB);
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
  updatedLabel: 'live',  // station 'updated' line: always "Live · <time>"
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
  fuelSlashNotation: false,     // WMS "D-1/D-2" codes are not resolved (null)
  edmontonFuelRaster: false,    // no Edmonton LiDAR raster in BC
  pinMapCenter: [52.5, -122.5], // pin-drop map view with no station selected
  csvSlug: 'bc',                // regional CSV export filename part
  // ── Danger classes ──
  dangerRating: fwi => dangerRatingBC(fwi),                        // BC 5-class (Very Low … Extreme)
  exports: () => ({ dangerRatingBC, dangerRatingProv, BC_STATIONS, getStationList, stationSector, getRegions, setProvince, getProvince }),
};
