// Grain models. Each takes a linear-light image (values <= 1 after the
// tone curve) and returns an sRGB-encoded float image ready for dither and
// 8-bit quantization. Every model is per-pixel math on noise fields that
// are either hashed white noise or small separable blurs of it.
import { linearToOklab, linearToSrgb, oklabToLinear } from './color.mjs';
import { makeImage } from './image.mjs';
import { bandNoise, normalCdf, uniform, whiteNoise } from './noise.mjs';

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Piecewise-linear amplitude curve over Oklab L: knots [[L, amp], ...].
export function knotCurve(knots) {
  return (L) => {
    if (L <= knots[0][0]) return knots[0][1];
    for (let i = 1; i < knots.length; i++) {
      if (L <= knots[i][0]) {
        const [l0, a0] = knots[i - 1];
        const [l1, a1] = knots[i];
        return a0 + ((a1 - a0) * (L - l0)) / (l1 - l0);
      }
    }
    return knots[knots.length - 1][1];
  };
}

function toOklabPlanes(lin) {
  const n = lin.w * lin.h;
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    linearToOklab(Math.max(0, lin.d[i * 3]), Math.max(0, lin.d[i * 3 + 1]), Math.max(0, lin.d[i * 3 + 2]), lab, i * 3);
  }
  return lab;
}

function encodeOklab(lab, w, h) {
  const out = makeImage(w, h);
  const rgb = [0, 0, 0];
  for (let i = 0; i < w * h; i++) {
    oklabToLinear(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2], rgb);
    out.d[i * 3] = linearToSrgb(Math.min(1, Math.max(0, rgb[0])));
    out.d[i * 3 + 1] = linearToSrgb(Math.min(1, Math.max(0, rgb[1])));
    out.d[i * 3 + 2] = linearToSrgb(Math.min(1, Math.max(0, rgb[2])));
  }
  return out;
}

export function encodeOnly(lin) {
  const out = makeImage(lin.w, lin.h);
  for (let i = 0; i < lin.d.length; i++) out.d[i] = linearToSrgb(Math.min(1, Math.max(0, lin.d[i])));
  return out;
}

// Mono grain applied to Oklab L only, so hue and chroma stay as rendered:
// L' = L + amp(L) * field.
function applyLightnessField(lin, field, amp) {
  const lab = toOklabPlanes(lin);
  for (let i = 0; i < lin.w * lin.h; i++) {
    const L = lab[i * 3];
    lab[i * 3] = L + amp(L) * field[i];
  }
  return encodeOklab(lab, lin.w, lin.h);
}

// (a) Gaussian film grain: one band of gaussian-blurred white noise with
// blob size `sigma` output px, strength set per Oklab L by `amp`.
export function filmGrain(lin, { sigma, amp, seed = 1 }) {
  return applyLightnessField(lin, bandNoise(lin.w, lin.h, sigma, seed), amp);
}

// (b) Multi-octave grain: sum of bands at sigmas s_k with weights w_k,
// normalized to unit standard deviation.
export function octaveField(w, h, octaves, seed = 1) {
  const field = new Float32Array(w * h);
  let norm = 0;
  octaves.forEach(({ sigma, weight }, k) => {
    const band = bandNoise(w, h, sigma, seed * 31 + k * 7919);
    for (let i = 0; i < field.length; i++) field[i] += weight * band[i];
    norm += weight * weight;
  });
  const s = 1 / Math.sqrt(norm);
  for (let i = 0; i < field.length; i++) field[i] *= s;
  return field;
}

export function octaveGrain(lin, { octaves, amp, seed = 1 }) {
  return applyLightnessField(lin, octaveField(lin.w, lin.h, octaves, seed), amp);
}

// Anisotropic blur of white noise for paper tooth (fibres run along y).
function toothField(w, h, { sigmaX, sigmaY }, seed) {
  const white = whiteNoise(w, h, seed);
  const bx = blurRows(white, w, h, sigmaX);
  const f = blurCols(bx, w, h, sigmaY);
  let s2 = 0;
  for (const v of f) s2 += v * v;
  const k = 1 / Math.sqrt(s2 / f.length);
  for (let i = 0; i < f.length; i++) f[i] *= k;
  return f;
}

function blurRows(src, w, h, sigma) {
  if (sigma <= 0) return new Float32Array(src);
  const tmp = src;
  const out = new Float32Array(w * h);
  const r = Math.ceil(sigma * 3);
  const k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v);
    sum += v;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += k[i + r] * tmp[y * w + Math.min(w - 1, Math.max(0, x + i))];
      out[y * w + x] = s / sum;
    }
  }
  return out;
}

function blurCols(src, w, h, sigma) {
  if (sigma <= 0) return new Float32Array(src);
  const out = new Float32Array(w * h);
  const r = Math.ceil(sigma * 3);
  const k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v);
    sum += v;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += k[i + r] * src[Math.min(h - 1, Math.max(0, y + i)) * w + x];
      out[y * w + x] = s / sum;
    }
  }
  return out;
}

// (c) Riso-style ink grain. Coverage c in [0, 1] comes from lightness
// between paper and a dense ink. A uniform threshold field t (blurred noise
// pushed through the normal CDF) gives an ink/no-ink pattern H = [c > t]
// with E[H] = c, drawn with a 1 px anti-aliased edge (the GPU
// clamp((c - t) / fwidth(t) + 0.5) step). `strength` blends toward it, so the
// variance is strength^2 c(1 - c), largest at half coverage. Paper tooth is
// stretched noise that changes bare paper and ink take-up. The colour moves
// along the paper-to-pixel line in Oklab, the way more or less of one ink
// moves it, scaled by (c' + eps) / (c + eps) so near-paper pixels cannot
// extrapolate to a random hue; a/b read the threshold field shifted by
// `misreg` px (a slightly misregistered second pass).
export function risoGrain(
  lin,
  {
    sigma = 0.8,
    strength = 0.05,
    edgePx = 1,
    paper = [0.96, 0, 0.008],
    lInk = 0,
    eps = 0.05,
    tooth = { amp: 0.006, ink: 0.1, sigmaX: 0.6, sigmaY: 3 },
    misreg = [0, 0],
    seed = 1,
  },
) {
  const { w, h } = lin;
  const lab = toOklabPlanes(lin);
  const g = bandNoise(w, h, sigma, seed);
  const t = new Float32Array(w * h);
  for (let i = 0; i < t.length; i++) t[i] = normalCdf(g[i]);
  const T = tooth ? toothField(w, h, tooth, seed + 101) : null;
  const span = paper[0] - lInk;
  const at = (x, y) => t[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const step = (c, x, y) => {
    const tv = at(x, y);
    const fw = Math.abs(at(x + 1, y) - at(x - 1, y)) * 0.5 + Math.abs(at(x, y + 1) - at(x, y - 1)) * 0.5;
    return Math.min(1, Math.max(0, (c - tv) / Math.max(1e-4, fw * edgePx) + 0.5));
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const L = lab[i * 3];
      const A = lab[i * 3 + 1];
      const B = lab[i * 3 + 2];
      const c = Math.min(1, Math.max(0, (paper[0] - L) / span));
      const tooth01 = T ? T[i] : 0;
      const take = T ? 1 + tooth.ink * tooth01 : 1;
      const cL = (c + strength * (step(c, x, y) - c)) * take;
      const cAB = (c + strength * (step(c, Math.round(x + misreg[0]), Math.round(y + misreg[1])) - c)) * take;
      const rL = (cL + eps) / (c + eps);
      const rAB = (cAB + eps) / (c + eps);
      const toothL = T ? tooth.amp * tooth01 * (1 - c) : 0;
      lab[i * 3] = paper[0] + (L - paper[0]) * rL + toothL;
      lab[i * 3 + 1] = paper[1] + (A - paper[1]) * rAB;
      lab[i * 3 + 2] = paper[2] + (B - paper[2]) * rAB;
    }
  }
  return encodeOklab(lab, w, h);
}

// (d) Coordinate jitter: the ramp coordinate is offset per pixel before the
// colour lookup, t' = t + J * n(x). Returned as an offset field in ramp
// units for renderRamp().
export function jitterField(w, h, { jitterPx, sigma, seed = 1 }) {
  const n = bandNoise(w, h, sigma, seed);
  const k = jitterPx / (h - 1);
  for (let i = 0; i < n.length; i++) n[i] *= k;
  return n;
}

// Output dither: triangular noise of +-1 LSB before 8-bit rounding.
export function dither(encoded, seed = 7) {
  const { w, h } = encoded;
  const out = makeImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = (uniform(x, y, seed) + uniform(x, y, seed + 1) - 1) / 255;
      out.d[i * 3] = encoded.d[i * 3] + t;
      out.d[i * 3 + 1] = encoded.d[i * 3 + 1] + t;
      out.d[i * 3 + 2] = encoded.d[i * 3 + 2] + t;
    }
  }
  return out;
}
