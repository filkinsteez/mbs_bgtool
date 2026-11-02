// Offline helper for reference presets: keeps the light parameters fixed and
// solves for the palette colors (one per band) that best match the reference,
// by non-negative least squares on a downsampled image. The renderer only ever
// receives the resulting hexes; no reference pixels reach it.
//
// Usage: node fit-colors.mjs presets/<id>.json [--set k=v ...] [--write]

import { readFileSync, writeFileSync } from "node:fs";
import { renderScene } from "./lib/scene.mjs";
import { loadReference } from "./lib/image.mjs";
import { linearToHex, luminance } from "./lib/color.mjs";
import { referencePath, applySets } from "./render.mjs";

const args = process.argv.slice(2);
const presetFile = args[0];
const sets = [];
let write = false;
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--set") sets.push(args[++i]);
  else if (args[i] === "--write") write = true;
}
const preset = applySets(JSON.parse(readFileSync(presetFile, "utf8")), sets);
preset.scene.output ??= {};
const { path, cornerRadius } = referencePath(preset.referenceId);
const ref = await loadReference(path, cornerRadius);

const f = 4;
const w = Math.floor(ref.width / f);
const h = Math.floor(ref.height / f);
const target = new Float64Array(w * h * 3);
const weight = new Float64Array(w * h);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let k = 0;
    for (let dy = 0; dy < f; dy++) {
      for (let dx = 0; dx < f; dx++) {
        const i = (y * f + dy) * ref.width + (x * f + dx);
        if (!ref.mask[i]) continue;
        r += ref.data[i * 3];
        g += ref.data[i * 3 + 1];
        b += ref.data[i * 3 + 2];
        k++;
      }
    }
    const j = y * w + x;
    if (k < f * f) continue;
    target[j * 3] = r / k;
    target[j * 3 + 1] = g / k;
    target[j * 3 + 2] = b / k;
    weight[j] = 1 / (luminance(r / k, g / k, b / k) + 0.05);
  }
}

const { basis } = renderScene(preset.scene, w, h, { basis: true });
const n = basis.length;
const A = Array.from({ length: n }, () => new Float64Array(n));
const B = Array.from({ length: 3 }, () => new Float64Array(n));
for (let j = 0; j < w * h; j++) {
  if (!weight[j]) continue;
  for (let p = 0; p < n; p++) {
    const bp = basis[p][j] * weight[j];
    for (let q = 0; q < n; q++) A[p][q] += bp * basis[q][j];
    for (let c = 0; c < 3; c++) B[c][p] += bp * target[j * 3 + c];
  }
}
// Small ridge term keeps nearly collinear bands from trading off wildly.
const trace = A.reduce((s, row, i) => s + row[i], 0);
for (let p = 0; p < n; p++) A[p][p] += 1e-4 * (trace / n);

function nnls(Am, bv) {
  const x = new Float64Array(n);
  for (let it = 0; it < 4000; it++) {
    for (let j = 0; j < n; j++) {
      let r = bv[j];
      for (let k = 0; k < n; k++) if (k !== j) r -= Am[j][k] * x[k];
      x[j] = Math.max(0, r / Am[j][j]);
    }
  }
  return x;
}
const cols = [0, 1, 2].map((c) => nnls(A, B[c]));
const colors = Array.from({ length: n }, (_, b) => [cols[0][b], cols[1][b], cols[2][b]]);
const exposure = preset.scene.output.exposure ?? 0;
const gain = Math.pow(2, exposure);
const maxc = Math.max(1e-6, ...colors.flat()) / gain;
const newExposure = exposure + Math.log2(maxc);
const scale = 1 / (gain * maxc);
const hexes = colors.map((c) => linearToHex(c.map((v) => v * scale)));
console.log(`fitted colors: ${JSON.stringify(hexes)}  exposure ${newExposure.toFixed(3)}`);
if (write) {
  const raw = JSON.parse(readFileSync(presetFile, "utf8"));
  raw.scene.colors = hexes;
  raw.scene.output = { ...(raw.scene.output ?? {}), exposure: Number(newExposure.toFixed(3)) };
  for (const s of sets) {
    const [k] = s.split("=");
    if (k !== "colors" && k !== "exposure") raw.scene.params[k] = preset.scene.params[k];
  }
  writeFileSync(presetFile, JSON.stringify(raw, null, 2) + "\n");
  console.log(`wrote ${presetFile}`);
}
