// Prints row profiles of a reference or render: for each sampled row, the mean
// color of the left, middle and right thirds as hex plus Oklab L, C and hue.
// Usage: node measure.mjs <png> [rows=24]

import { loadReference } from "./lib/image.mjs";
import { linearToHex, linearToOklab } from "./lib/color.mjs";

const [, , file, rowsArg] = process.argv;
const rows = Number(rowsArg ?? 24);
const img = await loadReference(file);
const { width, height, data, mask } = img;

function meanRect(x0, x1, y0, y1) {
  const acc = [0, 0, 0];
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      acc[0] += data[i * 3];
      acc[1] += data[i * 3 + 1];
      acc[2] += data[i * 3 + 2];
      n++;
    }
  }
  return n ? acc.map((v) => v / n) : [0, 0, 0];
}

function describe(rgb) {
  const [L, a, b] = linearToOklab(...rgb);
  const C = Math.hypot(a, b);
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return `${linearToHex(rgb)} L${(L * 100).toFixed(0).padStart(3)} C${(C * 100).toFixed(0).padStart(3)} h${h.toFixed(0).padStart(4)}`;
}

console.log(`${file} ${width}x${height}`);
const band = Math.max(1, Math.floor(height / rows / 3));
for (let k = 0; k < rows; k++) {
  const yc = Math.round(((k + 0.5) / rows) * height);
  const y0 = Math.max(0, yc - band);
  const y1 = Math.min(height, yc + band);
  const cols = [0, 1, 2].map((j) =>
    describe(meanRect(Math.floor((j * width) / 3), Math.floor(((j + 1) * width) / 3), y0, y1)),
  );
  console.log(`y=${String(yc).padStart(5)} (${(yc / height).toFixed(2)})  ${cols.join("  |  ")}`);
}
