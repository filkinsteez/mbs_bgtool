// Seeded integer hash and 2D gradient noise. Both port directly to GLSL ES 3.0
// (uint math) so the GPU recipe can reproduce the same field for a seed.

export function hash3(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function grad(ix, iy, seed, dx, dy) {
  const a = hash3(ix, iy, seed) * Math.PI * 2;
  return Math.cos(a) * dx + Math.sin(a) * dy;
}

// Gradient noise in about [-0.7, 0.7].
export function gnoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fade(fx);
  const v = fade(fy);
  const n00 = grad(ix, iy, seed, fx, fy);
  const n10 = grad(ix + 1, iy, seed, fx - 1, fy);
  const n01 = grad(ix, iy + 1, seed, fx, fy - 1);
  const n11 = grad(ix + 1, iy + 1, seed, fx - 1, fy - 1);
  return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v;
}

export function fbm2(x, y, seed, octaves = 2) {
  let s = 0;
  let a = 1;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    s += a * gnoise(x * f, y * f, seed + o * 101);
    norm += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / norm;
}

// Small seeded PRNG for composition choices (mulberry32).
export function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
