// Exact ports of the engine's GLSL hash and noise (src/light/engine/glsl/hash.ts
// and noise.ts), so a seed gives the same field here and on the GPU.

const TAU = Math.PI * 2;

// pcg3d (Jarzynski and Olano 2020), first component only, as uint32.
function pcg3dX(a, b, c) {
  let x = (Math.imul(a, 1664525) + 1013904223) >>> 0;
  let y = (Math.imul(b, 1664525) + 1013904223) >>> 0;
  let z = (Math.imul(c, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  return x;
}

// hash1(ivec2 cell, int seed) in [0, 1)
export function hash1(cx, cy, seed) {
  const v = pcg3dX((cx + 1048576) | 0, (cy + 1048576) | 0, (seed + 1048576) | 0);
  return (v >>> 8) * (1 / 16777216);
}

// hashIndex(int index, int seed): one value per (index, seed)
export function hashIndex(index, seed) {
  return hash1(index, 7919, seed);
}

function quintic(f) {
  return f * f * f * (f * (f * 6 - 15) + 10);
}

// gradientNoise(vec2 p, int seed), roughly in [-1, 1]
export function gradientNoise(px, py, seed) {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const ux = quintic(fx);
  const uy = quintic(fy);
  const a00 = hash1(ix, iy, seed) * TAU;
  const a10 = hash1(ix + 1, iy, seed) * TAU;
  const a01 = hash1(ix, iy + 1, seed) * TAU;
  const a11 = hash1(ix + 1, iy + 1, seed) * TAU;
  const n00 = Math.cos(a00) * fx + Math.sin(a00) * fy;
  const n10 = Math.cos(a10) * (fx - 1) + Math.sin(a10) * fy;
  const n01 = Math.cos(a01) * fx + Math.sin(a01) * (fy - 1);
  const n11 = Math.cos(a11) * (fx - 1) + Math.sin(a11) * (fy - 1);
  const nx0 = n00 + (n10 - n00) * ux;
  const nx1 = n01 + (n11 - n01) * ux;
  return 1.41421356 * (nx0 + (nx1 - nx0) * uy);
}

// fbm(vec2 p, int octaves, float lacunarity, float gain, int seed), as in the engine
export function fbm(px, py, octaves, seed, lacunarity = 2, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let x = px;
  let y = py;
  for (let i = 0; i < octaves; i++) {
    sum += amp * gradientNoise(x, y, seed + i * 131);
    norm += amp;
    const nx = 0.8 * x - 0.6 * y;
    const ny = 0.6 * x + 0.8 * y;
    x = nx * lacunarity + 17.31;
    y = ny * lacunarity + 9.17;
    amp *= gain;
  }
  return sum / Math.max(norm, 1e-6);
}
