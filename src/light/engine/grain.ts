import type { UniformMap } from '../scene'
import type { OutputFilter } from './filters/types'

/**
 * Grain: fine specks on Oklab L at output size, after the tone curve and
 * before dither, like Figma's Noise effect (the deck's Grain picture, 44:204)
 * and the brief's fine film grain. A speck is one pixel at 1080 px on the short
 * side: cells are shortSide / 1080 px, about 2 px in a 4K export and under a
 * pixel in a small preview. The strength is the Density: how many cells have a
 * speck, from none at 0 to SPECK_SHARE of them at 1, so most specks stand apart
 * with the picture clean between them, as in the deck's picture. Most specks
 * are darker, as there, and the rest lighter, each by a fixed amount; the
 * specks' mean is taken off, so the mean stays. Neither a speck's size nor its
 * strength changes with Density.
 *
 *   L' = L + amp(L) * weight * G(x)
 *   G  = the cells' specks as squares a cell wide (edges on whole multiples of
 *        the cell from the frame's corner), averaged over the output pixel, so
 *        a 4K speck is a crisp 2 x 2 px square and a pixel larger than a cell
 *        shows what a larger render shrunk to its size shows; minus the specks'
 *        mean, so a flat area keeps its level
 *   speck = 0, or darker (a share DARK_SHARE of specks) or lighter by 0.5..1,
 *           for a share `density * SPECK_SHARE` of cells
 *   amp(L) = SPECK * smoothstep(0, shadowEnd, L) * (1 - smoothstep(highlightStart, 1, L))
 *
 * Black stays black, and the grain fades out near white, where lighter specks
 * would clip and leave only dark ones.
 */

/** Cells across the short side: a speck is one pixel at 1080 px. */
export const GRAIN_CELLS_PER_SHORT_SIDE = 1080
/** Oklab L change of a full speck: Density 0.5 gives about 1.7 % L of grain in mid-tones in a 4K export, Density 1 about 2.3 %. */
const SPECK = 0.0575
/** Share of cells with a speck at Density 1. */
const SPECK_SHARE = 0.3
/** Share of specks that are darker; the rest are lighter. */
const DARK_SHARE = 0.8
/** Mean size of a speck, 0.5 to 1. */
const SPECK_MEAN_SIZE = 0.75
const SHADOW_END = 0.2
const HIGHLIGHT_START = 0.94
/** Cells averaged per axis at most; frames under about 220 px on the short side lose a little grain. */
const SPAN = 6

const glslFloat = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v))

export interface GrainParams {
  /** The Density, 0..1: a share `density * SPECK_SHARE` of cells has a speck. */
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

/**
 * A cell's speck (GLSL grainSpeck): 0, or darker (a share DARK_SHARE of specks) or lighter by 0.5 to 1, for a share
 * `density * SPECK_SHARE` of cells.
 */
export function grainSpeck(cx: number, cy: number, seed: number, density: number): number {
  const [hx, hy, hz] = pcg3d(cx + 1048576, cy + 1048576, grainSeed(seed) + 1048576)
  if (unit(hx) >= density * SPECK_SHARE) return 0
  return (unit(hy) < DARK_SHARE ? -0.5 : 0.5) * (1 + unit(hz))
}

/** The mean speck over all cells at a density, which grainField takes off so a flat area keeps its level. */
export function grainSpeckMean(density: number): number {
  return density * SPECK_SHARE * SPECK_MEAN_SIZE * (1 - 2 * DARK_SHARE)
}

function grainSeed(seed: number): number {
  return seed * 131 + 1048576
}

/** How much of the pixel [a, a + len) (in cells) each cell from floor(a) on covers, as a share of the pixel. */
function axisWeights(a: number, len: number): { first: number; weights: number[] } {
  const first = Math.floor(a)
  const count = Math.min(Math.ceil(a + len) - first, SPAN)
  const weights = []
  for (let k = 0; k < count; k++) weights.push((Math.min(a + len, first + k + 1) - Math.max(a, first + k)) / len)
  return { first, weights }
}

/** The speck field G at output pixel (x, y) (GLSL grainField). */
export function grainField(x: number, y: number, density: number, cellPx: number, seed: number): number {
  const len = 1 / cellPx
  const ax = axisWeights(x * len, len)
  const ay = axisWeights(y * len, len)
  let g = 0
  ay.weights.forEach((wy, j) => {
    if (wy <= 0) return
    ax.weights.forEach((wx, i) => {
      if (wx > 0) g += wy * wx * grainSpeck(ax.first + i, ay.first + j, seed, density)
    })
  })
  return g - grainSpeckMean(density)
}

/** Needs CHUNK_LIBRARY (hashes, Oklab) and uSeed. */
export const GRAIN_GLSL = /* glsl */ `
uniform float uGrainAmp;      // Oklab L change of a full speck; 0 is off
uniform float uGrainDensity;  // the Density: a share uGrainDensity * ${glslFloat(SPECK_SHARE)} of cells has a speck
uniform float uGrainCell;     // cell size in output pixels: short side / ${GRAIN_CELLS_PER_SHORT_SIDE}
uniform vec2 uGrainCurve;     // lightness where the grain is full above black, where it starts to fade below white

// A cell's speck: 0, or darker (a share ${glslFloat(DARK_SHARE)} of specks) or lighter by 0.5 to 1.
float grainSpeck(ivec2 cell, int seed) {
  vec3 u = unitFromUint(hashKey(ivec3(cell, seed)));
  if (u.x >= uGrainDensity * ${glslFloat(SPECK_SHARE)}) return 0.0;
  return (u.y < ${glslFloat(DARK_SHARE)} ? -0.5 : 0.5) * (1.0 + u.z);
}

// The specks as squares a cell wide, edges on whole multiples of the cell from the frame's corner, averaged over the
// pixel, so a 2 px cell gives a crisp 2 x 2 speck; minus the specks' mean, so a flat area keeps its level.
float grainField(ivec2 px) {
  float len = 1.0 / uGrainCell;
  vec2 a = vec2(px) * len;
  ivec2 first = ivec2(floor(a));
  ivec2 count = min(ivec2(ceil(a + len)) - first, ivec2(${SPAN}));
  float wx[${SPAN}];
  float wy[${SPAN}];
  for (int k = 0; k < ${SPAN}; k++) {
    vec2 cell = vec2(first + k);
    wx[k] = k < count.x ? (min(a.x + len, cell.x + 1.0) - max(a.x, cell.x)) / len : 0.0;
    wy[k] = k < count.y ? (min(a.y + len, cell.y + 1.0) - max(a.y, cell.y)) / len : 0.0;
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
  return g - uGrainDensity * ${glslFloat(grainSpeckMean(1))};
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
