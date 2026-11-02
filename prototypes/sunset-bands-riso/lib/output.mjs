import { linearToSrgb } from './color.mjs';
import { hash01 } from './noise.mjs';

// Colors with max channel <= 1 pass through unchanged. Brighter colors keep
// their hue direction and blend toward white as the excess grows; the blend
// rate k matches the luminance slope at the knee so there is no visible ring.
export function toneCurve(r, g, b) {
  const m = Math.max(r, g, b);
  if (m <= 1) return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
  const cr = Math.max(0, r / m);
  const cg = Math.max(0, g / m);
  const cb = Math.max(0, b / m);
  const y0 = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
  const k = Math.min(8, y0 / Math.max(1e-3, 1 - y0));
  const t = 1 - Math.exp(-k * (m - 1));
  return [cr + (1 - cr) * t, cg + (1 - cg) * t, cb + (1 - cb) * t];
}

// Linear radiance -> tone curve -> exact sRGB encode, as floats 0..1.
export function encodeImage(img, exposure = 0) {
  const { w, h, data } = img;
  const gain = Math.pow(2, exposure);
  const enc = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = toneCurve(data[i * 3] * gain, data[i * 3 + 1] * gain, data[i * 3 + 2] * gain);
    enc[i * 3] = linearToSrgb(r);
    enc[i * 3 + 1] = linearToSrgb(g);
    enc[i * 3 + 2] = linearToSrgb(b);
  }
  return { w, h, data: enc };
}

// About +-1 LSB triangular dither, then 8-bit.
export function quantize(enc, seed = 7, amount = 1) {
  const { w, h, data } = enc;
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d = (hash01(x, y, seed) + hash01(x, y, seed + 1) - 1) * amount;
      for (let c = 0; c < 3; c++) {
        const v = Math.round(data[i * 3 + c] * 255 + d);
        out[i * 3 + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return { w, h, data: out };
}
