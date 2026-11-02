// Seeded per-pixel noise built from a 32-bit integer hash, so every value
// ports to GLSL ES 3.0 uint math: hash(x, y, seed) -> uniform -> gaussian.

// "lowbias32" integer hash (Chris Wellons).
export function hash32(x) {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}

export function hash3(x, y, seed) {
  return hash32((x + hash32((y + hash32(seed >>> 0)) >>> 0)) >>> 0);
}

// Uniform in (0, 1), never exactly 0 or 1.
export function uniform(x, y, seed) {
  return ((hash3(x, y, seed) >>> 8) + 0.5) / 16777216;
}

// Standard normal via Box-Muller from two hashed uniforms.
export function gaussian(x, y, seed) {
  const u1 = uniform(x, y, seed);
  const u2 = uniform(x, y, (seed ^ 0x9e3779b9) >>> 0);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function whiteNoise(w, h, seed) {
  const f = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[y * w + x] = gaussian(x, y, seed);
  }
  return f;
}

export function gaussianKernel(sigma) {
  if (sigma <= 0) return new Float32Array([1]);
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

// Separable gaussian blur of a single plane. Borders clamp.
export function blurPlane(src, w, h, sigma) {
  if (sigma <= 0) return new Float32Array(src);
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
        s += k[i + r] * src[row + xx];
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        s += k[i + r] * tmp[yy * w + x];
      }
      out[y * w + x] = s;
    }
  }
  return out;
}

// White gaussian noise blurred to blob size `sigma` (output px), scaled back
// to unit standard deviation. For a separable kernel k the output variance
// is (sum k_i^2)^2, so the scale is 1 / sum k_i^2.
export function bandNoise(w, h, sigma, seed) {
  const white = whiteNoise(w, h, seed);
  if (sigma <= 0) return white;
  const k = gaussianKernel(sigma);
  let s2 = 0;
  for (const v of k) s2 += v * v;
  const out = blurPlane(white, w, h, sigma);
  const scale = 1 / s2;
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  return out;
}

function bspline(t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return [(1 - 3 * t + 3 * t2 - t3) / 6, (4 - 6 * t2 + 3 * t3) / 6, (1 + 3 * t + 3 * t2 - 3 * t3) / 6, t3 / 6];
}

// Lattice noise: unit gaussians hashed at integer lattice points, blended
// with cubic B-spline weights (4x4 taps), divided by sqrt(sum of squared
// weights) so the variance is the same everywhere. The pixel centre maps to
// lattice coordinates u = (x + 0.5) * scale, so a scale tied to the picture
// size gives the same pattern at every output size. The blob size is about
// 0.58 lattice cells (sigma), so scale = 0.58 / sigmaPx.
export function latticeNoise(w, h, scale, seed) {
  const out = new Float32Array(w * h);
  const gw = Math.ceil(w * scale) + 4;
  const gh = Math.ceil(h * scale) + 4;
  const grid = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) grid[j * gw + i] = gaussian(i + 1048576, j + 1048576, seed);
  }
  const wy = [];
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) * scale;
    const j = Math.floor(v);
    wy.push({ j, b: bspline(v - j) });
  }
  for (let x = 0; x < w; x++) {
    const u = (x + 0.5) * scale;
    const i = Math.floor(u);
    const bx = bspline(u - i);
    for (let y = 0; y < h; y++) {
      const { j, b: by } = wy[y];
      let s = 0;
      let s2 = 0;
      for (let dy = 0; dy < 4; dy++) {
        const row = (j + dy) * gw + i;
        for (let dx = 0; dx < 4; dx++) {
          const wgt = bx[dx] * by[dy];
          s += wgt * grid[row + dx];
          s2 += wgt * wgt;
        }
      }
      out[y * w + x] = s / Math.sqrt(s2);
    }
  }
  return out;
}

// Gaussian CDF (Abramowitz-Stegun 7.1.26 erf), used to turn unit gaussian
// noise into a uniform threshold field.
export function normalCdf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
