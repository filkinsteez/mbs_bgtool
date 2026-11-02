// Reads out/measure/<id>/metrics.json and prints the acceptance table, and draws
// two plots: wiggle correlation against isoline separation, and wiggle size
// against height. node tables.mjs [suffix]

import fs from 'node:fs';
import path from 'node:path';
import { PROTO } from './lib/refs.mjs';
import { SUNSET_IDS } from './lib/config.mjs';
import { makeCanvas, drawPolyline, drawText, saveCanvas, fillRect } from './lib/image.mjs';

const REF_COLORS = {
  'sky-peach': [230, 80, 40],
  'violet-wave': [240, 180, 0],
  'red-yellow-arcs': [20, 170, 230],
  'blue-diagonal': [150, 80, 240],
  'film-poster-bands': [40, 180, 80],
  'green-riso': [250, 110, 190],
  'blue-riso': [40, 40, 40],
  'pink-riso': [245, 140, 50],
};

const suffix = process.argv[2] ?? '';
const dir = path.join(PROTO, 'out/measure');
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const NOISE_FLOOR = 0.3; // wiggle RMS (% H) below which correlations are JPEG or grain noise

const all = {};
for (const id of SUNSET_IDS) {
  const file = path.join(dir, id + suffix, 'metrics.json');
  if (fs.existsSync(file)) all[id] = JSON.parse(fs.readFileSync(file, 'utf8'));
}

console.log('| reference | boundary | height %H | wander range %H | tilt / bow %H | wiggle RMS %H | main wavelengths W (amp %H) | 10-90 width %H | width min/max | width CV | width varies over W |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [id, m] of Object.entries(all)) {
  for (const b of m.summary.boundaries) {
    const dom = b.dominant.slice(0, 2).map((d) => `${f(d.lambdaW, 2)} (${f(d.ampH, 1)})`).join(', ');
    console.log(`| ${id.replace('sunset-', '')} | ${b.name} | ${f(b.meanH)} | ${f(b.rangeH)} | ${f(b.tiltH)} / ${f(b.bowH)} | ${f(b.wiggleRmsH, 2)} | ${dom} | ${f(b.width?.meanH)} | ${f(b.width?.minOverMax, 2)} | ${f(b.width?.cv, 2)} | ${f(b.width?.varLambdaW, 2)} |`);
  }
}

console.log('\n| reference | adjacent wiggle corr | adjacent spacing CV | vertical corr length %H | bump aspect (wavelength / 2 amp) | wiggle / width | fine residual % of width |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
const per = {};
for (const [id, m] of Object.entries(all)) {
  const s = m.summary;
  const big = s.boundaries.filter((b) => b.wiggleRmsH >= NOISE_FLOOR);
  const aspect = big.map((b) => (b.dominant[0].lambdaW * s.w) / (2 * Math.SQRT2 * (b.wiggleRmsH / 100) * s.h));
  const ratio = s.boundaries.filter((b) => b.width).map((b) => b.wiggleRmsH / b.width.meanH);
  const fine = s.boundaries.map((b) => b.finePctWidth).filter(Number.isFinite);
  per[id] = { aspect, fine };
  console.log(`| ${id.replace('sunset-', '')} | ${f(s.adjacentCorrWiggle, 2)} | ${f(s.adjacentSpacingCv, 2)} | ${f(s.vertCorrLenH)} | ${aspect.length ? `${f(Math.min(...aspect), 0)}-${f(Math.max(...aspect), 0)}` : 'below noise'} | ${f(Math.min(...ratio), 2)}-${f(Math.max(...ratio), 2)} | ${f(Math.min(...fine), 1)}-${f(Math.max(...fine), 1)} |`);
}

// Plot 1: wiggle correlation against separation, all pairs of equal-t isolines
// whose wiggle is above the noise floor.
async function scatter(file, title, xLabel, yLabel, xMax, yMin, yMax, series) {
  const W = 900;
  const Hh = 560;
  const L = 70;
  const B = 60;
  const c = makeCanvas(W, Hh, [255, 255, 255]);
  const X = (v) => L + (v / xMax) * (W - L - 20);
  const Y = (v) => Hh - B - ((v - yMin) / (yMax - yMin)) * (Hh - B - 40);
  drawPolyline(c, [[L, Y(yMin)], [W - 20, Y(yMin)]], [0, 0, 0], 0.8);
  drawPolyline(c, [[L, Y(yMin)], [L, 40]], [0, 0, 0], 0.8);
  if (yMin < 0) drawPolyline(c, [[L, Y(0)], [W - 20, Y(0)]], [180, 180, 180], 0.5);
  for (let k = 0; k <= 5; k++) {
    const v = (xMax * k) / 5;
    await drawText(c, f(v, 0), X(v) - 8, Hh - B + 8, { size: 13, color: [60, 60, 60] });
    const u = yMin + ((yMax - yMin) * k) / 5;
    await drawText(c, f(u, 1), 20, Y(u) - 8, { size: 13, color: [60, 60, 60] });
  }
  await drawText(c, title, L, 10, { size: 16, color: [0, 0, 0] });
  await drawText(c, xLabel, W / 2 - 80, Hh - 28, { size: 14, color: [0, 0, 0] });
  await drawText(c, yLabel, L + 8, 40, { size: 14, color: [0, 0, 0] });
  let ly = 60;
  for (const s of series) {
    const col = REF_COLORS[s.name] ?? [0, 0, 0];
    for (const [x, y] of s.points) {
      if (x > xMax || y < yMin || y > yMax) continue;
      fillRect(c, Math.round(X(x)) - 2, Math.round(Y(y)) - 2, 5, 5, col);
    }
    if (s.curve) drawPolyline(c, s.curve.map(([x, y]) => [X(x), Y(y)]), col, 1.2);
    fillRect(c, W - 230, ly + 4, 10, 10, col);
    await drawText(c, s.name, W - 214, ly, { size: 13, color: [0, 0, 0] });
    ly += 20;
  }
  await saveCanvas(c, file);
}

const corrSeries = [];
const ampSeries = [];
for (const [id, m] of Object.entries(all)) {
  const geo = m.equal.map((e) => e.geom);
  const pts = m.pairs
    .filter((p) => geo[p.i] && geo[p.j] && geo[p.i].wiggleRmsH >= NOISE_FLOOR && geo[p.j].wiggleRmsH >= NOISE_FLOOR)
    .map((p) => [Math.abs(p.sepH), p.corrWiggle]);
  pts.sort((a, b) => a[0] - b[0]);
  const curve = [];
  for (let s = 2; s <= 60; s += 4) {
    const near = pts.filter((p) => Math.abs(p[0] - s) < 4);
    if (near.length >= 2) curve.push([s, near.reduce((q, p) => q + p[1], 0) / near.length]);
  }
  if (pts.length) corrSeries.push({ name: id.replace('sunset-', ''), points: pts, curve });
  ampSeries.push({
    name: id.replace('sunset-', ''),
    points: m.equal.filter((e) => e.geom).map((e) => [e.geom.meanH, e.geom.wiggleRmsH]),
    curve: m.equal.filter((e) => e.geom).map((e) => [e.geom.meanH, e.geom.wiggleRmsH]).sort((a, b) => a[0] - b[0]),
  });
}
const outDir = path.join(PROTO, 'out/measure');
await scatter(path.join(outDir, `corr-vs-separation${suffix}.png`), 'Wiggle correlation of two isolines against their distance apart (wiggle above 0.3% H)', 'distance between the isolines, % of frame height', 'correlation', 60, -1, 1, corrSeries);
await scatter(path.join(outDir, `wiggle-vs-height${suffix}.png`), 'Wiggle RMS of each equal-t isoline (tilt and bow removed) against its height', 'height in the frame, % of frame height (0 = top)', 'wiggle RMS, % H', 100, 0, 5, ampSeries);
console.log('\nplots written to out/measure/');
