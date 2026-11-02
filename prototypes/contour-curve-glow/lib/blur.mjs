// Gaussian blur built like a GPU mip-chain blur: box-downsample by 2 until
// the remaining sigma is small, run a separable kernel there, then
// bilinear-upsample back to full size.

import { Img } from './image.mjs';

export function downsample2(img) {
  const w = Math.max(1, Math.ceil(img.w / 2));
  const h = Math.max(1, Math.ceil(img.h / 2));
  const out = new Img(w, h);
  const src = img.data;
  const dst = out.data;
  for (let y = 0; y < h; y++) {
    const y0 = Math.min(2 * y, img.h - 1);
    const y1 = Math.min(2 * y + 1, img.h - 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(2 * x, img.w - 1);
      const x1 = Math.min(2 * x + 1, img.w - 1);
      const a = (y0 * img.w + x0) * 3;
      const b = (y0 * img.w + x1) * 3;
      const c = (y1 * img.w + x0) * 3;
      const d = (y1 * img.w + x1) * 3;
      const o = (y * w + x) * 3;
      for (let k = 0; k < 3; k++) dst[o + k] = 0.25 * (src[a + k] + src[b + k] + src[c + k] + src[d + k]);
    }
  }
  return out;
}

// Resamples img to w x h with bilinear filtering (pixel centers aligned).
export function resize(img, w, h) {
  const out = new Img(w, h);
  const sx = img.w / w;
  const sy = img.h / h;
  const tmp = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      img.sample((x + 0.5) * sx, (y + 0.5) * sy, tmp);
      const o = (y * w + x) * 3;
      out.data[o] = tmp[0];
      out.data[o + 1] = tmp[1];
      out.data[o + 2] = tmp[2];
    }
  }
  return out;
}

function kernel(sigma) {
  const r = Math.max(1, Math.ceil(3.2 * sigma));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return { k, r };
}

function separable(img, sigma) {
  const { k, r } = kernel(sigma);
  const { w, h } = img;
  const tmp = new Float32Array(w * h * 3);
  const out = new Img(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      let b = 0;
      let c = 0;
      for (let i = -r; i <= r; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        const o = (y * w + xx) * 3;
        const kv = k[i + r];
        a += img.data[o] * kv;
        b += img.data[o + 1] * kv;
        c += img.data[o + 2] * kv;
      }
      const o = (y * w + x) * 3;
      tmp[o] = a;
      tmp[o + 1] = b;
      tmp[o + 2] = c;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      let b = 0;
      let c = 0;
      for (let i = -r; i <= r; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        const o = (yy * w + x) * 3;
        const kv = k[i + r];
        a += tmp[o] * kv;
        b += tmp[o + 1] * kv;
        c += tmp[o + 2] * kv;
      }
      const o = (y * w + x) * 3;
      out.data[o] = a;
      out.data[o + 1] = b;
      out.data[o + 2] = c;
    }
  }
  return out;
}

export function gaussianBlur(img, sigma) {
  if (sigma < 0.35) return img.clone();
  let level = 0;
  let accVar = 0;
  let work = img;
  // Each 2x box downsample at level i adds variance (2^i)^2 / 3 in full-res px.
  while (level < 9 && sigma / 2 ** (level + 1) >= 2.5 && work.w > 8 && work.h > 8) {
    accVar += 4 ** level / 3;
    work = downsample2(work);
    level++;
  }
  const scale = 2 ** level;
  const residual = Math.sqrt(Math.max(0.09, sigma * sigma - accVar)) / scale;
  work = separable(work, residual);
  return level === 0 ? work : resize(work, img.w, img.h);
}
