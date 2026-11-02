// Engine output stage: tone curve, exact sRGB encode, grain, dither, 8-bit.

import { linearToSrgb, linearToOklab } from "./color.mjs";
import { mulberry32, gaussian } from "./noise.mjs";

function oklabToLinear(L, a, b, out) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  out[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  out[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  out[2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return out;
}

const tmp = [0, 0, 0];
function inGamut(L, a, b) {
  oklabToLinear(L, a, b, tmp);
  return tmp[0] <= 1 && tmp[1] <= 1 && tmp[2] <= 1 && tmp[0] >= -1e-6 && tmp[1] >= -1e-6 && tmp[2] >= -1e-6;
}

// Colors whose max channel is <= 1 pass through unchanged. For brighter
// colors, Oklab lightness eases toward 1 with an exponential shoulder that
// starts at the lightness of the same hue at max channel 1 (matching value
// and slope there), the Oklab hue is kept, and chroma is reduced only as far
// as needed to fit in gamut. Working in Oklab avoids the jump a near-zero
// channel makes in sRGB when white is added in linear light.
export function toneMap(r, g, b, out) {
  const m = Math.max(r, g, b);
  if (m <= 1) {
    out[0] = r;
    out[1] = g;
    out[2] = b;
    return out;
  }
  const [L, A, B] = linearToOklab(r, g, b);
  const k = Math.cbrt(1 / m);
  const Lk = L * k;
  const Lt = 1 - (1 - Lk) * Math.exp(-(L - Lk) / Math.max(1e-6, 1 - Lk));
  const ca = A * k;
  const cb = B * k;
  let lo = 0;
  let hi = 1;
  if (inGamut(Lt, ca, cb)) lo = 1;
  else {
    for (let it = 0; it < 16; it++) {
      const mid = 0.5 * (lo + hi);
      if (inGamut(Lt, ca * mid, cb * mid)) lo = mid;
      else hi = mid;
    }
  }
  oklabToLinear(Lt, ca * lo, cb * lo, out);
  out[0] = Math.min(1, Math.max(0, out[0]));
  out[1] = Math.min(1, Math.max(0, out[1]));
  out[2] = Math.min(1, Math.max(0, out[2]));
  return out;
}

// img: { width, height, data: Float32Array linear RGB }.
// Returns { width, height, data: Uint8Array sRGB }.
export function encodeOutput(img, { exposure = 0, grain = 0, seed = 1, dither = true } = {}) {
  const { width, height, data } = img;
  const gain = Math.pow(2, exposure);
  const out = new Uint8Array(width * height * 3);
  const rand = mulberry32(seed * 7919 + 13);
  const px = [0, 0, 0];
  for (let i = 0; i < width * height; i++) {
    toneMap(data[i * 3] * gain, data[i * 3 + 1] * gain, data[i * 3 + 2] * gain, px);
    const n = grain > 0 ? gaussian(rand) * grain : 0;
    for (let c = 0; c < 3; c++) {
      let s = linearToSrgb(px[c]) + n;
      s *= 255;
      if (dither) s += rand() - rand();
      out[i * 3 + c] = Math.max(0, Math.min(255, Math.round(s)));
    }
  }
  return { width, height, data: out };
}
