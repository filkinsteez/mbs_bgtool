// Offline fit of one rim profile of contour-iridescent-rings, measured along
// the normal of a ring at one angle. Model: a flat-topped main lobe with
// per-channel inner widths, an inner tail lobe, and an outer glow, on the
// measured far-inside and far-outside levels. Prints numbers for the preset.
//   node tools/fit-ring-profile.mjs <ring> <angleDeg> [dMin] [dMax]

import path from 'node:path';
import { readLinear } from '../lib/image.mjs';

const RINGS = {
  big: [589.3, 239.0, 706.6, 706.6],
  small: [505.0, 322.4, 232.3, 217.8],
  bottom: [395.4, 1100.4, 356.6, 391.6],
};
const file = path.resolve(import.meta.dirname, '../../../public/references/awe/contour/contour-iridescent-rings.png');
const { img } = await readLinear(file);
const [name, angS, dMinS, dMaxS] = process.argv.slice(2);
const [cx, cy, a, b] = RINGS[name];
const t = (Number(angS) * Math.PI) / 180;
const ex = cx + a * Math.cos(t);
const ey = cy + b * Math.sin(t);
let nx = Math.cos(t) / a;
let ny = Math.sin(t) / b;
const nl = Math.hypot(nx, ny);
nx /= nl;
ny /= nl;
const dMin = Number(dMinS ?? -140);
const dMax = Number(dMaxS ?? 40);

const S = [];
const tmp = [0, 0, 0];
for (let d = dMin; d <= dMax; d += 1) {
  const x = ex + nx * d;
  const y = ey + ny * d;
  if (x < 3 || y < 3 || x > img.w - 4 || y > img.h - 4) continue;
  const acc = [0, 0, 0];
  for (let k = -3; k <= 3; k++) {
    img.sample(x - ny * k + 0.5, y + nx * k + 0.5, tmp);
    for (let c = 0; c < 3; c++) acc[c] += tmp[c] / 7;
  }
  S.push([d, acc]);
}
const bgIn = S[0][1];
const bgOut = S[S.length - 1][1];
const g = (x, s) => Math.exp(-(x * x) / (2 * s * s));
const pw = (x, s, p) => Math.pow(1 + (x * x) / (2 * p * s * s), -p);

// p: [o, w, sR, sG, sB, sOut, aR, aG, aB, tR, tG, tB, tSig, oR, oG, oB, oSig, oP]
function model(p, d) {
  const [o, w, sR, sG, sB, sO, aR, aG, aB, tR, tG, tB, tS, oR, oG, oB, oS, oP] = p;
  let x = d - o;
  x = x < -w ? x + w : x > 0 ? x : 0;
  const sig = [sR, sG, sB];
  const amp = [aR, aG, aB];
  const tail = d < o - w ? g(d - (o - w), tS) : 1;
  const out = d > 0 ? pw(d, oS, oP) : 1;
  const bin = 0.5 - 0.5 * Math.tanh(d / 2);
  return [0, 1, 2].map(
    (c) =>
      bgIn[c] * bin +
      bgOut[c] * (1 - bin) +
      amp[c] * (x < 0 ? g(x, sig[c]) : g(x, sO)) +
      [tR, tG, tB][c] * (d < o ? tail : g(d - o, sO)) +
      [oR, oG, oB][c] * (d > 0 ? out : 0),
  );
}
function cost(p) {
  for (const i of [2, 3, 4, 5, 12, 16]) if (p[i] < 0.4) return 1e9;
  if (p[1] < 0 || p[17] < 0.3 || p[17] > 30) return 1e9;
  for (const i of [6, 7, 8, 9, 10, 11, 13, 14, 15]) if (p[i] < 0) return 1e9;
  let c = 0;
  for (const [d, v] of S) {
    const m = model(p, d);
    for (let k = 0; k < 3; k++) c += (m[k] - v[k]) ** 2;
  }
  return c;
}
function nelderMead(f, x0, steps, iters) {
  const n = x0.length;
  let pts = [x0];
  for (let i = 0; i < n; i++) {
    const q = [...x0];
    q[i] += steps[i];
    pts.push(q);
  }
  let vals = pts.map(f);
  for (let it = 0; it < iters; it++) {
    const order = vals.map((_, i) => i).sort((x, y) => vals[x] - vals[y]);
    pts = order.map((i) => pts[i]);
    vals = order.map((i) => vals[i]);
    const c = Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
    const at = (s) => c.map((v, j) => v + s * (pts[n][j] - v));
    const xr = at(-1);
    const fr = f(xr);
    if (fr < vals[0]) {
      const xe = at(-2);
      const fe = f(xe);
      [pts[n], vals[n]] = fe < fr ? [xe, fe] : [xr, fr];
    } else if (fr < vals[n - 1]) {
      [pts[n], vals[n]] = [xr, fr];
    } else {
      const xc = at(0.5);
      const fc = f(xc);
      if (fc < vals[n]) [pts[n], vals[n]] = [xc, fc];
      else
        for (let i = 1; i <= n; i++) {
          pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j]));
          vals[i] = f(pts[i]);
        }
    }
  }
  return [pts[0], vals[0]];
}

const peak = S.reduce((m, [, v]) => (v[0] + v[1] + v[2] > m[0] + m[1] + m[2] ? v : m), [0, 0, 0]);
let best = null;
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 24; i++) {
  const start = [
    -2 - rnd() * 4, rnd() * 15, 3 + rnd() * 20, 3 + rnd() * 20, 3 + rnd() * 25, 0.8 + rnd() * 2,
    peak[0] * 0.7, peak[1] * 0.7, peak[2] * 0.7, peak[0] * 0.2, peak[1] * 0.2, peak[2] * 0.2, 10 + rnd() * 40,
    0.01, 0.01, 0.02, 5 + rnd() * 30, 0.5 + rnd() * 3,
  ];
  let r = nelderMead(cost, start, [2, 5, 5, 5, 5, 0.5, 0.1, 0.1, 0.1, 0.05, 0.05, 0.05, 10, 0.01, 0.01, 0.01, 10, 1], 5000);
  r = nelderMead(cost, r[0], [1, 2, 2, 2, 2, 0.3, 0.03, 0.03, 0.03, 0.02, 0.02, 0.02, 5, 0.005, 0.005, 0.005, 5, 0.5], 5000);
  if (!best || r[1] < best[1]) best = r;
}
const [p, c] = best;
const names = ['o', 'w', 'sR', 'sG', 'sB', 'sOut', 'aR', 'aG', 'aB', 'tR', 'tG', 'tB', 'tSig', 'oR', 'oG', 'oB', 'oSig', 'oP'];
console.log(`${name} ${angS}deg edge (${ex.toFixed(0)},${ey.toFixed(0)}) cost ${c.toFixed(4)} bgIn ${bgIn.map((v) => v.toFixed(4)).join(' ')} bgOut ${bgOut.map((v) => v.toFixed(4)).join(' ')}`);
console.log(names.map((n, i) => `${n} ${p[i].toFixed(3)}`).join('  '));
if (process.env.ROWS) for (const [d, v] of S) if (d % 4 === 0) console.log(`${String(d).padStart(4)}  ref ${v.map((x) => x.toFixed(3)).join(' ')}  model ${model(p, d).map((x) => x.toFixed(3)).join(' ')}`);
