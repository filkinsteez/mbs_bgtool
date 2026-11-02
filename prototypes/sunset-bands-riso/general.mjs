// Generality check: pack-based scenes at 16:9 and 9:16 with two seeds.
// Writes out/general/<pack>-<size>-s<seed>.png and a contact sheet per pack.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderBands } from './model/bands.mjs';
import { sunsetBandsScene } from './model/recipe.mjs';
import { encodeImage, quantize } from './lib/output.mjs';
import { risoGrainLinear } from './lib/grain.mjs';
import { writeRgb8, hstack, shrink8 } from './lib/image.mjs';
import { HERE } from './refs.mjs';

const outDir = join(HERE, 'out', 'general');
mkdirSync(outDir, { recursive: true });
const sizes = [
  ['16x9', 1920, 1080],
  ['9x16', 1080, 1920],
];
const packs = process.argv.slice(2).length ? process.argv.slice(2) : ['bold', 'elemental', 'atmospheric'];

for (const pack of packs) {
  const tiles = [];
  for (const seed of [1, 2]) {
    for (const [name, w, h] of sizes) {
      const scene = sunsetBandsScene({ pack, seed });
      const lin = renderBands(scene, w, h);
      const grained = risoGrainLinear(lin, { seed, ...scene.output.grain });
      const out8 = quantize(encodeImage(grained, 0), seed + 1);
      const file = join(outDir, `${pack}-${name}-s${seed}.png`);
      await writeRgb8(file, w, h, out8.data);
      writeFileSync(join(outDir, `${pack}-s${seed}.json`), JSON.stringify(scene, null, 2));
      tiles.push(shrink8(out8, name === '16x9' ? 4 : 4));
      console.log(file);
    }
  }
  const sheet = hstack(tiles, 12, 255);
  await writeRgb8(join(outDir, `${pack}-sheet.png`), sheet.w, sheet.h, sheet.data);
}

// Controls sheet: each control at its low and high end (Bold, 16:9, seed 1).
const controls = [
  { softness: 0.1 },
  { softness: 0.9 },
  { intensity: 0 },
  { intensity: 1 },
  { horizon: 0.42 },
  { horizon: 0.75 },
];
const ctiles = [];
for (const c of controls) {
  const scene = sunsetBandsScene({ pack: 'bold', seed: 1, ...c });
  const lin = renderBands(scene, 960, 540);
  ctiles.push(shrink8(quantize(encodeImage(lin, 0), 2), 2));
}
const csheet = hstack(ctiles, 12, 255);
await writeRgb8(join(outDir, 'controls-sheet.png'), csheet.w, csheet.h, csheet.data);
