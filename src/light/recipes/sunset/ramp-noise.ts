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

/**
 * Standard deviation of `f(x)` over `[from, to]` after removing its best-fit
 * line and parabola: the wiggle a boundary shaped by `f` shows across that span.
 */
export function wiggle(f: (x: number) => number, from: number, to: number, samples = 256): number {
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < samples; i++) {
    const x = from + ((i + 0.5) / samples) * (to - from)
    xs.push((2 * (x - from)) / (to - from) - 1)
    ys.push(f(x))
  }
  const s = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]
  for (let i = 0; i < samples; i++) {
    const basis = [1, xs[i], xs[i] * xs[i]]
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) s[r][c] += basis[r] * basis[c]
      s[r][3] += basis[r] * ys[i]
    }
  }
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      if (r === c) continue
      const k = s[r][c] / s[c][c]
      for (let q = c; q < 4; q++) s[r][q] -= k * s[c][q]
    }
  }
  const fit = [s[0][3] / s[0][0], s[1][3] / s[1][1], s[2][3] / s[2][2]]
  let sum = 0
  for (let i = 0; i < samples; i++) {
    const r = ys[i] - (fit[0] + fit[1] * xs[i] + fit[2] * xs[i] * xs[i])
    sum += r * r
  }
  return Math.sqrt(sum / samples)
}
