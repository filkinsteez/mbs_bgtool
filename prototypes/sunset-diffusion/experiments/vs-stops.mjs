// Diffusion vs a stop ramp with the same colors at the same heights (linear
// light), both without warp, light gradient or blur. For full-width
// horizontal strokes the membrane fill is a piecewise-linear ramp, so the two
// should match; the difference is reported as Oklab distance x100.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERE } from '../lib/refs.mjs';
import { renderRadiance, stopRamp } from '../lib/pipeline.mjs';
import { linearToOklab } from '../lib/color.mjs';

const preset = JSON.parse(readFileSync(join(HERE, 'presets', 'sunset-sky-peach.json'), 'utf8'));
const scene = JSON.parse(JSON.stringify(preset.scene));
delete scene.params.light;
delete scene.params.warp;
scene.params.blur = 0;
const w = 200;
const h = 1001;
const { img } = renderRadiance(scene, w, h, { solveScale: 1 });
const stops = scene.params.seeds.map((s) => ({ v: Math.min(1, Math.max(0, s.y)), color: s.color }));
const ramp = stopRamp(stops, scene.colors, w, h);
let max = 0;
let sum = 0;
for (let y = 0; y < h; y++) {
  const i = y * w + Math.floor(w / 2);
  const a = linearToOklab(img.ch[0][i], img.ch[1][i], img.ch[2][i]);
  const b = linearToOklab(ramp.ch[0][i], ramp.ch[1][i], ramp.ch[2][i]);
  const d = 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  max = Math.max(max, d);
  sum += d;
}
console.log(`sky-peach strokes: diffusion vs stop ramp, mean dE ${(sum / h).toFixed(2)}, max ${max.toFixed(2)}`);
