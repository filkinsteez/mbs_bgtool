// Compares texture autocorrelation of a reference and a render in named rects.
// Usage: node tools/accompare.mjs <ref.png> <render.png> name:x,y,w,h ...
import { readLinear, writeRgb8, zoom8, hstack } from '../lib/image.mjs';
import { linearToSrgb } from '../lib/color.mjs';
import { gaussBlurPlane } from '../lib/blur.mjs';
import { HERE } from '../refs.mjs';
import { join } from 'node:path';

const [, , refPath, renPath, ...rects] = process.argv;
const ref = await readLinear(refPath);
const ren = await readLinear(renPath);
const L = 6;

function ac(img, [x0, y0, pw, ph]) {
  const luma = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const i = ((y0 + y) * img.w + x0 + x) * 3;
      luma[y * pw + x] = 0.2126 * linearToSrgb(img.data[i]) + 0.7152 * linearToSrgb(img.data[i + 1]) + 0.0722 * linearToSrgb(img.data[i + 2]);
    }
  }
  const low = gaussBlurPlane(luma, pw, ph, 3);
  const hp = luma.map((v, i) => v - low[i]);
  let v0 = 0;
  for (const v of hp) v0 += v * v;
  v0 /= hp.length;
  const size = 2 * L + 1;
  const out = new Float64Array(size * size);
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
      out[(dy + L) * size + dx + L] = s / n / v0;
    }
  }
  return { grid: out, std: Math.sqrt(v0) * 255 };
}

const toImg = (grid) => {
  const size = 2 * L + 1;
  const data = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    const v = grid[i];
    data.set([v > 0 ? Math.min(255, v * 510) : 0, Math.round(Math.max(0, v) * 120), v < 0 ? Math.min(255, -v * 1020) : 0], i * 3);
  }
  return zoom8({ w: size, h: size, data }, 14);
};

for (const spec of rects) {
  const [name, r] = spec.split(':');
  const rect = r.split(',').map(Number);
  const a = ac(ref, rect);
  const b = ac(ren, rect);
  console.log(`== ${name} std ref ${a.std.toFixed(2)} ren ${b.std.toFixed(2)}`);
  const size = 2 * L + 1;
  for (let dy = -2; dy <= 4; dy++) {
    const row = (g) => {
      const cells = [];
      for (let dx = -4; dx <= 4; dx++) cells.push(g[(dy + L) * size + dx + L].toFixed(2).padStart(5));
      return cells.join(' ');
    };
    console.log(`dy=${String(dy).padStart(2)} ref ${row(a.grid)}  | ren ${row(b.grid)}`);
  }
  const pair = hstack([toImg(a.grid), toImg(b.grid)], 10, 128);
  await writeRgb8(join(HERE, 'out', 'ref', `ac-${name}.png`), pair.w, pair.h, pair.data);
}
