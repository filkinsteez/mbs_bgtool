import { gradientNoise, NOISE_RMS } from './boundary'

/** Seed of the edge noise for a scene seed; the shader and compose use the same one. */
export const edgeSeed = (seed: number) => seed * 7 + 101

/** Gaussian bump along an edge: x and width in frame widths, shift in frame heights. */
export type Bump = readonly [x: number, width: number, shift: number]

/**
 * The broad shape of one band edge: a tilt, Gaussian bumps and a broad wave
 * of two octaves. The shader computes the same numbers (`edgeWave`, `edgeAt`
 * in bands.ts), so compose can check band thickness on the CPU.
 */
export interface EdgeShape {
  /** Frame heights, 0 top. */
  base: number
  /** Change across the frame width, frame heights. */
  tilt: number
  bumps: readonly Bump[]
  /** Amplitude of the broad wave, frame heights. */
  wave: number
  /** Lattice of the broad wave along the edge, short-side units. */
  wavelength: number
  /** Noise row: the shader uses 2 x the band index for a band's top edge. */
  row: number
}

/** Broad wave along an edge, RMS about 1: two octaves of the engine's gradient noise on one row. */
export function edgeWave(a: number, wavelength: number, row: number, seed: number): number {
  const n1 = gradientNoise(a / wavelength + 0.37, 0.5 + 3.1 * row, seed)
  const n2 = gradientNoise((2 * a) / wavelength + 5.1, 1.9 + 3.1 * row, seed + 1)
  return (n1 + 0.5 * n2) / (NOISE_RMS * 1.118)
}

/**
 * How much of its wave an edge shows at `a` along it (short sides), between a quarter and all of it: the wander
 * comes and goes along the edge, so it never reads as a steady ripple.
 */
export function edgeSwell(a: number, row: number, seed: number): number {
  const t = Math.min(1, Math.max(0, 0.5 + gradientNoise(a / 1.7 + 4.1, 23 + 3.1 * row, seed + 77) / NOISE_RMS / 2))
  return 0.25 + 0.75 * t * t * (3 - 2 * t)
}

/** Edge height in frame heights at frame x (0..1); `frameW` is the frame width in short sides. */
export function edgeAt(edge: EdgeShape, x: number, frameW: number, seed: number): number {
  let v = edge.base + edge.tilt * (x - 0.5)
  for (const [at, width, shift] of edge.bumps) {
    if (width <= 0) continue
    const r = (x - at) / width
    v += shift * Math.exp(-0.5 * r * r)
  }
  const a = (x - 0.5) * frameW
  if (edge.wave !== 0) v += edge.wave * edgeSwell(a, edge.row, seed) * edgeWave(a, edge.wavelength, edge.row, seed)
  return v
}

/** The GLSL twins of edgeWave, edgeSwell and the bump sum. Needs the engine's gradientNoise. */
export const BANDS_SHAPE_GLSL = /* glsl */ `
float edgeWave(float a, float wavelength, float row, int seed) {
  float n1 = gradientNoise(vec2(a / wavelength + 0.37, 0.5 + 3.1 * row), seed);
  float n2 = gradientNoise(vec2(2.0 * a / wavelength + 5.1, 1.9 + 3.1 * row), seed + 1);
  return (n1 + 0.5 * n2) / (${NOISE_RMS} * 1.118);
}

float edgeSwell(float a, float row, int seed) {
  float t = clamp(0.5 + gradientNoise(vec2(a / 1.7 + 4.1, 23.0 + 3.1 * row), seed + 77) / ${NOISE_RMS} / 2.0, 0.0, 1.0);
  return 0.25 + 0.75 * t * t * (3.0 - 2.0 * t);
}
`
