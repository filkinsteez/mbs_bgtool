// Output stage: exposure, tone curve, exact sRGB encode, grain, dither, 8-bit.

import { linearToSrgb } from './color.mjs';
import { hash2, gaussPair } from './rng.mjs';

// Colors with max channel <= 1 pass unchanged. Above 1 the color moves toward
// white. The whitening rate k = Y/(1-Y) keeps luminance and its slope
// continuous at max = 1, so no ring appears where the roll-off starts.
export function toneMap(r, g, b, out) {
  const m = Math.max(r, g, b);
  if (m <= 1) {
    out[0] = r;
    out[1] = g;
    out[2] = b;
    return out;
  }
  const ur = r / m;
  const ug = g / m;
  const ub = b / m;
  const yu = 0.2126 * ur + 0.7152 * ug + 0.0722 * ub;
  const k = yu / Math.max(1e-4, 1 - yu);
  const w = 1 - Math.exp(-k * (m - 1));
  out[0] = ur + (1 - ur) * w;
  out[1] = ug + (1 - ug) * w;
  out[2] = ub + (1 - ub) * w;
  return out;
}

// opts: exposure (stops), white (display white level, 1 = full), grain
// (std dev in 8-bit steps of the encoded value at mid grey), grainResponse
// ('flat' or 'sqrt': grain grows with the square root of the encoded value),
// seed.
export function encode(img, opts = {}) {
  const exposure = 2 ** (opts.exposure ?? 0);
  const white = opts.white ?? 1;
  const grain = opts.grain ?? 0;
  const sqrtGrain = opts.grainResponse === 'sqrt';
  const seed = opts.seed ?? 1;
  const { w, h, data } = img;
  const bytes = new Uint8Array(w * h * 3);
  const t = [0, 0, 0];
  const n = [0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      toneMap(
        Math.max(0, (data[i] * exposure) / white),
        Math.max(0, (data[i + 1] * exposure) / white),
        Math.max(0, (data[i + 2] * exposure) / white),
        t,
      );
      gaussPair(hash2(x, y, seed), hash2(x, y, seed + 101), n);
      const e0 = linearToSrgb(t[0] * white) * 255;
      const e1 = linearToSrgb(t[1] * white) * 255;
      const e2 = linearToSrgb(t[2] * white) * 255;
      const amp = sqrtGrain ? grain * Math.sqrt((e0 + e1 + e2) / 384) : grain;
      const grainV = amp * n[0];
      const enc = [e0, e1, e2];
      for (let c = 0; c < 3; c++) {
        const s = enc[c] + grainV;
        // Triangular dither, +-1 step.
        const d = hash2(x, y, seed * 7 + c * 31 + 3) + hash2(x, y, seed * 13 + c * 17 + 5) - 1;
        bytes[i + c] = Math.max(0, Math.min(255, Math.round(s + d)));
      }
    }
  }
  return bytes;
}
