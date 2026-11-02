// 2D autocorrelation of the luma high-pass in a patch, written as an image,
// plus the strongest off-center peaks. Usage:
// node tools/texture.mjs <in.png> <x> <y> <w> <h> <out.png> [sigma=3] [maxLag=16]
import { readLinear, writeRgb8, zoom8 } from '../lib/image.mjs';
import { linearToSrgb } from '../lib/color.mjs';
import { gaussBlurPlane } from '../lib/blur.mjs';

const [, , inPath, xs, ys, ws, hs, outPath, sig = '3', lag = '16'] = process.argv;
const img = await readLinear(inPath);
const [x0, y0, pw, ph, sigma, L] = [+xs, +ys, +ws, +hs, +sig, +lag];
const luma = new Float32Array(pw * ph);
for (let y = 0; y < ph; y++) {
  for (let x = 0; x < pw; x++) {
    const i = ((y0 + y) * img.w + x0 + x) * 3;
    luma[y * pw + x] =
      0.2126 * linearToSrgb(img.data[i]) + 0.7152 * linearToSrgb(img.data[i + 1]) + 0.0722 * linearToSrgb(img.data[i + 2]);
  }
}
const low = gaussBlurPlane(luma, pw, ph, sigma);
const hp = luma.map((v, i) => v - low[i]);
const size = 2 * L + 1;
const ac = new Float64Array(size * size);
let v0 = 0;
for (let i = 0; i < hp.length; i++) v0 += hp[i] * hp[i];
v0 /= hp.length;
for (let dy = -L; dy <= L; dy++) {
  for (let dx = -L; dx <= L; dx++) {
    let s = 0;
    let n = 0;
    for (let y = Math.max(0, -dy); y < Math.min(ph, ph - dy); y++) {
      for (let x = Math.max(0, -dx); x < Math.min(pw, pw - dx); x++) {
        s += hp[y * pw + x] * hp[(y + dy) * pw + x + dx];
        n++;
      }
    }
    ac[(dy + L) * size + dx + L] = s / n / v0;
  }
}
const out = new Uint8Array(size * size * 3);
for (let i = 0; i < size * size; i++) {
  const v = ac[i];
  const r = v > 0 ? Math.min(255, Math.round(v * 255 * 2)) : 0;
  const b = v < 0 ? Math.min(255, Math.round(-v * 255 * 4)) : 0;
  out.set([r, Math.round(Math.max(0, v) * 120), b], i * 3);
}
const z = zoom8({ w: size, h: size, data: out }, 12);
await writeRgb8(outPath, z.w, z.h, z.data);
const peaks = [];
for (let dy = -L; dy <= L; dy++) {
  for (let dx = -L; dx <= L; dx++) {
    if (dx * dx + dy * dy < 9) continue;
    const v = ac[(dy + L) * size + dx + L];
    let isMax = true;
    for (let j = -1; j <= 1 && isMax; j++) {
      for (let i = -1; i <= 1; i++) {
        if (!i && !j) continue;
        const yy = dy + j;
        const xx = dx + i;
        if (Math.abs(yy) > L || Math.abs(xx) > L) continue;
        if (ac[(yy + L) * size + xx + L] > v) isMax = false;
      }
    }
    if (isMax && v > 0.05 && (dy > 0 || (dy === 0 && dx > 0))) peaks.push({ dx, dy, v: +v.toFixed(3) });
  }
}
peaks.sort((a, b) => b.v - a.v);
console.log(`std ${(Math.sqrt(v0) * 255).toFixed(2)} (0..255 units); peaks:`, JSON.stringify(peaks.slice(0, 8)));
const row = [];
for (let dx = 0; dx <= 6; dx++) row.push(ac[L * size + dx + L].toFixed(2));
const col = [];
for (let dy = 0; dy <= 6; dy++) col.push(ac[(dy + L) * size + L].toFixed(2));
console.log('ac along x:', row.join(' '), ' along y:', col.join(' '));
if (process.env.AC_GRID) {
  const R = 6;
  for (let dy = -R; dy <= R; dy++) {
    const cells = [];
    for (let dx = -R; dx <= R; dx++) cells.push(ac[(dy + L) * size + dx + L].toFixed(2).padStart(5));
    console.log(`dy=${String(dy).padStart(3)} ${cells.join(' ')}`);
  }
}
