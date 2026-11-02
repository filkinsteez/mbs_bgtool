// Generality check: renders production presets (pack colors only) at 16:9
// and 9:16 with two seeds, and writes one sheet per preset.
// Usage: node variations.mjs presets/production-*.json [--seeds 1,2] [--scale 1]

import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderFinal } from "./lib/pipeline.mjs";
import { saveBytes } from "./lib/image.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const files = [];
let seeds = [1, 2];
let scale = 1;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--seeds") seeds = args[++i].split(",").map(Number);
  else if (args[i] === "--scale") scale = Number(args[++i]);
  else files.push(args[i]);
}
const sizes = [
  [1920, 1080],
  [1080, 1920],
];
const outDir = join(here, "out", "variations");
mkdirSync(outDir, { recursive: true });

for (const file of files) {
  const preset = JSON.parse(readFileSync(file, "utf8"));
  const name = basename(file, ".json");
  const tiles = [];
  for (const [w0, h0] of sizes) {
    for (const seed of seeds) {
      const w = Math.round(w0 * scale);
      const h = Math.round(h0 * scale);
      const scene = { ...preset.scene, seed };
      const t0 = performance.now();
      const img = renderFinal(scene, w, h);
      const path = join(outDir, `${name}-${w0}x${h0}-s${seed}.png`);
      await saveBytes(path, img);
      console.log(`${path} ${(performance.now() - t0).toFixed(0)} ms`);
      tiles.push({ path, w, h });
    }
  }
  // Sheet: landscape tiles in the first row, portrait tiles in the second.
  const cellH = 360;
  const gap = 8;
  const rows = [tiles.filter((t) => t.w > t.h), tiles.filter((t) => t.w <= t.h)];
  const rowH = [cellH, cellH * 1.6];
  const comps = [];
  let width = 0;
  let top = 0;
  for (let r = 0; r < rows.length; r++) {
    let left = 0;
    for (const t of rows[r]) {
      const tw = Math.round((t.w * rowH[r]) / t.h);
      const buf = await sharp(t.path).resize(tw, Math.round(rowH[r])).png().toBuffer();
      comps.push({ input: buf, left, top });
      left += tw + gap;
    }
    width = Math.max(width, left - gap);
    top += Math.round(rowH[r]) + gap;
  }
  const sheet = join(outDir, `${name}-sheet.png`);
  await sharp({ create: { width, height: top - gap, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(comps)
    .png()
    .toFile(sheet);
  console.log(sheet);
}
