// Lens stage on linear radiance: bloom (sum of a few blur radii, mixed so it
// moves light rather than adding it) and halation (a wide warm glow from
// highlights, added). Blurs run on a 4x downsampled copy with three box passes
// per axis, which maps to a GPU blur pyramid.

import { hexToLinear, luminance } from "./color.mjs";

const DOWN = 4;

function downsample(img) {
  const w = Math.max(1, Math.floor(img.width / DOWN));
  const h = Math.max(1, Math.floor(img.height / DOWN));
  const data = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0];
      for (let dy = 0; dy < DOWN; dy++) {
        for (let dx = 0; dx < DOWN; dx++) {
          const i = ((y * DOWN + dy) * img.width + (x * DOWN + dx)) * 3;
          acc[0] += img.data[i];
          acc[1] += img.data[i + 1];
          acc[2] += img.data[i + 2];
        }
      }
      const o = (y * w + x) * 3;
      const k = 1 / (DOWN * DOWN);
      data[o] = acc[0] * k;
      data[o + 1] = acc[1] * k;
      data[o + 2] = acc[2] * k;
    }
  }
  return { width: w, height: h, data };
}

function boxPass(src, dst, w, h, r, horizontal) {
  const n = horizontal ? w : h;
  const lines = horizontal ? h : w;
  for (let l = 0; l < lines; l++) {
    for (let c = 0; c < 3; c++) {
      const at = (k) => {
        const kk = Math.min(n - 1, Math.max(0, k));
        return horizontal ? (l * w + kk) * 3 + c : (kk * w + l) * 3 + c;
      };
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[at(k)];
      const norm = 1 / (2 * r + 1);
      for (let k = 0; k < n; k++) {
        dst[at(k)] = acc * norm;
        acc += src[at(k + r + 1)] - src[at(k - r)];
      }
    }
  }
}

// Gaussian-like blur with standard deviation sigma (in small-image pixels).
function blurSmall(img, sigma) {
  const r = Math.max(1, Math.round(Math.sqrt((4 * sigma * sigma) / 3 + 0.25) - 0.5));
  let a = new Float32Array(img.data);
  let b = new Float32Array(a.length);
  for (let p = 0; p < 3; p++) {
    boxPass(a, b, img.width, img.height, r, true);
    boxPass(b, a, img.width, img.height, r, false);
  }
  return { width: img.width, height: img.height, data: a };
}

function sampleBilinear(img, x, y, out) {
  const fx = Math.max(0, Math.min(img.width - 1.001, x));
  const fy = Math.max(0, Math.min(img.height - 1.001, y));
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const i00 = (iy * img.width + ix) * 3;
  const i01 = i00 + 3;
  const i10 = i00 + img.width * 3;
  const i11 = i10 + 3;
  for (let c = 0; c < 3; c++) {
    out[c] =
      (img.data[i00 + c] * (1 - tx) + img.data[i01 + c] * tx) * (1 - ty) +
      (img.data[i10 + c] * (1 - tx) + img.data[i11 + c] * tx) * ty;
  }
}

// lens: { bloom, bloomRadius, halation, halationColor, halationThreshold,
// halationRadius }. Radii are fractions of the image height.
export function applyLens(img, lens = {}) {
  const {
    bloom = 0,
    bloomRadius = 0.05,
    halation = 0,
    halationColor = "#FF6A2A",
    halationThreshold = 0.8,
    halationRadius = 0.08,
  } = lens;
  if (!bloom && !halation) return img;
  const small = downsample(img);
  const sh = small.height;
  const radii = [0.25, 1, 3].map((k) => k * bloomRadius * sh);
  const weights = [0.5, 0.3, 0.2];
  const blooms = bloom ? radii.map((s) => blurSmall(small, s)) : [];
  let halo = null;
  if (halation) {
    const hl = { width: small.width, height: small.height, data: new Float32Array(small.data.length) };
    for (let i = 0; i < small.width * small.height; i++) {
      const r = small.data[i * 3];
      const g = small.data[i * 3 + 1];
      const b = small.data[i * 3 + 2];
      const y = luminance(r, g, b);
      const k = y > halationThreshold ? (y - halationThreshold) / Math.max(y, 1e-6) : 0;
      hl.data[i * 3] = r * k;
      hl.data[i * 3 + 1] = g * k;
      hl.data[i * 3 + 2] = b * k;
    }
    halo = blurSmall(hl, halationRadius * sh);
  }
  const tint = hexToLinear(halationColor);
  const tintLum = Math.max(1e-6, luminance(...tint));
  const out = new Float32Array(img.data.length);
  const px = [0, 0, 0];
  for (let y = 0; y < img.height; y++) {
    const sy = (y + 0.5) / DOWN - 0.5;
    for (let x = 0; x < img.width; x++) {
      const sx = (x + 0.5) / DOWN - 0.5;
      const i = (y * img.width + x) * 3;
      let r = img.data[i];
      let g = img.data[i + 1];
      let b = img.data[i + 2];
      if (bloom) {
        let br = 0;
        let bg = 0;
        let bb = 0;
        for (let k = 0; k < blooms.length; k++) {
          sampleBilinear(blooms[k], sx, sy, px);
          br += weights[k] * px[0];
          bg += weights[k] * px[1];
          bb += weights[k] * px[2];
        }
        r = (1 - bloom) * r + bloom * br;
        g = (1 - bloom) * g + bloom * bg;
        b = (1 - bloom) * b + bloom * bb;
      }
      if (halo) {
        sampleBilinear(halo, sx, sy, px);
        const e = luminance(px[0], px[1], px[2]) * halation;
        r += (e * tint[0]) / tintLum;
        g += (e * tint[1]) / tintLum;
        b += (e * tint[2]) / tintLum;
      }
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
    }
  }
  return { width: img.width, height: img.height, data: out };
}
