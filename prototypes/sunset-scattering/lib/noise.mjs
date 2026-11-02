// Seeded random numbers and smooth low-frequency noise.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand) {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function hash1(i, seed) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(seed | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// 1D value noise with quintic interpolation, range about [-1, 1].
export function valueNoise1(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = hash1(i, seed) * 2 - 1;
  const b = hash1(i + 1, seed) * 2 - 1;
  return a + (b - a) * u;
}

// A few octaves of 1D value noise, normalised to about [-1, 1].
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
