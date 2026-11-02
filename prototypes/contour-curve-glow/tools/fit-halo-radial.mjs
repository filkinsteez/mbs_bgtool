// Offline fit of the contour-yellow-halo radial structure along one
// direction from the ring center: an inner blue field that fades out before
// the ring, an outer light-blue field that fades in after it, and the ring
// light (asymmetric softened inverse power). Prints numbers for the preset.
//   node tools/fit-halo-radial.mjs <targetX> <targetY>

import path from 'node:path';
import { readLinear } from '../lib/image.mjs';

const file = path.resolve(import.meta.dirname, '../../../public/references/awe/contour/contour-yellow-halo.png');
const { img } = await readLinear(file);
const CX = 958;
const CY = 1490;
const tx = Number(process.argv[2] ?? 400);
const ty = Number(process.argv[3] ?? 423);
const len = Math.hypot(tx - CX, ty - CY);
const ux = (tx - CX) / len;
const uy = (ty - CY) / len;

const S = [];
for (let r = 420; r <= 1800; r += 20) {
  const x = CX + ux * r;
  const y = CY + uy * r;
  if (x < 6 || y < 6 || x > img.w - 7 || y > img.h - 7) continue;
  if (x > 280 && x < 646 && y > 1017 && y < 1281) continue;
  const acc = [0, 0, 0];
  for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) {
    const p = img.get(Math.round(x + i), Math.round(y + j));
    acc[0] += p[0] / 81;
    acc[1] += p[1] / 81;
    acc[2] += p[2] / 81;
  }
  S.push([r, acc]);
}

const cin = S[0][1];
const cout = S[S.length - 1][1];
const step = (x) => 0.5 + 0.5 * Math.tanh(x);
const prof = (x, s, p) => Math.pow(1 + (x * x) / (2 * p * s * s), -p);

// p: [R0, eIn, sIn, eOut, sOut, rr, rg, rb, sigIn, sigOut, pIn, pOut, tr, tg, tb, tSig, tP]
function model(p, r) {
  const [R0, eIn, sIn, eOut, sOut, rr, rg, rb, sgI, sgO, pI, pO, tr, tg, tb, tS, tP] = p;
  const d = r - R0;
  const wIn = 1 - step((d - eIn) / sIn);
  const wOut = step((d - eOut) / sOut);
  const g = d < 0 ? prof(d, sgI, pI) : prof(d, sgO, pO);
  const tail = d < 0 ? prof(d, tS, tP) : 0;
  return [0, 1, 2].map((c) => cin[c] * wIn + cout[c] * wOut + [rr, rg, rb][c] * g + [tr, tg, tb][c] * tail);
}
function cost(p) {
  if (p[2] < 5 || p[4] < 5 || p[8] < 5 || p[9] < 5 || p[10] < 0.3 || p[11] < 0.3 || p[10] > 50 || p[11] > 50) return 1e9;
  if (p[5] < 0 || p[6] < 0 || p[7] < 0 || p[12] < 0 || p[13] < 0 || p[14] < 0 || p[15] < 5 || p[16] < 0.3 || p[16] > 50) return 1e9;
  let c = 0;
  for (const [r, v] of S) {
    const m = model(p, r);
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
    const order = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
    pts = order.map((i) => pts[i]);
    vals = order.map((i) => vals[i]);
    const c = Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
    const at = (t) => c.map((v, j) => v + t * (pts[n][j] - v));
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

let best = null;
for (const start of [
  [1200, -100, 70, 50, 120, 0.9, 0.7, 0.3, 70, 150, 1, 2, 0.05, 0.2, 0.1, 200, 1],
  [1210, -60, 50, 100, 150, 1.0, 0.8, 0.35, 50, 200, 1.5, 1, 0.1, 0.3, 0.05, 300, 2],
  [1190, -140, 90, 0, 80, 0.8, 0.6, 0.2, 90, 120, 0.8, 3, 0.05, 0.15, 0.0, 150, 0.8],
]) {
  let r = nelderMead(cost, start, [20, 30, 20, 30, 30, 0.1, 0.1, 0.05, 20, 30, 0.3, 0.3, 0.05, 0.05, 0.05, 50, 0.3], 8000);
  r = nelderMead(cost, r[0], [5, 10, 10, 10, 10, 0.05, 0.05, 0.02, 10, 10, 0.2, 0.2, 0.02, 0.02, 0.02, 20, 0.2], 8000);
  if (!best || r[1] < best[1]) best = r;
}
const [p, c] = best;
const names = ['R0', 'eIn', 'sIn', 'eOut', 'sOut', 'ringR', 'ringG', 'ringB', 'sigIn', 'sigOut', 'pIn', 'pOut', 'tailR', 'tailG', 'tailB', 'tailSig', 'tailP'];
console.log('cost', c.toFixed(4), 'inner', cin.map((v) => v.toFixed(3)).join(' '), 'outer', cout.map((v) => v.toFixed(3)).join(' '));
console.log(names.map((n, i) => `${n} ${p[i].toFixed(3)}`).join('  '));
for (const [r, v] of S) {
  const m = model(p, r);
  console.log(`${r}  ref ${v.map((x) => x.toFixed(3)).join(' ')}  model ${m.map((x) => x.toFixed(3)).join(' ')}`);
}
