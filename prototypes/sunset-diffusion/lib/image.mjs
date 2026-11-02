// Planar float images (one Float32Array per channel), PNG I/O through sharp,
// separable blurs, and composition helpers for side-by-side audits.
import sharp from 'sharp';
import { srgbToLinear } from './color.mjs';

export function makeImage(w, h, channels = 3) {
  const ch = [];
  for (let i = 0; i < channels; i++) ch.push(new Float32Array(w * h));
  return { w, h, ch };
}

export function cloneImage(img) {
  return { w: img.w, h: img.h, ch: img.ch.map((c) => new Float32Array(c)) };
}

// Loads a PNG as linear RGB plus an sRGB copy. Alpha is dropped.
export async function loadReference(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  const lin = makeImage(w, h, 3);
  const srgb = makeImage(w, h, 3);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) {
      const v = data[i * channels + c];
      srgb.ch[c][i] = v / 255;
      lin.ch[c][i] = lut[v];
    }
  }
  return { w, h, lin, srgb };
}

export function rgb8FromSrgbImage(img) {
  const out = new Uint8Array(img.w * img.h * 3);
  for (let i = 0; i < img.w * img.h; i++) {
    for (let c = 0; c < 3; c++) {
      out[i * 3 + c] = Math.max(0, Math.min(255, Math.round(img.ch[c][i] * 255)));
    }
  }
  return out;
}

export async function writePng(path, w, h, rgb8) {
  await sharp(Buffer.from(rgb8.buffer, rgb8.byteOffset, rgb8.byteLength), {
    raw: { width: w, height: h, channels: 3 },
  })
    .png()
    .toFile(path);
}

export async function writeJpeg(path, w, h, rgb8, quality = 88) {
  await sharp(Buffer.from(rgb8.buffer, rgb8.byteOffset, rgb8.byteLength), {
    raw: { width: w, height: h, channels: 3 },
  })
    .jpeg({ quality, chromaSubsampling: '4:4:4' })
    .toFile(path);
}

// One box pass along a line with a running sum; edges clamp.
function boxLine(src, dst, n, stride, offset, r) {
  if (r < 1) {
    for (let i = 0; i < n; i++) dst[offset + i * stride] = src[offset + i * stride];
    return;
  }
  const inv = 1 / (2 * r + 1);
  const at = (i) => src[offset + Math.min(n - 1, Math.max(0, i)) * stride];
  let acc = 0;
  for (let i = -r; i <= r; i++) acc += at(i);
  for (let i = 0; i < n; i++) {
    dst[offset + i * stride] = acc * inv;
    acc += at(i + r + 1) - at(i - r);
  }
}

// Three box passes per axis approximate a gaussian with the given sigma (px).
export function blurChannel(data, w, h, sigmaX, sigmaY = sigmaX) {
  const tmp = new Float32Array(w * h);
  const radius = (s) => Math.max(0, Math.round((Math.sqrt(4 * s * s + 1) - 1) / 2));
  const rx = radius(sigmaX);
  const ry = radius(sigmaY);
  let a = data;
  let b = tmp;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) boxLine(a, b, w, 1, y * w, rx);
    [a, b] = [b, a];
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let x = 0; x < w; x++) boxLine(a, b, h, w, x, ry);
    [a, b] = [b, a];
  }
  if (a !== data) data.set(a);
  return data;
}

export function blurImage(img, sigmaX, sigmaY = sigmaX) {
  for (const c of img.ch) blurChannel(c, img.w, img.h, sigmaX, sigmaY);
  return img;
}

// Bilinear sample of one channel at pixel-space coordinates (centers at i + 0.5).
export function sampleBilinear(data, w, h, x, y) {
  const fx = Math.min(w - 1, Math.max(0, x - 0.5));
  const fy = Math.min(h - 1, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = data[y0 * w + x0] + (data[y0 * w + x1] - data[y0 * w + x0]) * tx;
  const b = data[y1 * w + x0] + (data[y1 * w + x1] - data[y1 * w + x0]) * tx;
  return a + (b - a) * ty;
}

// Joins 8-bit RGB buffers left to right with a gap.
export function hconcat(parts, gap = 12, gapValue = 255) {
  const h = Math.max(...parts.map((p) => p.h));
  const w = parts.reduce((s, p) => s + p.w, 0) + gap * (parts.length - 1);
  const out = new Uint8Array(w * h * 3).fill(gapValue);
  let x0 = 0;
  for (const p of parts) {
    for (let y = 0; y < p.h; y++) {
      out.set(p.data.subarray(y * p.w * 3, (y + 1) * p.w * 3), (y * w + x0) * 3);
    }
    x0 += p.w + gap;
  }
  return { w, h, data: out };
}

export function vconcat(parts, gap = 12, gapValue = 255) {
  const w = Math.max(...parts.map((p) => p.w));
  const h = parts.reduce((s, p) => s + p.h, 0) + gap * (parts.length - 1);
  const out = new Uint8Array(w * h * 3).fill(gapValue);
  let y0 = 0;
  for (const p of parts) {
    for (let y = 0; y < p.h; y++) {
      out.set(p.data.subarray(y * p.w * 3, (y + 1) * p.w * 3), ((y0 + y) * w) * 3);
    }
    y0 += p.h + gap;
  }
  return { w, h, data: out };
}

// Nearest-neighbor zoom of a crop of an 8-bit RGB buffer.
export function zoomCrop(src, sw, x0, y0, cw, ch, scale) {
  const w = cw * scale;
  const h = ch * scale;
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy = y0 + Math.floor(y / scale);
    for (let x = 0; x < w; x++) {
      const sx = x0 + Math.floor(x / scale);
      const si = (sy * sw + sx) * 3;
      const di = (y * w + x) * 3;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
    }
  }
  return { w, h, data: out };
}

export function rgb8FromLinear(img) {
  const out = new Uint8Array(img.w * img.h * 3);
  for (let i = 0; i < img.w * img.h; i++) {
    for (let c = 0; c < 3; c++) {
      const v = img.ch[c][i];
      const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055;
      out[i * 3 + c] = Math.max(0, Math.min(255, Math.round(s * 255)));
    }
  }
  return out;
}
