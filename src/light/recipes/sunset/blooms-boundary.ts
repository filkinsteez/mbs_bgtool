import { GLOW_COUNT } from './blooms-compose'
import { calibrateBoundary, type BoundaryParams } from './boundary'

/**
 * Minor radius, in short-side units, that the glow edge field is calibrated
 * for. Each glow reads the field across its long axis in units of its own
 * minor radius; a glow larger than this moves no further than one this size.
 */
export const BLOOM_MINOR_REF = 0.3

/** Distance between the field rows that neighbouring glows read, in short-side units, so each glow's edge gets its own shape. */
export const BLOOM_ROW = 6 * BLOOM_MINOR_REF

/**
 * Glow edges, per glow in its own frame: along its long axis (`a`, short-side
 * units) and across it (`s0`, distance mode). Across, the lattice is the minor
 * radius and the requested wander a tenth of it (the fold guard usually leaves
 * 0.05 to 0.065), so the edge drifts and the inner and outer edges move apart.
 * Along the glow the lattice is long (bumps at least 10 times wider than they
 * are deep): a glow's faint outer light shows every bump, and shorter ones
 * read as clouds or hills. The edge softness changes slowly along the arc.
 * The deep area's edge reads the row after the last glow's, and the line
 * above which the sky gets darker the row after that.
 */
export const BLOOM_BOUNDARY: BoundaryParams = {
  wander: [[0, 0.1 * BLOOM_MINOR_REF]],
  vertical: 'distance',
  ly: BLOOM_MINOR_REF,
  scale: 0.7,
  sharedScale: 0.8,
  gain: 0.4,
  soft: { amount: 0.1, scale: 1.0, ly: 1, wRef: 0 },
  range: [-3 * BLOOM_MINOR_REF, 3 * BLOOM_MINOR_REF + (GLOW_COUNT + 1) * BLOOM_ROW],
}

const CACHE_SIZE = 32
const cache = new Map<string, Record<string, number | number[]>>()

/** Shader uniforms for BOUNDARY_GLSL, calibrated once per params, frame aspect and seed. */
export function bloomBoundaryUniforms(params: BoundaryParams, aspect: number, seed: number): Record<string, number | number[]> {
  const key = `${JSON.stringify(params)}|${aspect}|${seed}`
  let uniforms = cache.get(key)
  if (uniforms) {
    cache.delete(key)
  } else {
    uniforms = calibrateBoundary(params, aspect, seed).uniforms
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  }
  cache.set(key, uniforms)
  return uniforms
}
