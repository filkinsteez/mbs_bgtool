// Reference analysis: row profiles (Oklab), fold detection, grain stats, plots.
// Usage: node analyze.mjs [referenceId ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLinear, readAlpha, writeRgb8 } from './lib/image.mjs';
import { buildMask, rowMeans, rowsToOklab, grainStats, plotSeries } from './lib/measure.mjs';
import { linearToHex, luminance } from './lib/color.mjs';
import { getRef, REF_IDS, HERE } from './refs.mjs';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : REF_IDS;
const outDir = join(HERE, 'out', 'analysis');
mkdirSync(outDir, { recursive: true });

for (const id of ids) {
  const ref = getRef(id);
  const img = await readLinear(ref.file);
  const { a } = await readAlpha(ref.file);
  const { w, h } = img;
  const maskNoIgnore = buildMask(w, h, a, []);
  const mask = buildMask(w, h, a, ref.ignore);
  console.log(`\n== ${id} ${w}x${h} clean=${ref.clean}`);

  // Fold scan: row luma vs the mean of rows 4..12 away.
  const rowsAll = rowMeans(img, maskNoIgnore);
  const lum = [];
  for (let y = 0; y < h; y++) lum.push(luminance(rowsAll[y * 3], rowsAll[y * 3 + 1], rowsAll[y * 3 + 2]));
  const anomalies = [];
  for (let y = 12; y < h - 12; y++) {
    let s = 0;
    for (let k = 4; k <= 12; k++) s += lum[y - k] + lum[y + k];
    const ref18 = s / 18;
    const d = (lum[y] - ref18) / Math.max(1e-4, ref18);
    if (Math.abs(d) > 0.025) anomalies.push(`${y}:${(d * 100).toFixed(1)}%`);
  }
  console.log('row anomalies >2.5%:', anomalies.join(' '));

  const rows = rowMeans(img, mask);
  const lab = rowsToOklab(rows);
  const step = Math.max(1, Math.round(h / 40));
  const lines = [];
  for (let y = 0; y < h; y += step) {
    const [L, A, B] = lab[y];
    if (Number.isNaN(L)) continue;
    const hex = linearToHex([rows[y * 3], rows[y * 3 + 1], rows[y * 3 + 2]]);
    lines.push(`y=${String(y).padStart(4)} ${hex} L=${L.toFixed(3)} a=${A.toFixed(3)} b=${B.toFixed(3)} C=${Math.hypot(A, B).toFixed(3)}`);
  }
  console.log(lines.join('\n'));

  // Left/center/right thirds to see horizontal variation.
  const thirds = [0, 1, 2].map((k) => rowsToOklab(rowMeans(img, mask, Math.floor((k * w) / 3), Math.floor(((k + 1) * w) / 3))));
  const varLines = [];
  for (let y = 0; y < h; y += step * 2) {
    const L3 = thirds.map((t) => t[y][0]);
    if (L3.some(Number.isNaN)) continue;
    varLines.push(`y=${y} L thirds ${L3.map((v) => v.toFixed(3)).join(' ')}`);
  }
  console.log(varLines.join('\n'));

  const g = grainStats(img, mask, { sigma: 3, bin: Math.round(h / 14) });
  console.log('grain (sRGB 0..255 units):');
  for (const b of g) {
    console.log(
      `  y ${b.y0}-${b.y1} mean ${b.meanEnc.map((v) => Math.round(v * 255)).join(',')} stdL ${b.stdL.toFixed(2)} rgb ${b.stdR.toFixed(2)}/${b.stdG.toFixed(2)}/${b.stdB.toFixed(2)} corr rg ${b.corrRG.toFixed(2)} rb ${b.corrRB.toFixed(2)} gb ${b.corrGB.toFixed(2)} acX ${b.acX1.toFixed(2)},${b.acX2.toFixed(2)} acY ${b.acY1.toFixed(2)},${b.acY2.toFixed(2)}`,
    );
  }

  const plot = plotSeries(
    [
      { values: lab.map((v) => v[0]), color: [0, 0, 0], min: 0, max: 1 },
      { values: lab.map((v) => v[1]), color: [220, 30, 60], min: -0.25, max: 0.25 },
      { values: lab.map((v) => v[2]), color: [30, 80, 220], min: -0.25, max: 0.25 },
    ],
    900,
    300,
  );
  await writeRgb8(join(outDir, `${id}-oklab-rows.png`), plot.w, plot.h, plot.data);
  writeFileSync(join(outDir, `${id}-rows.json`), JSON.stringify({ w, h, lab, rows: Array.from(rows) }));
}
