import { gaussianBlur } from './blur.mjs';
import { linearToOklab, linearToSrgb, luminance, parseColor } from './color.mjs';
import { makeImage } from './image.mjs';
import { gauss2, hash2 } from './noise.mjs';

/**
 * Lens: bloom from the bright parts (soft knee on luminance), as a sum of
 * blurs at a few radii with their own weight and tint. Radii are fractions of
 * the image height. Added on top of the image.
 */
export function applyLens(img, lens = {}) {
  if (lens.vignette) img = vignette(img, lens.vignette);
  const layers = lens.bloom ?? [];
  if (!layers.length) return img;
  const threshold = lens.threshold ?? 0.8;
  const knee = Math.max(1e-4, lens.knee ?? 0.4);
  const bright = makeImage(img.w, img.h);
  for (let i = 0; i < img.w * img.h; i++) {
    const r = img.data[i * 3];
    const g = img.data[i * 3 + 1];
    const b = img.data[i * 3 + 2];
    const y = luminance(r, g, b);
    const t = Math.min(1, Math.max(0, (y - threshold + knee) / (2 * knee)));
    const k = t * t * (3 - 2 * t);
    bright.data[i * 3] = r * k;
    bright.data[i * 3 + 1] = g * k;
    bright.data[i * 3 + 2] = b * k;
  }
  const out = makeImage(img.w, img.h);
  out.data.set(img.data);
  for (const layer of layers) {
    const blurred = gaussianBlur(bright, layer.radius * img.h);
    const tint = layer.tint ? parseColor(layer.tint) : [1, 1, 1];
    for (let i = 0; i < img.w * img.h; i++) {
      for (let c = 0; c < 3; c++) out.data[i * 3 + c] += layer.weight * tint[c] * blurred.data[i * 3 + c];
    }
  }
  return out;
}

/**
 * Natural lens falloff (cos^4 law): 1 / (1 + (r / f)^2)^2, r from the frame
 * center and f in units of the frame height.
 */
export function vignette(img, f) {
  const out = makeImage(img.w, img.h);
  for (let y = 0; y < img.h; y++) {
    const dy = (y + 0.5 - img.h / 2) / img.h;
    for (let x = 0; x < img.w; x++) {
      const dx = (x + 0.5 - img.w / 2) / img.h;
      const q = 1 + (dx * dx + dy * dy) / (f * f);
      const k = 1 / (q * q);
      const i = (y * img.w + x) * 3;
      out.data[i] = img.data[i] * k;
      out.data[i + 1] = img.data[i + 1] * k;
      out.data[i + 2] = img.data[i + 2] * k;
    }
  }
  return out;
}

/**
 * Tone curve. Colors with max channel <= 1 pass unchanged. Above that each
 * channel moves toward white; the overall rate at the onset is chosen so
 * Oklab lightness keeps the slope it had below 1 (no ring).
 * spill = 0: all channels whiten at the same rate (hue kept, orange -> peach
 * -> white). spill > 0: a channel whitens faster the closer it already is to
 * the max channel (orange -> yellow -> cream -> white, like a camera).
 */
export function toneMap(r, g, b, spill = 0) {
  const m = Math.max(r, g, b);
  if (m <= 1) return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
  const h = [Math.max(0, r) / m, Math.max(0, g) / m, Math.max(0, b) / m];
  const rate = h.map((v) => (spill ? Math.pow(v + 0.05, spill) : 1));
  const eps = 1e-3;
  const L0 = linearToOklab(h[0], h[1], h[2])[0];
  const below = linearToOklab(h[0] * (1 + eps), h[1] * (1 + eps), h[2] * (1 + eps))[0] - L0;
  const above = linearToOklab(...h.map((v, c) => v + eps * rate[c] * (1 - v)))[0] - L0;
  const a = below / Math.max(above, 1e-6);
  return h.map((v, c) => v + (1 - v) * (1 - Math.exp(-a * rate[c] * (m - 1))));
}

/** Linear radiance -> 8-bit sRGB bytes: exposure, tone curve, encode, grain, dither. */
export function encodeOutput(img, output = {}, seed = 1) {
  const { w, h } = img;
  const gain = Math.pow(2, output.exposure ?? 0);
  const grain = output.grain ?? 0;
  const grainChroma = output.grainChroma ?? 0.25;
  const spill = output.spill ?? 0;
  const bytes = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const t = toneMap(img.data[i] * gain, img.data[i + 1] * gain, img.data[i + 2] * gain, spill);
      const n = grain ? gauss2(x, y, seed * 31 + 5) : 0;
      for (let c = 0; c < 3; c++) {
        let v = linearToSrgb(t[c]);
        if (grain) v += grain * (n + grainChroma * gauss2(x, y, seed * 31 + 11 + c));
        v += (hash2(x, y, seed * 7 + c * 3) + hash2(x, y, seed * 7 + c * 3 + 1) - 1) / 255;
        bytes[i + c] = Math.min(255, Math.max(0, Math.round(v * 255)));
      }
    }
  }
  return bytes;
}
