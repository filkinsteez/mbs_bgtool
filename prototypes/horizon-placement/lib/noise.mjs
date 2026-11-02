// Small seeded noise for the sketches: 1D gradient noise and a two-octave sum, about -1..1.
function hash(i, seed) {
  let h = Math.imul(i ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul(seed + 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

export function noise1(x, seed) {
  const i = Math.floor(x)
  const f = x - i
  const g0 = hash(i, seed) * 2 - 1
  const g1 = hash(i + 1, seed) * 2 - 1
  const u = f * f * f * (f * (f * 6 - 15) + 10)
  return 2 * (g0 * f + (g1 * (f - 1) - g0 * f) * u)
}

export const fbm1 = (x, seed) => (noise1(x, seed) + 0.4 * noise1(2.03 * x + 7.1, seed + 17)) / 1.08

/** mulberry32 */
export function random(seed) {
  let a = (Math.imul(seed | 0, 0x9e3779b1) ^ 0x5bd1e995) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
