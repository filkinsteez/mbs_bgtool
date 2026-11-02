// Render a preset, compare with its reference, write review images.
// Usage: node render.mjs <preset.json> [tag] [--no-grain] [--size WxH]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { renderBands } from './model/bands.mjs';
import { encodeImage, quantize } from './lib/output.mjs';
import { risoGrainLinear, screenTexture } from './lib/grain.mjs';
import { readLinear, readAlpha, readSrgb8, writeRgb8, hstack, vstack, crop8, zoom8, shrink8, Img } from './lib/image.mjs';
import { buildMask, rowMeans, rowsToOklab, rowDeltaE, blurredDeltaE, grainStats, grainBands, plotSeries, errorMapImage } from './lib/measure.mjs';
import { srgbToLinear } from './lib/color.mjs';
import { getRef, HERE } from './refs.mjs';

const args = process.argv.slice(2);
const presetPath = args[0];
const tag = args[1] && !args[1].startsWith('--') ? args[1] : 'latest';
const noGrain = args.includes('--no-grain');
const sizeArg = args.includes('--size') ? args[args.indexOf('--size') + 1] : null;
const preset = JSON.parse(readFileSync(presetPath, 'utf8'));
const scene = preset.scene;
// --set scene.path=value (JSON value), e.g. --set params.mixN=1 --set params.bands.0.softUp=0.2
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--set') continue;
  const [path, raw] = args[i + 1].split('=');
  const keys = path.split('.');
  let obj = scene;
  for (const k of keys.slice(0, -1)) obj = obj[k];
  obj[keys.at(-1)] = JSON.parse(raw);
}
const id = preset.id ?? basename(presetPath, '.json');
const outDir = join(HERE, 'out', id, tag);
mkdirSync(outDir, { recursive: true });

function applyOutput(lin, sceneOut, seed, skipGrain) {
  const out = sceneOut ?? {};
  const surfaced = !skipGrain && out.grain?.type === 'riso' ? risoGrainLinear(lin, { seed, ...out.grain }) : lin;
  let enc = encodeImage(surfaced, out.exposure ?? 0);
  if (!skipGrain && out.grain?.type === 'screen') enc = screenTexture(enc, lin, { seed, ...out.grain });
  return quantize(enc, seed + 1, out.dither ?? 1);
}

function to8Linear(im8) {
  const img = new Img(im8.w, im8.h);
  for (let i = 0; i < im8.w * im8.h * 3; i++) img.data[i] = srgbToLinear(im8.data[i] / 255);
  return img;
}

const ref = preset.referenceId ? getRef(preset.referenceId) : null;
let w;
let h;
if (sizeArg) [w, h] = sizeArg.split('x').map(Number);
else if (ref) {
  const r8 = await readSrgb8(ref.file);
  w = r8.w;
  h = r8.h;
} else [w, h] = [1920, 1080];

const t0 = Date.now();
const lin = renderBands(scene, w, h);
const out8 = applyOutput(lin, scene.output, scene.seed ?? 1, noGrain);
await writeRgb8(join(outDir, 'render.png'), w, h, out8.data);
const ms = Date.now() - t0;

if (!ref || sizeArg) {
  console.log(`${id}/${tag}: rendered ${w}x${h} in ${ms} ms (no reference compare)`);
  process.exit(0);
}

const ref8 = await readSrgb8(ref.file);
const refLin = await readLinear(ref.file);
const { a } = await readAlpha(ref.file);
const mask = buildMask(w, h, a, ref.ignore);
const renLin = to8Linear(out8);

// Side by side, full size and half size.
const side = hstack([ref8, out8], 10);
await writeRgb8(join(outDir, 'side.png'), side.w, side.h, side.data);
const half = shrink8(side, 2);
await writeRgb8(join(outDir, 'side-half.png'), half.w, half.h, half.data);

// Zoom on the most important transition: reference above, render below.
const zr = preset.review?.zoom ?? [Math.floor(w / 2) - 100, Math.floor(h / 2) - 60, 200, 120];
const zoomK = preset.review?.zoomScale ?? 3;
const zRef = zoom8(crop8(ref8, ...zr), zoomK);
const zRen = zoom8(crop8(out8, ...zr), zoomK);
const zoom = hstack([zRef, zRen], 10);
await writeRgb8(join(outDir, 'zoom.png'), zoom.w, zoom.h, zoom.data);

// Row profiles in Oklab: reference dark, render light.
const refRows = rowMeans(refLin, mask);
const renRows = rowMeans(renLin, mask);
const refLab = rowsToOklab(refRows);
const renLab = rowsToOklab(renRows);
const panel = (k, min, max, dark, light) =>
  plotSeries(
    [
      { values: refLab.map((v) => v[k]), color: dark, min, max, thick: 3 },
      { values: renLab.map((v) => v[k]), color: light, min, max, thick: 2 },
    ],
    900,
    170,
  );
const rangeL = preset.review?.rangeL ?? [0, 1];
const rangeAB = preset.review?.rangeAB ?? [-0.2, 0.2];
const prof = vstack(
  [
    panel(0, rangeL[0], rangeL[1], [0, 0, 0], [150, 150, 150]),
    panel(1, rangeAB[0], rangeAB[1], [190, 0, 40], [255, 140, 160]),
    panel(2, rangeAB[0], rangeAB[1], [0, 40, 200], [120, 170, 255]),
  ],
  6,
  200,
);
await writeRgb8(join(outDir, 'profile.png'), prof.w, prof.h, prof.data);

const rowDE = rowDeltaE(refRows, renRows);
const valid = rowDE.map((v, i) => [v, i]).filter(([v]) => !Number.isNaN(v));
const meanRow = valid.reduce((s, [v]) => s + v, 0) / valid.length;
const worst = [...valid].sort((p, q) => q[0] - p[0]).slice(0, 5).map(([v, i]) => `${i}:${v.toFixed(1)}`);
const bde = blurredDeltaE(refLin, renLin, mask, 6);
const emap = shrink8(errorMapImage(bde.map, w, h, preset.review?.errScale ?? 5), 2);
await writeRgb8(join(outDir, 'errmap.png'), emap.w, emap.h, emap.data);

// Per-segment row errors: L, a, b differences averaged in 10 segments.
function segments(refL, renL) {
  const out = [];
  const nSeg = 10;
  for (let s = 0; s < nSeg; s++) {
    const y0 = Math.floor((s * h) / nSeg);
    const y1 = Math.floor(((s + 1) * h) / nSeg);
    let dL = 0;
    let da = 0;
    let db = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      if (Number.isNaN(refL[y][0]) || Number.isNaN(renL[y][0])) continue;
      dL += renL[y][0] - refL[y][0];
      da += renL[y][1] - refL[y][1];
      db += renL[y][2] - refL[y][2];
      n++;
    }
    if (n) out.push(`${y0}-${y1}: dL ${((dL / n) * 100).toFixed(1)} da ${((da / n) * 100).toFixed(1)} db ${((db / n) * 100).toFixed(1)}`);
  }
  return out;
}
const segs = segments(refLab, renLab);
if (args.includes('--thirds')) {
  for (let k = 0; k < 3; k++) {
    const x0 = Math.floor((k * w) / 3);
    const x1 = Math.floor(((k + 1) * w) / 3);
    const s = segments(rowsToOklab(rowMeans(refLin, mask, x0, x1)), rowsToOklab(rowMeans(renLin, mask, x0, x1)));
    console.log(`  third ${k}:\n   ` + s.join('\n   '));
  }
}

const thirds = [0, 1, 2].map((k) => {
  const x0 = Math.floor((k * w) / 3);
  const x1 = Math.floor(((k + 1) * w) / 3);
  const d = rowDeltaE(rowMeans(refLin, mask, x0, x1), rowMeans(renLin, mask, x0, x1)).filter((v) => !Number.isNaN(v));
  return d.reduce((s, v) => s + v, 0) / d.length;
});
const metrics = { id, tag, ms, rowMeanDE: meanRow, blurMeanDE: bde.mean, blurP90: bde.p90, worstRows: worst, thirds };
const gRef = grainStats(refLin, mask, { sigma: 3, bin: Math.round(h / 7) });
const gRen = grainStats(renLin, mask, { sigma: 3, bin: Math.round(h / 7) });
const grainLine = gRef
  .map((g, i) => `${g.y0}: ref ${g.stdL.toFixed(1)} ren ${gRen[i] ? gRen[i].stdL.toFixed(1) : '-'} acX ${g.acX1.toFixed(2)}/${gRen[i] ? gRen[i].acX1.toFixed(2) : '-'}`)
  .join(' | ');
writeFileSync(join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2));
console.log(
  `${id}/${tag}: ${w}x${h} ${ms} ms | row dE mean ${meanRow.toFixed(2)} | thirds ${thirds.map((v) => v.toFixed(2)).join('/')} | blurred dE mean ${bde.mean.toFixed(2)} p90 ${bde.p90.toFixed(2)} | worst rows ${worst.join(' ')}`,
);
console.log('  segments (render - ref, x100):\n   ' + segs.join('\n   '));
console.log('  grain stdL: ' + grainLine);
for (const rect of preset.review?.grainRects ?? []) {
  const fmt = (b) => b.map((v) => v.toFixed(2)).join('/');
  console.log(`  grain bands 0.5-1/1-2/2-4/4-8 px at ${rect.join(',')}: ref ${fmt(grainBands(refLin, rect))} ren ${fmt(grainBands(renLin, rect))}`);
}
