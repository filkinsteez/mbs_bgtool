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
 *
 * The grain varies a little, as film grain does in the moodboard references
 * (owner, 2026-11-11 2:50 PM: "a little bit more variation ... in sizing or
 * where on the image it is based on intensity/lumanicane"). Each speck keeps
 * its strength; what varies is how many cells have one and, in the dark, their
 * size:
 *   - fewer specks in deep shadows and near white: LIGHT_DENSITY of the
 *     midtones' count below L 0.1 and above L 0.97, all of it from L 0.4 to
 *     0.75 (the references' grain is strongest in the midtones);
 *   - the count drifts slowly across the frame by up to DRIFT either way, from
 *     smooth noise on lattices a third and a seventh of the short side;
 *   - in darker areas up to CLUMP of the grain comes from soft clumps two cells
 *     wide (the film references' grain is larger in the dark).
 * The specks' mean is taken off at the local count, so a flat area keeps its
 * level.
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
/** The speck count in deep shadows and near white, against the midtones'. */
const LIGHT_DENSITY = 0.6
/** How far the speck count drifts across the frame, either way. */
const DRIFT = 0.3
/** The share of the grain from soft two-cell clumps in the darkest areas. */
const CLUMP = 0.4
/** The std of a clump field (bilinear between clump cells) against a speck field's, at the same count. */
const CLUMP_STD = 2 / 3
/**
 * A speck fades in over this much of a cell's hash past the count's edge, so a count that changes with lightness and
 * place changes a speck smoothly: a hair's difference in lightness gives a hair's difference, never a whole speck.
 */
const SPECK_FADE = 0.01

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

/** The speck count at lightness L against the midtones': fewer in deep shadows and near white. */
export function grainLightDensity(L: number): number {
  return 1 - (1 - LIGHT_DENSITY) * (1 - smoothstep(0.1, 0.4, L) + smoothstep(0.75, 0.97, L))
}

/** The share of the grain from soft two-cell clumps at lightness L. */
export function grainClumpShare(L: number): number {
  return CLUMP * (1 - smoothstep(0.2, 0.55, L))
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
  const w = Math.min(1, Math.max(0, (density * SPECK_SHARE - unit(hx)) / SPECK_FADE))
  if (w <= 0) return 0
  return w * (unit(hy) < DARK_SHARE ? -0.5 : 0.5) * (1 + unit(hz))
}

/** The mean speck over all cells at a density, which grainField takes off so a flat area keeps its level. */
export function grainSpeckMean(density: number): number {
  const t = density * SPECK_SHARE
  const present = t >= SPECK_FADE ? t - SPECK_FADE / 2 : (t * t) / (2 * SPECK_FADE)
  return present * SPECK_MEAN_SIZE * (1 - 2 * DARK_SHARE)
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

/** The specks alone at output pixel (x, y), minus their mean (GLSL grainSpecks). */
function grainSpecks(x: number, y: number, density: number, cellPx: number, seed: number): number {
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

/** Soft clumps two cells wide at output pixel (x, y): the clump cells' specks, bilinear between their centers, minus their mean (GLSL grainClumps). */
function grainClumps(x: number, y: number, density: number, cellPx: number, seed: number): number {
  const px = (x + 0.5) / (2 * cellPx) - 0.5
  const py = (y + 0.5) / (2 * cellPx) - 0.5
  const [ix, iy] = [Math.floor(px), Math.floor(py)]
  const [fx, fy] = [px - ix, py - iy]
  const at = (cx: number, cy: number) => grainSpeck(cx, cy, seed + 1, density)
  const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx
  const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx
  return top * (1 - fy) + bottom * fy - grainSpeckMean(density)
}

function latticeValue(qx: number, qy: number, seed: number): number {
  return unit(pcg3d(qx + 1048576, qy + 1048576, seed + 1048576)[0]) * 2 - 1
}

function smoothNoise(x: number, y: number, seed: number): number {
  const [ix, iy] = [Math.floor(x), Math.floor(y)]
  const [fx, fy] = [x - ix, y - iy]
  const [ux, uy] = [fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)]
  const top = latticeValue(ix, iy, seed) * (1 - ux) + latticeValue(ix + 1, iy, seed) * ux
  const bottom = latticeValue(ix, iy + 1, seed) * (1 - ux) + latticeValue(ix + 1, iy + 1, seed) * ux
  return top * (1 - uy) + bottom * uy
}

/** The slow drift of the speck count at output pixel (x, y), -1 to 1 (GLSL grainDrift). */
export function grainDrift(x: number, y: number, cellPx: number, seed: number): number {
  const sx = (x + 0.5) / (cellPx * GRAIN_CELLS_PER_SHORT_SIDE)
  const sy = (y + 0.5) / (cellPx * GRAIN_CELLS_PER_SHORT_SIDE)
  const s = seed * 131 + 7919
  return 0.7 * smoothNoise(sx * 3, sy * 3, s) + 0.3 * smoothNoise(sx * 7 + 17, sy * 7 + 17, s + 1)
}

/** The grain field G at output pixel (x, y) over lightness L (GLSL grainField); L defaults to the midtones. */
export function grainField(x: number, y: number, density: number, cellPx: number, seed: number, L = 0.6): number {
  const local = Math.min(1, density * grainLightDensity(L) * (1 + DRIFT * grainDrift(x, y, cellPx, seed)))
  const g = grainSpecks(x, y, local, cellPx, seed)
  const c = grainClumpShare(L)
  if (c <= 0) return g
  return ((1 - c) * g + (c * grainClumps(x, y, local, cellPx, seed)) / CLUMP_STD) / Math.hypot(1 - c, c)
}

/** Needs CHUNK_LIBRARY (hashes, Oklab) and uSeed. */
export const GRAIN_GLSL = /* glsl */ `
uniform float uGrainAmp;      // Oklab L change of a full speck; 0 is off
uniform float uGrainDensity;  // the Density: a share uGrainDensity * ${glslFloat(SPECK_SHARE)} of cells has a speck
uniform float uGrainCell;     // cell size in output pixels: short side / ${GRAIN_CELLS_PER_SHORT_SIDE}
uniform vec2 uGrainCurve;     // lightness where the grain is full above black, where it starts to fade below white

// A cell's speck at the speck count \`density\`: 0, or darker (a share ${glslFloat(DARK_SHARE)} of specks) or lighter by 0.5 to 1.
float grainSpeck(ivec2 cell, int seed, float density) {
  vec3 u = unitFromUint(hashKey(ivec3(cell, seed)));
  float w = clamp((density * ${glslFloat(SPECK_SHARE)} - u.x) / ${glslFloat(SPECK_FADE)}, 0.0, 1.0);
  if (w <= 0.0) return 0.0;
  return w * (u.y < ${glslFloat(DARK_SHARE)} ? -0.5 : 0.5) * (1.0 + u.z);
}

// The mean speck at the speck count \`density\` (grainSpeckMean), taken off so a flat area keeps its level.
float grainMean(float density) {
  float t = density * ${glslFloat(SPECK_SHARE)};
  float present = t >= ${glslFloat(SPECK_FADE)} ? t - ${glslFloat(SPECK_FADE / 2)} : t * t / ${glslFloat(2 * SPECK_FADE)};
  return present * ${glslFloat(SPECK_MEAN_SIZE * (1 - 2 * DARK_SHARE))};
}

// The specks as squares a cell wide, edges on whole multiples of the cell from the frame's corner, averaged over the
// pixel, so a 2 px cell gives a crisp 2 x 2 speck; minus the specks' mean, so a flat area keeps its level.
float grainSpecks(ivec2 px, float density) {
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
      if (wx[i] > 0.0) row += wx[i] * grainSpeck(first + ivec2(i, j), seed, density);
    }
    g += wy[j] * row;
  }
  return g - grainMean(density);
}

// Soft clumps two cells wide: the clump cells' specks, bilinear between their centers, minus their mean.
float grainClumps(ivec2 px, float density) {
  vec2 p = (vec2(px) + 0.5) / (2.0 * uGrainCell) - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  ivec2 q = ivec2(i);
  int seed = (uSeed + 1) * 131 + 1048576;
  float top = mix(grainSpeck(q, seed, density), grainSpeck(q + ivec2(1, 0), seed, density), f.x);
  float bottom = mix(grainSpeck(q + ivec2(0, 1), seed, density), grainSpeck(q + ivec2(1, 1), seed, density), f.x);
  return mix(top, bottom, f.y) - grainMean(density);
}

float grainLattice(ivec2 q, int seed) {
  return unitFromUint(hashKey(ivec3(q, seed))).x * 2.0 - 1.0;
}

float grainNoise(vec2 p, int seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 q = ivec2(i);
  float top = mix(grainLattice(q, seed), grainLattice(q + ivec2(1, 0), seed), u.x);
  float bottom = mix(grainLattice(q + ivec2(0, 1), seed), grainLattice(q + ivec2(1, 1), seed), u.x);
  return mix(top, bottom, u.y);
}

// The slow drift of the speck count, -1 to 1: smooth noise on lattices a third and a seventh of the short side.
float grainDrift(ivec2 px) {
  vec2 s = (vec2(px) + 0.5) / (uGrainCell * ${glslFloat(GRAIN_CELLS_PER_SHORT_SIDE)});
  int seed = uSeed * 131 + 7919;
  return 0.7 * grainNoise(s * 3.0, seed) + 0.3 * grainNoise(s * 7.0 + 17.0, seed + 1);
}

// The grain at lightness L: fewer specks in deep shadows and near white, a slow drift of their count across the frame,
// and in darker areas part of the grain from soft two-cell clumps; each speck keeps its strength.
float grainField(ivec2 px, float L) {
  float light = 1.0 - ${glslFloat(1 - LIGHT_DENSITY)} * (1.0 - smoothstep(0.1, 0.4, L) + smoothstep(0.75, 0.97, L));
  float density = min(1.0, uGrainDensity * light * (1.0 + ${glslFloat(DRIFT)} * grainDrift(px)));
  float g = grainSpecks(px, density);
  float c = ${glslFloat(CLUMP)} * (1.0 - smoothstep(0.2, 0.55, L));
  if (c <= 0.0) return g;
  return ((1.0 - c) * g + c * grainClumps(px, density) / ${glslFloat(CLUMP_STD)}) / length(vec2(1.0 - c, c));
}

float grainAmplitude(float L) {
  return uGrainAmp * smoothstep(0.0, uGrainCurve.x, L) * (1.0 - smoothstep(uGrainCurve.y, 1.0, L));
}

// Display-linear in, display-linear out: grain moves Oklab L only, scaled by the recipe's 0..1 weight at this pixel.
vec3 applyGrain(vec3 display, ivec2 px, float weight) {
  vec3 lab = linearToOklab(display);
  float amp = grainAmplitude(lab.x) * weight;
  if (amp <= 0.0) return display;
  lab.x += amp * grainField(px, lab.x);
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
