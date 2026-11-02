/** The ramp shader's 1D edge noise on the CPU; must match `edgeFbm` in ramp-shader.ts. */

function rampHash(i: number, seed: number): number {
  let h = (Math.imul(i, 0x27d4eb2d) ^ Math.imul(seed, 0x165667b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

const rampUnit = (i: number, seed: number) => rampHash(i >>> 0, seed >>> 0) / 4294967296

function edgeNoise(x: number, seed: number): number {
  const i = Math.floor(x)
  const f = x - i
  const g0 = rampUnit(i, seed) * 2 - 1
  const g1 = rampUnit(i + 1, seed) * 2 - 1
  const u = f * f * f * (f * (f * 6 - 15) + 10)
  const v0 = g0 * f
  const v1 = g1 * (f - 1)
  return (v0 + (v1 - v0) * u) * 2
}

export function edgeFbm(x: number, seed: number, octaves: number): number {
  let sum = 0
  let amplitude = 1
  let norm = 0
  let frequency = 1
  for (let o = 0; o < Math.min(octaves, 4); o++) {
    sum += amplitude * edgeNoise(x * frequency + o * 17.31, seed + o * 101)
    norm += amplitude
    amplitude *= 0.5
    frequency *= 2.03
  }
  return sum / norm
}

/** Standard deviation of `f(x)` over `[from, to]`: how far a boundary shaped by `f` wanders across that span. */
export function spread(f: (x: number) => number, from: number, to: number, samples = 256): number {
  let sum = 0
  let squares = 0
  for (let i = 0; i < samples; i++) {
    const y = f(from + ((i + 0.5) / samples) * (to - from))
    sum += y
    squares += y * y
  }
  const mean = sum / samples
  return Math.sqrt(Math.max(0, squares / samples - mean * mean))
}
