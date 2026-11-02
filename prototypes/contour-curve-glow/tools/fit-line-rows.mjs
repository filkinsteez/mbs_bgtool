// Measures contour-light-line: per row, the core position and color, and a
// per-channel gaussian (amplitude, center, sigma) fitted to the glow with the
// core pixels left out. Prints a table used to pick preset numbers.
//   node tools/fit-line-rows.mjs

import path from 'node:path';
import { readLinear } from '../lib/image.mjs';

const file = path.resolve(import.meta.dirname, '../../../public/references/awe/contour/contour-light-line.png');
const { img } = await readLinear(file);
const { w } = img;

function rowMean(y, x, c) {
  let s = 0;
  for (let k = -2; k <= 2; k++) s += img.data[((y + k) * w + x) * 3 + c];
  return s / 5;
}

function fitGauss(xs, vs) {
  // Coarse grid search over center and sigma; amplitude by least squares.
  let best = { err: Infinity };
  for (let cx = 300; cx <= 620; cx += 1) {
    for (let s = 3; s <= 90; s *= 1.04) {
      let num = 0;
      let den = 0;
      for (let i = 0; i < xs.length; i++) {
        const g = Math.exp(-((xs[i] - cx) ** 2) / (2 * s * s));
        num += g * vs[i];
        den += g * g;
      }
      const a = num / den;
      let err = 0;
      for (let i = 0; i < xs.length; i++) err += (vs[i] - a * Math.exp(-((xs[i] - cx) ** 2) / (2 * s * s))) ** 2;
      if (err < best.err) best = { err, a, cx, s };
    }
  }
  return best;
}

console.log('  y   coreX  coreRGB(lin)              | R a/c/s           | G a/c/s           | B a/c/s');
for (const y of [120, 235, 350, 470, 590, 704, 820, 939, 1057, 1174, 1291, 1410, 1527, 1585, 1630]) {
  let cx = 0;
  let cm = -1;
  for (let x = 380; x < 540; x++) {
    const v = rowMean(y, x, 0) + rowMean(y, x, 1) + rowMean(y, x, 2);
    if (v > cm) {
      cm = v;
      cx = x;
    }
  }
  const core = [0, 1, 2].map((c) => rowMean(y, cx, c));
  const xs = [];
  const fits = [];
  for (let c = 0; c < 3; c++) {
    const vs = [];
    if (c === 0) xs.length = 0;
    for (let x = 150; x < 780; x += 2) {
      if (Math.abs(x - cx) < 6) continue;
      if (c === 0) xs.push(x);
      vs.push(rowMean(y, x, c));
    }
    fits.push(fitGauss(xs, vs));
  }
  const f = (g) => `${g.a.toFixed(3)}/${g.cx.toFixed(0)}/${g.s.toFixed(1)}`.padEnd(18);
  console.log(
    `${String(y).padStart(4)}  ${String(cx).padStart(4)}  ${core.map((v) => v.toFixed(3)).join(' ')}  | ${fits.map(f).join('| ')}`,
  );
}
