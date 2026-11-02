// Ramp coordinate t(x, y) in 0..1: each pixel's Oklab color projected onto the
// image's main color path. The path is the mean color of a central band of the
// frame, binned along the main axis, so it runs from the start color to the end
// color through every measured stop. t is arc length along the path in Oklab,
// so equal steps of t are equal amounts of color change.

import { linearToOklab, hexToLinear } from './color.mjs';

export function axisFrame(w, h, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const halfAlong = Math.abs((w / 2) * dx) + Math.abs((h / 2) * dy);
  const halfAcross = Math.abs((w / 2) * dy) + Math.abs((h / 2) * dx);
  return {
    dx,
    dy,
    halfAlong,
    halfAcross,
    // position along the axis in 0..1, and across it in -1..1
    pos: (x, y) => ((x + 0.5 - w / 2) * dx + (y + 0.5 - h / 2) * dy + halfAlong) / (2 * halfAlong),
    across: (x, y) => (-(x + 0.5 - w / 2) * dy + (y + 0.5 - h / 2) * dx) / halfAcross,
  };
}

// cfg: { angle (deg, 90 = down), band (0..1 share of the across extent), bins, wL }
export function buildPath(img, cfg = {}, mask = null) {
  const { w, h } = img;
  const angle = cfg.angle ?? 90;
  const band = cfg.band ?? 0.4;
  const bins = cfg.bins ?? 200;
  const wL = cfg.wL ?? 1;
  const fr = axisFrame(w, h, angle);
  const sum = new Float64Array(bins * 3);
  const cnt = new Float64Array(bins);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask && !mask[i]) continue;
      if (Math.abs(fr.across(x, y)) > band) continue;
      const b = Math.min(bins - 1, Math.max(0, Math.floor(fr.pos(x, y) * bins)));
      sum[b * 3] += img.ch[0][i];
      sum[b * 3 + 1] += img.ch[1][i];
      sum[b * 3 + 2] += img.ch[2][i];
      cnt[b]++;
    }
  }
  // fill empty bins from neighbours, then smooth lightly along the path
  const rgb = [];
  for (let b = 0; b < bins; b++) rgb.push(cnt[b] > 0 ? [sum[b * 3] / cnt[b], sum[b * 3 + 1] / cnt[b], sum[b * 3 + 2] / cnt[b]] : null);
  for (let b = 0; b < bins; b++) {
    if (rgb[b]) continue;
    let lo = b - 1;
    while (lo >= 0 && !rgb[lo]) lo--;
    let hi = b + 1;
    while (hi < bins && !rgb[hi]) hi++;
    rgb[b] = (lo >= 0 ? rgb[lo] : null) ?? (hi < bins ? rgb[hi] : [0, 0, 0]);
  }
  // A start or end color that the central band never reaches (the far sky at
  // one side of the frame) can extend the path: the first or last 8% of the bins
  // are replaced by a linear-light ramp from that color to the band's color there.
  const ext = (hex, at, dir) => {
    const c = hexToLinear(hex);
    const span = Math.round(bins * 0.08);
    const anchor = rgb[at + dir * span];
    for (let j = 0; j < span; j++) {
      const f = j / span;
      rgb[at + dir * j] = [0, 1, 2].map((q) => c[q] + (anchor[q] - c[q]) * f);
    }
  };
  if (cfg.prepend) ext(cfg.prepend, 0, 1);
  if (cfg.append) ext(cfg.append, bins - 1, -1);
  const sm = cfg.smooth ?? 1.5;
  const lab = [];
  for (let b = 0; b < bins; b++) {
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let ws = 0;
    for (let j = -Math.ceil(sm * 3); j <= Math.ceil(sm * 3); j++) {
      const k = Math.min(bins - 1, Math.max(0, b + j));
      const wt = Math.exp(-(j * j) / (2 * sm * sm));
      s0 += wt * rgb[k][0];
      s1 += wt * rgb[k][1];
      s2 += wt * rgb[k][2];
      ws += wt;
    }
    lab.push(linearToOklab(s0 / ws, s1 / ws, s2 / ws));
  }
  const len = new Float64Array(bins);
  for (let b = 1; b < bins; b++) {
    const dL = (lab[b][0] - lab[b - 1][0]) * wL;
    const da = lab[b][1] - lab[b - 1][1];
    const db = lab[b][2] - lab[b - 1][2];
    len[b] = len[b - 1] + Math.sqrt(dL * dL + da * da + db * db);
  }
  const total = len[bins - 1] || 1;
  const t = Array.from(len, (v) => v / total);
  return { angle, band, bins, wL, lab, t, total, pos: Array.from({ length: bins }, (_, b) => (b + 0.5) / bins) };
}

// t at an axis position (0..1) on the path
export function pathTAt(path, pos) {
  const f = Math.min(path.bins - 1, Math.max(0, pos * path.bins - 0.5));
  const i = Math.floor(f);
  const j = Math.min(path.bins - 1, i + 1);
  return path.t[i] + (path.t[j] - path.t[i]) * (f - i);
}

// Project every pixel onto the path. window (axis fraction) limits the search to
// path points near the pixel's own axis position, for paths that pass the same
// color twice (magenta above and below the pink riso's orange band, red at the top
// and bottom of the poster). null searches the whole path.
export function projectToPath(img, path, cfg = {}) {
  const { w, h } = img;
  const fr = axisFrame(w, h, path.angle);
  const wL = path.wL;
  const win = cfg.window ?? null;
  const n = path.bins;
  const P = path.lab;
  const segL = new Float64Array(n - 1);
  const segA = new Float64Array(n - 1);
  const segB = new Float64Array(n - 1);
  const seg2 = new Float64Array(n - 1);
  for (let k = 0; k < n - 1; k++) {
    segL[k] = (P[k + 1][0] - P[k][0]) * wL;
    segA[k] = P[k + 1][1] - P[k][1];
    segB[k] = P[k + 1][2] - P[k][2];
    seg2[k] = segL[k] * segL[k] + segA[k] * segA[k] + segB[k] * segB[k] || 1e-12;
  }
  const out = new Float32Array(w * h);
  const dist = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const lab = linearToOklab(img.ch[0][i], img.ch[1][i], img.ch[2][i]);
      let k0 = 0;
      let k1 = n - 2;
      if (win !== null) {
        const b = fr.pos(x, y) * n;
        k0 = Math.max(0, Math.floor(b - win * n));
        k1 = Math.min(n - 2, Math.ceil(b + win * n));
      }
      let best = Infinity;
      let bt = 0;
      for (let k = k0; k <= k1; k++) {
        const pL = (lab[0] - P[k][0]) * wL;
        const pA = lab[1] - P[k][1];
        const pB = lab[2] - P[k][2];
        let u = (pL * segL[k] + pA * segA[k] + pB * segB[k]) / seg2[k];
        if (u < 0) u = 0;
        else if (u > 1) u = 1;
        const eL = pL - u * segL[k];
        const eA = pA - u * segA[k];
        const eB = pB - u * segB[k];
        const d = eL * eL + eA * eA + eB * eB;
        if (d < best) {
          best = d;
          bt = path.t[k] + u * (path.t[k + 1] - path.t[k]);
        }
      }
      out[i] = bt;
      dist[i] = Math.sqrt(best);
    }
  }
  return { w, h, t: out, dist };
}
