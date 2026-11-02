// Single scattering (plus a multiple scattering table) in a spherical-shell
// atmosphere with an air layer (scale height 8 km), a haze layer (scale
// height hazeHeight) and an ozone layer. Three ways to use the palette:
//
// - bandMedium: one channel per palette color ("spectral band"); Rayleigh
//   extinction falls geometrically over the palette order. The image is the
//   sum of band radiance times band color.
// - spectraMedium: three linear RGB channels whose scattering and extinction
//   spectra come from the palette (sky color, warm color, haze color).
// - twoLightMedium: sky light and warm light are carried separately so their
//   colors only add, never multiply (see the section below).
//
// Lengths are in km. Lookup tables (all map to small GPU textures):
// - optical depth per unit coefficient for the Rayleigh, Mie and ozone
//   density profiles, by radius and sun zenith cosine (fixed, built once);
// - multiple scattering per channel (Hillaire 2020 isotropic approximation),
//   by altitude and sun zenith cosine (rebuilt when the medium changes).

import { hexToLinear } from "./color.mjs";

export const EARTH_R = 6360;
export const TOP_R = 6460;
const H_R = 8.0;
let H_M = 1.2;

// Mie (haze) scale height in km. The optical depth table depends on it.
export function setHazeHeight(h) {
  H_M = h;
}
const OZONE_CENTER = 25;
const OZONE_HALF_WIDTH = 15;
const SUN_RADIUS = 0.0047;
const RAYLEIGH_BLUE = 33.1e-3;
const MIE_BASE = 3.996e-3;

export function densityR(z) {
  return Math.exp(-z / H_R);
}
export function densityM(z) {
  return Math.exp(-z / H_M);
}
export function densityO(z) {
  return Math.max(0, 1 - Math.abs(z - OZONE_CENTER) / OZONE_HALF_WIDTH);
}

// Ozone (Chappuis band) absorption per km at peak layer density over the
// band position t (0 = first palette color, 1 = last). With the physical
// spread this roughly matches the usual RGB values (0.65, 1.88, 0.085) e-3.
function chappuis(t) {
  const d = (t - 0.62) / 0.31;
  return 2.0e-3 * Math.exp(-d * d);
}
const OZONE_RGB = [0.65e-3, 1.881e-3, 0.085e-3];

// Air scattering has two parts: scaR (lit by the per-channel transmitted
// sunlight) and scaRsky (lit by the luminance of the transmitted sunlight).
function emptyMedium(n, mieG) {
  return {
    count: n,
    scaR: new Float64Array(n),
    scaRsky: new Float64Array(n),
    extR: new Float64Array(n),
    scaM: new Float64Array(n),
    extM: new Float64Array(n),
    absO: new Float64Array(n),
    sun: new Float64Array(n),
    mieG,
  };
}

// Band b sits at position t = b / (count - 1). Rayleigh extinction falls
// geometrically from the first band to the last by the factor `spread`
// (5.7 is Earth's 440 nm to 680 nm ratio). Mie falls with spread^(t/8),
// which matches an Angstrom exponent of 0.5 at the physical spread.
export function bandMedium(count, params) {
  const { air = 1, haze = 1, ozone = 1, spread = 5.7, mieG = 0.8, weights } = params;
  const m = emptyMedium(count, mieG);
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0.5;
    m.scaR[i] = air * RAYLEIGH_BLUE * Math.pow(spread, -t);
    m.extR[i] = m.scaR[i];
    m.scaM[i] = haze * MIE_BASE * Math.pow(spread, -t / 8);
    m.extM[i] = m.scaM[i] / 0.9;
    m.absO[i] = ozone * chappuis(t);
    m.sun[i] = weights?.[i] ?? 1;
  }
  return m;
}

// params: air (air density), redden (depth of the warm chain), haze (haze
// density), airWarmth, ozone, mieG, airModel. roles: { sky, warm, haze }.
//
// The haze (low, scale height hazeHeight) scatters with the haze color; its
// extinction is (1 + redden * K) per unit haze depth with K = -ln(warm), so
// sunlight after haze depth tau has the color e^(-tau) * warm^(redden * tau):
// the warm color's own Beer-Lambert chain (pale tint -> warm -> deep, dark).
//
// airModel "split" (default): a share (1 - airWarmth) of the air scatters
// light of the sky color, lit by the luminance of the transmitted sunlight;
// the share airWarmth scatters the transmitted sunlight with its own color.
// Skylight and warm light then add instead of multiply. The air's extinction
// is gray plus reddenAir times the warm chain.
// airModel "physical": the air scatters and extinguishes with the sky color's
// spectrum, lit by the per-channel sunlight (sky color times reddened sun).
export function spectraMedium(roles, params) {
  const {
    air = 1,
    redden = 1,
    reddenAir = 0,
    haze = 1,
    ozone = 0,
    mieG = 0.8,
    airWarmth = 0.25,
    airModel = "split",
  } = params;
  const m = emptyMedium(3, mieG);
  const sky = hexToLinear(roles.sky);
  const skyMax = Math.max(...sky, 1e-6);
  const skyN = sky.map((c) => c / skyMax);
  const skyLum = 0.2126 * skyN[0] + 0.7152 * skyN[1] + 0.0722 * skyN[2];
  const warm = roles.warm ? hexToLinear(roles.warm) : [1, 0.42, 0.12];
  const hz = roles.haze ? hexToLinear(roles.haze) : [1, 1, 1];
  const hzMax = Math.max(...hz, 1e-6);
  const beta = air * RAYLEIGH_BLUE;
  for (let c = 0; c < 3; c++) {
    const K = -Math.log(Math.max(warm[c], 1e-3));
    if (airModel === "physical") {
      m.scaR[c] = beta * skyN[c];
      m.extR[c] = m.scaR[c];
    } else {
      m.scaRsky[c] = beta * (1 - airWarmth) * skyN[c];
      m.scaR[c] = beta * airWarmth * skyLum;
      m.extR[c] = beta * skyLum * (1 + reddenAir * K);
    }
    m.scaM[c] = haze * MIE_BASE * (hz[c] / hzMax);
    m.extM[c] = haze * MIE_BASE * (1 + redden * K);
    m.absO[c] = ozone * OZONE_RGB[c];
    m.sun[c] = 1;
  }
  m.sunGray = params.sunGray ?? 0;
  m.extRMean = (m.extR[0] + m.extR[1] + m.extR[2]) / 3;
  return m;
}

export function rayleighPhase(c) {
  return (3 / (16 * Math.PI)) * (1 + c * c);
}

export function miePhase(c, g) {
  const g2 = g * g;
  const k = (3 / (8 * Math.PI)) * ((1 - g2) / (2 + g2));
  return (k * (1 + c * c)) / Math.pow(1 + g2 - 2 * g * c, 1.5);
}

// Distance from radius r along direction with zenith cosine mu to the sphere
// of radius R2 (outward hit). Returns -1 if none.
function rayToSphere(r, mu, R2) {
  const disc = r * r * (mu * mu - 1) + R2 * R2;
  if (disc < 0) return -1;
  return -r * mu + Math.sqrt(disc);
}
function rayToGround(r, mu) {
  if (mu >= 0) return -1;
  const disc = r * r * (mu * mu - 1) + EARTH_R * EARTH_R;
  if (disc < 0) return -1;
  return -r * mu - Math.sqrt(disc);
}

export function horizonMu(r) {
  const s = EARTH_R / Math.max(r, EARTH_R);
  return -Math.sqrt(Math.max(0, 1 - s * s));
}

// ---- Optical depth table ------------------------------------------------

const OD_NR = 64;
const OD_NMU = 256;

function odIndexR(r) {
  return Math.sqrt(Math.max(0, Math.min(1, (r - EARTH_R) / (TOP_R - EARTH_R))));
}

export function buildOpticalDepthTable() {
  const table = new Float32Array(OD_NR * OD_NMU * 3);
  const steps = 160;
  for (let ir = 0; ir < OD_NR; ir++) {
    const xr = ir / (OD_NR - 1);
    const r = EARTH_R + xr * xr * (TOP_R - EARTH_R);
    const muH = horizonMu(r);
    for (let im = 0; im < OD_NMU; im++) {
      const xm = im / (OD_NMU - 1);
      const mu = muH + xm * xm * (1 - muH);
      const tTop = rayToSphere(r, mu, TOP_R);
      // The densest point is the start (mu >= 0) or the tangent point.
      const tLow = mu < 0 ? Math.min(tTop, -r * mu) : 0;
      let odR = 0;
      let odM = 0;
      let odO = 0;
      const segs = tLow > 0 ? [[tLow, 0], [tLow, tTop]] : [[0, tTop]];
      for (const [a, b] of segs) {
        // Quadratic spacing from a (dense end) toward b.
        let prev = a;
        let prevVals = sampleOD(r, mu, a);
        for (let k = 1; k <= steps; k++) {
          const f = k / steps;
          const t = a + (b - a) * f * f;
          const vals = sampleOD(r, mu, t);
          const dt = Math.abs(t - prev);
          odR += 0.5 * (vals[0] + prevVals[0]) * dt;
          odM += 0.5 * (vals[1] + prevVals[1]) * dt;
          odO += 0.5 * (vals[2] + prevVals[2]) * dt;
          prev = t;
          prevVals = vals;
        }
      }
      const o = (ir * OD_NMU + im) * 3;
      table[o] = odR;
      table[o + 1] = odM;
      table[o + 2] = odO;
    }
  }
  return table;
}

function sampleOD(r, mu, t) {
  const rr = Math.sqrt(t * t + 2 * r * mu * t + r * r);
  const z = Math.max(0, rr - EARTH_R);
  return [densityR(z), densityM(z), densityO(z)];
}

// Optical depth toward the sun from radius r with sun zenith cosine mu,
// written into out[0..2]. Returns the sun visibility (0..1) for the Earth's
// shadow, softened over the sun's disc.
export function sunOpticalDepth(table, r, mu, out) {
  const muH = horizonMu(r);
  // Elevation of the sun above the local geometric horizon.
  const e = Math.asin(Math.max(-1, Math.min(1, mu))) - Math.asin(muH);
  let vis = (e + SUN_RADIUS) / (2 * SUN_RADIUS);
  vis = vis <= 0 ? 0 : vis >= 1 ? 1 : vis * vis * (3 - 2 * vis);
  const muC = Math.max(mu, muH);
  const fr = odIndexR(r) * (OD_NR - 1);
  const fm = Math.sqrt(Math.max(0, Math.min(1, (muC - muH) / (1 - muH)))) * (OD_NMU - 1);
  const ir = Math.min(OD_NR - 2, Math.floor(fr));
  const im = Math.min(OD_NMU - 2, Math.floor(fm));
  const ar = fr - ir;
  const am = fm - im;
  for (let c = 0; c < 3; c++) {
    const v00 = table[(ir * OD_NMU + im) * 3 + c];
    const v01 = table[(ir * OD_NMU + im + 1) * 3 + c];
    const v10 = table[((ir + 1) * OD_NMU + im) * 3 + c];
    const v11 = table[((ir + 1) * OD_NMU + im + 1) * 3 + c];
    out[c] = (v00 * (1 - am) + v01 * am) * (1 - ar) + (v10 * (1 - am) + v11 * am) * ar;
  }
  return vis;
}

// sunGray blends the air's extinction along the sun path toward its channel
// mean, so sunlight stays near white while view paths keep per-channel
// extinction (the saturation sequence instead of the band-pass sequence).
function sunTransmittance(m, b, od, vis) {
  const eR = m.sunGray ? m.extR[b] + m.sunGray * (m.extRMean - m.extR[b]) : m.extR[b];
  return vis * Math.exp(-(eR * od[0] + m.extM[b] * od[1] + m.absO[b] * od[2]));
}

// Fills tSun (per channel sunlight transmittance) and returns the luminance
// of the transmitted sunlight (what the sky-colored air share is lit by).
function sunLight(m, od, vis, tSun) {
  const n = m.count;
  for (let b = 0; b < n; b++) tSun[b] = sunTransmittance(m, b, od, vis);
  return n === 3 ? 0.2126 * tSun[0] + 0.7152 * tSun[1] + 0.0722 * tSun[2] : 0;
}

// ---- Multiple scattering table (per channel) ----------------------------

const MS_NZ = 32;
const MS_NMU = 32;

export function buildMultiScatterTable(m, odTable, groundAlbedo = 0.1) {
  const n = m.count;
  const table = new Float32Array(MS_NZ * MS_NMU * n);
  const dirs = 64;
  const steps = 20;
  const od = [0, 0, 0];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const L2 = new Float64Array(n);
  const fms = new Float64Array(n);
  const T = new Float64Array(n);
  const tSun = new Float64Array(n);
  const albedo = Array.isArray(groundAlbedo) ? groundAlbedo : new Array(n).fill(groundAlbedo);
  for (let iz = 0; iz < MS_NZ; iz++) {
    const z = ((iz + 0.5) / MS_NZ) ** 2 * (TOP_R - EARTH_R);
    const r = EARTH_R + z;
    for (let im = 0; im < MS_NMU; im++) {
      const muS = -1 + (2 * (im + 0.5)) / MS_NMU;
      const sx = Math.sqrt(1 - muS * muS);
      L2.fill(0);
      fms.fill(0);
      for (let d = 0; d < dirs; d++) {
        const vy = 1 - (2 * (d + 0.5)) / dirs;
        const rad = Math.sqrt(1 - vy * vy);
        const phi = d * golden;
        const vx = Math.cos(phi) * rad;
        const vs = vx * sx + vy * muS;
        const tG = rayToGround(r, vy);
        const tEnd = tG > 0 ? tG : rayToSphere(r, vy, TOP_R);
        T.fill(1);
        for (let k = 0; k < steps; k++) {
          const t = tEnd * ((k + 0.5) / steps);
          const dt = tEnd / steps;
          const rr = Math.sqrt(t * t + 2 * r * vy * t + r * r);
          const zz = Math.max(0, rr - EARTH_R);
          const dR = densityR(zz);
          const dM = densityM(zz);
          const dO = densityO(zz);
          const mu = (r * muS + t * vs) / rr;
          const vis = sunOpticalDepth(odTable, rr, mu, od);
          const y = sunLight(m, od, vis, tSun);
          for (let b = 0; b < n; b++) {
            const sR = m.scaR[b] * dR;
            const sRs = m.scaRsky[b] * dR;
            const sM = m.scaM[b] * dM;
            const st = m.extR[b] * dR + m.extM[b] * dM + m.absO[b] * dO;
            const tStep = Math.exp(-st * dt);
            const integ = st > 0 ? (1 - tStep) / st : dt;
            L2[b] += T[b] * ((sR + sM) * tSun[b] + sRs * y) * integ * m.sun[b] * (1 / (4 * Math.PI));
            fms[b] += T[b] * (sR + sRs + sM) * integ;
            T[b] *= tStep;
          }
        }
        if (tG > 0) {
          const muG = (r * muS + tEnd * vs) / EARTH_R;
          const vis = sunOpticalDepth(odTable, EARTH_R, muG, od);
          sunLight(m, od, vis, tSun);
          for (let b = 0; b < n; b++) {
            L2[b] += T[b] * tSun[b] * Math.max(0, muG) * (albedo[b] / Math.PI) * m.sun[b];
          }
        }
      }
      for (let b = 0; b < n; b++) {
        const l2 = L2[b] / dirs;
        const f = fms[b] / dirs;
        table[(iz * MS_NMU + im) * n + b] = l2 / Math.max(1e-4, 1 - f);
      }
    }
  }
  return table;
}

// Multiple scattering radiance for all channels at radius r and sun zenith
// cosine mu, written into out.
export function multiScatter(table, n, r, mu, out) {
  const z = Math.max(0, r - EARTH_R);
  const fz = Math.sqrt(Math.min(1, z / (TOP_R - EARTH_R))) * MS_NZ - 0.5;
  const fm = ((mu + 1) / 2) * MS_NMU - 0.5;
  const iz = Math.max(0, Math.min(MS_NZ - 2, Math.floor(fz)));
  const im = Math.max(0, Math.min(MS_NMU - 2, Math.floor(fm)));
  const az = Math.max(0, Math.min(1, fz - iz));
  const am = Math.max(0, Math.min(1, fm - im));
  for (let b = 0; b < n; b++) {
    const v00 = table[(iz * MS_NMU + im) * n + b];
    const v01 = table[(iz * MS_NMU + im + 1) * n + b];
    const v10 = table[((iz + 1) * MS_NMU + im) * n + b];
    const v11 = table[((iz + 1) * MS_NMU + im + 1) * n + b];
    out[b] = (v00 * (1 - am) + v01 * am) * (1 - az) + (v10 * (1 - am) + v11 * am) * az;
  }
}

// ---- Two-light mode -------------------------------------------------------
//
// Two light components that never multiply each other's colors:
// - sky light: the air scatters the sky color, lit by the luminance of the
//   transmitted sunlight; along the view path it is dimmed by the air with the
//   sky color's own spectrum (so long paths saturate toward white) and by the
//   haze only in gray. Multiple scattering adds to it as an isotropic fill.
// - warm light: the haze (and a share airWarmth of the air) scatters
//   sunlight whose color is the warm color's Beer-Lambert chain; along the
//   view path it is dimmed by the haze with that chain and by the air in gray.
// The sun path is gray through the air and follows the warm chain in the haze.

export function twoLightMedium(roles, params) {
  const {
    air = 1,
    redden = 1,
    haze = 1,
    mieG = 0.8,
    mieGSpread = 0,
    airWarmth = 0.25,
    skySat = 1,
    hazeChain = 1,
  } = params;
  const sky = hexToLinear(roles.sky);
  const skyMax = Math.max(...sky, 1e-6);
  const skyN = sky.map((c) => c / skyMax);
  const skyLum = 0.2126 * skyN[0] + 0.7152 * skyN[1] + 0.0722 * skyN[2];
  const warm = roles.warm ? hexToLinear(roles.warm) : [1, 0.42, 0.12];
  const K = warm.map((c) => -Math.log(Math.max(c, 1e-3)));
  const Kmean = 0.2126 * K[0] + 0.7152 * K[1] + 0.0722 * K[2];
  const hz = roles.haze ? hexToLinear(roles.haze) : [1, 1, 1];
  const hzMax = Math.max(...hz, 1e-6);
  const beta = air * RAYLEIGH_BLUE;
  const bm = haze * MIE_BASE;
  return {
    twoLight: true,
    count: 3,
    mieG,
    // Per-channel forward-peak width: with mieGSpread > 0 red spreads wider
    // than blue around the sun, as in diffraction by uniform particles
    // (a bluish-white centre with yellow, orange and red rings).
    mieGc: [0, 1, 2].map((c) => Math.max(-0.95, Math.min(0.97, mieG + mieGSpread * (c - 1)))),
    skyN,
    // Scattering.
    skySca: skyN.map((c) => beta * (1 - airWarmth) * c),
    warmAirSca: beta * airWarmth * skyLum,
    hazeSca: hz.map((c) => (bm * c) / hzMax),
    // Gray totals.
    airExtGray: beta * skyLum,
    hazeExtGray: bm * (1 + redden * Kmean),
    // Per-channel: air extinction seen by sky light, haze extinction seen by
    // the warm light and by the sun.
    airExtSky: skyN.map((c) => beta * (skyLum + skySat * (c - skyLum))),
    hazeExtWarm: K.map((k) => bm * (1 + redden * (Kmean + hazeChain * (k - Kmean)))),
  };
}

// Gray medium for the multiple scattering table of the two-light mode.
export function twoLightGrayMedium(m) {
  const g = emptyMedium(1, m.mieG);
  g.scaR[0] = m.skySca.reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0) + m.warmAirSca;
  g.extR[0] = m.airExtGray;
  g.scaM[0] = m.hazeSca.reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  g.extM[0] = m.hazeExtGray;
  g.sun[0] = 1;
  return g;
}

export function viewRayTwoLight(ctx, r0, vx, vy, vz, sx, sy, sz, maxDist, out, scratch) {
  const { medium: m, odTable, msTable, steps, groundAlbedo, msScale } = ctx;
  const od = scratch.od;
  const ms = scratch.ms;
  const vs = vx * sx + vy * sy + vz * sz;
  const pR = rayleighPhase(vs);
  const pMc = m.mieGc.map((g) => miePhase(vs, g));
  const tG = rayToGround(r0, vy);
  let tEnd = tG > 0 ? tG : rayToSphere(r0, vy, TOP_R);
  let hitsSurface = tG > 0;
  if (maxDist > 0 && maxDist < tEnd) {
    tEnd = maxDist;
    hitsSurface = true;
  }
  const Tsky = [1, 1, 1];
  const Twarm = [1, 1, 1];
  const sun = [0, 0, 0];
  let Lr = 0;
  let Lg = 0;
  let Lb = 0;
  let prev = 0;
  for (let k = 0; k < steps; k++) {
    const f = (k + 1) / steps;
    const t1 = tEnd * f * f;
    const t = 0.5 * (prev + t1);
    const dt = t1 - prev;
    prev = t1;
    const rr = Math.sqrt(t * t + 2 * r0 * vy * t + r0 * r0);
    const z = Math.max(0, rr - EARTH_R);
    const dR = densityR(z);
    const dM = densityM(z);
    const mu = (r0 * sy + t * vs) / rr;
    const vis = sunOpticalDepth(odTable, rr, mu, od);
    multiScatter(msTable, 1, rr, mu, ms);
    const airOD = m.airExtGray * od[0];
    for (let c = 0; c < 3; c++) sun[c] = vis * Math.exp(-(airOD + m.hazeExtWarm[c] * od[1]));
    const y = 0.2126 * sun[0] + 0.7152 * sun[1] + 0.0722 * sun[2];
    const msv = ms[0] * msScale;
    // The haze's multiple scattering keeps the color of the light it
    // scatters: the local sunlight chain where lit, the sky color in shadow.
    const wl = y / (y + 1e-3);
    for (let c = 0; c < 3; c++) {
      const sSky = m.skySca[c] * dR;
      const srcSky = sSky * (pR * y + msv);
      const msColor = wl * (sun[c] / Math.max(y, 1e-6)) + (1 - wl) * m.skyN[c];
      const srcWarm =
        (m.warmAirSca * dR * pR + m.hazeSca[c] * dM * pMc[c]) * sun[c] + m.hazeSca[c] * dM * msv * msColor;
      const eSky = m.airExtSky[c] * dR + m.hazeExtGray * dM;
      const eWarm = m.airExtGray * dR + m.hazeExtWarm[c] * dM;
      const tsS = Math.exp(-eSky * dt);
      const tsW = Math.exp(-eWarm * dt);
      const iS = eSky > 0 ? (1 - tsS) / eSky : dt;
      const iW = eWarm > 0 ? (1 - tsW) / eWarm : dt;
      const add = Tsky[c] * srcSky * iS + Twarm[c] * srcWarm * iW;
      if (c === 0) Lr += add;
      else if (c === 1) Lg += add;
      else Lb += add;
      Tsky[c] *= tsS;
      Twarm[c] *= tsW;
    }
  }
  out[0] = Lr;
  out[1] = Lg;
  out[2] = Lb;
  if (hitsSurface) {
    const xg = tEnd * vx;
    const yg = r0 + tEnd * vy;
    const zg = tEnd * vz;
    const rg = Math.sqrt(xg * xg + yg * yg + zg * zg);
    const muG = (xg * sx + yg * sy + zg * sz) / rg;
    const vis = sunOpticalDepth(odTable, rg, muG, od);
    multiScatter(msTable, 1, rg, muG, ms);
    const airOD = m.airExtGray * od[0];
    for (let c = 0; c < 3; c++) {
      const s = vis * Math.exp(-(airOD + m.hazeExtWarm[c] * od[1]));
      const a = Array.isArray(groundAlbedo) ? groundAlbedo[c] : groundAlbedo;
      // Ground lit by sunlight (warm) and by sky-colored skylight.
      const E = s * Math.max(0, muG) * Twarm[c] + Math.PI * ms[0] * msScale * m.skyN[c] * Tsky[c];
      out[c] += (a / Math.PI) * E;
    }
  }
}

// ---- View ray -------------------------------------------------------------

// Integrates single + multiple scattering along a view ray from radius r0
// with direction (vx, vy, vz) (y up), sun direction (sx, sy, sz). If
// maxDist > 0 the ray stops there (terrain) and adds ground radiance.
// Writes per-channel radiance into out. scratch: { T, ms, od } arrays.
export function viewRay(ctx, r0, vx, vy, vz, sx, sy, sz, maxDist, out, scratch) {
  const { medium: m, odTable, msTable, steps, groundAlbedo, msScale } = ctx;
  const n = m.count;
  const { T, ms, od } = scratch;
  scratch.tSun ??= new Float64Array(n);
  const { tSun } = scratch;
  const vs = vx * sx + vy * sy + vz * sz;
  const pR = rayleighPhase(vs);
  const pM = miePhase(vs, m.mieG);
  const tG = rayToGround(r0, vy);
  let tEnd = tG > 0 ? tG : rayToSphere(r0, vy, TOP_R);
  let hitsSurface = tG > 0;
  if (maxDist > 0 && maxDist < tEnd) {
    tEnd = maxDist;
    hitsSurface = true;
  }
  for (let b = 0; b < n; b++) {
    out[b] = 0;
    T[b] = 1;
  }
  let prev = 0;
  for (let k = 0; k < steps; k++) {
    const f = (k + 1) / steps;
    const t1 = tEnd * f * f;
    const t = 0.5 * (prev + t1);
    const dt = t1 - prev;
    prev = t1;
    const rr = Math.sqrt(t * t + 2 * r0 * vy * t + r0 * r0);
    const z = Math.max(0, rr - EARTH_R);
    const dR = densityR(z);
    const dM = densityM(z);
    const dO = densityO(z);
    const mu = (r0 * sy + t * vs) / rr;
    const vis = sunOpticalDepth(odTable, rr, mu, od);
    multiScatter(msTable, n, rr, mu, ms);
    const y = sunLight(m, od, vis, tSun);
    for (let b = 0; b < n; b++) {
      const sR = m.scaR[b] * dR;
      const sRs = m.scaRsky[b] * dR;
      const sM = m.scaM[b] * dM;
      const st = m.extR[b] * dR + m.extM[b] * dM + m.absO[b] * dO;
      const S =
        m.sun[b] * ((sR * tSun[b] + sRs * y) * pR + sM * pM * tSun[b]) + (sR + sRs + sM) * ms[b] * msScale;
      const tStep = Math.exp(-st * dt);
      const integ = st > 0 ? (1 - tStep) / st : dt;
      out[b] += T[b] * S * integ;
      T[b] *= tStep;
    }
  }
  if (hitsSurface) {
    // Lambertian ground lit by the sun (if visible) and by the multiple
    // scattering radiance as a stand-in for skylight.
    const xg = tEnd * vx;
    const yg = r0 + tEnd * vy;
    const zg = tEnd * vz;
    const rg = Math.sqrt(xg * xg + yg * yg + zg * zg);
    const muG = (xg * sx + yg * sy + zg * sz) / rg;
    const vis = sunOpticalDepth(odTable, rg, muG, od);
    multiScatter(msTable, n, rg, muG, ms);
    sunLight(m, od, vis, tSun);
    for (let b = 0; b < n; b++) {
      const E = m.sun[b] * tSun[b] * Math.max(0, muG) + Math.PI * ms[b] * msScale;
      const a = Array.isArray(groundAlbedo) ? groundAlbedo[b] : groundAlbedo;
      out[b] += T[b] * (a / Math.PI) * E;
    }
  }
}
