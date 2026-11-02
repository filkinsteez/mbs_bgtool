// Usage: node render.mjs <preset.json> <width> <height> <out.png> [seed]
import { readFile } from 'node:fs/promises';
import { renderRadiance, applyLens } from './lib/blooms.mjs';
import { outputStage } from './lib/output.mjs';
import { writeSrgb8 } from './lib/image.mjs';

export function renderScene(scene, w, h) {
  const radiance = renderRadiance(scene, w, h);
  const lensed = applyLens(radiance, scene.lens);
  return outputStage(lensed, scene.output, scene.seed ?? 1);
}

export async function loadPreset(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [presetPath, w, h, out, seed] = process.argv.slice(2);
  const preset = await loadPreset(presetPath);
  const scene = { ...preset.scene };
  if (seed) scene.seed = Number(seed);
  const t0 = performance.now();
  const img = renderScene(scene, Number(w), Number(h));
  await writeSrgb8(out, img);
  console.log(`${out} ${w}x${h} ${(performance.now() - t0).toFixed(0)} ms`);
}
