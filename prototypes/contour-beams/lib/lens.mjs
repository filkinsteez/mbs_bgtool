// Lens stage: bloom pyramid with per-level weight and tint, plus halation.
import { createImage, scaleImage } from './image.mjs';
import { buildPyramid, upsampleTo } from './blur.mjs';

// Bloom as an energy-conserving point-spread mix:
//   out = (1 - strength) * img + strength * sum_i(w_i * tint_i * B_i(img)) / sum_i(w_i)
// where B_i is pyramid level i (i = 1..levels) upsampled back to full size.
// Levels are added during the upsample chain, as on a GPU.
export function bloom(img, { strength = 0, weights = [1, 1, 1, 1, 1, 1], tints = null } = {}) {
  if (strength <= 0) return img;
  const levels = weights.length;
  const pyr = buildPyramid(img, levels);
  const wsum = weights.reduce((a, b) => a + b, 0);
  let acc = null;
  for (let i = levels; i >= 1; i--) {
    const lev = pyr[i];
    const wt = weights[i - 1] / wsum;
    const tint = tints ? tints[i - 1] : [1, 1, 1];
    if (acc) acc = upsampleTo(acc, lev.w, lev.h);
    else acc = createImage(lev.w, lev.h);
    for (let p = 0; p < lev.w * lev.h; p++) {
      acc.data[p * 3] += lev.data[p * 3] * wt * tint[0];
      acc.data[p * 3 + 1] += lev.data[p * 3 + 1] * wt * tint[1];
      acc.data[p * 3 + 2] += lev.data[p * 3 + 2] * wt * tint[2];
    }
  }
  acc = upsampleTo(acc, img.w, img.h);
  const out = createImage(img.w, img.h);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = img.data[i] * (1 - strength) + acc.data[i] * strength;
  }
  return out;
}

// Halation: highlights above `threshold` (soft knee), blurred wide, tinted
// warm, added on top. Weighted down where the image is already bright so it
// shows mostly against dark.
export function halation(img, { strength = 0, threshold = 0.6, knee = 0.4, level = 4, tint = [1, 0.32, 0.12] } = {}) {
  if (strength <= 0) return img;
  const { w, h } = img;
  const hi = createImage(w, h);
  for (let p = 0; p < w * h; p++) {
    const r = img.data[p * 3];
    const g = img.data[p * 3 + 1];
    const b = img.data[p * 3 + 2];
    const m = Math.max(r, g, b);
    let rq = Math.min(Math.max(m - threshold + knee, 0), 2 * knee);
    rq = (rq * rq) / (4 * knee + 1e-9);
    const k = Math.max(rq, m - threshold) / Math.max(m, 1e-5);
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    hi.data[p * 3] = y * k;
    hi.data[p * 3 + 1] = y * k;
    hi.data[p * 3 + 2] = y * k;
  }
  const pyr = buildPyramid(hi, level);
  let acc = pyr[level];
  for (let i = level - 1; i >= 0; i--) acc = upsampleTo(acc, pyr[i].w, pyr[i].h);
  scaleImage(acc, strength);
  const out = createImage(w, h);
  for (let p = 0; p < w * h; p++) {
    const r = img.data[p * 3];
    const g = img.data[p * 3 + 1];
    const b = img.data[p * 3 + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const dark = 1 / (1 + 4 * y);
    out.data[p * 3] = r + acc.data[p * 3] * tint[0] * dark;
    out.data[p * 3 + 1] = g + acc.data[p * 3 + 1] * tint[1] * dark;
    out.data[p * 3 + 2] = b + acc.data[p * 3 + 2] * tint[2] * dark;
  }
  return out;
}
