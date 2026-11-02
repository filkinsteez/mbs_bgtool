// Render a preset. With a referenceId (and no --size) it renders at the
// reference size and writes the side-by-side, a 3x zoom crop and profile
// sheets next to the render in out/.
// Usage: node render.mjs presets/<file>.json [--size WxH] [--seed N] [--name NAME] [--zoom x,y,w,h]
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { bytesToLinear, deltaE, diffMap, profileSheet } from './lib/compare.mjs';
import { saveBytes, sideBySide, zoomCrop } from './lib/image.mjs';
import { renderScene } from './lib/model.mjs';
import { applyLens, encodeOutput } from './lib/output.mjs';
import { PROTO, loadReference } from './lib/refs.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
const presetPath = args[0];
const preset = JSON.parse(readFileSync(presetPath, 'utf8'));
const scene = structuredClone(preset.scene);
if (opt('seed')) scene.seed = Number(opt('seed'));
// --set path=value (repeatable), e.g. --set params.haze.light=0.05
args.forEach((a, i) => {
  if (a !== '--set') return;
  const [path, raw] = args[i + 1].split('=');
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), scene);
  target[last] = JSON.parse(raw);
});
const name = opt('name') ?? basename(presetPath, '.json') + (opt('seed') ? `-s${scene.seed}` : '');
const outDir = join(PROTO, 'out');
mkdirSync(outDir, { recursive: true });

const ref = preset.referenceId && !opt('size') ? await loadReference(preset.referenceId) : null;
const [w, h] = ref ? [ref.w, ref.h] : (opt('size') ?? '1920x1080').split('x').map(Number);

const t0 = performance.now();
const radiance = renderScene(scene, w, h);
const t1 = performance.now();
const lensed = applyLens(radiance, scene.lens);
const t2 = performance.now();
const bytes = encodeOutput(lensed, scene.output, scene.seed);
const t3 = performance.now();
await saveBytes(bytes, w, h, join(outDir, name + '.png'));
console.log(
  `${name}: ${w}x${h} scene ${(t1 - t0).toFixed(0)} ms, lens ${(t2 - t1).toFixed(0)} ms, output ${(t3 - t2).toFixed(0)} ms`,
);

if (ref) {
  const outImg = bytesToLinear(bytes, w, h);
  const masked = new Uint8Array(bytes);
  for (let i = 0; i < w * h; i++) {
    if (!ref.mask[i]) masked.set(ref.bytes.subarray(i * 3, i * 3 + 3), i * 3);
  }
  const sbs = sideBySide([
    { bytes: ref.bytes, w, h },
    { bytes: masked, w, h },
  ]);
  await saveBytes(sbs.bytes, sbs.w, sbs.h, join(outDir, name + '-sbs.png'));

  const z = (opt('zoom') ?? preset.zoom?.join(',') ?? `${Math.floor(w * 0.3)},${Math.floor(h * 0.4)},200,200`)
    .split(',')
    .map(Number);
  const zr = zoomCrop(ref.bytes, w, z[0], z[1], z[2], z[3], 3);
  const zo = zoomCrop(bytes, w, z[0], z[1], z[2], z[3], 3);
  const zs = sideBySide([zr, zo]);
  await saveBytes(zs.bytes, zs.w, zs.h, join(outDir, name + '-zoom.png'));

  const rows = profileSheet(ref.img, outImg, ref.mask, true);
  await saveBytes(rows.bytes, rows.w, rows.h, join(outDir, name + '-rows.png'));
  const cols = profileSheet(ref.img, outImg, ref.mask, false);
  await saveBytes(cols.bytes, cols.w, cols.h, join(outDir, name + '-cols.png'));

  const diff = diffMap(ref.img, outImg, ref.mask, Number(opt('range') ?? 0.03));
  await saveBytes(diff.bytes, diff.w, diff.h, join(outDir, name + '-diff.png'));

  const de = deltaE(ref.img, outImg, ref.mask, 6);
  console.log(
    `  dE(ok x100, blur 6px) mean ${de.mean.toFixed(2)} p95 ${de.p95.toFixed(2)} max ${de.max.toFixed(2)}  mean dL ${de.meanDL.toFixed(2)}`,
  );
}
