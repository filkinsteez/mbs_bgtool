// Integer hashes and smooth noise. Everything here uses 32-bit integer math
// (Math.imul) so it ports to GLSL ES 3.0 `uint` code bit for bit.

export function lowbias32(x) {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

// Uniform [0, 1) from two integer coordinates and a seed.
export function hash2u(x, y, seed) {
  const h = lowbias32((x | 0) ^ lowbias32(((y | 0) ^ lowbias32(seed >>> 0)) >>> 0));
  return h / 4294967296;
}

export function hash1u(x, seed) {
  return lowbias32((x | 0) ^ lowbias32(seed >>> 0)) / 4294967296;
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// 1D value noise in [-1, 1], quintic interpolation.
export function noise1(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash1u(i, seed) * 2 - 1;
  const b = hash1u(i + 1, seed) * 2 - 1;
  return a + (b - a) * fade(f);
}

// 1D noise that wraps with period `period` (integer), for angles.
export function noise1Periodic(x, period, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const ia = ((i % period) + period) % period;
  const ib = (ia + 1) % period;
  const a = hash1u(ia, seed) * 2 - 1;
  const b = hash1u(ib, seed) * 2 - 1;
  return a + (b - a) * fade(f);
}

// 2D gradient noise in about [-1, 1].
export function noise2(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const g = (cx, cy) => {
    const a = hash2u(cx, cy, seed) * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)];
  };
  const g00 = g(ix, iy);
  const g10 = g(ix + 1, iy);
  const g01 = g(ix, iy + 1);
  const g11 = g(ix + 1, iy + 1);
  const d00 = g00[0] * fx + g00[1] * fy;
  const d10 = g10[0] * (fx - 1) + g10[1] * fy;
  const d01 = g01[0] * fx + g01[1] * (fy - 1);
  const d11 = g11[0] * (fx - 1) + g11[1] * (fy - 1);
  const u = fade(fx);
  const v = fade(fy);
  const a = d00 + (d10 - d00) * u;
  const b = d01 + (d11 - d01) * u;
  return (a + (b - a) * v) * 1.4142;
}

export function fbm2(x, y, seed, octaves = 4, lacunarity = 2, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(fx, fy, seed + o * 1013);
    norm += amp;
    amp *= gain;
    // Rotate each octave so the lattice does not line up.
    const rx = fx * 0.8 - fy * 0.6;
    const ry = fx * 0.6 + fy * 0.8;
    fx = rx * lacunarity + 17.3;
    fy = ry * lacunarity + 5.1;
  }
  return sum / norm;
}

export function fbm1Periodic(x, period, seed, octaves = 3) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let p = period;
  let fx = x;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise1Periodic(fx, p, seed + o * 7919);
    norm += amp;
    amp *= 0.5;
    p *= 2;
    fx *= 2;
  }
  return sum / norm;
}
