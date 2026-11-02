// Offline helper for a reference with an in-frame horizon: measures the
// reference ridge (per column, the row where Oklab L falls through the middle
// of its sky-to-ground range), then searches the warp seed, phase, scale and
// amplitude so the rendered horizon follows it. Prints the best numbers; only
// those four numbers go into the preset.
// Usage: node ridge.mjs presets/<id>.json

import { readFileSync } from "node:fs";
import { loadReference, blurFloat } from "./lib/image.mjs";
import { linearToOklab } from "./lib/color.mjs";
import { fbm1 } from "./lib/noise.mjs";
import { referencePath } from "./render.mjs";

const preset = JSON.parse(readFileSync(process.argv[2], "utf8"));
const LEVEL = Number(process.argv[3] ?? 0.62);
const OCTAVES = Number(process.argv[4] ?? 3);
const { path, cornerRadius } = referencePath(preset.referenceId);
const ref = blurFloat(await loadReference(path, cornerRadius), 6);
const { width, height } = ref;
const cols = 24;
const ridge = [];
for (let k = 0; k < cols; k++) {
  const x = Math.round(((k + 0.5) / cols) * (width - 1));
  const L = [];
  for (let y = 0; y < height; y++) {
    const i = (y * width + x) * 3;
    L.push(linearToOklab(ref.data[i], ref.data[i + 1], ref.data[i + 2])[0]);
  }
  // Last row (from the top) where L is still above the threshold.
  let by = 0;
  for (let y = Math.round(height * 0.1); y < height * 0.9; y++) {
    if (L[y] >= LEVEL) by = y;
  }
  ridge.push(by / height);
}
// Optional ridge read by eye: comma list of heights at evenly spaced x.
if (process.argv[5]) {
  const pts = process.argv[5].split(",").map(Number);
  for (let k = 0; k < cols; k++) {
    const f = ((k + 0.5) / cols) * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(f));
    ridge[k] = pts[i] + (pts[i + 1] - pts[i]) * (f - i);
  }
}
console.log("reference ridge:", ridge.map((v) => v.toFixed(2)).join(" "));

// Render-side horizon for a warp: the horizon sits where elevation equals the
// warp, i.e. it moves up by warp / fov of the frame (small-angle).
const p = preset.scene.params;
const base = p.horizon;
let bestErr = Infinity;
let bestCfg = null;
for (let seed = 1; seed <= 40; seed++) {
  for (let scale = 0.5; scale <= 2.51; scale += 0.1) {
    for (let phase = -3; phase <= 3; phase += 0.05) {
      const w = [];
      for (let k = 0; k < cols; k++) {
        const u = (k + 0.5) / cols;
        w.push(fbm1((u - 0.5) * scale + 17.3 + phase, seed * 31 + (p.warpSeedOffset ?? 0), OCTAVES));
      }
      // Least squares for amplitude a and offset b in ridge = b - a * w.
      let sw = 0;
      let sww = 0;
      let sr = 0;
      let swr = 0;
      for (let k = 0; k < cols; k++) {
        sw += w[k];
        sww += w[k] * w[k];
        sr += ridge[k];
        swr += w[k] * ridge[k];
      }
      const n = cols;
      const den = n * sww - sw * sw;
      if (Math.abs(den) < 1e-9) continue;
      const a = -(n * swr - sw * sr) / den;
      const b = (sr + a * sw) / n;
      if (a <= 0) continue;
      let err = 0;
      for (let k = 0; k < cols; k++) err += (b - a * w[k] - ridge[k]) ** 2;
      if (err < bestErr) {
        bestErr = err;
        bestCfg = { seed, warpScale: +scale.toFixed(2), warpPhase: +phase.toFixed(2), warp: +a.toFixed(4), horizon: +b.toFixed(4) };
      }
    }
  }
}
console.log("best:", JSON.stringify(bestCfg), "rms", Math.sqrt(bestErr / cols).toFixed(4));
console.log(`current horizon ${base}`);
