/**
 * Independent reference implementation of CFFDRS FWI (Van Wagner & Pickett 1985,
 * FTR-33) and FBP (FCFDG 1992 ST-X-3; Wotton, Alexander & Taylor 2009 GLC-X-10).
 *
 * Ported line-for-line from the canonical `cffdrs` R package (CRAN mirror:
 * github.com/cran/cffdrs, R/rate_of_spread.r, R/surface_fuel_consumption.r,
 * R/CFBcalc.r, R/C6calc.r, R/foliar_moisture_content.r, R/buildup_effect.r,
 * R/fire_intensity.r, R/total_fuel_consumption.r) on 2026-06-10.
 *
 * This file is the test oracle. It must NEVER share code with fwi.js —
 * the whole point is that it is an independent derivation.
 */

// ─── FWI System (FTR-33) ─────────────────────────────────────────────────────

const DMC_LE = [0, 6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8.0, 7.0, 6.0];
const DC_LF  = [0, -1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6];

export function refFFMC(temp, rh, wind, rain, prev) {
  let mo = 147.2 * (101 - prev) / (59.5 + prev);
  if (rain > 0.5) {
    const rf = rain - 0.5;
    let mr = mo + 42.5 * rf * Math.exp(-100 / (251 - mo)) * (1 - Math.exp(-6.93 / rf));
    if (mo > 150) mr += 0.0015 * (mo - 150) ** 2 * Math.sqrt(rf);
    mo = Math.min(mr, 250);
  }
  const ed = 0.942 * rh ** 0.679 + 11 * Math.exp((rh - 100) / 10)
           + 0.18 * (21.1 - temp) * (1 - Math.exp(-0.115 * rh));
  let m;
  if (mo > ed) {
    const ko = 0.424 * (1 - (rh / 100) ** 1.7) + 0.0694 * Math.sqrt(wind) * (1 - (rh / 100) ** 8);
    const kd = ko * 0.581 * Math.exp(0.0365 * temp);
    m = ed + (mo - ed) * 10 ** -kd;
  } else {
    const ew = 0.618 * rh ** 0.753 + 10 * Math.exp((rh - 100) / 10)
             + 0.18 * (21.1 - temp) * (1 - Math.exp(-0.115 * rh));
    if (mo < ew) {
      const kl = 0.424 * (1 - ((100 - rh) / 100) ** 1.7)
               + 0.0694 * Math.sqrt(wind) * (1 - ((100 - rh) / 100) ** 8);
      const kw = kl * 0.581 * Math.exp(0.0365 * temp);
      m = ew - (ew - mo) * 10 ** -kw;
    } else m = mo;
  }
  return Math.max(0, Math.min(101, 59.5 * (250 - m) / (147.2 + m)));
}

export function refDMC(temp, rh, rain, month, prev) {
  let p = prev;
  if (rain > 1.5) {
    const re = 0.92 * rain - 1.27;
    const mo = 20 + Math.exp(5.6348 - p / 43.43);
    const b = p <= 33 ? 100 / (0.5 + 0.3 * p)
            : p <= 65 ? 14 - 1.3 * Math.log(p)
            : 6.2 * Math.log(p) - 17.2;
    const mr = mo + 1000 * re / (48.77 + b * re);
    p = Math.max(0, 244.72 - 43.43 * Math.log(mr - 20));
  }
  if (temp > -1.1) p += 1.894 * (temp + 1.1) * (100 - rh) * DMC_LE[month] * 1e-4;
  return Math.max(0, p);
}

export function refDC(temp, rain, month, prev) {
  let d = prev;
  if (rain > 2.8) {
    const rd = 0.83 * rain - 1.27;
    const qr = 800 * Math.exp(-d / 400) + 3.937 * rd;
    d = Math.max(0, 400 * Math.log(800 / qr));
  }
  const v = 0.36 * (Math.max(temp, -2.8) + 2.8) + DC_LF[month];
  d += 0.5 * Math.max(0, v);
  return Math.max(0, d);
}

// hourly_fine_fuel_moisture_code.r (Van Wagner 1977) — t0 = 1 h, with the
// engine's 147.2 conversion constant
export function refHFFMC(temp, rh, ws, prec, Fo) {
  let mo = 147.2 * (101 - Fo) / (59.5 + Fo);
  if (prec > 0) {
    let mr = mo + 42.5 * prec * Math.exp(-100 / (251 - mo)) * (1 - Math.exp(-6.93 / prec));
    if (mo > 150) mr += 0.0015 * (mo - 150) ** 2 * Math.sqrt(prec);
    mo = Math.min(mr, 250);
  }
  const ed = 0.942 * rh ** 0.679 + 11 * Math.exp((rh - 100) / 10)
           + 0.18 * (21.1 - temp) * (1 - Math.exp(-0.115 * rh));
  const ew = 0.618 * rh ** 0.753 + 10 * Math.exp((rh - 100) / 10)
           + 0.18 * (21.1 - temp) * (1 - Math.exp(-0.115 * rh));
  let m;
  if (mo > ed) {
    const ko = 0.424 * (1 - (rh / 100) ** 1.7) + 0.0694 * Math.sqrt(ws) * (1 - (rh / 100) ** 8);
    m = ed + (mo - ed) * 10 ** (-(ko * 0.0579 * Math.exp(0.0365 * temp)));
  } else if (mo < ew) {
    const k1 = 0.424 * (1 - ((100 - rh) / 100) ** 1.7) + 0.0694 * Math.sqrt(ws) * (1 - ((100 - rh) / 100) ** 8);
    m = ew - (ew - mo) * 10 ** (-(k1 * 0.0579 * Math.exp(0.0365 * temp)));
  } else m = mo;
  return Math.max(0, Math.min(101, 59.5 * (250 - m) / (147.2 + m)));
}

export function refISI(ffmc, wind) {
  const m = 147.2 * (101 - ffmc) / (59.5 + ffmc);
  const fF = 91.9 * Math.exp(-0.1386 * m) * (1 + m ** 5.31 / 4.93e7);
  return 0.208 * Math.exp(0.05039 * wind) * fF;
}

export function refBUI(dmc, dc) {
  if (dmc === 0 && dc === 0) return 0;
  return Math.max(0, dmc <= 0.4 * dc
    ? 0.8 * dmc * dc / (dmc + 0.4 * dc)
    : dmc - (1 - 0.8 * dc / (dmc + 0.4 * dc)) * (0.92 + (0.0114 * dmc) ** 1.7));
}

export function refFWI(isi, bui) {
  const fD = bui <= 80 ? 0.626 * bui ** 0.809 + 2 : 1000 / (25 + 108.64 * Math.exp(-0.023 * bui));
  const b = 0.1 * isi * fD;
  return b <= 1 ? b : Math.exp(2.72 * (0.434 * Math.log(b)) ** 0.647);
}

// ─── FBP System (ST-X-3 / GLC-X-10, via cffdrs) ─────────────────────────────

// rate_of_spread.r — a/b/c (M3: 120/0.0572/1.4, M4: 100/0.0404/1.48 per GLC-X-10)
const ROS_PARAMS = {
  C1: { a: 90,  b: 0.0649, c: 4.5 },  C2: { a: 110, b: 0.0282, c: 1.5 },
  C3: { a: 110, b: 0.0444, c: 3.0 },  C4: { a: 110, b: 0.0293, c: 1.5 },
  C5: { a: 30,  b: 0.0697, c: 4.0 },  C6: { a: 30,  b: 0.0800, c: 3.0 },
  C7: { a: 45,  b: 0.0305, c: 2.0 },  D1: { a: 30,  b: 0.0232, c: 1.6 },
  M3: { a: 120, b: 0.0572, c: 1.4 },  M4: { a: 100, b: 0.0404, c: 1.48 },
  S1: { a: 75,  b: 0.0297, c: 1.3 },  S2: { a: 40,  b: 0.0438, c: 1.7 },
  S3: { a: 55,  b: 0.0829, c: 3.2 },  O1a: { a: 190, b: 0.0310, c: 1.4 },
  O1b: { a: 250, b: 0.0350, c: 1.7 },
};

// buildup_effect.r — q / BUI0
const BE_PARAMS = {
  C1: { q: 0.90, bui0: 72 },  C2: { q: 0.70, bui0: 64 },  C3: { q: 0.75, bui0: 62 },
  C4: { q: 0.80, bui0: 66 },  C5: { q: 0.80, bui0: 56 },  C6: { q: 0.80, bui0: 62 },
  C7: { q: 0.85, bui0: 106 }, D1: { q: 0.90, bui0: 32 },  D2: { q: 0.90, bui0: 32 },
  M1: { q: 0.80, bui0: 50 },  M2: { q: 0.80, bui0: 50 },  M3: { q: 0.80, bui0: 50 },
  M4: { q: 0.80, bui0: 50 },  S1: { q: 0.75, bui0: 38 },  S2: { q: 0.75, bui0: 63 },
  S3: { q: 0.75, bui0: 31 },  O1a: { q: 1.0, bui0: 1 },   O1b: { q: 1.0, bui0: 1 },
};

// ST-X-3 Table 8 / GLC-X-10 — CBH (m), CFL (kg/m²)
const CROWN_PARAMS = {
  C1: { cbh: 2,  cfl: 0.75 }, C2: { cbh: 3,  cfl: 0.80 }, C3: { cbh: 8,  cfl: 1.15 },
  C4: { cbh: 4,  cfl: 1.20 }, C5: { cbh: 18, cfl: 1.20 }, C6: { cbh: 7,  cfl: 1.80 },
  C7: { cbh: 10, cfl: 0.50 }, M1: { cbh: 6,  cfl: 0.80 }, M2: { cbh: 6,  cfl: 0.80 },
  M3: { cbh: 6,  cfl: 0.80 }, M4: { cbh: 6,  cfl: 0.80 },
};

export function refBE(fuel, bui) {
  const p = BE_PARAMS[fuel];
  if (!p || bui <= 0 || p.bui0 <= 0) return 1;
  return Math.exp(50 * Math.log(p.q) * (1 / bui - 1 / p.bui0));
}

// surface_fuel_consumption.r
export function refSFC(fuel, ffmc, bui, pc = 50, gfl = 0.35) {
  let sfc;
  switch (fuel) {
    case 'C1':
      sfc = ffmc > 84
        ? 0.75 + 0.75 * Math.sqrt(1 - Math.exp(-0.23 * (ffmc - 84)))
        : 0.75 - 0.75 * Math.sqrt(1 - Math.exp(-0.23 * (84 - ffmc)));
      break;
    case 'C2': case 'M3': case 'M4':
      sfc = 5.0 * (1 - Math.exp(-0.0115 * bui)); break;
    case 'C3': case 'C4':
      sfc = 5.0 * (1 - Math.exp(-0.0164 * bui)) ** 2.24; break;
    case 'C5': case 'C6':
      sfc = 5.0 * (1 - Math.exp(-0.0149 * bui)) ** 2.48; break;
    case 'C7':
      sfc = (ffmc > 70 ? 2 * (1 - Math.exp(-0.104 * (ffmc - 70))) : 0)
          + 1.5 * (1 - Math.exp(-0.0201 * bui));
      break;
    case 'D1': case 'D2':
      sfc = 1.5 * (1 - Math.exp(-0.0183 * bui)); break;
    case 'M1': case 'M2':
      sfc = pc / 100 * (5.0 * (1 - Math.exp(-0.0115 * bui)))
          + (100 - pc) / 100 * (1.5 * (1 - Math.exp(-0.0183 * bui)));
      break;
    case 'O1a': case 'O1b':
      sfc = gfl; break;
    case 'S1':
      sfc = 4.0 * (1 - Math.exp(-0.025 * bui)) + 4.0 * (1 - Math.exp(-0.034 * bui)); break;
    case 'S2':
      sfc = 10.0 * (1 - Math.exp(-0.013 * bui)) + 6.0 * (1 - Math.exp(-0.060 * bui)); break;
    case 'S3':
      sfc = 12.0 * (1 - Math.exp(-0.0166 * bui)) + 20.0 * (1 - Math.exp(-0.0210 * bui)); break;
    default:
      sfc = 0;
  }
  return Math.max(sfc, 0.000001);
}

// foliar_moisture_content.r — ELV<=0 branch (no elevation data)
export function refFMC(lat, lng, dj) {
  const lonW = Math.abs(lng);                      // FCFDG longitude is °W positive
  const latn = 46 + 23.4 * Math.exp(-0.0360 * (150 - lonW));
  const d0 = Math.round(151 * (lat / latn));
  const nd = Math.abs(dj - d0);
  if (nd < 30) return 85 + 0.0189 * nd ** 2;
  if (nd < 50) return 32.9 + 3.17 * nd - 0.0288 * nd ** 2;
  return 120;
}

export function refCSI(fmc, cbh) {
  return 0.001 * cbh ** 1.5 * (460 + 25.9 * fmc) ** 1.5;
}
export function refRSO(csi, sfc) {
  return csi / (300 * sfc);
}
export function refCFBgeneric(ros, rso) {
  return ros > rso ? 1 - Math.exp(-0.23 * (ros - rso)) : 0;
}

function rsiBasic(fuel, isi) {
  const p = ROS_PARAMS[fuel];
  return p.a * (1 - Math.exp(-p.b * isi)) ** p.c;
}

/**
 * rate_of_spread_extended (cffdrs) — returns { ros, cfb, csi, rso } for any fuel.
 * cc = grass curing %, pc = percent conifer, pdf = percent dead fir.
 */
export function refROS(fuel, isi, bui, fmc, sfc, { pc = 50, pdf = 35, cc = 80 } = {}) {
  let rsi;
  if (fuel === 'M1') {
    rsi = pc / 100 * rsiBasic('C2', isi) + (100 - pc) / 100 * rsiBasic('D1', isi);
  } else if (fuel === 'M2') {
    rsi = pc / 100 * rsiBasic('C2', isi) + 0.2 * (100 - pc) / 100 * rsiBasic('D1', isi);
  } else if (fuel === 'M3') {
    rsi = pdf / 100 * rsiBasic('M3', isi) + (1 - pdf / 100) * rsiBasic('D1', isi);
  } else if (fuel === 'M4') {
    rsi = pdf / 100 * rsiBasic('M4', isi) + 0.2 * (1 - pdf / 100) * rsiBasic('D1', isi);
  } else if (fuel === 'O1a' || fuel === 'O1b') {
    const cf = cc < 58.8 ? 0.005 * (Math.exp(0.061 * cc) - 1) : 0.176 + 0.02 * (cc - 58.8);
    rsi = rsiBasic(fuel, isi) * cf;
  } else if (fuel === 'D2') {
    // GLC-X-10: D2 spreads only at BUI >= 80, at 0.2 × D1 rate
    rsi = bui >= 80 ? 0.2 * rsiBasic('D1', isi) : 0;
  } else if (fuel === 'C6') {
    rsi = 30 * (1 - Math.exp(-0.08 * isi)) ** 3.0;   // Eq. 62
  } else {
    rsi = rsiBasic(fuel, isi);
  }

  const crown = CROWN_PARAMS[fuel];
  const csi = crown ? refCSI(fmc, crown.cbh) : Infinity;
  const rso = crown ? refRSO(csi, sfc) : Infinity;

  let rss, cfb, ros;
  if (fuel === 'C6') {
    rss = rsi * refBE('C6', bui);                    // Eq. 63
    const fme = (1.5 - 0.00275 * fmc) ** 4 / (460 + 25.9 * fmc) * 1000;  // Eq. 61
    const rsc = 60 * (1 - Math.exp(-0.0497 * isi)) * fme / 0.778;        // Eq. 64
    cfb = (rsc > rss && rss > rso) ? refCFBgeneric(rss, rso) : 0;
    ros = rsc > rss ? rss + cfb * (rsc - rss) : rss; // Eq. 65
  } else {
    rss = rsi * refBE(fuel, bui);
    cfb = crown ? refCFBgeneric(rss, rso) : 0;
    ros = rss;
  }
  return { ros: Math.max(ros, 0.000001), cfb, csi, rso };
}

// total_fuel_consumption.r — CFC scaled by PC (M1/M2) or PDF (M3/M4)
export function refTFC(fuel, cfb, sfc, { pc = 50, pdf = 35 } = {}) {
  const crown = CROWN_PARAMS[fuel];
  let cfc = crown ? crown.cfl * cfb : 0;
  if (fuel === 'M1' || fuel === 'M2') cfc *= pc / 100;
  if (fuel === 'M3' || fuel === 'M4') cfc *= pdf / 100;
  return { cfc, tfc: sfc + cfc };
}

// fire_intensity.r — Eq. 69
export function refHFI(tfc, ros) {
  return 300 * tfc * ros;
}

export const REF_CROWN_PARAMS = CROWN_PARAMS;
export const REF_ROS_PARAMS = ROS_PARAMS;
export const REF_BE_PARAMS = BE_PARAMS;
