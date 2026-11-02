// Blur passes that map to standard GPU passes: separable gaussian, a 2x
// downsample / tent upsample pyramid, directional blur, and a radial
// (zoom) blur toward a screen point.
import { createImage, sampleBilinear } from './image.mjs';

function gaussianKernel(sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(r * 2 + 1);
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
  if (sigma <= 0) return { w: img.w, h: img.h, data: new Float32Array(img.data) };
  const { w, h } = img;
  const { k, r } = gaussianKernel(sigma);
  const tmp = createImage(w, h);
  const out = createImage(w, h);
  const src = img.data;
  const t = tmp.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      let b = 0;
      let c = 0;
      for (let i = -r; i <= r; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        const j = (y * w + xx) * 3;
        const wt = k[i + r];
        a += src[j] * wt;
        b += src[j + 1] * wt;
        c += src[j + 2] * wt;
      }
      const o = (y * w + x) * 3;
      t[o] = a;
      t[o + 1] = b;
      t[o + 2] = c;
    }
  }
  const d = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      let b = 0;
      let c = 0;
      for (let i = -r; i <= r; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        const j = (yy * w + x) * 3;
        const wt = k[i + r];
        a += t[j] * wt;
        b += t[j + 1] * wt;
        c += t[j + 2] * wt;
      }
      const o = (y * w + x) * 3;
      d[o] = a;
      d[o + 1] = b;
      d[o + 2] = c;
    }
  }
  return out;
}

// 2x downsample with a 4x4 [1 3 3 1] kernel (one bilinear-tap pattern on GPU).
export function downsample2(img) {
  const w = Math.max(1, Math.ceil(img.w / 2));
  const h = Math.max(1, Math.ceil(img.h / 2));
  const out = createImage(w, h);
  const kw = [1, 3, 3, 1];
  const src = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      let b = 0;
      let c = 0;
      let ws = 0;
      for (let j = 0; j < 4; j++) {
        const yy = Math.min(img.h - 1, Math.max(0, y * 2 - 1 + j));
        for (let i = 0; i < 4; i++) {
          const xx = Math.min(img.w - 1, Math.max(0, x * 2 - 1 + i));
          const wt = kw[i] * kw[j];
          const s = (yy * img.w + xx) * 3;
          a += src[s] * wt;
          b += src[s + 1] * wt;
          c += src[s + 2] * wt;
          ws += wt;
        }
      }
      const o = (y * w + x) * 3;
      out.data[o] = a / ws;
      out.data[o + 1] = b / ws;
      out.data[o + 2] = c / ws;
    }
  }
  return out;
}

// Upsample to (w, h) with bilinear filtering followed by a 3x3 tent.
export function upsampleTo(img, w, h) {
  const up = createImage(w, h);
  const sx = img.w / w;
  const sy = img.h / h;
  const px = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      sampleBilinear(img, (x + 0.5) * sx, (y + 0.5) * sy, px);
      const o = (y * w + x) * 3;
      up.data[o] = px[0];
      up.data[o + 1] = px[1];
      up.data[o + 2] = px[2];
    }
  }
  const out = createImage(w, h);
  const kw = [1, 2, 1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      let b = 0;
      let c = 0;
      for (let j = -1; j <= 1; j++) {
        const yy = Math.min(h - 1, Math.max(0, y + j));
        for (let i = -1; i <= 1; i++) {
          const xx = Math.min(w - 1, Math.max(0, x + i));
          const wt = kw[i + 1] * kw[j + 1];
          const s = (yy * w + xx) * 3;
          a += up.data[s] * wt;
          b += up.data[s + 1] * wt;
          c += up.data[s + 2] * wt;
        }
      }
      const o = (y * w + x) * 3;
      out.data[o] = a / 16;
      out.data[o + 1] = b / 16;
      out.data[o + 2] = c / 16;
    }
  }
  return out;
}

export function buildPyramid(img, levels) {
  const pyr = [img];
  for (let i = 1; i <= levels; i++) pyr.push(downsample2(pyr[i - 1]));
  return pyr;
}

// Blur by an approximate gaussian of large radius using the pyramid:
// downsample `level` times, then upsample back.
export function pyramidBlur(img, level) {
  let cur = img;
  const sizes = [];
  for (let i = 0; i < level; i++) {
    sizes.push([cur.w, cur.h]);
    cur = downsample2(cur);
  }
  for (let i = level - 1; i >= 0; i--) cur = upsampleTo(cur, sizes[i][0], sizes[i][1]);
  return cur;
}

// Directional blur: gaussian taps along a per-pixel direction.
// dirFn(x, y) -> [dx, dy, sigmaPx]. Taps run symmetric (both ways) unless
// `oneSided` is set, in which case they run only along +dir.
export function directionalBlur(img, dirFn, { taps = 24, oneSided = false } = {}) {
  const { w, h } = img;
  const out = createImage(w, h);
  const px = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [dx, dy, sigma] = dirFn(x + 0.5, y + 0.5);
      let a = 0;
      let b = 0;
      let c = 0;
      let ws = 0;
      const n = taps;
      for (let i = -n; i <= n; i++) {
        if (oneSided && i < 0) continue;
        const t = (i / n) * 2.5 * sigma;
        const wt = Math.exp(-(t * t) / (2 * sigma * sigma + 1e-9));
        sampleBilinear(img, x + 0.5 + dx * t, y + 0.5 + dy * t, px);
        a += px[0] * wt;
        b += px[1] * wt;
        c += px[2] * wt;
        ws += wt;
      }
      const o = (y * w + x) * 3;
      out.data[o] = a / ws;
      out.data[o + 1] = b / ws;
      out.data[o + 2] = c / ws;
    }
  }
  return out;
}

// Radial (zoom) blur toward (cx, cy), GPU Gems 3 chapter 13 style.
// Each pixel averages the image along the segment from itself toward the
// center, out to scale `1 - length` (length 1 reaches the center). Weights
// fall as decay^i. `passes` > 1 repeats with the step multiplied by `taps`,
// which is how a GPU gets long streaks from a few short passes.
export function radialBlur(img, cx, cy, { length = 0.5, taps = 32, decay = 1, passes = 1 } = {}) {
  let cur = img;
  const px = [0, 0, 0];
  // Log-scale steps so that repeated passes compose into one long smear.
  const total = Math.log(1 / Math.max(1e-4, 1 - Math.min(length, 0.9999)));
  const nTotal = Math.pow(taps, passes);
  const base = total / nTotal;
  for (let p = 0; p < passes; p++) {
    const step = base * Math.pow(taps, p);
    const out = createImage(img.w, img.h);
    for (let y = 0; y < img.h; y++) {
      for (let x = 0; x < img.w; x++) {
        const vx = x + 0.5 - cx;
        const vy = y + 0.5 - cy;
        let a = 0;
        let b = 0;
        let c = 0;
        let ws = 0;
        let wt = 1;
        for (let i = 0; i < taps; i++) {
          const s = Math.exp(-step * i);
          sampleBilinear(cur, cx + vx * s, cy + vy * s, px);
          a += px[0] * wt;
          b += px[1] * wt;
          c += px[2] * wt;
          ws += wt;
          wt *= decay;
        }
        const o = (y * img.w + x) * 3;
        out.data[o] = a / ws;
        out.data[o + 1] = b / ws;
        out.data[o + 2] = c / ws;
      }
    }
    cur = out;
  }
  return cur;
}
