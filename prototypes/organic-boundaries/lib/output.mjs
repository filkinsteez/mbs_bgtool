// Engine output stage: tone curve, exact sRGB, grain at output size, dither, 8-bit.

import { linearToSrgb, luminance } from './color.mjs';
import { makeCanvas } from './image.mjs';
import { blurPlane } from './blur.mjs';
import { hash1 } from './noise.mjs';

// Max channel <= 1 passes unchanged, so a pack color at nominal intensity encodes
// to its exact hex. Brighter light keeps its hue at max 1 and mixes toward white;
// the rate keeps the luminance slope continuous at the threshold (no ring).
export function tone(r, g, b) {
  const m = Math.max(r, g, b);
  if (m <= 1) return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
  const br = r / m;
  const bg = g / m;
  const bb = b / m;
  const y0 = luminance(br, bg, bb);
  const k = y0 / Math.max(1e-4, 1 - y0);
  const t = 1 - Math.exp(-k * (m - 1));
  return [br + (1 - br) * t, bg + (1 - bg) * t, bb + (1 - bb) * t];
}

// opts.grain: sigma in sRGB units (0..1), mono; opts.grainSize: blur in px;
// opts.grainInk: extra grain in dark ink (1 + grainInk * (1 - max channel)).
export function encode(img, opts = {}, seed = 1) {
  const { w, h } = img;
  const n = w * h;
  const c = makeCanvas(w, h);
  let grain = null;
  if (opts.grain) {
    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // Box-Muller from two hashes
      const u1 = Math.max(1e-7, hash1(i % w, Math.floor(i / w), seed * 7 + 1));
      const u2 = hash1(i % w, Math.floor(i / w), seed * 7 + 2);
      g[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
    const sz = opts.grainSize ?? 0;
    grain = sz > 0.3 ? blurPlane(g, w, h, sz) : g;
    if (sz > 0.3) {
      let s2 = 0;
      for (let i = 0; i < n; i++) s2 += grain[i] * grain[i];
      const k = 1 / Math.sqrt(s2 / n);
      for (let i = 0; i < n; i++) grain[i] *= k;
    }
  }
  for (let i = 0; i < n; i++) {
    const exp = 2 ** (opts.exposure ?? 0);
    const [r, g, b] = tone(img.ch[0][i] * exp, img.ch[1][i] * exp, img.ch[2][i] * exp);
    let sr = linearToSrgb(r);
    let sg = linearToSrgb(g);
    let sb = linearToSrgb(b);
    if (grain) {
      const amp = opts.grain * (1 + (opts.grainInk ?? 0) * (1 - Math.max(r, g, b)));
      const d = amp * grain[i];
      sr += d;
      sg += d;
      sb += d;
    }
    const x = i % w;
    const y = (i / w) | 0;
    const dither = (hash1(x, y, seed * 7 + 3) + hash1(x, y, seed * 7 + 4) - 1) / 255;
    c.data[i * 3] = Math.round(Math.min(1, Math.max(0, sr + dither)) * 255);
    c.data[i * 3 + 1] = Math.round(Math.min(1, Math.max(0, sg + dither)) * 255);
    c.data[i * 3 + 2] = Math.round(Math.min(1, Math.max(0, sb + dither)) * 255);
  }
  return c;
}

// Decode an 8-bit canvas back to linear light (to measure renders like targets).
export function canvasToLinear(c) {
  const img = { w: c.w, h: c.h, ch: [new Float32Array(c.w * c.h), new Float32Array(c.w * c.h), new Float32Array(c.w * c.h)] };
  for (let i = 0; i < c.w * c.h; i++) {
    for (let k = 0; k < 3; k++) {
      const v = c.data[i * 3 + k] / 255;
      img.ch[k][i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }
  }
  return img;
}
