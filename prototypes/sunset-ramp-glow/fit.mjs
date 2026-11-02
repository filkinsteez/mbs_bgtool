// Offline fit of a reference preset's numbers (dev tool, never run at render
// time). Renders the model at low resolution and lowers the mean Oklab
// difference to the blurred, downsampled reference. Writes only preset
// numbers and picked colors; the renderer never reads the reference.
// Usage: node fit.mjs presets/<file>.json <specName> [--evals N] [--scale K] [--sigma S] [--write]
import { readFileSync, writeFileSync } from 'node:fs';
import { gaussianBlur } from './lib/blur.mjs';
import { cmaes } from './lib/cmaes.mjs';
import { hexToSrgb, linearToOklab, srgbToLinear } from './lib/color.mjs';
import { downsample, downsampleMask } from './lib/image.mjs';
import { formatJson } from './lib/json.mjs';
import { renderScene } from './lib/model.mjs';
import { applyLens, toneMap } from './lib/output.mjs';
import { loadReference } from './lib/refs.mjs';
import { SPECS } from './fitspecs.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const presetPath = args[0];
const preset = JSON.parse(readFileSync(presetPath, 'utf8'));
const spec = SPECS[args[1]](preset);
const k = Number(opt('scale', 6));
const ref = await loadReference(preset.referenceId);
const small = downsample(gaussianBlur(ref.img, 0.5 * k), k);
const smallMask = downsampleMask(ref.mask, ref.w, k);
const refLab = new Float32Array(small.w * small.h * 3);
for (let i = 0; i < small.w * small.h; i++) {
  refLab.set(linearToOklab(small.data[i * 3], small.data[i * 3 + 1], small.data[i * 3 + 2]), i * 3);
}

const getPath = (obj, path) => path.split('.').reduce((o, key) => o[key], obj);
const setPath = (obj, path, v) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, key) => o[key], obj)[last] = v;
};
const toHex = (rgb) =>
  '#' +
  rgb
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();

// Each entry maps a slice of the [0, 1] vector to a preset field.
const entries = [];
let n = 0;
// --color-range path=r (repeatable) narrows one color's sRGB range.
const colorRanges = Object.fromEntries(
  args.flatMap((a, i) => (a === '--color-range' ? [args[i + 1].split('=')] : [])).map(([p, r]) => [p, Number(r)]),
);
for (const e of spec) {
  if (e[0] === 'color') {
    const [, path, specRange = 0.25] = e;
    const range = colorRanges[path] ?? specRange;
    const c0 = hexToSrgb(getPath(preset.scene, path));
    const lo = c0.map((v) => Math.max(0, v - range));
    const hi = c0.map((v) => Math.min(1, v + range));
    entries.push({ kind: 'color', path, at: n, lo, hi });
    n += 3;
  } else {
    const [, path, lo, hi] = e;
    entries.push({ kind: 'num', path, at: n, lo, hi });
    n += 1;
  }
}
// Haze is zero-mean and slow to evaluate; fits run without it unless --haze.
const keepHaze = args.includes('--haze');
const toScene = (x, forScore = true) => {
  const scene = structuredClone(preset.scene);
  if (forScore && !keepHaze) delete scene.params.haze;
  for (const e of entries) {
    if (e.kind === 'color') {
      setPath(scene, e.path, toHex([0, 1, 2].map((c) => e.lo[c] + (e.hi[c] - e.lo[c]) * x[e.at + c])));
    } else {
      setPath(scene, e.path, +(e.lo + (e.hi - e.lo) * x[e.at]).toFixed(4));
    }
  }
  return scene;
};
const x0 = [];
for (const e of entries) {
  if (e.kind === 'color') {
    const c0 = hexToSrgb(getPath(preset.scene, e.path));
    for (let c = 0; c < 3; c++) x0.push(e.hi[c] > e.lo[c] ? (c0[c] - e.lo[c]) / (e.hi[c] - e.lo[c]) : 0.5);
  } else {
    const v = getPath(preset.scene, e.path);
    x0.push(Math.min(1, Math.max(0, (v - e.lo) / (e.hi - e.lo))));
  }
}

const gainOf = (scene) => Math.pow(2, scene.output?.exposure ?? 0);
function score(scene) {
  const img = applyLens(renderScene(scene, small.w, small.h), scene.lens);
  const gain = gainOf(scene);
  const spill = scene.output?.spill ?? 0;
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < small.w * small.h; i++) {
    if (!smallMask[i]) continue;
    const t = toneMap(img.data[i * 3] * gain, img.data[i * 3 + 1] * gain, img.data[i * 3 + 2] * gain, spill);
    // Match what an 8-bit encode does to out-of-range values.
    const lin = t.map((v) => srgbToLinear(Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055))));
    const lab = linearToOklab(lin[0], lin[1], lin[2]);
    sum += Math.hypot(lab[0] - refLab[i * 3], lab[1] - refLab[i * 3 + 1], lab[2] - refLab[i * 3 + 2]);
    cnt++;
  }
  return (sum / cnt) * 100;
}

console.log(`fit ${args[1]}: ${n} numbers, ${small.w}x${small.h}, start ${score(toScene(x0)).toFixed(3)}`);
const best = cmaes((x) => score(toScene(x)), x0, {
  sigma: Number(opt('sigma', 0.12)),
  maxEvals: Number(opt('evals', 3000)),
  seed: Number(opt('seed', 1)),
  log: (s) => console.log('  ' + s),
});
const scene = toScene(best.x, false);
console.log(`best ${best.fx.toFixed(3)}`);
for (const e of entries) console.log(`  ${e.path} = ${JSON.stringify(getPath(scene, e.path))}`);
if (args.includes('--write')) {
  preset.scene = scene;
  writeFileSync(presetPath, formatJson(preset) + '\n');
  console.log('wrote ' + presetPath);
}
