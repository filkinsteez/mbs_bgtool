// Diagnostic: prints each band's radiance down the centre column of a preset,
// normalised to that band's maximum, plus the absolute maxima.
// Usage: node bands.mjs presets/<id>.json [--set k=v ...] [--x 0.5]

import { readFileSync } from "node:fs";
import { renderScene } from "./lib/scene.mjs";
import { applySets } from "./render.mjs";

const args = process.argv.slice(2);
const sets = [];
let xf = 0.5;
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--set") sets.push(args[++i]);
  else if (args[i] === "--x") xf = Number(args[++i]);
}
const preset = applySets(JSON.parse(readFileSync(args[0], "utf8")), sets);
const w = 64;
const h = 200;
const { basis } = renderScene(preset.scene, w, h, { basis: true });
const x = Math.min(w - 1, Math.floor(xf * w));
const maxes = basis.map((b) => {
  let m = 0;
  for (let y = 0; y < h; y++) m = Math.max(m, b[y * w + x]);
  return m;
});
console.log(`band maxima: ${maxes.map((m) => m.toExponential(2)).join("  ")}`);
for (let k = 0; k < 20; k++) {
  const y = Math.floor(((k + 0.5) / 20) * h);
  const cells = basis.map((b, i) => (b[y * w + x] / maxes[i]).toFixed(2));
  const abs = basis.map((b) => b[y * w + x].toExponential(1));
  console.log(`y=${(y / h).toFixed(2)}  rel ${cells.join(" ")}   abs ${abs.join(" ")}`);
}
