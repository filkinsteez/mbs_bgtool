// Full pipeline: scene radiance -> lens -> tone curve, sRGB, grain, dither.

import { renderScene } from './scene.mjs';
import { applyLens } from './lens.mjs';
import { encode } from './output.mjs';

export function renderPreset(preset, W, H, seedOverride) {
  const scene = preset.scene;
  const seed = seedOverride ?? scene.seed ?? 1;
  const t0 = performance.now();
  const radiance = renderScene(scene, W, H);
  const t1 = performance.now();
  const lensed = applyLens(radiance, scene.lens, scene.colors);
  const t2 = performance.now();
  const bytes = encode(lensed, { ...(scene.output ?? {}), seed });
  const t3 = performance.now();
  return {
    bytes,
    radiance: lensed,
    timing: { scene: t1 - t0, lens: t2 - t1, output: t3 - t2 },
  };
}
