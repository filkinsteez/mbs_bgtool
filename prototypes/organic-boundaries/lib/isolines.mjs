// Isolines of a ramp coordinate t(x, y) and the boundary numbers measured on them.

import { smooth1d } from './blur.mjs';

// Height of the level-`level` isoline in every column, for boundaries that run
// across the frame. Soft count of pixels with t below the level: equal to the
// crossing for monotone t, and a robust average where small noise wiggles it.
// NaN where the column never crosses the level. Also returns how many separate
// crossings each column has (with hysteresis); more than one means a fold.
export function columnCrossings(T, level, opts = {}) {
  const { w, h, t } = T;
  const eps = opts.eps ?? 0.004;
  const hyst = opts.hyst ?? 0.01;
  const y = new Float64Array(w);
  const folds = new Uint8Array(w);
  for (let x = 0; x < w; x++) {
    let s = 0;
    let state = 0;
    let crossings = 0;
    for (let yy = 0; yy < h; yy++) {
      const v = t[yy * w + x];
      const u = (level - v) / eps + 0.5;
      s += u <= 0 ? 0 : u >= 1 ? 1 : u;
      const st = v < level - hyst ? -1 : v > level + hyst ? 1 : 0;
      if (st !== 0 && st !== state) {
        if (state !== 0) crossings++;
        state = st;
      }
    }
    y[x] = s < 0.5 || s > h - 0.5 ? NaN : s;
    folds[x] = crossings;
  }
  return { y, folds };
}

// Marching squares on t; returns polylines in pixel coordinates (pixel centers
// at +0.5). Used for drawing and for boundaries that are not functions of x.
export function traceIsolines(T, level) {
  const { w, h, t } = T;
  const segs = [];
  const P = (x, y) => [x + 0.5, y + 0.5];
  const lerp = (a, b, va, vb) => {
    const f = (level - va) / (vb - va);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  };
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const v0 = t[y * w + x];
      const v1 = t[y * w + x + 1];
      const v2 = t[(y + 1) * w + x + 1];
      const v3 = t[(y + 1) * w + x];
      const c = (v0 > level ? 1 : 0) | (v1 > level ? 2 : 0) | (v2 > level ? 4 : 0) | (v3 > level ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const p0 = P(x, y);
      const p1 = P(x + 1, y);
      const p2 = P(x + 1, y + 1);
      const p3 = P(x, y + 1);
      const eT = () => lerp(p0, p1, v0, v1);
      const eR = () => lerp(p1, p2, v1, v2);
      const eB = () => lerp(p3, p2, v3, v2);
      const eL = () => lerp(p0, p3, v0, v3);
      const add = (a, b) => segs.push([a, b]);
      switch (c) {
        case 1: case 14: add(eL(), eT()); break;
        case 2: case 13: add(eT(), eR()); break;
        case 3: case 12: add(eL(), eR()); break;
        case 4: case 11: add(eR(), eB()); break;
        case 6: case 9: add(eT(), eB()); break;
        case 7: case 8: add(eL(), eB()); break;
        case 5: {
          const m = (v0 + v1 + v2 + v3) / 4;
          if (m > level) { add(eL(), eB()); add(eT(), eR()); } else { add(eL(), eT()); add(eR(), eB()); }
          break;
        }
        case 10: {
          const m = (v0 + v1 + v2 + v3) / 4;
          if (m > level) { add(eL(), eT()); add(eR(), eB()); } else { add(eL(), eB()); add(eT(), eR()); }
          break;
        }
        default: break;
      }
    }
  }
  return joinSegments(segs);
}

function joinSegments(segs) {
  const key = (p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  const ends = new Map();
  const used = new Uint8Array(segs.length);
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  const lines = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line = [segs[i][0], segs[i][1]];
    for (const dir of [1, 0]) {
      for (;;) {
        const tip = dir ? line[line.length - 1] : line[0];
        const cand = (ends.get(key(tip)) ?? []).find((j) => !used[j]);
        if (cand === undefined) break;
        used[cand] = 1;
        const s = segs[cand];
        const next = key(s[0]) === key(tip) ? s[1] : s[0];
        if (dir) line.push(next);
        else line.unshift(next);
      }
    }
    lines.push(line);
  }
  return lines;
}

// ---------------------------------------------------------------- statistics

export function validRange(y) {
  let a = 0;
  while (a < y.length && !Number.isFinite(y[a])) a++;
  let b = y.length - 1;
  while (b > a && !Number.isFinite(y[b])) b--;
  return [a, b];
}

function polyfit(xs, ys, deg) {
  const n = deg + 1;
  const M = Array.from({ length: n }, () => new Float64Array(n + 1));
  for (let i = 0; i < xs.length; i++) {
    const p = [];
    for (let k = 0; k < n; k++) p.push(xs[i] ** k);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) M[r][c] += p[r] * p[c];
      M[r][n] += p[r] * ys[i];
    }
  }
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return Array.from({ length: n }, (_, k) => M[k][n] / M[k][k]);
}

// DCT-II amplitudes of a sampled curve: r(i) = sum_k a_k cos(pi k (i + 0.5) / n).
// Component k has wavelength 2n / k samples.
export function dct(r) {
  const n = r.length;
  const K = Math.min(n, 64);
  const a = new Float64Array(K);
  for (let k = 1; k < K; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += r[i] * Math.cos((Math.PI * k * (i + 0.5)) / n);
    a[k] = (2 / n) * s;
  }
  return a;
}

function resample(v, m) {
  const out = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const f = ((i + 0.5) / m) * v.length - 0.5;
    const a = Math.max(0, Math.min(v.length - 1, Math.floor(f)));
    const b = Math.min(v.length - 1, a + 1);
    out[i] = v[a] + (v[b] - v[a]) * (f - a);
  }
  return out;
}

function corr(a, b) {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= a.length;
  mb /= b.length;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < a.length; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb || 1e-12);
}

function rms(v) {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s / v.length);
}

// Lag (in samples) where the autocorrelation first drops below 0.5.
function halfCorrLag(r) {
  const n = r.length;
  let s0 = 0;
  for (const v of r) s0 += v * v;
  if (s0 <= 0) return NaN;
  for (let lag = 1; lag < n / 2; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += r[i] * r[i + lag];
    s /= (n - lag) / n;
    if (s / s0 < 0.5) return lag;
  }
  return n / 2;
}

// Geometry of one boundary y(x) (pixels). Returns numbers in % of frame height
// (H) and fractions of frame width (W).
export function boundaryGeometry(y, w, h) {
  const [a, b] = validRange(y);
  const xs = [];
  const ys = [];
  for (let x = a; x <= b; x++) if (Number.isFinite(y[x])) {
    xs.push((x + 0.5 - w / 2) / (w / 2));
    ys.push(y[x]);
  }
  if (xs.length < w * 0.25) return null;
  const mean = ys.reduce((s, v) => s + v, 0) / ys.length;
  const lin = polyfit(xs, ys, 1);
  const quad = polyfit(xs, ys, 2);
  const resid = ys.map((v, i) => v - (quad[0] + quad[1] * xs[i] + quad[2] * xs[i] ** 2));
  const detr = ys.map((v, i) => v - (lin[0] + lin[1] * xs[i]));
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = xs.length / w;
  // spectrum of the tilt-removed curve on 256 samples over the valid span
  const r = resample(detr, 256);
  const amp = dct(r);
  const comps = [];
  for (let k = 1; k < amp.length; k++) comps.push({ k, lambdaW: (2 * span) / k, ampH: (Math.abs(amp[k]) / h) * 100 });
  const bandRms = (lo, hi) => {
    let s = 0;
    for (const c of comps) if (c.lambdaW <= hi && c.lambdaW > lo) s += (c.ampH * c.ampH) / 2;
    return Math.sqrt(s);
  };
  const top = comps.filter((c) => c.k >= 2).sort((p, q) => q.ampH - p.ampH).slice(0, 3);
  // curvature of the curve smoothed over 1% of the width
  const ysm = smooth1d(Float64Array.from(ys), Math.max(2, w * 0.01));
  let k2 = 0;
  let kmax = 0;
  let nk = 0;
  for (let i = 2; i < ysm.length - 2; i++) {
    const d1 = (ysm[i + 1] - ysm[i - 1]) / 2;
    const d2 = ysm[i + 1] - 2 * ysm[i] + ysm[i - 1];
    const kap = (d2 / (1 + d1 * d1) ** 1.5) * h;
    k2 += kap * kap;
    kmax = Math.max(kmax, Math.abs(kap));
    nk++;
  }
  const lagPx = halfCorrLag(resid) * ((b - a + 1) / xs.length);
  const pct = (v) => (v / h) * 100;
  return {
    span,
    meanH: pct(mean),
    rangeH: pct(max - min),
    rmsH: pct(rms(ys.map((v) => v - mean))),
    tiltH: pct(lin[1] * 2),
    bowH: pct(quad[2]),
    wiggleRmsH: pct(rms(resid)),
    wigglePpH: pct(Math.max(...resid) - Math.min(...resid)),
    bands: {
      gt1W: bandRms(1, 99),
      w05to1: bandRms(0.5, 1),
      w025to05: bandRms(0.25, 0.5),
      w01to025: bandRms(0.1, 0.25),
      lt01W: bandRms(0, 0.1),
    },
    dominant: top.map((c) => ({ lambdaW: +c.lambdaW.toFixed(3), ampH: +c.ampH.toFixed(2) })),
    curvRmsPerH: Math.sqrt(k2 / Math.max(1, nk)),
    curvMaxPerH: kmax,
    corrLenW: lagPx / w,
    resid,
    xs,
  };
}

// 10-90 width along a boundary, perpendicular to it, from the 10% and 90% isolines.
export function widthAlong(y10, y50, y90, w) {
  const out = new Float64Array(w).fill(NaN);
  const ysm = smooth1d(y50, Math.max(2, w * 0.01));
  for (let x = 1; x < w - 1; x++) {
    if (!Number.isFinite(y10[x] + y90[x] + ysm[x - 1] + ysm[x + 1])) continue;
    const slope = (ysm[x + 1] - ysm[x - 1]) / 2;
    out[x] = Math.abs(y90[x] - y10[x]) / Math.sqrt(1 + slope * slope);
  }
  return out;
}

export function widthStats(wv, y50, w, h) {
  const sm = smooth1d(wv, Math.max(2, w * 0.01));
  const vals = [];
  const pos = [];
  for (let x = 0; x < w; x++) if (Number.isFinite(sm[x])) {
    vals.push(sm[x]);
    pos.push(y50[x]);
  }
  if (vals.length < w * 0.25) return null;
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = rms(vals.map((v) => v - mean));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const rel = vals.map((v) => v / mean - 1);
  const amp = dct(resample(rel, 256));
  let kBest = 1;
  for (let k = 1; k < amp.length; k++) if (Math.abs(amp[k]) > Math.abs(amp[kBest])) kBest = k;
  const span = vals.length / w;
  return {
    meanH: (mean / h) * 100,
    minH: (min / h) * 100,
    maxH: (max / h) * 100,
    minOverMax: min / max,
    cv: sd / mean,
    varLambdaW: (2 * span) / kBest,
    corrLenW: halfCorrLag(rel) / w,
    corrWithPos: corr(vals, pos),
  };
}

// Relation between two boundaries over their common columns.
export function pairStats(ya, yb, w, h) {
  const xs = [];
  const A = [];
  const B = [];
  for (let x = 0; x < w; x++) if (Number.isFinite(ya[x]) && Number.isFinite(yb[x])) {
    xs.push((x + 0.5 - w / 2) / (w / 2));
    A.push(ya[x]);
    B.push(yb[x]);
  }
  if (xs.length < w * 0.25) return null;
  const qa = polyfit(xs, A, 2);
  const qb = polyfit(xs, B, 2);
  const ra = A.map((v, i) => v - (qa[0] + qa[1] * xs[i] + qa[2] * xs[i] ** 2));
  const rb = B.map((v, i) => v - (qb[0] + qb[1] * xs[i] + qb[2] * xs[i] ** 2));
  const sp = B.map((v, i) => v - A[i]);
  const ms = sp.reduce((s, v) => s + v, 0) / sp.length;
  return {
    sepH: (ms / h) * 100,
    corrFull: corr(A, B),
    corrWiggle: corr(ra, rb),
    spacingCv: rms(sp.map((v) => v - ms)) / Math.abs(ms),
    spacingMinOverMax: Math.min(...sp.map(Math.abs)) / Math.max(...sp.map(Math.abs)),
    ampRatio: rms(rb) / Math.max(1e-9, rms(ra)),
  };
}

// Fine feathering: what is left of a boundary after smoothing it over `scale`
// of the frame width, in pixels.
export function fineResidual(y, w, scale = 0.02) {
  const sm = smooth1d(y, Math.max(1, w * scale));
  const r = [];
  for (let x = 0; x < w; x++) if (Number.isFinite(y[x]) && Number.isFinite(sm[x])) r.push(y[x] - sm[x]);
  return r.length ? rms(r) : NaN;
}
