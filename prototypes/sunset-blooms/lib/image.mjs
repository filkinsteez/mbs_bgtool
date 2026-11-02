// Float32 linear-RGB images (3 channels, row-major) plus sharp I/O helpers.
import sharp from 'sharp';
import { srgbToLinear } from './color.mjs';

export function makeImage(w, h) {
  return { w, h, data: new Float32Array(w * h * 3) };
}

export function cloneImage(img) {
  return { w: img.w, h: img.h, data: new Float32Array(img.data) };
}

const SRGB_TO_LINEAR_LUT = new Float32Array(256).map((_, i) => srgbToLinear(i / 255));

// Reads any PNG/JPEG into linear float RGB. Alpha is dropped.
export async function readLinear(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const img = makeImage(info.width, info.height);
  for (let i = 0; i < info.width * info.height; i++) {
    for (let c = 0; c < 3; c++) img.data[i * 3 + c] = SRGB_TO_LINEAR_LUT[data[i * info.channels + c]];
  }
  return img;
}

export async function readSrgb8(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8Array(data) };
}

export async function writeSrgb8(path, rgb8) {
  const s = sharp(Buffer.from(rgb8.data.buffer, rgb8.data.byteOffset, rgb8.data.byteLength), {
    raw: { width: rgb8.w, height: rgb8.h, channels: 3 },
  });
  if (path.endsWith('.jpg')) await s.jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toFile(path);
  else await s.png({ compressionLevel: 6 }).toFile(path);
}

export function srgb8ToLinear(rgb8) {
  const img = makeImage(rgb8.w, rgb8.h);
  for (let i = 0; i < img.data.length; i++) img.data[i] = SRGB_TO_LINEAR_LUT[rgb8.data[i]];
  return img;
}

// Places 8-bit images in a row (or grid) with a gap; returns a new 8-bit image.
export function composeRow(images, gap = 8, bg = 255) {
  const h = Math.max(...images.map((i) => i.h));
  const w = images.reduce((s, i) => s + i.w, 0) + gap * (images.length - 1);
  const out = { w, h, data: new Uint8Array(w * h * 3).fill(bg) };
  let x0 = 0;
  for (const im of images) {
    for (let y = 0; y < im.h; y++) {
      out.data.set(im.data.subarray(y * im.w * 3, (y + 1) * im.w * 3), (y * w + x0) * 3);
    }
    x0 += im.w + gap;
  }
  return out;
}

export function composeColumn(images, gap = 8, bg = 255) {
  const w = Math.max(...images.map((i) => i.w));
  const h = images.reduce((s, i) => s + i.h, 0) + gap * (images.length - 1);
  const out = { w, h, data: new Uint8Array(w * h * 3).fill(bg) };
  let y0 = 0;
  for (const im of images) {
    for (let y = 0; y < im.h; y++) {
      out.data.set(im.data.subarray(y * im.w * 3, (y + 1) * im.w * 3), ((y0 + y) * w) * 3);
    }
    y0 += im.h + gap;
  }
  return out;
}

export function crop8(im, x, y, w, h) {
  const out = { w, h, data: new Uint8Array(w * h * 3) };
  for (let j = 0; j < h; j++) {
    out.data.set(im.data.subarray(((y + j) * im.w + x) * 3, ((y + j) * im.w + x + w) * 3), j * w * 3);
  }
  return out;
}

// Nearest-neighbour zoom so grain and banding stay visible.
export function zoom8(im, k) {
  const out = { w: im.w * k, h: im.h * k, data: new Uint8Array(im.w * k * im.h * k * 3) };
  for (let y = 0; y < out.h; y++) {
    const sy = (y / k) | 0;
    for (let x = 0; x < out.w; x++) {
      const si = (sy * im.w + ((x / k) | 0)) * 3;
      const di = (y * out.w + x) * 3;
      out.data[di] = im.data[si];
      out.data[di + 1] = im.data[si + 1];
      out.data[di + 2] = im.data[si + 2];
    }
  }
  return out;
}

export async function resize8(im, w, h) {
  const { data, info } = await sharp(Buffer.from(im.data), { raw: { width: im.w, height: im.h, channels: 3 } })
    .resize(w, h, { kernel: 'lanczos3', fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8Array(data) };
}
