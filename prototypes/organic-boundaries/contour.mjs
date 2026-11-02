// Task 1, Contour: how width and brightness change along each glow edge.
// node contour.mjs
// Each edge is walked along a guide (geometry numbers from the contour-curve-glow
// presets, or a straight line); at every step a luminance profile is sampled
// across the edge, and the peak, the width at half maximum, the inner and outer
// reach to 10% and the ridge's offset from the guide are recorded.
// Writes out/contour/<id>.png (edge drawn on the reference, plus curves along
// the edge) and out/contour/summary.json.

import fs from 'node:fs';
import path from 'node:path';
import { loadReference, PROTO, fillMasked } from './lib/refs.mjs';
import { blurImage, smooth1d } from './lib/blur.mjs';
import { canvasFromLinear, makeCanvas, drawPolyline, drawText, saveCanvas, row, fillRect } from './lib/image.mjs';
import { linearToOklab } from './lib/color.mjs';

const out = path.join(PROTO, 'out/contour');

function lum(img, signal = 'luminance') {
  const n = img.w * img.h;
  const Y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (signal === 'yellow') Y[i] = Math.max(0, linearToOklab(img.ch[0][i], img.ch[1][i], img.ch[2][i])[2]);
    else Y[i] = 0.2126 * img.ch[0][i] + 0.7152 * img.ch[1][i] + 0.0722 * img.ch[2][i];
  }
  return Y;
}

function bilinear(Y, w, h, x, y) {
  const x0 = Math.max(0, Math.min(w - 2, Math.floor(x - 0.5)));
  const y0 = Math.max(0, Math.min(h - 2, Math.floor(y - 0.5)));
  const fx = Math.max(0, Math.min(1, x - 0.5 - x0));
  const fy = Math.max(0, Math.min(1, y - 0.5 - y0));
  const a = Y[y0 * w + x0];
  const b = Y[y0 * w + x0 + 1];
  const c = Y[(y0 + 1) * w + x0];
  const d = Y[(y0 + 1) * w + x0 + 1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// Profile across the edge at guide point p with unit normal nrm (pointing
// "outside"), from -reachIn to +reachOut px. Returns peak, offset of the peak
// from the guide, width at half maximum above the base, and the inner and outer
// distance from the peak to 10% above the base.
function profileAt(Y, w, h, p, nrm, reachIn, reachOut, search) {
  const step = 0.5;
  const ts = [];
  const vs = [];
  for (let t = -reachIn; t <= reachOut; t += step) {
    const x = p[0] + nrm[0] * t;
    const y = p[1] + nrm[1] * t;
    if (x < 0 || y < 0 || x >= w || y >= h) {
      ts.push(t);
      vs.push(NaN);
      continue;
    }
    ts.push(t);
    vs.push(bilinear(Y, w, h, x, y));
  }
  let k = -1;
  for (let i = 0; i < ts.length; i++) {
    if (Math.abs(ts[i]) > search || !Number.isFinite(vs[i])) continue;
    if (k < 0 || vs[i] > vs[k]) k = i;
  }
  if (k < 0) return null;
  const finite = vs.filter(Number.isFinite);
  const base = Math.min(...finite);
  const peak = vs[k];
  // each side is its own soft edge, falling from the peak to that side's own
  // background (the value at the end of the reach on that side)
  const sideBase = (dir) => {
    for (let i = dir > 0 ? ts.length - 1 : 0; i >= 0 && i < ts.length; i -= dir) if (Number.isFinite(vs[i])) return vs[i];
    return base;
  };
  const cross = (frac, dir, b0) => {
    const target = b0 + (peak - b0) * frac;
    for (let i = k; i >= 0 && i < ts.length; i += dir) {
      if (!Number.isFinite(vs[i])) return NaN;
      if (vs[i] <= target) {
        const j = i - dir;
        const f = (vs[j] - target) / (vs[j] - vs[i] || 1e-9);
        return Math.abs(ts[j] + (ts[i] - ts[j]) * f - ts[k]);
      }
    }
    return NaN;
  };
  const bIn = sideBase(-1);
  const bOut = sideBase(1);
  return {
    peak,
    base,
    offset: ts[k],
    inner50: cross(0.5, -1, base),
    outer50: cross(0.5, 1, base),
    inner10: cross(0.1, -1, base),
    outer10: cross(0.1, 1, base),
    // per side: position of the 50% point and 10-90 width, against its own background
    inPos: cross(0.5, -1, bIn),
    outPos: cross(0.5, 1, bOut),
    inW: cross(0.1, -1, bIn) - cross(0.9, -1, bIn),
    outW: cross(0.1, 1, bOut) - cross(0.9, 1, bOut),
  };
}

// Wiggle of a side edge: its 50% position (guide offset + distance from the
// peak) about a smooth trend over 25% of its length, in px.
function sideWiggle(pos) {
  const f = pos.filter(Number.isFinite);
  if (f.length < 16) return NaN;
  const trend = smooth1d(Float64Array.from(f), f.length * 0.25);
  const fine = smooth1d(Float64Array.from(f), 2);
  let s = 0;
  for (let i = 0; i < f.length; i++) s += (fine[i] - trend[i]) ** 2;
  return Math.sqrt(s / f.length);
}

function stats(v) {
  const f = v.filter(Number.isFinite);
  if (f.length < 8) return null;
  const sm = Array.from(smooth1d(Float64Array.from(f), 3));
  const mean = sm.reduce((s, x) => s + x, 0) / sm.length;
  const sd = Math.sqrt(sm.reduce((s, x) => s + (x - mean) ** 2, 0) / sm.length);
  const min = Math.min(...sm);
  const max = Math.max(...sm);
  // samples until the autocorrelation of the variation falls below 0.5
  const r = sm.map((x) => x - mean);
  const s0 = r.reduce((s, x) => s + x * x, 0) || 1;
  let lag = r.length / 2;
  for (let l = 1; l < r.length / 2; l++) {
    let s = 0;
    for (let i = 0; i + l < r.length; i++) s += r[i] * r[i + l];
    if (s / ((r.length - l) / r.length) / s0 < 0.5) {
      lag = l;
      break;
    }
  }
  return { mean, min, max, minOverMax: min / max, cv: sd / Math.abs(mean || 1), corrLen: lag };
}

// Guides: arrays of { p: [x, y] px, n: [nx, ny] outward normal, s: arc length px }
function lineGuide(a, b, n, stepPx) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const pts = [];
  for (let s = 0; s <= L; s += stepPx) pts.push({ p: [a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L], n, s });
  return pts;
}

function wedgeGuide(w, h, corner, angles, radius, stepPx) {
  // rounded corner of two rays from the corner point; offset the rays inward by
  // the radius and join them with an arc (as in contour-curve-glow's wedge)
  const S = Math.min(w, h) / 1000;
  const r = radius * S;
  const c = [corner[0] * w, corner[1] * h];
  const d1 = [Math.cos((angles[0] * Math.PI) / 180), Math.sin((angles[0] * Math.PI) / 180)];
  const d2 = [Math.cos((angles[1] * Math.PI) / 180), Math.sin((angles[1] * Math.PI) / 180)];
  const bis = [d1[0] + d2[0], d1[1] + d2[1]];
  const bl = Math.hypot(...bis);
  const half = Math.acos(d1[0] * d2[0] + d1[1] * d2[1]) / 2;
  const dc = r / Math.sin(half);
  const arcC = [c[0] + (bis[0] / bl) * dc, c[1] + (bis[1] / bl) * dc];
  const tl = r / Math.tan(half);
  const t1 = [c[0] + d1[0] * tl, c[1] + d1[1] * tl];
  const t2 = [c[0] + d2[0] * tl, c[1] + d2[1] * tl];
  const pts = [];
  let s = 0;
  // ray 1 from its far end (frame edge) to the tangent point
  const far1 = [c[0] + d1[0] * 3000, c[1] + d1[1] * 3000];
  const n1 = [-d1[1], d1[0]];
  const out1 = n1[0] * (arcC[0] - c[0]) + n1[1] * (arcC[1] - c[1]) > 0 ? [-n1[0], -n1[1]] : n1;
  const L1 = Math.hypot(far1[0] - t1[0], far1[1] - t1[1]);
  for (let q = 0; q < L1; q += stepPx) {
    const p = [far1[0] + ((t1[0] - far1[0]) * q) / L1, far1[1] + ((t1[1] - far1[1]) * q) / L1];
    if (p[0] < 0 || p[1] < 0 || p[0] >= w || p[1] >= h) continue;
    pts.push({ p, n: out1, s: s++ * stepPx });
  }
  // arc
  const a1 = Math.atan2(t1[1] - arcC[1], t1[0] - arcC[0]);
  let a2 = Math.atan2(t2[1] - arcC[1], t2[0] - arcC[0]);
  let da = a2 - a1;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const na = Math.max(2, Math.ceil((Math.abs(da) * r) / stepPx));
  for (let i = 0; i <= na; i++) {
    const a = a1 + (da * i) / na;
    const p = [arcC[0] + Math.cos(a) * r, arcC[1] + Math.sin(a) * r];
    pts.push({ p, n: [Math.cos(a), Math.sin(a)], s: s++ * stepPx, arc: true });
  }
  a2 = 0;
  const far2 = [c[0] + d2[0] * 3000, c[1] + d2[1] * 3000];
  const n2 = [-d2[1], d2[0]];
  const out2 = n2[0] * (arcC[0] - c[0]) + n2[1] * (arcC[1] - c[1]) > 0 ? [-n2[0], -n2[1]] : n2;
  const L2 = Math.hypot(far2[0] - t2[0], far2[1] - t2[1]);
  for (let q = 0; q < L2; q += stepPx) {
    const p = [t2[0] + ((far2[0] - t2[0]) * q) / L2, t2[1] + ((far2[1] - t2[1]) * q) / L2];
    if (p[0] < 0 || p[1] < 0 || p[0] >= w || p[1] >= h) break;
    pts.push({ p, n: out2, s: s++ * stepPx });
  }
  return pts;
}

function circleGuide(w, h, center, radius, stepPx) {
  const S = Math.min(w, h) / 1000;
  const c = [center[0] * w, center[1] * h];
  const r = radius * S;
  const pts = [];
  const na = Math.ceil((2 * Math.PI * r) / stepPx);
  let s = 0;
  for (let i = 0; i < na; i++) {
    const a = (2 * Math.PI * i) / na;
    const p = [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
    if (p[0] < 2 || p[1] < 2 || p[0] >= w - 2 || p[1] >= h - 2) continue;
    pts.push({ p, n: [Math.cos(a), Math.sin(a)], s: s++ * stepPx });
  }
  return pts;
}

const JOBS = [
  {
    id: 'contour-light-line',
    edges: (w, h) => [{ name: 'line', guide: lineGuide([w / 2, 0], [w / 2, h], [1, 0], 4), reachIn: 220, reachOut: 220, search: 12 }],
  },
  {
    id: 'contour-rim-edge',
    edges: (w, h) => [{ name: 'rim', guide: wedgeGuide(w, h, [0.87027, 0.12318], [180, 116.46], 91.4, 4), reachIn: 90, reachOut: 40, search: 10 }],
  },
  {
    id: 'contour-yellow-halo',
    signal: 'yellow',
    edges: (w, h) => [{ name: 'halo (yellowness)', guide: circleGuide(w, h, [1.03568, 1.13828], 1294, 4), reachIn: 320, reachOut: 320, search: 80 }],
  },
  {
    id: 'contour-beam-pool',
    edges: (w, h) => [
      { name: 'beam (across rows)', guide: lineGuide([w / 2, h * 0.03], [w / 2, h * 0.68], [1, 0], 4), reachIn: 380, reachOut: 380, search: 120 },
      { name: 'pool top (across columns)', guide: lineGuide([w * 0.08, h * 0.765], [w * 0.92, h * 0.765], [0, -1], 4), reachIn: 120, reachOut: 120, search: 60 },
    ],
  },
];

const summary = {};
for (const job of JOBS) {
  const ref = await loadReference(job.id);
  const { w, h } = ref.img;
  const img = blurImage(fillMasked(ref.img, ref.mask), 1.5);
  const Y = lum(img, job.signal);
  const S = Math.min(w, h);
  const base = canvasFromLinear(ref.img);
  const plots = [];
  summary[job.id] = {};
  for (const e of job.edges(w, h)) {
    const prof = e.guide.map((g) => ({ g, r: profileAt(Y, w, h, g.p, g.n, e.reachIn, e.reachOut, e.search) })).filter((q) => q.r && q.r.peak - q.r.base > 0.002);
    const peak = prof.map((q) => q.r.peak);
    const fwhm = prof.map((q) => q.r.inner50 + q.r.outer50);
    const in10 = prof.map((q) => q.r.inner10);
    const out10 = prof.map((q) => q.r.outer10);
    const off = prof.map((q) => q.r.offset);
    const st = {
      samples: prof.length,
      stepPx: 4,
      peak: stats(peak),
      fwhmS: stats(fwhm.map((v) => v / S)),
      inner10S: stats(in10.map((v) => v / S)),
      outer10S: stats(out10.map((v) => v / S)),
      offsetPx: stats(off),
      offsetRmsPx: Math.sqrt(off.reduce((s, v) => s + v * v, 0) / off.length),
    };
    for (const side of ['in', 'out']) {
      const pos = prof.map((q) => (side === 'in' ? q.r.offset - q.r.inPos : q.r.offset + q.r.outPos));
      const wid = prof.map((q) => (side === 'in' ? q.r.inW : q.r.outW) / S);
      const wg = sideWiggle(pos);
      st[side] = { wigglePx: wg, wigglePctS: (wg / S) * 100, width1090S: stats(wid) };
    }
    summary[job.id][e.name] = st;
    // draw: ridge points on the image, colored by width
    for (let i = 0; i + 1 < prof.length; i++) {
      const a = prof[i];
      const b = prof[i + 1];
      if (Math.hypot(b.g.p[0] - a.g.p[0], b.g.p[1] - a.g.p[1]) > 12) continue;
      const pa = [a.g.p[0] + a.g.n[0] * a.r.offset, a.g.p[1] + a.g.n[1] * a.r.offset];
      const pb = [b.g.p[0] + b.g.n[0] * b.r.offset, b.g.p[1] + b.g.n[1] * b.r.offset];
      drawPolyline(base, [pa, pb], [255, 60, 40], 1.2, 0.9);
      for (const [d, col] of [
        [a.r.outer10, [255, 220, 0]],
        [-a.r.inner10, [0, 220, 255]],
      ]) {
        if (!Number.isFinite(d)) continue;
        const q = [a.g.p[0] + a.g.n[0] * (a.r.offset + d), a.g.p[1] + a.g.n[1] * (a.r.offset + d)];
        drawPolyline(base, [q, [q[0] + 0.5, q[1] + 0.5]], col, 1, 0.8);
      }
    }
    // curves along the edge: peak (relative to max) and widths (fraction of S)
    const PW = 700;
    const PH = 260;
    const c = makeCanvas(PW, PH, [255, 255, 255]);
    const n = prof.length;
    const X = (i) => 40 + ((PW - 60) * i) / Math.max(1, n - 1);
    const pmax = Math.max(...peak);
    const wmax = Math.max(...out10.filter(Number.isFinite), ...in10.filter(Number.isFinite), ...fwhm.filter(Number.isFinite)) / S;
    const curve = (vals, scale, col) => drawPolyline(c, vals.map((v, i) => [X(i), PH - 30 - (Number.isFinite(v) ? v / scale : 0) * (PH - 60)]), col, 1);
    curve(peak, pmax, [200, 40, 40]);
    curve(fwhm.map((v) => v / S), wmax, [40, 40, 200]);
    curve(in10.map((v) => v / S), wmax, [40, 170, 220]);
    curve(out10.map((v) => v / S), wmax, [220, 170, 0]);
    fillRect(c, 40, PH - 30, PW - 60, 1, [0, 0, 0]);
    await drawText(c, `${job.id} / ${e.name}: along the edge (left to right)`, 40, 6, { size: 14, color: [0, 0, 0] });
    await drawText(c, `red: peak (max ${pmax.toFixed(3)})   blue: width at half max   cyan / yellow: reach to 10% inside / outside   (max ${(wmax * 100).toFixed(1)}% of short side)`, 40, 26, { size: 11, color: [60, 60, 60] });
    plots.push(c);
  }
  const sheet = await row([base, ...plots.map((p) => p)], { labels: [job.id, ...job.edges(w, h).map((e) => e.name)] });
  await saveCanvas(sheet, path.join(out, `${job.id}.png`));
  const f = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '-');
  for (const [name, st] of Object.entries(summary[job.id])) {
    console.log(`${job.id} / ${name}: ${st.samples} samples`);
    console.log(`  peak: min/max ${f(st.peak?.minOverMax, 2)}, cv ${f(st.peak?.cv, 2)}, varies over ${st.peak?.corrLen * 4} px`);
    console.log(`  half-max width: mean ${f(st.fwhmS?.mean)} S, min/max ${f(st.fwhmS?.minOverMax, 2)}, cv ${f(st.fwhmS?.cv, 2)}, varies over ${st.fwhmS?.corrLen * 4} px`);
    console.log(`  10% reach in/out: ${f(st.inner10S?.mean)} / ${f(st.outer10S?.mean)} S, min/max ${f(st.inner10S?.minOverMax, 2)} / ${f(st.outer10S?.minOverMax, 2)}`);
    console.log(`  ridge offset from guide: rms ${f(st.offsetRmsPx, 1)} px`);
    for (const side of ['in', 'out']) {
      const q = st[side];
      console.log(`  ${side} side: 50% position wiggle ${f(q.wigglePx, 1)} px (${f(q.wigglePctS, 2)}% S); 10-90 width mean ${f(q.width1090S?.mean)} S, min/max ${f(q.width1090S?.minOverMax, 2)}, cv ${f(q.width1090S?.cv, 2)}, varies over ${(q.width1090S?.corrLen ?? NaN) * 4} px`);
    }
  }
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1));
