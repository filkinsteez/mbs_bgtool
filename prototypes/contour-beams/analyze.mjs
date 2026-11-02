// Prints a grid of cell-mean colors for a reference and writes enlarged
// crops to out/. Used only to read the reference by eye and by a few
// measurements; the renderer never reads reference pixels.
//
//   node prototypes/contour-beams/analyze.mjs <png> <gx> <gy> [x,y,w,h,scale ...]
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linearToHex, linearToOklab, srgbToLinear } from './lib/color.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [file, gxs = '8', gys = '12', ...crops] = process.argv.slice(2);
const gx = Number(gxs);
const gy = Number(gys);

const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const sums = new Float64Array(gx * gy * 4);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (data[i + 3] !== 255) continue;
    const c = (Math.min(gy - 1, Math.floor((y / h) * gy)) * gx + Math.min(gx - 1, Math.floor((x / w) * gx))) * 4;
    sums[c] += srgbToLinear(data[i] / 255);
    sums[c + 1] += srgbToLinear(data[i + 1] / 255);
    sums[c + 2] += srgbToLinear(data[i + 2] / 255);
    sums[c + 3] += 1;
  }
}
console.log(`${path.basename(file)} ${w}x${h}, grid ${gx}x${gy} (hex of linear cell means, then Oklab L)`);
for (let y = 0; y < gy; y++) {
  const hexes = [];
  const ls = [];
  for (let x = 0; x < gx; x++) {
    const c = (y * gx + x) * 4;
    const n = Math.max(1, sums[c + 3]);
    const lin = [sums[c] / n, sums[c + 1] / n, sums[c + 2] / n];
    hexes.push(linearToHex(lin));
    ls.push(String(Math.round(linearToOklab(lin)[0] * 100)).padStart(3));
  }
  console.log(`${String(Math.round(((y + 0.5) / gy) * h)).padStart(5)}  ${hexes.join(' ')}  L:${ls.join('')}`);
}

let n = 0;
for (const spec of crops) {
  const [x, y, cw, ch, s] = spec.split(',').map(Number);
  const out = path.join(here, 'out', `crop-${path.basename(file, '.png')}-${n++}.png`);
  await sharp(file)
    .flatten({ background: '#000000' })
    .extract({ left: x, top: y, width: cw, height: ch })
    .resize(cw * s, ch * s, { kernel: 'nearest' })
    .png()
    .toFile(out);
  console.log('crop', out);
}
