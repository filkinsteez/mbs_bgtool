// Which mixing law does a reference transition follow? For each row between
// y0 and y1, find the best single mix amount c between endpoint colors A and B
// under several laws and report the remaining Oklab error.
// Usage: node tools/mixlaw.mjs <referenceId> <y0> <y1> [yA] [yB]
//   A = row-mean color at yA (default y0), B = at yB (default y1), 9-row averages.
import { readLinear, readAlpha } from '../lib/image.mjs';
import { buildMask, rowMeans } from '../lib/measure.mjs';
import { linearToOklab, oklabToLinear, linearToSrgb, srgbToLinear, linearToHex } from '../lib/color.mjs';
import { getRef } from '../refs.mjs';

const [, , id, y0s, y1s, yAs, yBs] = process.argv;
const ref = getRef(id);
const img = await readLinear(ref.file);
const { a } = await readAlpha(ref.file);
const mask = buildMask(img.w, img.h, a, ref.ignore);
const rows = rowMeans(img, mask);
const y0 = +y0s;
const y1 = +y1s;
const yA = yAs ? +yAs : y0;
const yB = yBs ? +yBs : y1;

function avgRow(yc) {
  const acc = [0, 0, 0];
  let n = 0;
  for (let y = yc - 4; y <= yc + 4; y++) {
    if (y < 0 || y >= img.h || Number.isNaN(rows[y * 3])) continue;
    for (let c = 0; c < 3; c++) acc[c] += rows[y * 3 + c];
    n++;
  }
  return acc.map((v) => v / n);
}
const A = avgRow(yA);
const B = avgRow(yB);
const labA = linearToOklab(...A);
const labB = linearToOklab(...B);
const encA = A.map(linearToSrgb);
const encB = B.map(linearToSrgb);

const laws = {
  linear: (c) => A.map((v, i) => v + c * (B[i] - v)),
  ink: (c) => A.map((v, i) => v * Math.pow(Math.max(1e-5, B[i]) / Math.max(1e-5, v), c)),
  srgb: (c) => encA.map((v, i) => srgbToLinear(v + c * (encB[i] - v))),
  oklab: (c) => oklabToLinear(...labA.map((v, i) => v + c * (labB[i] - v))),
};

const de = (p, q) => 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const stats = {};
for (const name of Object.keys(laws)) stats[name] = { sum: 0, max: 0, n: 0, worstY: 0, samples: [] };
for (let y = y0; y <= y1; y++) {
  if (Number.isNaN(rows[y * 3])) continue;
  const T = [rows[y * 3], rows[y * 3 + 1], rows[y * 3 + 2]];
  const labT = linearToOklab(...T);
  for (const [name, fn] of Object.entries(laws)) {
    let best = Infinity;
    let bestC = 0;
    for (let k = 0; k <= 400; k++) {
      const c = k / 400;
      const d = de(linearToOklab(...fn(c)), labT);
      if (d < best) {
        best = d;
        bestC = c;
      }
    }
    const s = stats[name];
    s.sum += best;
    s.n++;
    if (best > s.max) {
      s.max = best;
      s.worstY = y;
    }
    if ((y - y0) % Math.max(1, Math.round((y1 - y0) / 6)) === 0) s.samples.push(`${y}:c${bestC.toFixed(2)} ${linearToHex(fn(bestC))} vs ${linearToHex(T)} dE${best.toFixed(1)}`);
  }
}
console.log(`${id} rows ${y0}-${y1}  A ${linearToHex(A)} (y${yA})  B ${linearToHex(B)} (y${yB})`);
for (const [name, s] of Object.entries(stats)) {
  console.log(`  ${name.padEnd(7)} mean dE ${(s.sum / s.n).toFixed(2)}  max ${s.max.toFixed(2)} at y${s.worstY}`);
  if (process.env.SAMPLES) console.log('     ' + s.samples.join('\n     '));
}
