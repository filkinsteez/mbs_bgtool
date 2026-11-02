// Lens stage: multi-scale bloom with a tint per level, halation, and
// per-channel shifts of the scattered light (dispersion).

import { gaussianBlur } from './blur.mjs';
import { Img } from './image.mjs';
import { resolveColor } from './scene.mjs';

function shiftChannels(img, disp, W, H, unit) {
  if (!disp) return img;
  const out = new Img(W, H);
  const tmp = [0, 0, 0];
  const cx = (disp.center?.[0] ?? 0.5) * W;
  const cy = (disp.center?.[1] ?? 0.5) * H;
  for (let c = 0; c < 3; c++) {
    const sx = (disp.shift?.[c]?.[0] ?? 0) * unit;
    const sy = (disp.shift?.[c]?.[1] ?? 0) * unit;
    const k = disp.radial?.[c] ?? 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const qx = cx + (px - cx) / (1 + k) - sx;
        const qy = cy + (py - cy) / (1 + k) - sy;
        img.sample(qx, qy, tmp);
        out.data[(y * W + x) * 3 + c] = tmp[c];
      }
    }
  }
  return out;
}

export function applyLens(img, lens, palette = []) {
  if (!lens) return img;
  const { w: W, h: H } = img;
  const unit = Math.min(W, H) / 1000;
  const out = img.clone();
  const scattered = new Img(W, H);
  let removed = 0;

  for (const lvl of lens.bloom ?? []) {
    const tint = resolveColor(lvl.tint ?? [1, 1, 1], palette);
    const b = gaussianBlur(img, lvl.sigma * unit);
    const wgt = lvl.weight ?? 0;
    removed += wgt;
    for (let p = 0; p < W * H; p++) {
      scattered.data[p * 3] += wgt * tint[0] * b.data[p * 3];
      scattered.data[p * 3 + 1] += wgt * tint[1] * b.data[p * 3 + 1];
      scattered.data[p * 3 + 2] += wgt * tint[2] * b.data[p * 3 + 2];
    }
  }

  const hal = lens.halation;
  if (hal && hal.strength) {
    const thr = hal.threshold ?? 0.5;
    const hi = new Img(W, H);
    for (let p = 0; p < W * H; p++) {
      const r = img.data[p * 3];
      const g = img.data[p * 3 + 1];
      const b = img.data[p * 3 + 2];
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const k = y > thr ? 1 - thr / y : 0;
      hi.data[p * 3] = r * k;
      hi.data[p * 3 + 1] = g * k;
      hi.data[p * 3 + 2] = b * k;
    }
    const hb = gaussianBlur(hi, (hal.sigma ?? 60) * unit);
    const col = resolveColor(hal.color ?? '#FF6A2A', palette);
    for (let p = 0; p < W * H; p++) {
      const y = 0.2126 * hb.data[p * 3] + 0.7152 * hb.data[p * 3 + 1] + 0.0722 * hb.data[p * 3 + 2];
      scattered.data[p * 3] += hal.strength * col[0] * y;
      scattered.data[p * 3 + 1] += hal.strength * col[1] * y;
      scattered.data[p * 3 + 2] += hal.strength * col[2] * y;
    }
  }

  const disp = shiftChannels(scattered, lens.dispersion, W, H, unit);
  const keep = lens.conserve ? Math.max(0, 1 - removed) : 1;
  for (let p = 0; p < W * H * 3; p++) out.data[p] = img.data[p] * keep + disp.data[p];
  return out;
}
