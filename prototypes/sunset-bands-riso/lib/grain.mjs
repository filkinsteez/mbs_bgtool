// Output-size surface textures. They take the encoded image (0..1 floats) and
// the linear image, and return a new encoded image. Zero-mean, so the average
// color does not change.
import { gaussBlurPlane } from './blur.mjs';
import { hashGauss, fbm2 } from './noise.mjs';
import { hexToLinear, linearToOklab } from './color.mjs';

// Unit-variance gaussian noise blurred to correlation length `size` px
// (`stretch` > 1 elongates it horizontally, like paper fibers).
// GPU: hash noise in one pass, then a small separable blur (or a 5x5 tap sum).
export function noiseField(w, h, seed, size, stretch = 1) {
  const n = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) n[y * w + x] = hashGauss(x, y, seed);
  const b = size > 0.3 ? gaussBlurPlane(n, w, h, size * stretch, size) : n;
  let v = 0;
  for (let i = 0; i < b.length; i++) v += b[i] * b[i];
  const k = 1 / Math.sqrt(v / b.length);
  for (let i = 0; i < b.length; i++) b[i] *= k;
  return b;
}

// Riso surface on the linear image (before encode), luma only:
//   paper tooth: L *= 1 + tooth * n1            (paper texture; weaker under ink
//                                                 because it scales with L)
//   ink grain:   L += ink * Y_paper * c^p * n2  (coverage noise, image-only
//                                                 estimate c = 1 - Y / Y_paper)
// For reference prints the ink grain is set per band in the recipe instead,
// since each ink has its own grain; this term is for images without inks.
export function risoGrainLinear(lin, opts) {
  const { w, h } = lin;
  const { seed = 3, size = 1.3, tooth = 0.02, ink = 0, p = 1, paper = '#F0EDE8', stretch = 1 } = opts;
  const P = hexToLinear(paper);
  const yP = 0.2126 * P[0] + 0.7152 * P[1] + 0.0722 * P[2];
  const nTooth = noiseField(w, h, seed + 11, size, stretch);
  const nInk = ink ? noiseField(w, h, seed, size, stretch) : null;
  const out = new Float32Array(lin.data);
  for (let i = 0; i < w * h; i++) {
    const Y = 0.2126 * lin.data[i * 3] + 0.7152 * lin.data[i * 3 + 1] + 0.0722 * lin.data[i * 3 + 2];
    let m = 1 + tooth * nTooth[i];
    if (nInk && Y > 1e-5) {
      const c = Math.min(1, Math.max(0, 1 - Y / yP));
      m += (ink * yP * Math.pow(c, p) * nInk[i]) / Y;
    }
    m = Math.max(0, m);
    out[i * 3] *= m;
    out[i * 3 + 1] *= m;
    out[i * 3 + 2] *= m;
  }
  return { w, h, data: out };
}

// Print screen: line gratings (what a scanned halftone becomes after
// downscaling) plus fine noise, luma only, amplitudes in 8-bit units.
// Each grating is driven by one property of the pixel, with c = 1 - cbrt(Y):
//   mid:     4c(1 - c)                           (a screen shows most at mid coverage)
//   neutral: 4c(1 - c) * max(0, 1 - 2.5 chroma)  (black screen: greys and near-blacks)
// chroma is Oklab chroma / 0.2, clamped to 1.
// angle is the direction of the wave vector in degrees (0 = along x, 90 = down).
export function screenTexture(enc, lin, opts) {
  const { w, h } = enc;
  const { seed = 5, gratings = [], noise = 0.5, noiseSize = 0.7, noiseDrive = 'none', wobbleScale = 8 } = opts;
  const n = noiseField(w, h, seed, noiseSize);
  const out = new Float32Array(enc.data);
  const gs = gratings.map((g, gi) => {
    const a = (g.angle * Math.PI) / 180;
    return { ...g, gi, kx: Math.cos(a) / g.period, ky: Math.sin(a) / g.period, phase: g.phase ?? 0, wobble: g.wobble ?? 0 };
  });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = lin.data[i * 3];
      const gch = lin.data[i * 3 + 1];
      const b = lin.data[i * 3 + 2];
      const Y = 0.2126 * r + 0.7152 * gch + 0.0722 * b;
      const c = Math.min(1, Math.max(0, 1 - Math.cbrt(Y)));
      const lab = linearToOklab(r, gch, b);
      const chroma = Math.min(1, Math.hypot(lab[1], lab[2]) / 0.2);
      const mid = 4 * c * (1 - c);
      let d = noise * n[i] * (noiseDrive === 'mid' ? mid : 1);
      for (const g of gs) {
        const drive = g.drive === 'neutral' ? mid * Math.max(0, 1 - 2.5 * chroma) : mid;
        const ph =
          2 * Math.PI * (g.kx * x + g.ky * y + g.phase) + g.wobble * fbm2(x / wobbleScale, y / wobbleScale, seed + 3 + 17 * g.gi, 2);
        d += g.amp * drive * Math.sin(ph);
      }
      d /= 255;
      out[i * 3] += d;
      out[i * 3 + 1] += d;
      out[i * 3 + 2] += d;
    }
  }
  return { w, h, data: out };
}
