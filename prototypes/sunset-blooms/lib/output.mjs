// Engine output stage: exposure, tone curve, exact sRGB encode, grain at
// output size, ±1 LSB triangular dither, 8-bit.
import { linearToSrgb } from './color.mjs';
import { hash3 } from './noise.mjs';

// Colors with max channel <= 1 pass through unchanged. Above 1 the color
// keeps its chromaticity and mixes toward white. The mix rate at m = 1 is
// chosen so luminance keeps the same slope on both sides of m = 1, which is
// what keeps a ring from showing where the roll-off starts.
export function toneMap(r, g, b, out) {
  const m = Math.max(r, g, b);
  if (m <= 1) {
    out[0] = r;
    out[1] = g;
    out[2] = b;
    return out;
  }
  const cr = r / m;
  const cg = g / m;
  const cb = b / m;
  const y = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
  const k = Math.min(8, Math.max(0.15, y / Math.max(1e-4, 1 - y)));
  const t = 1 - 1 / (1 + k * (m - 1));
  out[0] = cr + (1 - cr) * t;
  out[1] = cg + (1 - cg) * t;
  out[2] = cb + (1 - cb) * t;
  return out;
}

function gaussish(x, y, seed) {
  return (hash3(x, y, seed) + hash3(x, y, seed + 1) + hash3(x, y, seed + 2) - 1.5) * 2;
}

// img: linear radiance. Returns 8-bit sRGB { w, h, data }.
export function outputStage(img, output = {}, seed = 1) {
  const { w, h, data } = img;
  const exposure = Math.pow(2, output.exposure ?? 0);
  const grain = output.grain ?? 0;
  const dither = output.dither ?? 1;
  const out8 = { w, h, data: new Uint8Array(w * h * 3) };
  const t = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      toneMap(data[i] * exposure, data[i + 1] * exposure, data[i + 2] * exposure, t);
      const n = grain > 0 ? gaussish(x, y, seed * 7919 + 11) * grain : 0;
      for (let c = 0; c < 3; c++) {
        let v = linearToSrgb(t[c]);
        // Grain is the same for all channels so it changes lightness, not hue.
        // It fades toward black and white so it can't push values past them.
        v += n * Math.min(1, 4 * v * (1 - v) + 0.25);
        if (dither) v += ((hash3(x, y, seed * 31 + c) + hash3(x, y, seed * 37 + c + 5) - 1) * dither) / 255;
        out8.data[i + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    }
  }
  return out8;
}
