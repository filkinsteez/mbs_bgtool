// Fine-texture level of a reference: standard deviation of (image - blurred
// image) in sRGB code values, per region, so grain settings can be matched.
// Usage: node grain-measure.mjs <referenceId | path.png>
import { gaussianBlur } from './lib/blur.mjs';
import { linearToSrgb } from './lib/color.mjs';
import { loadImage } from './lib/image.mjs';
import { loadReference } from './lib/refs.mjs';

const arg = process.argv[2];
const ref = arg.endsWith('.png') ? { ...(await loadImage(arg)), mask: null } : await loadReference(arg);
const { w, h } = ref;
const blurred = gaussianBlur(ref.img, 3);
const rows = 4;
const cols = 3;
for (let ry = 0; ry < rows; ry++) {
  const line = [];
  for (let rx = 0; rx < cols; rx++) {
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    const x0 = Math.floor((rx / cols) * w) + 10;
    const x1 = Math.floor(((rx + 1) / cols) * w) - 10;
    const y0 = Math.floor((ry / rows) * h) + 10;
    const y1 = Math.floor(((ry + 1) / rows) * h) - 10;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (ref.mask && !ref.mask[y * w + x]) continue;
        const i = (y * w + x) * 3;
        for (let c = 0; c < 3; c++) {
          const d = (linearToSrgb(ref.img.data[i + c]) - linearToSrgb(blurred.data[i + c])) * 255;
          sum += d;
          sum2 += d * d;
          n++;
        }
      }
    }
    const mean = sum / n;
    line.push(Math.sqrt(sum2 / n - mean * mean).toFixed(2).padStart(6));
  }
  console.log(`rows ${ry + 1}/${rows}: ` + line.join(' '));
}
