// Seeded random numbers and the engine's 2D gradient noise (same hash and fade as
// src/light/recipes/sunset/boundary.ts, which ports the engine's GLSL), so a GPU port
// can use the existing gradientNoise.

const TAU = 6.283185307179586

function pcg3dX(a, b, c) {
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
  return x
}

const hash1 = (cx, cy, seed) => (pcg3dX((cx + 1048576) | 0, (cy + 1048576) | 0, (seed + 1048576) | 0) >>> 8) * (1 / 16777216)
const quintic = (f) => f * f * f * (f * (f * 6 - 15) + 10)

/** Gradient noise, roughly in [-1, 1], RMS about 0.305. */
export function gradientNoise(px, py, seed) {
  const ix = Math.floor(px)
  const iy = Math.floor(py)
  const fx = px - ix
  const fy = py - iy
  const ux = quintic(fx)
  const uy = quintic(fy)
  const a00 = hash1(ix, iy, seed) * TAU
  const a10 = hash1(ix + 1, iy, seed) * TAU
  const a01 = hash1(ix, iy + 1, seed) * TAU
  const a11 = hash1(ix + 1, iy + 1, seed) * TAU
  const n00 = Math.cos(a00) * fx + Math.sin(a00) * fy
  const n10 = Math.cos(a10) * (fx - 1) + Math.sin(a10) * fy
  const n01 = Math.cos(a01) * fx + Math.sin(a01) * (fy - 1)
  const n11 = Math.cos(a11) * (fx - 1) + Math.sin(a11) * (fy - 1)
  const nx0 = n00 + (n10 - n00) * ux
  const nx1 = n01 + (n11 - n01) * ux
  return 1.41421356 * (nx0 + (nx1 - nx0) * uy)
}
export const NOISE_RMS = 0.3052

/** 1D noise along x with unit RMS (a row of the 2D noise). */
export const noise1 = (x, seed, row = 0.5) => gradientNoise(x, row, seed) / NOISE_RMS

/** mulberry32 with the seed hashed first. */
export function random(seed) {
  let h = Math.imul((seed | 0) ^ 0x5bd1e995, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  let t = (h ^ (h >>> 16)) >>> 0
  const next = () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    between: (a, b) => a + (b - a) * next(),
    chance: (p) => next() < p,
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    sign: () => (next() < 0.5 ? -1 : 1),
  }
}
