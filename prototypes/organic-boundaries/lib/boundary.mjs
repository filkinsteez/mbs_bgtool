// The shared boundary model. A recipe gives, per pixel, an along-boundary
// coordinate `a` and a base across coordinate `s0` (both in frame heights, s0
// increasing from the first color to the last). The model returns the warped
// coordinate s = s0 + D(a, s0), which every isoline of the recipe follows, a
// softness multiplier per boundary, and an optional fine feather per boundary.
// All noise is the engine's gradientNoise, so a seed gives the same field on the GPU.
//
//   D(a, s0) = E(s0) * M(a) * clip(cS * (S(a) - S_mean) + cI * I(a, v(s0)))
//   S  1D noise along the boundary, the same for every boundary (1-3 octaves)
//   I  2D noise stretched along the boundary, 1-3 octaves (gain `gain`, x
//      lacunarity 2, y lacunarity 1.5); v is s0 (distance mode) or the number of
//      transitions passed (ramp mode); points more than about 0.39 * ly apart in
//      v move independently
//   M  1 + amount * noise(a): the waviness comes and goes along the boundary
//   E  smooth (C1) envelope through knots down the ramp
//   clip  c * tanh(x / c): no rare deep extremes, flat stretches between rises
//
// The preset asks for the wander it wants: [[s0, std], ...], the standard
// deviation of the boundary position across the frame width, in frame heights,
// and `share`, the fraction of that variance all boundaries have in common. The
// CPU then (1) sets cS = sqrt(share) and cI = sqrt(1 - share) after scaling each
// term to unit spread over the calibration window, (2) sets each envelope knot so
// the realized wander there equals the request, and (3) scales everything down
// if the steepest negative slope dD/ds0 found on a grid over the frame is below
// -budget, so t stays monotone and isolines never cross (in edge mode: per-edge
// factors that keep neighbouring edges apart). The shader receives the numbers.

import { gradientNoise } from './noise.mjs';

// Measured on the engine's gradientNoise (tools/noise-bounds.mjs, fbm-bounds.mjs):
// RMS of the raw octave sum, and max |value| and max |d/dy| of the sum over its RMS.
export const FBM = {
  1: { rms: 0.3052, max: 3.215, slope: 9.476 },
  2: { rms: 0.3412, max: 4.01, slope: 12.659 },
  3: { rms: 0.3496, max: 4.007, slope: 14.753 },
};
export const NOISE_HALF_CORR = 0.39; // lattice units at which correlation is 0.5
const GAIN = 0.5;
const LACX = 2;
const LACY = 1.5;

const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function envelopeFn(knots) {
  const k = knots.slice().sort((x, y) => x[0] - y[0]);
  return (s0) => {
    if (s0 <= k[0][0]) return k[0][1];
    for (let i = 0; i + 1 < k.length; i++) {
      const [x0, v0] = k[i];
      const [x1, v1] = k[i + 1];
      if (s0 <= x1) return v0 + (v1 - v0) * smoothstep((s0 - x0) / (x1 - x0));
    }
    return k[k.length - 1][1];
  };
}

// Field terms with unit amplitudes (no calibration).
export function fieldTerms(p) {
  const seed = p.seed ?? 1;
  const octaves = p.octaves ?? 2;
  const gain = p.gain ?? GAIN;
  const sharedScale = p.sharedScale ?? 0.4;
  const scale = p.scale ?? 0.3;
  const ly = p.ly ?? 0.25;
  // vertical noise coordinate: distance down the ramp (s0), or, for stop-based
  // recipes, the number of transitions passed (p.vOf), so isolines inside one
  // transition wave together and the next transition gets its own shape
  const vOf = p.vOf ?? ((s0) => s0);
  const mod = { amount: 0, scale: 0.8, ...(p.alongMod ?? {}) };
  // both terms: octave 0 plus finer octaves along the boundary (the shared term
  // stays 1D, so all boundaries share its detail too)
  if (p.sine) {
    // one wavelength at one amplitude (failure demo only: reads as a sine wave)
    return {
      S: (a) => Math.sin((2 * Math.PI * a) / p.sine.wavelength + 0.7) * Math.SQRT2,
      I: () => 0,
      M: () => 1,
    };
  }
  return {
    S: (a) => {
      let sum = 0;
      let amp = 1;
      let fx = 1 / sharedScale;
      for (let o = 0; o < octaves; o++) {
        sum += amp * gradientNoise(a * fx + 0.37 + 2.9 * o, 0.5 + 4 * o, seed);
        amp *= gain;
        fx *= LACX;
      }
      return sum / FBM[1].rms;
    },
    I: (a, s0) => {
      let sum = 0;
      let amp = 1;
      let fx = 1 / scale;
      let fy = 1 / ly;
      const v = vOf(s0);
      for (let o = 0; o < octaves; o++) {
        sum += amp * gradientNoise(a * fx + 1.7 * o + 0.13, v * fy + 3.3 * o + 0.71, seed + 131 * (o + 1));
        amp *= gain;
        fx *= LACX;
        fy *= LACY;
      }
      return sum / FBM[1].rms;
    },
    M: (a) => {
      if (!mod.amount) return 1;
      const n = Math.max(-2.5, Math.min(2.5, gradientNoise(a / mod.scale + 0.31, 7.5, seed + 977) / FBM[1].rms));
      return Math.max(0, 1 + mod.amount * n);
    },
  };
}

// frame: { aMin, aMax, sMin, sMax }, the range of (a, s0) over the visible frame.
export function makeBoundaryField(p = {}, frame = { aMin: -0.9, aMax: 0.9, sMin: 0, sMax: 1 }) {
  const seed = p.seed ?? 1;
  const T = fieldTerms(p);
  const { aMin, aMax, sMin, sMax } = frame;
  const NA = 96;
  const NS = 240;
  const A = Array.from({ length: NA }, (_, i) => aMin + ((aMax - aMin) * (i + 0.5)) / NA);
  // Spreads are calibrated over at least p.calWidth (frame heights) of boundary,
  // centered on the frame: a tall frame then shows the middle of the same
  // pattern instead of a squeezed copy that needs steep slopes.
  const half = Math.max((aMax - aMin) / 2, (p.calWidth ?? 1.2) / 2);
  const aMid = (aMin + aMax) / 2;
  const AC = Array.from({ length: NA }, (_, i) => aMid - half + (2 * half * (i + 0.5)) / NA);
  const stdOf = (f) => {
    const v = AC.map(f);
    const m = v.reduce((s, x) => s + x, 0) / NA;
    return { m, sd: Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / NA) };
  };
  // (1) unit spread for each term over the frame
  const sS = stdOf(T.S);
  let i2 = 0;
  let rows = 0;
  for (let j = 0; j < NS; j += 8) {
    const s0 = sMin + ((sMax - sMin) * (j + 0.5)) / NS;
    i2 += stdOf((a) => T.I(a, s0)).sd ** 2;
    rows++;
  }
  const share = Math.max(0, Math.min(1, p.share ?? 0.5));
  const cS = Math.sqrt(share) / Math.max(0.33, sS.sd);
  const cI = Math.sqrt(1 - share) / Math.max(0.33, Math.sqrt(i2 / rows));
  const sMean = sS.m;
  // Soft clip at `clip` spreads: removes the rare deep extremes that read as
  // blobs, and gives flat stretches joined by steeper rises instead of a sine.
  const clip = p.clip ?? 0;
  const shape = clip > 0 ? (v) => clip * Math.tanh(v / clip) : (v) => v;
  const raw = (a, s0) => T.M(a) * shape(cS * (T.S(a) - sMean) + cI * T.I(a, s0));
  // (2) envelope knots so the realized wander at each knot equals the request
  const wander = p.wander ?? [[0, 0]];
  const knots = wander.map(([s0, sd]) => {
    const got = stdOf((a) => raw(a, s0)).sd;
    return [s0, got > 1e-6 ? sd / got : 0];
  });
  const E = envelopeFn(knots);
  // (3) fold guard from the steepest negative slope on a grid over the frame.
  // With p.guardZones ([lo, hi] ranges of s0 around each transition), only slopes
  // inside transitions count: inside a flat band the color is the same whichever
  // way the coordinate runs, so a fold there can't show.
  const zones = p.guardZones ?? null;
  const inZone = (s0) => !zones || zones.some(([lo, hi]) => s0 >= lo && s0 <= hi);
  const ds = (sMax - sMin) / NS;
  let minSlope = 0;
  for (const a of A) {
    let prev = E(sMin) * raw(a, sMin);
    for (let j = 1; j <= NS; j++) {
      const s0 = sMin + ds * j;
      const d = E(s0) * raw(a, s0);
      if (inZone(s0 - ds / 2)) minSlope = Math.min(minSlope, (d - prev) / ds);
      prev = d;
    }
  }
  const budget = p.slopeBudget ?? 0.75;
  let guard = -minSlope > budget * 0.9 ? (budget * 0.9) / -minSlope : 1;
  // Edge mode (bands): each transition j moves as a whole by f_j * D(a, m_j), so
  // nothing folds inside a transition. The guard then only keeps neighbouring
  // edges apart: their gap never drops below `minGap` of their mean width. Only
  // the edges of a pair that gets too close are scaled down (factor f_j).
  let edgeFactor = null;
  if (p.edges) {
    guard = 1;
    minSlope = 0;
    const minGap = p.minGap ?? 0.35;
    const order = p.edges.map((e, i) => i).sort((i, k) => p.edges[i][0] - p.edges[k][0]);
    const D = p.edges.map(([m]) => A.map((a) => E(m) * raw(a, m)));
    edgeFactor = p.edges.map(() => 1);
    for (let it = 0; it < 60; it++) {
      let ok = true;
      for (let q = 0; q + 1 < order.length; q++) {
        const i = order[q];
        const k = order[q + 1];
        const need = (minGap * (p.edges[i][1] + p.edges[k][1])) / 2;
        const gap0 = p.edges[k][0] - p.edges[i][0];
        if (gap0 <= need) continue;
        for (let s = 0; s < A.length; s++) {
          if (gap0 + edgeFactor[k] * D[k][s] - edgeFactor[i] * D[i][s] < need) {
            edgeFactor[i] *= 0.93;
            edgeFactor[k] *= 0.93;
            ok = false;
            break;
          }
        }
      }
      if (ok) break;
    }
  }

  const soft = { amount: 0, scale: 0.5, ly: 0.25, ...(p.soft ?? {}) };
  const feather = { amp: 0, scale: 0.03, ly: 2, ...(p.feather ?? {}) };
  // Feathering moves each boundary by a fraction of its own width with a noise
  // whose lattice is `ly` widths tall, so its slope is at most amp * 9.5 / ly for
  // any width. It has its own budget; both factors of ds/ds0 stay positive.
  const fWorst = (Math.abs(feather.amp) * FBM[1].slope) / feather.ly;
  const fGuard = fWorst > 0.5 ? 0.5 / fWorst : 1;

  return {
    calibration: { cS, cI, sMean, knots, guard, minSlope, worstSlope: -minSlope * guard },
    guard,
    worstSlope: -minSlope * guard,
    featherGuard: fGuard,
    edgeFactor,
    warp: (a, s0) => guard * E(s0) * raw(a, s0),
    // edge mode: displacement of edge i (index into p.edges)
    edgeWarp: (a, i) => edgeFactor[i] * E(p.edges[i][0]) * raw(a, p.edges[i][0]),
    // Softness multiplier for the boundary at base position m with width w. The
    // amount shrinks for transitions wider than soft.wRef: how far a soft ramp's
    // tail reaches scales with its width, so a wide sky ramp whose width changes
    // by 30% shows columns of color climbing higher (the measured wide sky
    // transitions change width by about 5%).
    softAt(a, m, w = 0) {
      if (!soft.amount) return 1;
      const amt = soft.wRef && w > soft.wRef ? (soft.amount * soft.wRef) / w : soft.amount;
      const n = Math.max(-2.5, Math.min(2.5, gradientNoise(a / soft.scale + 5.1, m / soft.ly + 2.3, seed + 577) / FBM[1].rms));
      return Math.exp(amt * n);
    },
    feather(a, s, m, w, j) {
      if (!feather.amp) return 0;
      const n = gradientNoise(a / feather.scale + 9.7 + 3.3 * j, (s - m) / (feather.ly * w) + 4.1, seed + 733 + 17 * j) / FBM[1].rms;
      return fGuard * feather.amp * w * n;
    },
  };
}
