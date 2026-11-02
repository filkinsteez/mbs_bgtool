import type { UniformMap } from '../scene'

/**
 * The Grain filter from prototypes/grain-study (README, lib/filter.mjs,
 * presets/grain-filter.json): mono grain on Oklab L at output size, after the
 * tone curve and before dither. One strength 0..1: up to FILM_UNTIL only the
 * film grain's amplitude grows (0.5 is about 1.25 % Oklab L at mid-tones);
 * from there to 1 every setting blends to the riso end, which matches the
 * three riso prints at 925 px.
 *
 *   L' = L + amp(L) * G(x)
 *   G  = sum_k w_k N_k / sqrt(sum w_k^2), N_k unit noise of blob sigma rel_k * size * shortSide
 *   amp(L) = ampMid * smoothstep(0, shadowEnd, L) * (1 - highlightCut * smoothstep(0.5, 1, L))
 *                   * (1 + inkBoost * (smoothstep(0.85, 0.45, L) - 0.5))
 */
interface GrainEnd {
  amp: number
  /** Blob sigma as a fraction of the short side. */
  size: number
  weights: readonly [number, number, number, number]
  shadowEnd: number
  highlightCut: number
  inkBoost: number
}

/** Octave sizes relative to `size`. */
export const GRAIN_OCTAVES = [0.5, 1, 2, 8] as const
const FILM: GrainEnd = { amp: 0.015, size: 0.0005, weights: [0.35, 0.85, 0.35, 0], shadowEnd: 0.25, highlightCut: 0.5, inkBoost: 0 }
const RISO: GrainEnd = { amp: 0.016, size: 0.0011, weights: [0.1, 0.6, 0.72, 0.12], shadowEnd: 0.2, highlightCut: 0, inkBoost: 0.9 }
const FILM_UNTIL = 0.6
/** Octaves at least this many output pixels wide use lattice noise; smaller ones per-pixel noise. */
export const LATTICE_MIN_SIGMA_PX = 0.6

export interface GrainParams extends GrainEnd {
  strength: number
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t

export function grainParams(strength: number): GrainParams {
  const s = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0))
  const toRiso = smoothstep(FILM_UNTIL, 1, s)
  return {
    strength: s,
    amp: mix(FILM.amp * Math.min(s / FILM_UNTIL, 1), RISO.amp, toRiso),
    size: mix(FILM.size, RISO.size, toRiso),
    weights: [0, 1, 2, 3].map((k) => mix(FILM.weights[k], RISO.weights[k], toRiso)) as unknown as GrainEnd['weights'],
    shadowEnd: mix(FILM.shadowEnd, RISO.shadowEnd, toRiso),
    highlightCut: mix(FILM.highlightCut, RISO.highlightCut, toRiso),
    inkBoost: mix(FILM.inkBoost, RISO.inkBoost, toRiso),
  }
}

/** Standard deviation of the grain in Oklab L at lightness L. */
export function grainAmplitude(params: GrainParams, L: number): number {
  const shadow = smoothstep(0, params.shadowEnd, L)
  const highlight = 1 - params.highlightCut * smoothstep(0.5, 1, L)
  const ink = 1 + params.inkBoost * (1 - smoothstep(0.45, 0.85, L) - 0.5)
  return params.amp * shadow * highlight * ink
}

/**
 * Uniforms for GRAIN_GLSL at an output size. Octave k's weight includes
 * sqrt(1 / (1 + 1 / (4 pi sigma^2))): an octave smaller than a pixel loses
 * the variance a pixel would average away, so a preview shows the grain an
 * export shows at the same viewing size.
 */
export function grainUniforms(strength: number, width: number, height: number): UniformMap {
  const params = grainParams(strength)
  const short = Math.min(width, height)
  const sigmas = GRAIN_OCTAVES.map((rel) => rel * params.size * short)
  const norm = Math.sqrt(params.weights.reduce((sum, w) => sum + w * w, 0)) || 1
  const weights = params.weights.map((w, k) => (w * Math.sqrt(1 / (1 + 1 / (4 * Math.PI * sigmas[k] * sigmas[k])))) / norm)
  return {
    uGrainAmp: params.strength > 0 ? params.amp : 0,
    uGrainSigmaPx: sigmas,
    uGrainWeight: weights,
    uGrainCurve: [params.shadowEnd, params.highlightCut, params.inkBoost],
  }
}

/** Needs CHUNK_LIBRARY (hashes, Oklab) and uSeed. */
export const GRAIN_GLSL = /* glsl */ `
uniform float uGrainAmp;
uniform vec4 uGrainSigmaPx;
uniform vec4 uGrainWeight;
uniform vec3 uGrainCurve;  // shadowEnd, highlightCut, inkBoost

// Unit-variance noise from three hashed uniforms (close to gaussian once blended).
float grainValue(ivec2 cell, int seed) {
  vec3 u = unitFromUint(hashKey(ivec3(cell, seed)));
  return (u.x + u.y + u.z - 1.5) * 2.0;
}

vec4 bsplineWeights4(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4(1.0 - 3.0 * t + 3.0 * t2 - t3, 4.0 - 6.0 * t2 + 3.0 * t3, 1.0 + 3.0 * t + 3.0 * t2 - 3.0 * t3, t3) / 6.0;
}

// Lattice values blended with cubic B-spline weights over 4 x 4 cells, divided by the weights' root sum of
// squares so the variance is the same everywhere. A blob sigma is about 0.577 lattice cells.
float latticeNoise(vec2 u, int seed) {
  vec2 cell = floor(u);
  vec4 wx = bsplineWeights4(u.x - cell.x);
  vec4 wy = bsplineWeights4(u.y - cell.y);
  ivec2 base = ivec2(cell) - 1;
  float sum = 0.0;
  for (int j = 0; j < 4; j++) {
    float row = 0.0;
    for (int i = 0; i < 4; i++) row += wx[i] * grainValue(base + ivec2(i, j), seed);
    sum += wy[j] * row;
  }
  return sum / sqrt(dot(wx, wx) * dot(wy, wy));
}

float grainField(ivec2 px) {
  float g = 0.0;
  for (int k = 0; k < 4; k++) {
    float w = uGrainWeight[k];
    if (w <= 0.0) continue;
    float sigma = uGrainSigmaPx[k];
    int seed = uSeed * 131 + k * 7919 + 1048576;
    g += w * (sigma >= ${LATTICE_MIN_SIGMA_PX.toFixed(1)} ? latticeNoise((vec2(px) + 0.5) * 0.577 / sigma, seed) : grainValue(px, seed));
  }
  return g;
}

float grainAmplitude(float L) {
  float shadow = smoothstep(0.0, uGrainCurve.x, L);
  float highlight = 1.0 - uGrainCurve.y * smoothstep(0.5, 1.0, L);
  float ink = 1.0 + uGrainCurve.z * (0.5 - smoothstep(0.45, 0.85, L));
  return uGrainAmp * shadow * highlight * ink;
}

// Display-linear in, display-linear out: grain moves Oklab L only, scaled by the recipe's 0..1 weight at this pixel.
vec3 applyGrain(vec3 display, ivec2 px, float weight) {
  vec3 lab = linearToOklab(display);
  lab.x += grainAmplitude(lab.x) * weight * grainField(px);
  return saturate(oklabToLinear(lab));
}
`
