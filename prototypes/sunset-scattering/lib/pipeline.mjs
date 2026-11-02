// Full pipeline for a preset scene: linear radiance -> exposure -> lens ->
// tone curve -> exact sRGB -> grain -> dither -> 8-bit.

import { renderScene } from "./scene.mjs";
import { applyLens } from "./lens.mjs";
import { encodeOutput } from "./output.mjs";
import { hexToLinear } from "./color.mjs";

// Exposure mode "sky": meter the top 8% of the frame (middle half of the
// width) and scale so its blue channel equals the sky role color's blue at
// nominal intensity; output.exposure is then an offset in stops on top.
function skyMeterGain(lin, scene) {
  const roles = scene.params?.roles ?? {};
  const sky = hexToLinear(scene.colors[roles.sky ?? 0]);
  const c = sky.indexOf(Math.max(...sky));
  const { width, height, data } = lin;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < Math.max(1, Math.round(height * 0.08)); y++) {
    for (let x = Math.round(width * 0.25); x < Math.round(width * 0.75); x++) {
      sum += data[(y * width + x) * 3 + c];
      n++;
    }
  }
  return sum > 0 ? sky[c] / (sum / n) : 1;
}

export function renderLinear(scene, width, height, opts = {}) {
  const lin = renderScene(scene, width, height, opts);
  let gain = Math.pow(2, scene.output?.exposure ?? 0);
  if (scene.output?.exposureMode === "sky") gain *= skyMeterGain(lin, scene);
  for (let i = 0; i < lin.data.length; i++) lin.data[i] *= gain;
  return applyLens(lin, scene.lens ?? {});
}

export function renderFinal(scene, width, height, opts = {}) {
  const lin = renderLinear(scene, width, height, opts);
  return encodeOutput(lin, {
    exposure: 0,
    grain: opts.noGrain ? 0 : (scene.output?.grain ?? 0),
    seed: scene.seed ?? 1,
    dither: opts.dither ?? true,
  });
}
