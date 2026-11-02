// Posterized contour maps of an image: Oklab lightness in steps (left) and
// hue in steps (right), to see the shape of the iso-lines.
// Usage: node contours.mjs <referenceId | path.png> <out.png> [Lstep] [hueStep]
import { gaussianBlur } from './lib/blur.mjs';
import { linearToOklab, linearToSrgb, oklabToLinear } from './lib/color.mjs';
import { loadImage, saveBytes } from './lib/image.mjs';
import { loadReference } from './lib/refs.mjs';

const [src, outPath, lStepArg, hStepArg] = process.argv.slice(2);
const lStep = Number(lStepArg ?? 0.02);
const hStep = Number(hStepArg ?? 15);
const ref = src.endsWith('.png') ? await loadImage(src) : await loadReference(src);
const img = gaussianBlur(ref.img, 3);
const { w, h } = img;
const bytes = new Uint8Array(w * 2 * h * 3);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    const [L, a, b] = linearToOklab(img.data[i], img.data[i + 1], img.data[i + 2]);
    const band = Math.floor(L / lStep);
    const v = band % 2 ? 0.25 : 0.85;
    const li = (y * 2 * w + x) * 3;
    bytes[li] = bytes[li + 1] = bytes[li + 2] = Math.round(v * 255);
    const hue = Math.atan2(b, a);
    const q = (Math.floor(((hue * 180) / Math.PI + 360) / hStep) + 0.5) * hStep * (Math.PI / 180);
    const C = Math.hypot(a, b) < 0.02 ? 0 : 0.12;
    const rgb = oklabToLinear(0.72, C * Math.cos(q), C * Math.sin(q));
    const ci = (y * 2 * w + w + x) * 3;
    for (let c = 0; c < 3; c++) bytes[ci + c] = Math.round(Math.min(1, Math.max(0, linearToSrgb(rgb[c]))) * 255);
  }
}
await saveBytes(bytes, w * 2, h, outPath);
