// Boundary audit: ramp coordinate, isolines and boundary numbers for one image.
// The same function measures a reference and a render; for a render, pass the
// reference's color path so both get the same t.

import { blurImage, smooth1d } from './blur.mjs';
import { fillMasked } from './refs.mjs';
import { buildPath, projectToPath, pathTAt } from './rampcoord.mjs';
import { columnCrossings, boundaryGeometry, widthAlong, widthStats, pairStats, fineResidual } from './isolines.mjs';
import { transitions } from './config.mjs';

export const EQUAL_LEVELS = Array.from({ length: 14 }, (_, k) => (k + 0.5) / 14);

export function rampCoordinate(img, mask, cfg, path = null, blur = 6, opts = {}) {
  const filled = mask ? fillMasked(img, mask) : img;
  let b = blurImage(filled, blur);
  let gain = null;
  if (opts.removeGain ?? cfg.gain) {
    gain = lateralGain(b);
    b = applyGain(b, gain);
  }
  const p = path ?? buildPath(b, { angle: cfg.angle, band: cfg.band, prepend: cfg.prepend, append: cfg.append }, mask);
  const T = projectToPath(b, p, { window: cfg.window });
  return { T, path: p, blurred: b, gain };
}

// Smooth left-to-right brightness gain, for images whose notes describe one
// (light from an off-frame sun that multiplies every height alike). Per column,
// the median over rows of luminance relative to the central columns, then a
// quadratic fit of its log across the width. A gain changes lightness, not hue,
// so dividing it out leaves the color boundaries where they are.
export function lateralGain(img) {
  const { w, h } = img;
  const Y = (i) => 0.2126 * img.ch[0][i] + 0.7152 * img.ch[1][i] + 0.0722 * img.ch[2][i];
  const c0 = Math.floor(w * 0.48);
  const c1 = Math.ceil(w * 0.52);
  const center = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = c0; x < c1; x++) s += Y(y * w + x);
    center[y] = s / (c1 - c0);
  }
  const xs = [];
  const ls = [];
  for (let x = 0; x < w; x += 4) {
    const r = [];
    for (let y = 0; y < h; y += 2) r.push(Y(y * w + x) / Math.max(1e-6, center[y]));
    r.sort((a, b) => a - b);
    xs.push((x + 0.5 - w / 2) / (w / 2));
    ls.push(Math.log(r[r.length >> 1]));
  }
  // least squares fit of log gain = c0 + c1 u + c2 u^2
  const S = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let i = 0; i < xs.length; i++) {
    const p = [1, xs[i], xs[i] * xs[i]];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) S[r][c] += p[r] * p[c];
      S[r][3] += p[r] * ls[i];
    }
  }
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = S[r][c] / S[c][c];
      for (let k = c; k < 4; k++) S[r][k] -= f * S[c][k];
    }
  }
  const k = [S[0][3] / S[0][0], S[1][3] / S[1][1], S[2][3] / S[2][2]];
  const g = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    const u = (x + 0.5 - w / 2) / (w / 2);
    g[x] = Math.exp(k[0] + k[1] * u + k[2] * u * u);
  }
  return { g, left: g[0], right: g[w - 1] };
}

function applyGain(img, gain) {
  const { w, h } = img;
  const out = { w, h, ch: img.ch.map((c) => Float32Array.from(c)) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) out.ch[c][y * w + x] /= gain.g[x];
  }
  return out;
}

// Boundary curves are smoothed over 1% of the width before shape statistics, so
// JPEG block offsets in wide soft ramps (several px of isoline jitter) don't count
// as waviness. The fine residual is measured on the unsmoothed curve.
const SMOOTH_W = 0.01;

export function measureBoundaries(T, path, cfg) {
  const { w, h } = T;
  const sm = (y) => {
    const s = smooth1d(y, w * SMOOTH_W);
    for (let x = 0; x < w; x++) if (!Number.isFinite(y[x])) s[x] = NaN;
    return s;
  };
  const equal = EQUAL_LEVELS.map((level) => {
    const c = columnCrossings(T, level);
    const y = sm(c.y);
    return { level, y, raw: c.y, folds: c.folds, geom: boundaryGeometry(y, w, h), fine: fineResidual(c.y, w) };
  });
  const main = transitions(cfg, pathTAt, path).map((tr) => {
    const c10 = columnCrossings(T, tr.t10);
    const c50 = columnCrossings(T, tr.t50);
    const c90 = columnCrossings(T, tr.t90);
    const y50 = sm(c50.y);
    const wv = widthAlong(sm(c10.y), y50, sm(c90.y), w);
    const width = widthStats(wv, y50, w, h);
    const fine = fineResidual(c50.y, w);
    return {
      ...tr,
      y10: c10.y,
      y50,
      y90: c90.y,
      folds: c50.folds,
      geom: boundaryGeometry(y50, w, h),
      width,
      widthCurve: wv,
      fine,
      finePctWidth: width ? (fine / ((width.meanH / 100) * h)) * 100 : NaN,
    };
  });
  // all pairs of equally spaced isolines: correlation against separation
  const pairs = [];
  for (let i = 0; i < equal.length; i++) {
    for (let j = i + 1; j < equal.length; j++) {
      const s = pairStats(equal[i].y, equal[j].y, w, h);
      if (s) pairs.push({ i, j, ...s });
    }
  }
  const adjacent = main.slice(0, -1).map((m, k) => {
    const s = pairStats(m.y50, main[k + 1].y50, w, h);
    return s ? { a: m.name, b: main[k + 1].name, ...s } : null;
  });
  const foldCols = equal.reduce((s, e) => s + e.folds.reduce((q, f) => q + (f > 1 ? 1 : 0), 0), 0);
  return { equal, main, pairs, adjacent, foldShare: foldCols / (w * equal.length), slope: warpSlope(equal, w) };
}

// Implied warp slope from the local spacing of neighbouring equal-t isolines:
// spacing ratio r = local / mean spacing along the pair, slope = 1/r - 1.
// Folds start at slope -1; large positive slopes are bunched (sharper) isolines.
function warpSlope(equal, w) {
  const v = [];
  for (let i = 0; i + 1 < equal.length; i++) {
    const A = equal[i].y;
    const B = equal[i + 1].y;
    const sp = [];
    for (let x = 0; x < w; x++) if (Number.isFinite(A[x]) && Number.isFinite(B[x])) sp.push(B[x] - A[x]);
    if (sp.length < w * 0.5) continue;
    const m = sp.reduce((s, q) => s + q, 0) / sp.length;
    if (m < 4) continue;
    for (const q of sp) v.push(m / Math.max(0.5, q) - 1);
  }
  if (!v.length) return null;
  v.sort((a, b) => a - b);
  const pct = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  const rms = Math.sqrt(v.reduce((s, q) => s + q * q, 0) / v.length);
  return { p01: pct(0.01), p05: pct(0.05), p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), rms };
}

// Separation (in % H) at which the wiggle correlation of two isolines falls to 0.5,
// from a running mean over pairs sorted by separation.
export function verticalCorrLength(pairs) {
  const ps = pairs.filter((p) => Number.isFinite(p.corrWiggle)).sort((a, b) => a.sepH - b.sepH);
  if (ps.length < 4) return NaN;
  const k = Math.max(2, Math.round(ps.length / 8));
  for (let i = 0; i + k <= ps.length; i++) {
    const win = ps.slice(i, i + k);
    const m = win.reduce((s, p) => s + p.corrWiggle, 0) / k;
    if (m < 0.5) return win.reduce((s, p) => s + p.sepH, 0) / k;
  }
  return Infinity;
}

// Compact numbers for tables and for comparing a render with its target.
export function summarize(res, w) {
  const mains = res.main.filter((m) => m.geom);
  const avg = (f) => {
    const v = mains.map(f).filter(Number.isFinite);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
  };
  const adj = res.adjacent.filter(Boolean);
  return {
    boundaries: mains.map((m) => ({
      name: m.name,
      meanH: m.geom.meanH,
      rangeH: m.geom.rangeH,
      tiltH: m.geom.tiltH,
      bowH: m.geom.bowH,
      wiggleRmsH: m.geom.wiggleRmsH,
      dominant: m.geom.dominant,
      bands: m.geom.bands,
      curvRmsPerH: m.geom.curvRmsPerH,
      corrLenW: m.geom.corrLenW,
      width: m.width,
      finePx: m.fine,
      finePctWidth: m.finePctWidth,
    })),
    wanderRangeH: avg((m) => m.geom.rangeH),
    wiggleRmsH: avg((m) => m.geom.wiggleRmsH),
    widthMinOverMax: avg((m) => m.width?.minOverMax),
    widthCv: avg((m) => m.width?.cv),
    adjacentCorrWiggle: adj.length ? adj.reduce((s, p) => s + p.corrWiggle, 0) / adj.length : NaN,
    adjacentSpacingCv: adj.length ? adj.reduce((s, p) => s + p.spacingCv, 0) / adj.length : NaN,
    vertCorrLenH: verticalCorrLength(res.pairs),
    horizCorrLenW: avg((m) => m.geom.corrLenW),
    foldShare: res.foldShare,
    slope: res.slope,
    w,
  };
}
