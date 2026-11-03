// Seeded hashes and the lattice-noise pieces of src/light/engine/grain.ts, ported to JS.

/** lowbias32 (Chris Wellons). */
export function hash32(x) {
  x >>>= 0
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return x >>> 0
}

export const hash3 = (x, y, s) => hash32(hash32(hash32(x + 0x9e3779b9) ^ Math.imul(y, 0x85ebca6b)) ^ Math.imul(s, 0xc2b2ae35))
export const unit = (h) => h / 4294967296

/** Unit-variance noise from three hashed uniforms (grainValue in grain.ts). */
export function cellValue(ix, iy, seed) {
  const h = hash3(ix, iy, seed)
  const a = unit(h)
  const b = unit(hash32(h ^ 0x68e31da4))
  const c = unit(hash32(h ^ 0xb5297a4d))
  return (a + b + c - 1.5) * 2
}

/** Cubic B-spline weights for the 4 lattice cells around fractional position t. */
export function bspline4(t) {
  const t2 = t * t
  const t3 = t2 * t
  return [(1 - 3 * t + 3 * t2 - t3) / 6, (4 - 6 * t2 + 3 * t3) / 6, (1 + 3 * t + 3 * t2 - 3 * t3) / 6, t3 / 6]
}

/** Standard normal CDF (Abramowitz and Stegun 7.1.26 on erf). */
export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y)
}
