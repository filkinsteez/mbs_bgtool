// Integer hash noise that ports directly to GLSL ES 3.0 (uint math).

export function hash32(x, y, seed) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function hash01(x, y, seed) {
  return hash32(x, y, seed) / 4294967296;
}

// Approximately unit-variance gaussian from 4 uniforms (Irwin–Hall).
export function hashGauss(x, y, seed) {
  let s = 0;
  for (let k = 0; k < 4; k++) s += hash01(x, y, seed * 4 + k + 17);
  return (s - 2) * Math.sqrt(3);
}

function quintic(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// 1D value noise in [-1, 1].
export function valueNoise1(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash01(i, 0, seed) * 2 - 1;
  const b = hash01(i + 1, 0, seed) * 2 - 1;
  return a + (b - a) * quintic(f);
}

// 2D value noise in [-1, 1].
export function valueNoise2(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = quintic(x - ix);
  const fy = quintic(y - iy);
  const a = hash01(ix, iy, seed);
  const b = hash01(ix + 1, iy, seed);
  const c = hash01(ix, iy + 1, seed);
  const d = hash01(ix + 1, iy + 1, seed);
  return (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) * 2 - 1;
}

// Low-frequency fbm in 1D, roughly in [-1, 1].
export function fbm1(x, seed, octaves = 3) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise1(x * f, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

export function fbm2(x, y, seed, octaves = 3) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2(x * f, y * f, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

// Deterministic PRNG for parameter jitter (mulberry32).
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
