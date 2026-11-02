// Renders variants of a preset at reduced size and writes one sheet:
// reference first, then each variant in order.
// Usage: node sweep.mjs presets/<id>.json <name> "k=v k=v" "k=v" ...

import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderFinal } from "./lib/pipeline.mjs";
import { loadReference, linearToBytes, bytesToLinear, blurredDeltaE } from "./lib/image.mjs";
import { referencePath, applySets } from "./render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [, , presetFile, name, ...variants] = process.argv;
const base = readFileSync(presetFile, "utf8");
const id = JSON.parse(base).referenceId;
const { path, cornerRadius } = referencePath(id);
const ref = await loadReference(path, cornerRadius);
const cellH = 420;
const w = Math.round((ref.width * cellH) / ref.height);
const h = cellH;
const refSmall = await sharp(Buffer.from(linearToBytes(ref).data), {
  raw: { width: ref.width, height: ref.height, channels: 3 },
})
  .resize(w, h)
  .raw()
  .toBuffer();
const refSmallLin = bytesToLinear({ width: w, height: h, data: new Uint8Array(refSmall) });
const mask = new Uint8Array(w * h).fill(1);
const cells = [refSmall];
for (const v of variants) {
  const preset = applySets(JSON.parse(base), v.split(" ").filter(Boolean));
  const out = renderFinal(preset.scene, w, h, { noGrain: true });
  const dE = blurredDeltaE(refSmallLin, bytesToLinear(out), mask, 3);
  console.log(`${v.padEnd(60)} dE ${dE.mean.toFixed(2)}`);
  cells.push(Buffer.from(out.data));
}
const gap = 6;
const cols = Math.min(cells.length, 6);
const rows = Math.ceil(cells.length / cols);
const W = cols * w + (cols - 1) * gap;
const H = rows * h + (rows - 1) * gap;
mkdirSync(join(here, "out", "sweeps"), { recursive: true });
const file = join(here, "out", "sweeps", `${name}.png`);
await sharp({ create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  .composite(
    cells.map((c, i) => ({
      input: c,
      raw: { width: w, height: h, channels: 3 },
      left: (i % cols) * (w + gap),
      top: Math.floor(i / cols) * (h + gap),
    })),
  )
  .png()
  .toFile(file);
console.log(file);
