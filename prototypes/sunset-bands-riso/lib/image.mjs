import sharp from 'sharp';
import { srgbToLinear } from './color.mjs';

// RGB float image, row-major, 3 floats per pixel.
export class Img {
  constructor(w, h, data) {
    this.w = w;
    this.h = h;
    this.data = data ?? new Float32Array(w * h * 3);
  }

  clone() {
    return new Img(this.w, this.h, new Float32Array(this.data));
  }
}

const SRGB_TO_LINEAR_LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) SRGB_TO_LINEAR_LUT[i] = srgbToLinear(i / 255);

// Reads a PNG, flattens alpha onto `matte` (sRGB 0..255), returns linear RGB.
export async function readLinear(path, matte = [255, 255, 255]) {
  const { data, info } = await sharp(path)
    .flatten({ background: { r: matte[0], g: matte[1], b: matte[2] } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const img = new Img(info.width, info.height);
  for (let i = 0; i < info.width * info.height * 3; i++) {
    img.data[i] = SRGB_TO_LINEAR_LUT[data[i]];
  }
  return img;
}

export async function readAlpha(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = new Float32Array(info.width * info.height);
  for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3] / 255;
  return { w: info.width, h: info.height, a };
}

// Reads 8-bit sRGB values (no linearization) as Uint8 RGB.
export async function readSrgb8(path) {
  const { data, info } = await sharp(path)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data };
}

export async function writeRgb8(path, w, h, rgb8) {
  await sharp(Buffer.from(rgb8.buffer, rgb8.byteOffset, rgb8.byteLength), {
    raw: { width: w, height: h, channels: 3 },
  })
    .png({ compressionLevel: 6 })
    .toFile(path);
}

export async function writeJpeg(path, w, h, rgb8, quality = 86) {
  await sharp(Buffer.from(rgb8.buffer, rgb8.byteOffset, rgb8.byteLength), {
    raw: { width: w, height: h, channels: 3 },
  })
    .jpeg({ quality, mozjpeg: true })
    .toFile(path);
}

// 8-bit RGB buffers: { w, h, data: Uint8Array }.
export function hstack(images, gap = 8, gapValue = 255) {
  const h = Math.max(...images.map((i) => i.h));
  const w = images.reduce((s, i) => s + i.w, 0) + gap * (images.length - 1);
  const out = new Uint8Array(w * h * 3).fill(gapValue);
  let x0 = 0;
  for (const im of images) {
    for (let y = 0; y < im.h; y++) {
      const src = y * im.w * 3;
      const dst = (y * w + x0) * 3;
      out.set(im.data.subarray(src, src + im.w * 3), dst);
    }
    x0 += im.w + gap;
  }
  return { w, h, data: out };
}

export function vstack(images, gap = 8, gapValue = 255) {
  const w = Math.max(...images.map((i) => i.w));
  const h = images.reduce((s, i) => s + i.h, 0) + gap * (images.length - 1);
  const out = new Uint8Array(w * h * 3).fill(gapValue);
  let y0 = 0;
  for (const im of images) {
    for (let y = 0; y < im.h; y++) {
      out.set(im.data.subarray(y * im.w * 3, (y + 1) * im.w * 3), ((y0 + y) * w) * 3);
    }
    y0 += im.h + gap;
  }
  return { w, h, data: out };
}

export function crop8(im, x, y, w, h) {
  const out = new Uint8Array(w * h * 3);
  for (let j = 0; j < h; j++) {
    const sy = Math.min(im.h - 1, Math.max(0, y + j));
    for (let i = 0; i < w; i++) {
      const sx = Math.min(im.w - 1, Math.max(0, x + i));
      const s = (sy * im.w + sx) * 3;
      const d = (j * w + i) * 3;
      out[d] = im.data[s];
      out[d + 1] = im.data[s + 1];
      out[d + 2] = im.data[s + 2];
    }
  }
  return { w, h, data: out };
}

export function zoom8(im, k) {
  const w = im.w * k;
  const h = im.h * k;
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / k);
    for (let x = 0; x < w; x++) {
      const s = (sy * im.w + Math.floor(x / k)) * 3;
      const d = (y * w + x) * 3;
      out[d] = im.data[s];
      out[d + 1] = im.data[s + 1];
      out[d + 2] = im.data[s + 2];
    }
  }
  return { w, h, data: out };
}

// Downscale by an integer factor with box averaging (8-bit in, 8-bit out).
export function shrink8(im, k) {
  const w = Math.floor(im.w / k);
  const h = Math.floor(im.h / k);
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let j = 0; j < k; j++) {
          for (let i = 0; i < k; i++) s += im.data[((y * k + j) * im.w + x * k + i) * 3 + c];
        }
        out[(y * w + x) * 3 + c] = Math.round(s / (k * k));
      }
    }
  }
  return { w, h, data: out };
}
