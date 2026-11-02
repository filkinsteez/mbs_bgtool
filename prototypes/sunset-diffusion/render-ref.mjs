// Renders a reference preset at the reference's size and writes the audit set:
//   out/<id>/<tag>-render.png   the render
//   out/<id>/<tag>-sbs.png      reference | render
//   out/<id>/<tag>-zoom.png     3x crop of preset.audit.zoom, reference | render
//   out/<id>/<tag>-heat.png     Oklab difference (red = render lighter, blue = darker)
// and prints blurred Oklab error and row profiles.
// Usage: node render-ref.mjs <referenceId> [--tag t] [--solver pushpull|harmonic] [--preset file]
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, resolveReference } from './lib/refs.mjs';
import { hconcat, loadReference, makeImage, rgb8FromSrgbImage, writePng, zoomCrop } from './lib/image.mjs';
import { renderRadiance, outputStage } from './lib/pipeline.mjs';
import { compare, diffHeat, makeMask, rowProfile } from './lib/measure.mjs';
import { srgbToLinear } from './lib/color.mjs';

const args = process.argv.slice(2);
const id = args[0];
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const tag = opt('tag', 'cur');
const presetPath = opt('preset', join(HERE, 'presets', `${id}.json`));
const preset = JSON.parse(readFileSync(presetPath, 'utf8'));
const solver = opt('solver', undefined);
// --set params.gain=2 --set params.seeds.1.y=0.5 (values parsed as JSON)
args.forEach((a, i) => {
  if (a !== '--set') return;
  const [path, raw] = args[i + 1].split('=');
  const keys = path.split('.');
  let o = preset.scene;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys[keys.length - 1]] = JSON.parse(raw);
});

const ref = await resolveReference(id);
const target = await loadReference(ref.path);
const { w, h } = target;
const outDir = join(HERE, 'out', id);
mkdirSync(outDir, { recursive: true });

const solveScale = Number(opt('solveScale', '1'));
const t0 = performance.now();
const { img } = renderRadiance(preset.scene, w, h, { solver, solveScale });
const rgb8 = outputStage(img, preset.scene.output ?? {}, preset.scene.seed ?? 1);
const ms = performance.now() - t0;

const renLin = makeImage(w, h, 3);
for (let i = 0; i < w * h; i++) {
  for (let c = 0; c < 3; c++) renLin.ch[c][i] = srgbToLinear(rgb8[i * 3 + c] / 255);
}
const mask = makeMask(w, h, ref.cornerRadius, ref.ignore);
const m = compare(target.lin, renLin, mask, 4);

const ref8 = rgb8FromSrgbImage(target.srgb);
await writePng(join(outDir, `${tag}-render.png`), w, h, rgb8);
const sbs = hconcat([
  { w, h, data: ref8 },
  { w, h, data: rgb8 },
]);
await writePng(join(outDir, `${tag}-sbs.png`), sbs.w, sbs.h, sbs.data);
const [zx, zy, zw, zh] = preset.audit?.zoom ?? [Math.round(w * 0.3), Math.round(h * 0.4), 140, 140];
const zoom = hconcat(
  [zoomCrop(ref8, w, zx, zy, zw, zh, 3), zoomCrop(rgb8, w, zx, zy, zw, zh, 3)],
  12,
);
await writePng(join(outDir, `${tag}-zoom.png`), zoom.w, zoom.h, zoom.data);
const heat = diffHeat(target.lin, renLin, 4, 12);
await writePng(join(outDir, `${tag}-heat.png`), w, h, heat);

const strips = 16;
const cols = [
  [0.03, 0.2],
  [0.4, 0.6],
  [0.8, 0.97],
];
const pr = cols.map(([a, b]) => rowProfile(target.lin, mask, strips, Math.round(w * a), Math.round(w * b)));
const pn = cols.map(([a, b]) => rowProfile(renLin, mask, strips, Math.round(w * a), Math.round(w * b)));
const f = (p) => `${p.L.toFixed(2)} ${p.C.toFixed(3)} ${p.h.toFixed(0).padStart(3)}`;
console.log(`${id} [${tag}] ${w}x${h} ${ms.toFixed(0)} ms  dE mean ${m.mean.toFixed(2)}  p95 ${m.p95.toFixed(2)}  max ${m.max.toFixed(1)}  L bias ${m.biasL.toFixed(2)}`);
console.log('   y |   left ref    -> render     |    mid ref     -> render     |   right ref    -> render');
for (let i = 0; i < strips; i++) {
  const row = [0, 1, 2].map((k) => `${f(pr[k][i])} > ${f(pn[k][i])}`).join(' | ');
  console.log(`${String(Math.round(pr[0][i].y)).padStart(4)} | ${row}`);
}
appendFileSync(
  join(outDir, 'log.txt'),
  `${new Date().toISOString()} ${tag} mean=${m.mean.toFixed(2)} p95=${m.p95.toFixed(2)} biasL=${m.biasL.toFixed(2)} ms=${ms.toFixed(0)}\n`,
);
