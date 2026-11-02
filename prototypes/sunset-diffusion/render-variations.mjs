// Renders production-style variations (pack colors only) at 16:9 and 9:16
// for a few seeds and writes one contact sheet per pack/technique.
// Usage: node render-variations.mjs [scale] [--bridge n]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HERE } from './lib/refs.mjs';
import { hconcat, writePng } from './lib/image.mjs';
import { renderRadiance, outputStage } from './lib/pipeline.mjs';
import { productionScene } from './lib/production.mjs';
import sharp from 'sharp';

const args = process.argv.slice(2);
const scale = Number(args.find((a) => !a.startsWith('--')) ?? 0.5);
const bi = args.indexOf('--bridge');
const bridge = bi >= 0 ? Number(args[bi + 1]) : undefined;
const only = args.indexOf('--only') >= 0 ? args[args.indexOf('--only') + 1] : null;
const dir = join(HERE, 'out', 'variations');
mkdirSync(dir, { recursive: true });

const jobs = [
  ['bold', 'horizon'],
  ['elemental', 'bands'],
  ['atmospheric', 'blooms'],
];
const seeds = [1, 2];
for (const [pack, tech] of jobs) {
  if (only && only !== pack) continue;
  const tiles = [];
  for (const seed of seeds) {
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
    ]) {
      const W = Math.round(w * scale);
      const H = Math.round(h * scale);
      const scene = productionScene(pack, tech, seed, { bridge });
      const t0 = performance.now();
      const { img } = renderRadiance(scene, W, H, { solveScale: 0.25 });
      const rgb = outputStage(img, scene.output, seed);
      const ms = performance.now() - t0;
      const name = `${pack}-${tech}-s${seed}-${w > h ? '16x9' : '9x16'}`;
      await writePng(join(dir, `${name}.png`), W, H, rgb);
      console.log(`${name} ${W}x${H} ${ms.toFixed(0)} ms`);
      tiles.push({ w: W, h: H, data: rgb });
    }
  }
  // sheet: the two landscape tiles stacked next to the two portrait tiles
  const land = tiles.filter((t) => t.w > t.h);
  const port = tiles.filter((t) => t.w < t.h);
  const lw = land[0].w;
  const lh = land[0].h;
  const stack = { w: lw, h: lh * 2 + 12, data: new Uint8Array(lw * (lh * 2 + 12) * 3).fill(255) };
  land.forEach((t, k) => stack.data.set(t.data, k * (lh + 12) * lw * 3));
  const ph = port[0].h;
  const pad = (t) => {
    const out = { w: t.w, h: Math.max(ph, stack.h), data: new Uint8Array(t.w * Math.max(ph, stack.h) * 3).fill(255) };
    out.data.set(t.data, 0);
    return out;
  };
  const sheet = hconcat([pad(stack), ...port.map(pad)], 12);
  const sheetPath = join(dir, `${pack}-${tech}-sheet.png`);
  await writePng(sheetPath, sheet.w, sheet.h, sheet.data);
  await sharp(sheetPath).resize({ width: 1400 }).toFile(join(dir, `${pack}-${tech}-sheet-small.png`));
}
