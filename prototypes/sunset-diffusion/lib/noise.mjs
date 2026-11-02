// 2D gradient noise and fbm built on an integer hash, so the same values can be
// produced in GLSL ES 3.0 with uint math.

function hash(ix, iy, seed) {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const TAU_OVER_U32 = (Math.PI * 2) / 4294967296;

function grad(ix, iy, seed, fx, fy) {
  const a = hash(ix, iy, seed) * TAU_OVER_U32;
  return Math.cos(a) * fx + Math.sin(a) * fy;
}

// Returns roughly [-1, 1].
export function gnoise(x, y, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const n00 = grad(ix, iy, seed, fx, fy);
  const n10 = grad(ix + 1, iy, seed, fx - 1, fy);
  const n01 = grad(ix, iy + 1, seed, fx, fy - 1);
  const n11 = grad(ix + 1, iy + 1, seed, fx - 1, fy - 1);
  const nx0 = n00 + (n10 - n00) * ux;
  const nx1 = n01 + (n11 - n01) * ux;
  return 1.41 * (nx0 + (nx1 - nx0) * uy);
}

export function fbm(x, y, seed = 0, octaves = 3, lacunarity = 2.03, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += amp * gnoise(fx, fy, seed + o * 101);
    norm += amp;
    amp *= gain;
    // rotate each octave a little so lattice axes don't line up
    const nx = 0.8 * fx - 0.6 * fy;
    const ny = 0.6 * fx + 0.8 * fy;
    fx = nx * lacunarity + 17.3;
    fy = ny * lacunarity + 5.1;
  }
  return sum / norm;
}

// Small deterministic PRNG for grain and dither (mulberry32).
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
