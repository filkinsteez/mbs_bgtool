// Generality check: renders production presets (pack colors) at 16:9 and
// 9:16 for two seeds each, and writes one contact sheet per preset.
//
//   node prototypes/contour-beams/production.mjs [preset.json ...] [--seeds 1,2] [--scale 1]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { applyLens, runRecipe } from './render.mjs';
import { saveLinear } from './lib/image.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const seeds = opt('seeds', '1,2').split(',').map(Number);
const scale = Number(opt('scale', '1'));
let files = args.filter((a, i) => a.endsWith('.json') && !String(args[i - 1]).startsWith('--'));
if (files.length === 0) {
  const dir = path.join(here, 'presets');
  files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('prod-'))
    .map((f) => path.join(dir, f));
}

const SIZES = { '16:9': [1920, 1080], '9:16': [1080, 1920] };

function mergeDeep(a, b) {
  const out = structuredClone(a ?? {});
  for (const [k, v] of Object.entries(b ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      out[k] = mergeDeep(out[k], v);
    } else out[k] = v;
  }
  return out;
}

const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });
for (const file of files) {
  const preset = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tiles = [];
  for (const [aspect, [w0, h0]] of Object.entries(SIZES)) {
    const W = Math.round(w0 * scale);
    const H = Math.round(h0 * scale);
    for (const seed of seeds) {
      const scene = structuredClone(preset.scene);
      scene.seed = seed;
      scene.params = mergeDeep(scene.params, preset.aspects?.[aspect]);
      const t0 = Date.now();
      const img = applyLens(runRecipe(scene, W, H), scene.lens);
      const name = `${preset.id}-${aspect.replace(':', 'x')}-s${seed}.png`;
      await saveLinear(path.join(outDir, name), img, { grain: scene.output?.grain ?? 0, seed });
      console.log(`wrote out/${name} (${W}x${H}) in ${Date.now() - t0} ms`);
      tiles.push({ aspect, file: path.join(outDir, name) });
    }
  }
  // Sheet: landscape tiles on the first row, portrait tiles on the second.
  const lw = 640;
  const lh = 360;
  const pw = Math.round((lh * 9) / 16);
  const gap = 8;
  const land = tiles.filter((t) => t.aspect === '16:9');
  const port = tiles.filter((t) => t.aspect === '9:16');
  const sheetW = Math.max(land.length * (lw + gap), port.length * (pw + gap)) + gap;
  const sheetH = gap + lh + gap + lh + gap;
  const comps = [];
  for (let i = 0; i < land.length; i++) {
    comps.push({ input: await sharp(land[i].file).resize(lw, lh).png().toBuffer(), left: gap + i * (lw + gap), top: gap });
  }
  for (let i = 0; i < port.length; i++) {
    comps.push({ input: await sharp(port[i].file).resize(pw, lh).png().toBuffer(), left: gap + i * (pw + gap), top: gap * 2 + lh });
  }
  const sheet = path.join(outDir, `${preset.id}-sheet.png`);
  await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: '#808080' } })
    .composite(comps)
    .png()
    .toFile(sheet);
  console.log(`sheet out/${path.basename(sheet)}`);
}
