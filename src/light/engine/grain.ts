import type { UniformMap } from '../scene'
import type { OutputFilter } from './filters/types'

/**
 * Grain: fine specks on Oklab L at output size, after the tone curve and
 * before dither, like Figma's Noise effect (the deck's Grain picture, 44:204)
 * and the brief's fine film grain. A speck is one pixel at 1080 px on the short
 * side: cells are shortSide / 1080 px, about 2 px in a 4K export and under a
 * pixel in a small preview. The strength is the Density: the share of cells
 * with a speck, from none at 0 to every cell at 1. Each speck is lighter or
 * darker by a fixed amount, so the mean stays, and neither its size nor its
 * strength changes with Density.
 *
 *   L' = L + amp(L) * weight * G(x)
 *   G  = the cells' specks blended bilinearly between cell centres (which sit
 *        on pixel centres), averaged over the output pixel, so a 4K speck is a
 *        pixel with soft edges and a pixel larger than a cell shows what a
 *        larger render shrunk to its size shows
 *   speck = 0, or +-(0.5..1) for a share `density` of cells
 *   amp(L) = SPECK * smoothstep(0, shadowEnd, L) * (1 - smoothstep(highlightStart, 1, L))
 *
 * Black stays black, and the grain fades out near white, where lighter specks
 * would clip and leave only dark ones.
 */

/** Cells across the short side: a speck is one pixel at 1080 px. */
export const GRAIN_CELLS_PER_SHORT_SIDE = 1080
/** Oklab L change of a full speck: Density 0.5 gives about 1.7 % L of grain in mid-tones, Density 1 about 2.4 %. */
const SPECK = 0.05
const SHADOW_END = 0.2
const HIGHLIGHT_START = 0.94
/** Cells averaged per axis at most; frames under about 300 px on the short side lose a little grain. */
const SPAN = 6

export interface GrainParams {
  /** Share of cells with a speck, 0..1. */
  density: number
  speck: number
  shadowEnd: number
  highlightStart: number
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** The strength is the Density; speck size and strength stay the same. */
export function grainParams(strength: number): GrainParams {
  const density = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0))
  return { density, speck: SPECK, shadowEnd: SHADOW_END, highlightStart: HIGHLIGHT_START }
}

/** Oklab L change of a full speck at lightness L. */
export function grainAmplitude(params: GrainParams, L: number): number {
  return params.speck * smoothstep(0, params.shadowEnd, L) * (1 - smoothstep(params.highlightStart, 1, L))
}

/** A cell's size in output pixels. */
export function grainCellPx(width: number, height: number): number {
  return Math.min(width, height) / GRAIN_CELLS_PER_SHORT_SIDE
}

/** Uniforms for GRAIN_GLSL at an output size. */
export function grainUniforms(strength: number, width: number, height: number): UniformMap {
  const params = grainParams(strength)
  return {
    uGrainAmp: params.density > 0 ? params.speck : 0,
    uGrainDensity: params.density,
    uGrainCell: grainCellPx(width, height),
    uGrainCurve: [params.shadowEnd, params.highlightStart],
  }
}

// The same math on the CPU, for tests and scripts.

function pcg3d(a: number, b: number, c: number): [number, number, number] {
  let x = (Math.imul(a, 1664525) + 1013904223) >>> 0
  let y = (Math.imul(b, 1664525) + 1013904223) >>> 0
  let z = (Math.imul(c, 1664525) + 1013904223) >>> 0
  x = (x + Math.imul(y, z)) >>> 0
  y = (y + Math.imul(z, x)) >>> 0
  z = (z + Math.imul(x, y)) >>> 0
  x = (x ^ (x >>> 16)) >>> 0
  y = (y ^ (y >>> 16)) >>> 0
  z = (z ^ (z >>> 16)) >>> 0
  x = (x + Math.imul(y, z)) >>> 0
  y = (y + Math.imul(z, x)) >>> 0
  z = (z + Math.imul(x, y)) >>> 0
  return [x, y, z]
}

const unit = (v: number) => (v >>> 8) / 16777216

/** A cell's speck: 0, or lighter or darker by 0.5 to 1, for a share `density` of cells (GLSL grainSpeck). */
export function grainSpeck(cx: number, cy: number, seed: number, density: number): number {
  const [hx, hy, hz] = pcg3d(cx + 1048576, cy + 1048576, grainSeed(seed) + 1048576)
  if (unit(hx) >= density) return 0
  return (unit(hy) < 0.5 ? -0.5 : 0.5) * (1 + unit(hz))
}

function grainSeed(seed: number): number {
  return seed * 131 + 1048576
}

/** Integral of the unit tent (1 - |t|) from -1 to t. */
function tentArea(t: number): number {
  const s = Math.min(1, Math.max(-1, t))
  return s < 0 ? 0.5 * (1 + s) * (1 + s) : 1 - 0.5 * (1 - s) * (1 - s)
}

function axisWeights(a: number, len: number): { first: number; weights: number[] } {
  const first = Math.floor(a)
  const count = Math.min(Math.ceil(a + len) - first + 1, SPAN)
  const weights = []
  for (let k = 0; k < count; k++) weights.push((tentArea(a + len - (first + k)) - tentArea(a - (first + k))) / len)
  return { first, weights }
}

/** The speck field G at output pixel (x, y) (GLSL grainField). */
export function grainField(x: number, y: number, density: number, cellPx: number, seed: number): number {
  const len = 1 / cellPx
  const ax = axisWeights((x - 0.5) * len, len)
  const ay = axisWeights((y - 0.5) * len, len)
  let g = 0
  ay.weights.forEach((wy, j) => {
    if (wy <= 0) return
    ax.weights.forEach((wx, i) => {
      if (wx > 0) g += wy * wx * grainSpeck(ax.first + i, ay.first + j, seed, density)
    })
  })
  return g
}

/** Needs CHUNK_LIBRARY (hashes, Oklab) and uSeed. */
export const GRAIN_GLSL = /* glsl */ `
uniform float uGrainAmp;      // Oklab L change of a full speck; 0 is off
uniform float uGrainDensity;  // share of cells with a speck
uniform float uGrainCell;     // cell size in output pixels: short side / ${GRAIN_CELLS_PER_SHORT_SIDE}
uniform vec2 uGrainCurve;     // lightness where the grain is full above black, where it starts to fade below white

// A cell's speck: 0, or lighter or darker by 0.5 to 1, for a share uGrainDensity of cells.
float grainSpeck(ivec2 cell, int seed) {
  vec3 u = unitFromUint(hashKey(ivec3(cell, seed)));
  if (u.x >= uGrainDensity) return 0.0;
  return (u.y < 0.5 ? -0.5 : 0.5) * (1.0 + u.z);
}

// Integral of the unit tent (1 - |t|) from -1 to t.
float grainTentArea(float t) {
  t = clamp(t, -1.0, 1.0);
  return t < 0.0 ? 0.5 * (1.0 + t) * (1.0 + t) : 1.0 - 0.5 * (1.0 - t) * (1.0 - t);
}

// The cells' specks blended bilinearly, averaged over the pixel. Cell centres sit on pixel centres (cell i on pixel
// i * uGrainCell), so a 2 px cell gives a speck with a one-pixel core and soft edges rather than a soft 2 x 2 block.
float grainField(ivec2 px) {
  float len = 1.0 / uGrainCell;
  vec2 a = (vec2(px) - 0.5) * len;
  ivec2 first = ivec2(floor(a));
  ivec2 count = min(ivec2(ceil(a + len)) - first + 1, ivec2(${SPAN}));
  float wx[${SPAN}];
  float wy[${SPAN}];
  for (int k = 0; k < ${SPAN}; k++) {
    vec2 cell = vec2(first + k);
    wx[k] = k < count.x ? (grainTentArea(a.x + len - cell.x) - grainTentArea(a.x - cell.x)) / len : 0.0;
    wy[k] = k < count.y ? (grainTentArea(a.y + len - cell.y) - grainTentArea(a.y - cell.y)) / len : 0.0;
  }
  int seed = uSeed * 131 + 1048576;
  float g = 0.0;
  for (int j = 0; j < ${SPAN}; j++) {
    if (j >= count.y) break;
    if (wy[j] <= 0.0) continue;
    float row = 0.0;
    for (int i = 0; i < ${SPAN}; i++) {
      if (i >= count.x) break;
      if (wx[i] > 0.0) row += wx[i] * grainSpeck(first + ivec2(i, j), seed);
    }
    g += wy[j] * row;
  }
  return g;
}

float grainAmplitude(float L) {
  return uGrainAmp * smoothstep(0.0, uGrainCurve.x, L) * (1.0 - smoothstep(uGrainCurve.y, 1.0, L));
}

// Display-linear in, display-linear out: grain moves Oklab L only, scaled by the recipe's 0..1 weight at this pixel.
vec3 applyGrain(vec3 display, ivec2 px, float weight) {
  vec3 lab = linearToOklab(display);
  float amp = grainAmplitude(lab.x) * weight;
  if (amp <= 0.0) return display;
  lab.x += amp * grainField(px);
  return saturate(oklabToLinear(lab));
}
`

/** The grain as the first stage of the output filter chain. */
export const GRAIN_FILTER: OutputFilter = {
  key: 'grain',
  glsl:
    GRAIN_GLSL +
    /* glsl */ `
vec3 filterGrain(vec3 display, ivec2 px, float weight) {
  if (uGrainAmp <= 0.0 || weight <= 0.0) return display;
  return applyGrain(display, px, weight);
}
`,
  apply: 'filterGrain',
  uniforms: (strength, frame) => grainUniforms(strength, frame.width, frame.height),
}
