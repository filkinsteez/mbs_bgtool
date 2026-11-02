// Float32 linear-RGB images and the engine's output stage:
// tone curve -> exact sRGB encode -> grain -> dither -> 8-bit PNG.
import sharp from 'sharp';
import { linearToSrgb, srgbToLinear } from './color.mjs';
import { hash2u } from './noise.mjs';

export function createImage(w, h) {
  return { w, h, data: new Float32Array(w * h * 3) };
}

export function cloneImage(img) {
  return { w: img.w, h: img.h, data: new Float32Array(img.data) };
}

export function addInto(dst, src, scale = 1) {
  const d = dst.data;
  const s = src.data;
  for (let i = 0; i < d.length; i++) d[i] += s[i] * scale;
  return dst;
}

export function scaleImage(img, k) {
  const d = img.data;
  for (let i = 0; i < d.length; i++) d[i] *= k;
  return img;
}

// Bilinear sample with clamp-to-edge, like a GPU texture fetch.
export function sampleBilinear(img, x, y, out) {
  const { w, h, data } = img;
  const fx = Math.min(Math.max(x - 0.5, 0), w - 1);
  const fy = Math.min(Math.max(y - 0.5, 0), h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const i00 = (y0 * w + x0) * 3;
  const i10 = (y0 * w + x1) * 3;
  const i01 = (y1 * w + x0) * 3;
  const i11 = (y1 * w + x1) * 3;
  for (let c = 0; c < 3; c++) {
    const a = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * tx;
    const b = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * tx;
    out[c] = a + (b - a) * ty;
  }
  return out;
}

// Tone curve. Colors whose max channel is <= 1 pass through unchanged.
// Above 1 the color moves toward white along a path whose luminance keeps a
// continuous value and slope at the boundary, so no ring appears there.
export function toneToWhite(r, g, b, out) {
  const m = Math.max(r, g, b);
  if (m <= 1) {
    out[0] = r;
    out[1] = g;
    out[2] = b;
    return out;
  }
  const ur = r / m;
  const ug = g / m;
  const ub = b / m;
  const yu = 0.2126 * ur + 0.7152 * ug + 0.0722 * ub;
  const k = yu >= 0.999 ? 1e6 : yu / (1 - yu);
  const t = 1 - Math.exp(-(m - 1) * k);
  out[0] = ur + (1 - ur) * t;
  out[1] = ug + (1 - ug) * t;
  out[2] = ub + (1 - ub) * t;
  return out;
}

// Full output stage. `grain` is the film grain amplitude in encoded units
// (0.01 to 0.02 is 1 to 2 percent). Dither is about +-1 LSB, triangular.
export function encodeOutput(img, { grain = 0, seed = 1, exposure = 0 } = {}) {
  const { w, h, data } = img;
  const out = Buffer.alloc(w * h * 3);
  const t = [0, 0, 0];
  const ex = Math.pow(2, exposure);
  const s = (seed * 0x9e3779b1) >>> 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      toneToWhite(
        Math.max(data[i] * ex, 0),
        Math.max(data[i + 1] * ex, 0),
        Math.max(data[i + 2] * ex, 0),
        t,
      );
      let gr = 0;
      if (grain > 0) {
        // Approximately gaussian luminance grain from four uniform hashes.
        const n =
          hash2u(x, y, s ^ 0x1234) +
          hash2u(x, y, s ^ 0x5678) +
          hash2u(x, y, s ^ 0x9abc) +
          hash2u(x, y, s ^ 0xdef0) -
          2;
        gr = n * grain * 1.73;
      }
      const d1 = hash2u(x, y, s ^ 0x2468ace);
      const d2 = hash2u(x, y, s ^ 0x13579bd);
      const dither = (d1 + d2 - 1) / 255;
      for (let c = 0; c < 3; c++) {
        const v = linearToSrgb(t[c]) + gr + dither;
        out[i + c] = Math.min(255, Math.max(0, Math.round(v * 255)));
      }
    }
  }
  return out;
}

export async function saveRgb8(path, buf, w, h) {
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } })
    .png({ compressionLevel: 6 })
    .toFile(path);
}

export async function saveLinear(path, img, opts = {}) {
  const buf = encodeOutput(img, opts);
  await saveRgb8(path, buf, img.w, img.h);
  return buf;
}

// Loads an 8-bit image as linear RGB. Pixels with alpha < 1 (the screenshots'
// rounded corners) are reported in `mask` (1 = use for measuring).
export async function loadLinear(path) {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const img = createImage(w, h);
  const mask = new Uint8Array(w * h);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
  for (let p = 0; p < w * h; p++) {
    img.data[p * 3] = lut[data[p * 4]];
    img.data[p * 3 + 1] = lut[data[p * 4 + 1]];
    img.data[p * 3 + 2] = lut[data[p * 4 + 2]];
    mask[p] = data[p * 4 + 3] === 255 ? 1 : 0;
  }
  return { img, mask };
}

export async function loadRgb8(path) {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { buf: data, w: info.width, h: info.height };
}
