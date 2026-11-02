// Offline analysis: which edge kernel shape and mixing exponent n describe a
// single-ink ramp? Usage: node tools/edgefit.mjs <referenceId> <y0> <y1> [down|up]
//   down = coverage rises with y (ramp from A at y0 to B at y1).
import { readLinear, readAlpha } from '../lib/image.mjs';
import { buildMask, rowMeans } from '../lib/measure.mjs';
import { linearToOklab } from '../lib/color.mjs';
import { blurredStep } from '../model/bands.mjs';
import { getRef } from '../refs.mjs';

const [, , id, y0s, y1s] = process.argv;
const ref = getRef(id);
const img = await readLinear(ref.file);
const { a } = await readAlpha(ref.file);
const mask = buildMask(img.w, img.h, a, ref.ignore);
const rows = rowMeans(img, mask);
const H = img.h;
const y0 = +y0s;
const y1 = +y1s;
const avg = (yc) => {
  const acc = [0, 0, 0];
  let k = 0;
  for (let y = yc - 4; y <= yc + 4; y++) {
    if (Number.isNaN(rows[y * 3])) continue;
    for (let c = 0; c < 3; c++) acc[c] += rows[y * 3 + c];
    k++;
  }
  return acc.map((v) => v / k);
};
const A = avg(y0 + 4);
const B = avg(y1 - 4);
const de = (p, q) => 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const mixYN = (n, c) => A.map((v, i) => Math.pow((1 - c) * Math.pow(v, 1 / n) + c * Math.pow(B[i], 1 / n), n));

function coverageProfile(n) {
  const cs = [];
  let err = 0;
  let maxErr = 0;
  for (let y = y0; y <= y1; y++) {
    if (Number.isNaN(rows[y * 3])) {
      cs.push(null);
      continue;
    }
    const T = linearToOklab(rows[y * 3], rows[y * 3 + 1], rows[y * 3 + 2]);
    let best = Infinity;
    let bc = 0;
    for (let k = 0; k <= 200; k++) {
      const d = de(linearToOklab(...mixYN(n, k / 200)), T);
      if (d < best) {
        best = d;
        bc = k / 200;
      }
    }
    err += best;
    maxErr = Math.max(maxErr, best);
    cs.push(bc);
  }
  return { cs, mean: err / cs.filter((c) => c !== null).length, maxErr };
}

console.log(`${id} rows ${y0}-${y1}`);
let bestN = 1;
let bestMean = Infinity;
for (const n of [1, 1.5, 2, 2.5, 3, 4, 6]) {
  const { mean, maxErr } = coverageProfile(n);
  console.log(`  n=${n}: color dE mean ${mean.toFixed(2)} max ${maxErr.toFixed(2)}`);
  if (mean < bestMean) {
    bestMean = mean;
    bestN = n;
  }
}

const families = {
  gauss1: { shape: 'gauss', radii: [1], weights: [1] },
  gaussSum: { shape: 'gauss', radii: [0.45, 1, 2.2], weights: [0.3, 0.5, 0.2] },
  disk: { shape: 'disk', soft: 0, haze: 0 },
  diskSoft: { shape: 'disk', soft: 0.15, haze: 0 },
  diskHaze: { shape: 'disk', soft: 0.15, haze: 0.15, hazeRadius: 1.5 },
  box: { shape: 'box', soft: 0, haze: 0 },
  boxSoft: { shape: 'box', soft: 0.15, haze: 0 },
};

for (const n of [1, bestN]) {
  const { cs } = coverageProfile(n);
  console.log(`  edge fits on coverage for n=${n} (rms coverage error):`);
  for (const [name, kernel] of Object.entries(families)) {
    let best = { rms: Infinity };
    for (let t0 = (y0 - 200) / H; t0 <= (y1 + 200) / H; t0 += 4 / H) {
      for (let s = 10 / H; s <= 1.2; s *= 1.04) {
        let e2 = 0;
        let k = 0;
        for (let i = 0; i < cs.length; i++) {
          if (cs[i] === null) continue;
          const v = (y0 + i + 0.5) / H;
          const d = blurredStep(v - t0, s, kernel) - cs[i];
          e2 += d * d;
          k++;
        }
        const rms = Math.sqrt(e2 / k);
        if (rms < best.rms) best = { rms, t0, s };
      }
    }
    console.log(`    ${name.padEnd(9)} rms ${best.rms.toFixed(4)}  edge y ${(best.t0 * H).toFixed(0)}  scale ${(best.s * H).toFixed(0)} px`);
  }
}
