// Separable gaussian blur, 2x box downsample, bilinear upsample, and a
// downsample/upsample bloom pyramid. Edges clamp, like CLAMP_TO_EDGE.
import { makeImage } from './image.mjs';

function gaussianKernel(sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3));
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

export function gaussianBlur(img, sigma) {
  if (sigma <= 0) return img;
  const { w, h } = img;
  const { k, r } = gaussianKernel(sigma);
  const tmp = makeImage(w, h);
  const out = makeImage(w, h);
  const src = img.data;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let a = 0, b = 0, c = 0;
      for (let i = -r; i <= r; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        const wt = k[i + r];
        const si = (row + xx) * 3;
        a += src[si] * wt;
        b += src[si + 1] * wt;
        c += src[si + 2] * wt;
      }
      const di = (row + x) * 3;
      tmp.data[di] = a;
      tmp.data[di + 1] = b;
      tmp.data[di + 2] = c;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0, b = 0, c = 0;
      for (let i = -r; i <= r; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        const wt = k[i + r];
        const si = (yy * w + x) * 3;
        a += tmp.data[si] * wt;
        b += tmp.data[si + 1] * wt;
        c += tmp.data[si + 2] * wt;
      }
      const di = (y * w + x) * 3;
      out.data[di] = a;
      out.data[di + 1] = b;
      out.data[di + 2] = c;
    }
  }
  return out;
}

export function downsample2(img) {
  const w = Math.max(1, Math.ceil(img.w / 2));
  const h = Math.max(1, Math.ceil(img.h / 2));
  const out = makeImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let j = 0; j < 2; j++) {
          for (let i = 0; i < 2; i++) {
            const xx = Math.min(img.w - 1, 2 * x + i);
            const yy = Math.min(img.h - 1, 2 * y + j);
            s += img.data[(yy * img.w + xx) * 3 + c];
          }
        }
        out.data[(y * w + x) * 3 + c] = s * 0.25;
      }
    }
  }
  return out;
}

export function upsampleTo(img, w, h) {
  const out = makeImage(w, h);
  const sx = img.w / w;
  const sy = img.h / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(img.h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(img.h - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(img.w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(img.w - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const a = img.data[(y0 * img.w + x0) * 3 + c];
        const b = img.data[(y0 * img.w + x1) * 3 + c];
        const d = img.data[(y1 * img.w + x0) * 3 + c];
        const e = img.data[(y1 * img.w + x1) * 3 + c];
        out.data[(y * w + x) * 3 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
    }
  }
  return out;
}

// Weighted sum of blurred mip levels 1..weights.length, upsampled level by
// level (each level: one downsample pass and one upsample+add pass on GPU).
// Returns an image whose total weight is 1, so mixing it in keeps energy.
export function bloomPyramid(img, weights) {
  const levels = [img];
  for (let k = 1; k <= weights.length; k++) levels.push(downsample2(levels[k - 1]));
  const total = weights.reduce((s, v) => s + v, 0) || 1;
  let acc = null;
  for (let k = weights.length; k >= 1; k--) {
    const blurred = gaussianBlur(levels[k], 1.2);
    const wk = weights[k - 1] / total;
    if (acc) {
      acc = upsampleTo(acc, levels[k].w, levels[k].h);
      for (let i = 0; i < acc.data.length; i++) acc.data[i] += blurred.data[i] * wk;
    } else {
      acc = blurred;
      for (let i = 0; i < acc.data.length; i++) acc.data[i] *= wk;
    }
  }
  return upsampleTo(acc, img.w, img.h);
}
