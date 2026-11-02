/** Integer hash to [0, 1). Same math ports to GLSL with uint ops. */
export function hash1(i, seed) {
  let h = (Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

export function hash2(x, y, seed) {
  return hash1((Math.imul(x | 0, 0x1b873593) + Math.imul(y | 0, 0x3c6ef372)) | 0, seed);
}

/** 1D gradient noise, quintic fade, output roughly in [-1, 1]. */
export function noise1(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const g0 = hash1(i, seed) * 2 - 1;
  const g1 = hash1(i + 1, seed) * 2 - 1;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const v0 = g0 * f;
  const v1 = g1 * (f - 1);
  return (v0 + (v1 - v0) * u) * 2;
}

/** Fractal sum of noise1, normalized so the result stays roughly in [-1, 1]. */
export function fbm1(x, seed, octaves = 3, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise1(x * freq + o * 17.31, seed + o * 101);
    norm += amp;
    amp *= gain;
    freq *= 2.03;
  }
  return sum / norm;
}

/** 2D gradient noise (Perlin style), quintic fade, output roughly in [-1, 1]. */
export function noise2(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const corner = (cx, cy) => {
    const ang = hash2(ix + cx, iy + cy, seed) * 2 * Math.PI;
    return Math.cos(ang) * (fx - cx) + Math.sin(ang) * (fy - cy);
  };
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = corner(0, 0) + (corner(1, 0) - corner(0, 0)) * ux;
  const b = corner(0, 1) + (corner(1, 1) - corner(0, 1)) * ux;
  return (a + (b - a) * uy) * 1.6;
}

export function fbm2(x, y, seed, octaves = 3, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(x * freq + o * 5.17, y * freq - o * 3.71, seed + o * 131);
    norm += amp;
    amp *= gain;
    freq *= 2.07;
  }
  return sum / norm;
}

/** Approximate unit gaussian from two hashes (Box-Muller). */
export function gauss2(x, y, seed) {
  const u1 = Math.max(1e-7, hash2(x, y, seed));
  const u2 = hash2(x, y, seed + 7919);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
