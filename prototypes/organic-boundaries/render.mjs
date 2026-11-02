// Render a preset at its reference's size and compare boundaries with the target.
// node render.mjs presets/<file>.json [tag] [--set path=json ...]
// Writes out/<referenceId>/<tag>/{render,side,iso,lines,zoom}.png and numbers.json.

import fs from 'node:fs';
import path from 'node:path';
import { loadReference, PROTO, fillMasked } from './lib/refs.mjs';
import { canvasFromLinear, saveCanvas, row, column, cropCanvas, resizeCanvas } from './lib/image.mjs';
import { rampCoordinate, measureBoundaries, summarize, EQUAL_LEVELS } from './lib/audit.mjs';
import { overlay, linesPlot } from './lib/draw.mjs';
import { SUNSET } from './lib/config.mjs';
import { renderScene } from './lib/scene.mjs';
import { encode, canvasToLinear } from './lib/output.mjs';
import { blurImage } from './lib/blur.mjs';
import { linearToOklab } from './lib/color.mjs';

const args = process.argv.slice(2);
const file = args[0];
const tag = args[1] && !args[1].startsWith('--') ? args[1] : 'latest';
const preset = JSON.parse(fs.readFileSync(file, 'utf8'));
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--set') continue;
  const [k, v] = args[i + 1].split('=');
  let o = preset.scene;
  const keys = k.split('.');
  for (const q of keys.slice(0, -1)) o = o[q] ??= {};
  o[keys[keys.length - 1]] = JSON.parse(v);
}

export function sceneFromPreset(p) {
  const s = p.scene;
  return { seed: s.seed, colors: s.colors, ...s.params };
}

function deltaE(a, b, mask) {
  const A = blurImage(a, 4);
  const B = blurImage(b, 4);
  const d = [];
  for (let i = 0; i < a.w * a.h; i++) {
    if (mask && !mask[i]) continue;
    const p = linearToOklab(A.ch[0][i], A.ch[1][i], A.ch[2][i]);
    const q = linearToOklab(B.ch[0][i], B.ch[1][i], B.ch[2][i]);
    d.push(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100);
  }
  d.sort((x, y) => x - y);
  return { mean: d.reduce((s, v) => s + v, 0) / d.length, p95: d[Math.floor(d.length * 0.95)] };
}

const id = preset.referenceId;
const cfg = SUNSET[id];
const ref = await loadReference(id);
const { w, h } = ref.img;
const t0 = Date.now();
const { img, guard, baseMinRate } = renderScene(sceneFromPreset(preset), w, h);
const canvas = encode(img, preset.scene.output ?? {}, preset.scene.seed ?? 1);
const renderMs = Date.now() - t0;
const lin = canvasToLinear(canvas);

const R = rampCoordinate(ref.img, ref.mask, cfg);
const resR = measureBoundaries(R.T, R.path, cfg);
const sumR = summarize(resR, w);
const Q = rampCoordinate(lin, ref.mask, cfg, R.path);
const resQ = measureBoundaries(Q.T, R.path, cfg);
const sumQ = summarize(resQ, w);

const dir = path.join(PROTO, 'out', id, tag);
const refC = canvasFromLinear(ref.img);
await saveCanvas(canvas, path.join(dir, 'render.png'));
const side = await row([refC, canvas], { labels: ['reference', `render (${tag})`] });
await saveCanvas(side, path.join(dir, 'side.png'));
const iso = await row([overlay(refC, R.T, EQUAL_LEVELS, resR.main), overlay(canvas, Q.T, EQUAL_LEVELS, resQ.main)], { labels: ['reference isolines', 'render isolines'] });
await saveCanvas(iso, path.join(dir, 'iso.png'));
const lines = await row([linesPlot(R.T, EQUAL_LEVELS, resR.main), linesPlot(Q.T, EQUAL_LEVELS, resQ.main)], { labels: ['reference', 'render'] });
await saveCanvas(lines, path.join(dir, 'lines.png'));
const z = preset.zoom ?? [Math.round(w * 0.3), Math.round(h * 0.4), Math.round(w * 0.3), Math.round(h * 0.15)];
const zr = await resizeCanvas(cropCanvas(refC, ...z), z[2] * 3, z[3] * 3);
const zq = await resizeCanvas(cropCanvas(canvas, ...z), z[2] * 3, z[3] * 3);
await saveCanvas(await column([zr, zq]), path.join(dir, 'zoom.png'));

const dE = deltaE(fillMasked(ref.img, ref.mask), lin, ref.mask);
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
console.log(`${id} [${tag}] render ${renderMs} ms, guard scale ${f(guard.scale, 2)} (worst slope ${f(guard.worstSlope, 2)}), base min slope ${f(baseMinRate, 2)}, blurred dE mean ${f(dE.mean, 2)} p95 ${f(dE.p95, 2)}`);
console.log('  boundary                       height      range       wiggle      lambda        width       min/max     cv');
const byName = new Map(sumQ.boundaries.map((b) => [b.name, b]));
for (const a of sumR.boundaries) {
  const b = byName.get(a.name);
  const pair = (x, y, d = 1) => `${f(x, d)}/${f(y, d)}`.padEnd(12);
  console.log(
    `  ${a.name.padEnd(30)} ${pair(a.meanH, b?.meanH)}${pair(a.rangeH, b?.rangeH)}${pair(a.wiggleRmsH, b?.wiggleRmsH, 2)}${pair(a.dominant[0]?.lambdaW, b?.dominant[0]?.lambdaW, 2)}${pair(a.width?.meanH, b?.width?.meanH)}${pair(a.width?.minOverMax, b?.width?.minOverMax, 2)}${pair(a.width?.cv, b?.width?.cv, 2)}`,
  );
}
console.log(`  adjacent wiggle corr ${f(sumR.adjacentCorrWiggle, 2)}/${f(sumQ.adjacentCorrWiggle, 2)}, spacing CV ${f(sumR.adjacentSpacingCv, 2)}/${f(sumQ.adjacentSpacingCv, 2)}, vertical corr length ${f(sumR.vertCorrLenH)}/${f(sumQ.vertCorrLenH)} %H, folds ${f(sumR.foldShare * 100, 2)}/${f(sumQ.foldShare * 100, 2)} %`);
const sl = (s) => (s ? `${f(s.p01, 2)}..${f(s.p99, 2)} (rms ${f(s.rms, 2)})` : '-');
console.log(`  implied warp slope p01..p99: ${sl(sumR.slope)} / ${sl(sumQ.slope)}`);
fs.writeFileSync(path.join(dir, 'numbers.json'), JSON.stringify({ id, tag, dE, guard, target: sumR, render: sumQ }, null, 1));
