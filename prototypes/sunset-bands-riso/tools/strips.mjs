// Oklab L (and optionally hue) per vertical strip and row step, to see how band
// edges move along x. Usage: node tools/strips.mjs <referenceId|png> <strips> <rowStep> [L|hex] [render.png]
import { readLinear, readAlpha } from '../lib/image.mjs';
import { buildMask, rowMeans } from '../lib/measure.mjs';
import { linearToOklab, linearToHex } from '../lib/color.mjs';
import { getRef } from '../refs.mjs';

const [, , id, ns = '8', steps = '32', mode = 'L', renderPath] = process.argv;
const ref = getRef(id);
const img = await readLinear(renderPath ?? ref.file);
const { a } = await readAlpha(ref.file);
const mask = buildMask(img.w, img.h, a, ref.ignore);
const n = +ns;
const cols = [];
for (let k = 0; k < n; k++) cols.push(rowMeans(img, mask, Math.floor((k * img.w) / n), Math.floor(((k + 1) * img.w) / n)));
for (let y = 0; y < img.h; y += +steps) {
  const cells = cols.map((r) => {
    const rgb = [r[y * 3], r[y * 3 + 1], r[y * 3 + 2]];
    if (Number.isNaN(rgb[0])) return '   -   ';
    return mode === 'hex' ? linearToHex(rgb) : linearToOklab(...rgb)[0].toFixed(3).padStart(6);
  });
  console.log(`${String(y).padStart(5)} ${cells.join(' ')}`);
}
