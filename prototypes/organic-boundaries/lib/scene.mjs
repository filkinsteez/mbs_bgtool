// Ramp layers on top of the shared boundary model, CPU version.
// Positions are in frame heights: p = ((x + 0.5 - W/2) / H, (y + 0.5) / H).
//
// Base coordinate of a layer (recipe-specific): along an axis tilted by `tilt`
// degrees (0 = straight down) from `anchor`, e = across the axis, then
//   s0 = along + T(along) * e - 0.5 * B(along) * e^2 - sum_k P_k(u) * G_k(along)
// T and B are tilt and bend that may change down the ramp (knots); P_k are
// optional fixed profiles across the frame (u = x / W) with envelopes G_k down
// the ramp, for 1:1 shapes such as a particular hill line.
// Then s = s0 + D(e, s0) from the boundary model, and each transition j between
// colors j and j+1 is a step at m_j whose 10-90 width is w_j * soft_j(e).
// Colors mix in linear light; the bridge step pulls mixes of distant hues toward
// a lifted neutral. Layers after the first cover the ones below through a soft
// edge in their own warped coordinate (a land in front of the sky).

import { hexToLinear, luminance } from './color.mjs';
import { makeImage } from './image.mjs';
import { makeBoundaryField } from './boundary.mjs';
import { fbm } from './noise.mjs';

const LN81 = 2 * Math.log(9);
const ss = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function knotFn(knots) {
  const k = knots.slice().sort((x, y) => x[0] - y[0]);
  return (v) => {
    if (v <= k[0][0]) return k[0][1];
    for (let i = 0; i + 1 < k.length; i++) {
      if (v <= k[i + 1][0]) return k[i][1] + (k[i + 1][1] - k[i][1]) * ss((v - k[i][0]) / (k[i + 1][0] - k[i][0]));
    }
    return k[k.length - 1][1];
  };
}

// Catmull-Rom through [u, value] knots (C1, no flat spots at the knots)
function splineFn(knots) {
  const k = knots.slice().sort((x, y) => x[0] - y[0]);
  return (u) => {
    if (u <= k[0][0]) return k[0][1];
    if (u >= k[k.length - 1][0]) return k[k.length - 1][1];
    let i = 0;
    while (u > k[i + 1][0]) i++;
    const p0 = k[Math.max(0, i - 1)];
    const p1 = k[i];
    const p2 = k[i + 1];
    const p3 = k[Math.min(k.length - 1, i + 2)];
    const t = (u - p1[0]) / (p2[0] - p1[0]);
    const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0] || 1)) * (p2[0] - p1[0]);
    const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0] || 1)) * (p2[0] - p1[0]);
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
  };
}

function diskStep(x) {
  if (x <= -1) return 0;
  if (x >= 1) return 1;
  return 0.5 + (x * Math.sqrt(1 - x * x) + Math.asin(x)) / Math.PI;
}

const toLin = (list, gains) => list.map((c, i) => hexToLinear(c).map((v) => v * (gains?.[i] ?? 1)));

function prepareLayer(spec, w, h, seed) {
  const colors = toLin(spec.colors, spec.gains);
  const colorsLeft = spec.colorsLeft ? toLin(spec.colorsLeft, spec.gains) : null;
  const colorsRight = spec.colorsRight ? toLin(spec.colorsRight, spec.gains) : null;
  const stops = spec.stops.map((s) => ({
    at: s.at,
    width: Math.max(1e-4, s.width),
    profile: s.profile ?? 'logistic',
    soft: s.softKnots ? splineFn(s.softKnots) : null,
    bridge: s.bridge,
  }));
  const base = { tilt: 0, anchor: [0.5, 0], bend: 0, fanTilt: 0, fanBend: 0, ...(spec.base ?? {}) };
  const th = (base.tilt * Math.PI) / 180;
  const L = {
    w,
    h,
    colors,
    colorsLeft,
    colorsRight,
    lateralRatio: spec.lateralRatio ?? 1,
    stops,
    base: {
      ...base,
      d: [Math.sin(th), Math.cos(th)],
      e: [Math.cos(th), -Math.sin(th)],
      ax: (base.anchor[0] - 0.5) * (w / h),
      ay: base.anchor[1],
      bendAt: base.bendKnots ? knotFn(base.bendKnots) : null,
      tiltAt: base.tiltKnots ? knotFn(base.tiltKnots) : null,
      profiles: (base.profiles ?? []).map((p) => ({ P: splineFn(p.knots), G: knotFn(p.envelope ?? [[0, 1]]) })),
    },
    bridge: spec.bridge ?? null,
    softness: spec.softness ?? 1,
    lateral: spec.light?.lateral ?? null,
    mottle: spec.light?.mottle ? { seed: seed + 51, ...spec.light.mottle } : null,
    coverage: spec.coverage
      ? { ...spec.coverage, soft: spec.coverage.softKnots ? splineFn(spec.coverage.softKnots) : null }
      : null,
  };
  // range of (a, s0) over the frame, for the field's calibration, and a check
  // that the base coordinate itself is monotone down the frame
  let aMin = Infinity;
  let aMax = -Infinity;
  let sMin = Infinity;
  let sMax = -Infinity;
  let minRate = Infinity;
  for (let i = 0; i <= 32; i++) {
    let prev = null;
    for (let j = 0; j <= 64; j++) {
      const c = baseCoord(L, (i / 32) * w - 0.5, (j / 64) * h - 0.5);
      aMin = Math.min(aMin, c.a);
      aMax = Math.max(aMax, c.a);
      sMin = Math.min(sMin, c.s0);
      sMax = Math.max(sMax, c.s0);
      if (prev !== null) minRate = Math.min(minRate, ((c.s0 - prev) * 64) / (h / h));
      prev = c.s0;
    }
  }
  L.baseMinRate = minRate;
  const bp = { seed, ...(spec.boundary ?? {}) };
  if (bp.guard === 'transitions') {
    // s0 ranges where a fold would show: each transition +-1.5 widths, padded by
    // the largest requested wander (three spreads) and the softness variation
    const pad = 3 * Math.max(...(bp.wander ?? [[0, 0]]).map((k) => k[1]));
    const sv = Math.exp(2.5 * (bp.soft?.amount ?? 0));
    const edges = stops.map((st) => [st.at, st.width]);
    if (L.coverage) edges.push([L.coverage.at, L.coverage.width]);
    bp.guardZones = edges.map(([m, wd]) => [m - 1.5 * wd * sv - pad, m + 1.5 * wd * sv + pad]);
  }
  L.edgeMode = bp.mode === 'edges';
  if (L.edgeMode) {
    // edge i = stop i; the coverage edge, if any, comes last
    bp.edges = stops.map((st) => [st.at, st.width]);
    if (L.coverage) bp.edges.push([L.coverage.at, L.coverage.width]);
  }
  if (bp.lyMode === 'ramp') {
    bp.vOf = (s0) => {
      let u = 0;
      for (const st of stops) u += 1 / (1 + Math.exp((-LN81 * (s0 - st.at)) / st.width));
      return u;
    };
  }
  L.field = makeBoundaryField(bp, { aMin, aMax, sMin: sMin - 0.05, sMax: sMax + 0.05 });
  return L;
}

export function baseCoord(L, x, y) {
  const px = (x + 0.5 - L.w / 2) / L.h;
  const py = (y + 0.5) / L.h;
  const qx = px - L.base.ax;
  const qy = py - L.base.ay;
  const along = qx * L.base.d[0] + qy * L.base.d[1];
  const e = qx * L.base.e[0] + qy * L.base.e[1];
  const bend = L.base.bendAt ? L.base.bendAt(along) : L.base.bend + L.base.fanBend * along;
  const tilt = L.base.tiltAt ? L.base.tiltAt(along) : L.base.fanTilt * along;
  let s0 = along + tilt * e - 0.5 * bend * e * e;
  if (L.base.profiles.length) {
    const u = (x + 0.5) / L.w;
    for (const p of L.base.profiles) s0 -= p.P(u) * p.G(along);
  }
  return { a: e, s0, px };
}

function lateralColors(L, x) {
  if (!L.colorsRight) return L.colors;
  const u = Math.max(0, Math.min(1, (x + 0.5) / L.w));
  if (L.colorsLeft) {
    // left, center (colors), right; smooth in each half
    const [A, B, t] = u < 0.5 ? [L.colorsLeft, L.colors, ss(u / 0.5)] : [L.colors, L.colorsRight, ss((u - 0.5) / 0.5)];
    return A.map((c, i) => [0, 1, 2].map((q) => c[q] + (B[i][q] - c[q]) * t));
  }
  const k = L.lateralRatio;
  const wt = k === 1 ? u : (1 - k ** -u) / (1 - 1 / k);
  return L.colors.map((c, i) => [0, 1, 2].map((q) => c[q] + (L.colorsRight[i][q] - c[q]) * wt));
}

// One layer at pixel (x, y): linear color in out[0..2]; returns the warped s
function shadeLayer(L, x, y, out, sig) {
  const { a, s0, px } = baseCoord(L, x, y);
  const s = L.edgeMode ? s0 : s0 + L.field.warp(a, s0);
  const n = L.stops.length;
  const u = (x + 0.5) / L.w;
  for (let j = 0; j < n; j++) {
    const st = L.stops[j];
    const wj = st.width * L.field.softAt(a, st.at, st.width) * L.softness * (st.soft ? st.soft(u) : 1);
    const sw = L.edgeMode ? s0 + L.field.edgeWarp(a, j) : s;
    const sj = sw + L.field.feather(a, sw, st.at, wj, j);
    const xj = (sj - st.at) / wj;
    sig[j] = st.profile === 'disk' ? diskStep(xj * 1.04) : 1 / (1 + Math.exp(-LN81 * xj));
  }
  const colors = lateralColors(L, x);
  let r = 0;
  let g = 0;
  let b = 0;
  let wsum = 0;
  for (let i = 0; i <= n; i++) {
    const hi = i === 0 ? 1 : sig[i - 1];
    const lo = i === n ? 0 : sig[i];
    const wi = Math.max(0, hi - lo);
    if (wi <= 0) continue;
    const c = colors[i];
    r += wi * c[0];
    g += wi * c[1];
    b += wi * c[2];
    wsum += wi;
  }
  r /= wsum;
  g /= wsum;
  b /= wsum;
  if (L.bridge && L.bridge.pull) {
    // Bridge light, per transition: pull_j * min(1, V_j / ref) * 4 sig (1 - sig),
    // where V_j is the chromaticity variance halfway between the two colors of
    // transition j (|q_j - q_j+1|^2 / 4). Transitions can switch it off (bridge 0).
    let t = 0;
    for (let j = 0; j < n; j++) {
      const pj = L.stops[j].bridge ?? L.bridge.pull;
      if (!pj) continue;
      const ca = colors[j];
      const cb = colors[j + 1];
      const sa = ca[0] + ca[1] + ca[2] + 1e-6;
      const sb = cb[0] + cb[1] + cb[2] + 1e-6;
      let V = 0;
      for (let q = 0; q < 3; q++) V += (ca[q] / sa - cb[q] / sb) ** 2 / 4;
      t += pj * Math.min(1, V / (L.bridge.ref ?? 0.25)) * 4 * sig[j] * (1 - sig[j]);
    }
    t = Math.min(1, t);
    if (t > 0) {
      const lift = L.bridge.lift ?? 0.15;
      const Y0 = Math.min(1, luminance(r, g, b));
      // the lift raises the mix part of the way to white; dark mixes get less
      // of it (scaled by Y / 0.18), so an ink black next to red stays dark
      const Y = Y0 + lift * (1 - Y0) * Math.min(1, Y0 / 0.18);
      const tint = L.bridge.tint ?? [1, 1, 1];
      r += t * (Y * tint[0] - r);
      g += t * (Y * tint[1] - g);
      b += t * (Y * tint[2] - b);
    }
  }
  if (L.lateral) {
    const k = L.lateral.k ?? 0;
    const tint = L.lateral.tint ?? [1, 1, 1];
    r *= Math.exp(k * tint[0] * px);
    g *= Math.exp(k * tint[1] * px);
    b *= Math.exp(k * tint[2] * px);
  }
  if (L.mottle) {
    // slow light variation inside bands (the poster's round patches); not a boundary
    const py = (y + 0.5) / L.h;
    const m = 1 + L.mottle.amount * (fbm(px / L.mottle.scale + 3.1, py / L.mottle.scale + 7.7, 2, L.mottle.seed) / 0.34);
    r *= m;
    g *= m;
    b *= m;
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
  if (L.coverage) {
    const cv = L.coverage;
    const wc = cv.width * L.field.softAt(a, cv.at, cv.width) * (cv.soft ? cv.soft(u) : 1);
    const sc = L.edgeMode ? s0 + L.field.edgeWarp(a, L.stops.length) : s;
    out[3] = 1 / (1 + Math.exp((-LN81 * (sc - cv.at)) / wc));
  } else out[3] = 1;
  return s;
}

export function prepareScene(scene, w, h) {
  const seed = scene.seed ?? 1;
  const specs = scene.layers ?? [scene];
  const layers = specs.map((sp, k) => prepareLayer({ ...sp }, w, h, sp.seed ?? seed + 101 * k));
  return { w, h, layers };
}

export function renderScene(scene, w, h) {
  const P = prepareScene(scene, w, h);
  const img = makeImage(w, h);
  const coord = new Float32Array(w * h);
  const out = [0, 0, 0, 1];
  const sig = new Float64Array(32);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let r = 0;
      let g = 0;
      let b = 0;
      P.layers.forEach((L, k) => {
        const s = shadeLayer(L, x, y, out, sig);
        if (k === 0) coord[i] = s;
        const c = k === 0 ? 1 : out[3];
        r += (out[0] - r) * c;
        g += (out[1] - g) * c;
        b += (out[2] - b) * c;
      });
      img.ch[0][i] = r;
      img.ch[1][i] = g;
      img.ch[2][i] = b;
    }
  }
  const f = P.layers[0].field;
  return {
    img,
    coord,
    guard: { scale: f.guard, worstSlope: f.worstSlope, featherScale: f.featherGuard },
    baseMinRate: Math.min(...P.layers.map((L) => L.baseMinRate)),
  };
}
