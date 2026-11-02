// The recommended grain filter and output stage, written the way the GLSL
// output pass would do it: per pixel, after the tone curve, before dither.
//
//   L' = L + amp(L) * G(x)            (Oklab L; a and b unchanged)
//   G  = sum_k w_k N_k / sqrt(sum w_k^2)
//   N_k = unit noise with blob sigma_k = rel_k * size * shortSide (output
//         px), times sqrt(1 / (1 + 1 / (4 pi sigma_k^2))) so octaves smaller
//         than a pixel lose the variance a pixel would average away.
//
// Sizes are fractions of the image's short side, so a 925 px preview and a
// 3840 px export hold the same grain relative to the picture. N_k is either
// B-spline lattice noise in picture-relative coordinates (default: one pass,
// same clumps at every size) or white noise blurred at output size.
import fs from 'node:fs';
import { linearToOklab, linearToSrgb, oklabToLinear } from './color.mjs';
import { makeImage } from './image.mjs';
import { bandNoise, latticeNoise, uniform } from './noise.mjs';

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

// Two ends of the one strength slider, from presets/grain-filter.json.
// `film` is the default look; `riso` matches the riso moodboard prints.
const PRESET = JSON.parse(fs.readFileSync(new URL('../presets/grain-filter.json', import.meta.url), 'utf8'));
export const GRAIN_ENDS = PRESET.ends;
const FILM_UNTIL = PRESET.slider.filmUntil;

// One slider, 0..1. 0 is off. Up to 0.6 the grain is the film look and
// only gets stronger (0.4 -> 1.0%, 0.6 -> 1.5% Oklab L at mid-tones). From
// 0.6 to 1 it grows coarser and shifts toward the riso prints: bigger
// clumps, a faint coarse mottle, and more grain in dense colour (about
// 2.5%) than on light paper (about 0.9%).
export function grainParams(strength) {
  const s = Math.min(1, Math.max(0, strength));
  const toRiso = smooth(FILM_UNTIL, 1, s);
  const f = GRAIN_ENDS.film;
  const r = GRAIN_ENDS.riso;
  const ampMid = mix(f.amp * Math.min(s / FILM_UNTIL, 1), r.amp, toRiso);
  return {
    strength: s,
    ampMid,
    size: mix(f.size, r.size, toRiso),
    octaves: f.octaves.map((o, k) => ({ rel: o.rel, w: mix(o.w, r.octaves[k].w, toRiso) })),
    shadowEnd: mix(f.shadowEnd, r.shadowEnd, toRiso),
    highlightCut: mix(f.highlightCut, r.highlightCut, toRiso),
    inkBoost: mix(f.inkBoost, r.inkBoost, toRiso),
  };
}

// Strength over Oklab L. Falls to 0 at black so blacks are not lifted,
// eases off toward white, and with inkBoost leans toward darker colour
// (the riso prints: 0.8% on paper, about 2% in dense ink).
export function ampCurve(p) {
  return (L) => {
    const shadow = smooth(0, p.shadowEnd, L);
    const highlight = 1 - p.highlightCut * smooth(0.5, 1, L);
    const ink = 1 + p.inkBoost * (smooth(0.85, 0.45, L) - 0.5);
    return p.ampMid * shadow * highlight * ink;
  };
}

export function pixelVarianceScale(sigmaPx) {
  return Math.sqrt(1 / (1 + 1 / (4 * Math.PI * sigmaPx * sigmaPx)));
}

// `method`: 'blur' = white noise at output size blurred per octave (two
// separable passes on the GPU); 'lattice' = B-spline lattice noise in
// picture-relative coordinates (one pass, same pattern at every size),
// falling back to per-pixel white noise for octaves under 0.6 px.
export function grainField(w, h, p, seed = 1, method = 'lattice') {
  const S = Math.min(w, h);
  const field = new Float32Array(w * h);
  let norm = 0;
  p.octaves.forEach(({ rel, w: wk }, k) => {
    if (wk <= 0) return;
    const sigmaPx = rel * p.size * S;
    const octaveSeed = seed * 131 + k * 7919;
    const band =
      method === 'lattice' && sigmaPx >= 0.6
        ? latticeNoise(w, h, 0.577 / sigmaPx, octaveSeed)
        : bandNoise(w, h, sigmaPx < 0.3 ? 0 : sigmaPx, octaveSeed);
    const g = wk * pixelVarianceScale(sigmaPx);
    for (let i = 0; i < field.length; i++) field[i] += g * band[i];
    norm += wk * wk;
  });
  const s = norm > 0 ? 1 / Math.sqrt(norm) : 0;
  for (let i = 0; i < field.length; i++) field[i] *= s;
  return field;
}

// Output stage after the tone curve: encode, grain in Oklab L, then
// triangular +-1 LSB dither. Returns encoded floats; toBytes() rounds.
export function outputStage(lin, { strength = 0, seed = 1, ditherOn = true, method = 'lattice' } = {}) {
  const { w, h } = lin;
  const out = makeImage(w, h);
  const p = grainParams(strength);
  const field = strength > 0 ? grainField(w, h, p, seed, method) : null;
  const amp = ampCurve(p);
  const lab = [0, 0, 0];
  const rgb = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let r = Math.min(1, Math.max(0, lin.d[i * 3]));
      let g = Math.min(1, Math.max(0, lin.d[i * 3 + 1]));
      let b = Math.min(1, Math.max(0, lin.d[i * 3 + 2]));
      if (field) {
        linearToOklab(r, g, b, lab);
        oklabToLinear(lab[0] + amp(lab[0]) * field[i], lab[1], lab[2], rgb);
        r = Math.min(1, Math.max(0, rgb[0]));
        g = Math.min(1, Math.max(0, rgb[1]));
        b = Math.min(1, Math.max(0, rgb[2]));
      }
      const t = ditherOn ? (uniform(x, y, seed + 977) + uniform(x, y, seed + 983) - 1) / 255 : 0;
      out.d[i * 3] = linearToSrgb(r) + t;
      out.d[i * 3 + 1] = linearToSrgb(g) + t;
      out.d[i * 3 + 2] = linearToSrgb(b) + t;
    }
  }
  return out;
}
