// Stacked horizontal light bands with analytic blurred edges, combined per
// pixel. Everything here is per-pixel math (no image passes), so it ports to
// one fragment shader.
import { hexToLinear } from '../lib/color.mjs';
import { Img } from '../lib/image.mjs';
import { fbm1 } from '../lib/noise.mjs';
import { noiseField } from '../lib/grain.mjs';

// Abramowitz & Stegun 7.1.26 (max error 1.5e-7).
export function erf(x) {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

const SQRT1_2 = Math.SQRT1_2;

function phi(t) {
  return 0.5 * (1 + erf(t * SQRT1_2));
}

// Step response of a uniform disk of radius 1 (a defocused lens): the share of
// the disk below a line at signed distance t.
function diskStep(t) {
  if (t <= -1) return 0;
  if (t >= 1) return 1;
  return 0.5 + (t * Math.sqrt(1 - t * t) + Math.asin(t)) / Math.PI;
}

function boxStep(t) {
  return t <= -1 ? 0 : t >= 1 ? 1 : 0.5 * (t + 1);
}

// 3-point Gauss-Hermite quadrature for "shape convolved with a small gaussian".
const GH = [
  [0, 2 / 3],
  [Math.sqrt(3), 1 / 6],
  [-Math.sqrt(3), 1 / 6],
];

// Step edge blurred by the band kernel at scale s (normalized units):
//   gauss: sum_k w_k * Phi(t / (s r_k))            (sharp core, long tails)
//   disk:  disk step of radius s, softened by a gaussian of sigma soft*s,
//          plus `haze` weight of a wide gaussian (radius hazeRadius*s)
//   box:   same with a box (linear ramp) instead of the disk
export function blurredStep(t, s, kernel) {
  if (s <= 1e-6) return t >= 0 ? 1 : 0;
  if (kernel.shape === 'gauss') {
    let acc = 0;
    for (let k = 0; k < kernel.radii.length; k++) acc += kernel.weights[k] * phi(t / (s * kernel.radii[k]));
    return acc;
  }
  const step = kernel.shape === 'disk' ? diskStep : boxStep;
  const tn = t / s;
  let core = 0;
  if (kernel.soft > 0) {
    for (const [o, wgt] of GH) core += wgt * step(tn + o * kernel.soft);
  } else {
    core = step(tn);
  }
  const haze = kernel.haze ?? 0;
  if (haze <= 0) return core;
  return (1 - haze) * core + haze * phi(tn / (kernel.hazeRadius ?? 2.5));
}

// One-sided glow: 1 at t <= 0, falls off for t > 0 as a sum of exponentials
// (a scattering tail). Used for light rising above an occluding horizon.
export function glowTail(t, s, tail) {
  if (t <= 0) return 1;
  let acc = 0;
  for (let k = 0; k < tail.radii.length; k++) acc += tail.weights[k] * Math.exp(-t / (s * tail.radii[k]));
  return acc;
}

export const DEFAULT_KERNEL = { shape: 'gauss', radii: [0.45, 1, 2.2], weights: [0.3, 0.5, 0.2] };
const DEFAULT_TAIL = { radii: [0.35, 1, 2.5], weights: [0.3, 0.5, 0.2] };

function normalizeWeights(k) {
  const sum = k.weights.reduce((s, v) => s + v, 0);
  return { ...k, weights: k.weights.map((v) => v / sum) };
}

function resolveColor(c, colors) {
  const v = typeof c === 'number' ? colors[c] : c;
  return typeof v === 'string' ? hexToLinear(v) : v;
}

// Band coverage at normalized height v for one column, given that column's
// warped top/bottom edges and softness.
function bandCoverage(v, top, bottom, softUp, softDown, band) {
  if (band.profile === 'line') {
    // Thin bright line: sum of gaussians around the band center (sharp core,
    // long tail), with its own width above and below. Peak coverage 1.
    const d = v - (top + bottom) / 2;
    const s = d < 0 ? softUp : softDown;
    const k = band.kernel;
    let acc = 0;
    for (let j = 0; j < k.radii.length; j++) acc += k.weights[j] * Math.exp(-0.5 * (d / (s * k.radii[j])) ** 2);
    return acc;
  }
  if (band.profile === 'glow') {
    const above = glowTail(bottom - v, softUp, band.tail);
    const below = 1 - blurredStep(v - bottom, softDown, band.kernel);
    return above * below;
  }
  const a = blurredStep(v - top, softUp, band.kernel);
  const b = blurredStep(v - bottom, softDown, band.kernel);
  return Math.max(0, a - b);
}

// Per-column edge offset, softness and gain for one band: low-frequency
// warp, tilt and a few gaussian lumps along x.
function bandColumn(band, u, uMid, seed) {
  const warp = band.warp ?? {};
  const scale = warp.scale ?? 0.6;
  let shift = (warp.amp ?? 0) * fbm1(u / scale + 13.7 * (seed + 1), seed + 7, warp.octaves ?? 3);
  shift += (band.tilt ?? 0) * (u - uMid);
  let soft = 1 + (warp.softVar ?? 0) * fbm1(u / scale + 71.3 * (seed + 1), seed + 31, 2);
  let gain = 1 + (warp.gainVar ?? 0) * fbm1(u / scale + 37.1 * (seed + 1), seed + 53, 2);
  gain *= 1 + (band.gainTilt ?? 0) * (u - uMid);
  let shiftDown = (band.tiltDown ?? 0) * (u - uMid);
  let bright = 1;
  for (const lump of band.lumps ?? []) {
    const g = Math.exp(-0.5 * ((u - lump.u) / lump.width) ** 2);
    shift += (lump.shift ?? 0) * g;
    shiftDown += (lump.shiftDown ?? 0) * g;
    gain *= 1 + (lump.gain ?? 0) * g;
    soft *= 1 + (lump.soft ?? 0) * g;
    bright *= 1 + (lump.bright ?? 0) * g;
  }
  return { shift, shiftDown: shift + shiftDown, soft: Math.max(0.05, soft), gain: Math.max(0, gain), bright: Math.max(0, bright) };
}

// L, E and base are in mixing space: linear light raised to 1/n. With n = 1
// this is plain linear light. With n > 1 it is the Yule-Nielsen print model,
// where partial ink coverage gives more saturated mid-tones than a linear mix.
//   add:      L += a * E                 (light adds; n must be 1)
//   over:     L += a * (E - L)           (translucent light layer, Rothko)
//   multiply: L *= 1 - a + a * E / base  (ink: passes E/base of what is below)
function combine(op, L, a, E, base) {
  switch (op) {
    case 'add':
      for (let c = 0; c < 3; c++) L[c] += a * E[c];
      return;
    case 'over':
      for (let c = 0; c < 3; c++) L[c] += a * (E[c] - L[c]);
      return;
    case 'multiply':
      for (let c = 0; c < 3; c++) L[c] *= 1 - a + (a * E[c]) / Math.max(1e-6, base[c]);
      return;
    default:
      throw new Error(`unknown combine op ${op}`);
  }
}

// Renders linear radiance. scene: { seed, colors, params } in the preset format.
// opts.xs renders only those columns (x in pixels of an image opts.fullW wide).
export function renderBands(scene, w, h, opts = {}) {
  const p = scene.params;
  const colors = scene.colors ?? [];
  const n = p.mixN ?? 1;
  const toMix = (c) => Math.pow(Math.max(0, c), 1 / n);
  const sceneKernel = normalizeWeights({ ...DEFAULT_KERNEL, ...(p.kernel ?? {}) });
  const baseLin = resolveColor(p.base ?? '#000000', colors).map((c) => c * (p.baseIntensity ?? 1));
  const base = baseLin.map(toMix);
  const defaultOp = p.mode ?? 'add';
  const seed = scene.seed ?? 1;
  const prep = (b, i, salt) => {
    const op = b.op ?? defaultOp;
    if (op === 'add' && n !== 1) throw new Error('add needs mixN = 1');
    const lin = resolveColor(b.color, colors).map((c) => c * (b.intensity ?? 1));
    return {
      ...b,
      op,
      lin,
      seed: seed * salt + i * 13,
      kernel: b.kernel ? normalizeWeights({ ...sceneKernel, ...b.kernel }) : sceneKernel,
      tail: normalizeWeights(b.tail ?? DEFAULT_TAIL),
    };
  };
  const bands = p.bands.map((b, i) => prep(b, i, 97));
  const blooms = (p.blooms ?? []).map((b, i) => ({
    ...prep(b, i, 89),
    kernel: normalizeWeights(b.kernel ?? { radii: [1], weights: [1] }),
  }));
  const img = new Img(w, h);
  const colX = opts.xs ?? Array.from({ length: w }, (_, x) => x);
  const uMid = (opts.fullW ?? w) / h / 2;
  const L = [0, 0, 0];
  const E = [0, 0, 0];

  // Edge offsets depend only on x, so they are computed once per column.
  const cols = bands.map((band) => {
    const arr = new Array(w);
    for (let x = 0; x < w; x++) arr[x] = bandColumn(band, (colX[x] + 0.5) / h, uMid, band.seed);
    return arr;
  });

  // Ink grain: each band's coverage gets its own multiplicative noise, read from
  // one shared noise field at a per-band offset. Dense ink can only lose
  // coverage (light pinholes); light tints barely change.
  const inkNoise = bands.some((b) => b.grain) ? noiseField(w, h, seed * 7 + 3, p.grainSize ?? 1.3) : null;
  let px = 0;
  let py = 0;
  const grainAt = (i) => inkNoise[((py + 61 * i) % h) * w + ((px + 37 * i) % w)];

  // gain scales emitted light for add layers and coverage for over/multiply
  // layers. Ink grain: coverage a gets noise * (a + mid * 4a(1 - a)), so solids
  // show pinholes and half-covered areas show screening noise. It may push
  // coverage a little past 1 (denser ink, darker). The grained stack Lg is
  // composited next to the clean stack L; only its luminance is kept.
  const grainMid = p.grainMid ?? 0;
  const Lg = [0, 0, 0];
  const apply = (layer, cov, gain, i, bright = 1) => {
    const isAdd = layer.op === 'add';
    const a = isAdd ? cov * gain : Math.min(1, cov * gain * (layer.opacity ?? 1));
    for (let c = 0; c < 3; c++) E[c] = isAdd ? layer.lin[c] * bright : toMix(layer.lin[c] * bright);
    combine(layer.op, L, a, E, base);
    if (inkNoise) {
      const g = layer.grain ? layer.grain * grainAt(i) * (a + grainMid * 4 * a * Math.max(0, 1 - a)) : 0;
      combine(layer.op, Lg, isAdd ? Math.max(0, a + g) : Math.min(1.25, Math.max(0, a + g)), E, base);
      for (let c = 0; c < 3; c++) Lg[c] = Math.max(0, Lg[c]);
    }
  };

  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    py = y;
    for (let x = 0; x < w; x++) {
      const u = (colX[x] + 0.5) / h;
      px = colX[x];
      for (let c = 0; c < 3; c++) L[c] = Lg[c] = base[c];
      for (let i = 0; i < bands.length; i++) {
        const band = bands[i];
        const col = cols[i][x];
        const half = (band.height ?? 0) / 2;
        const top = (band.top ?? band.center - half) + col.shift;
        const bottom = (band.bottom ?? band.center + half) + col.shiftDown;
        const cov = bandCoverage(v, top, bottom, band.softUp * col.soft, band.softDown * col.soft, band);
        if (cov > 1e-6) apply(band, cov, col.gain, i, col.bright);
      }
      for (const bloom of blooms) {
        const dx = (u - bloom.u) / bloom.rx;
        const dy = (v - bloom.v) / bloom.ry;
        const r2 = dx * dx + dy * dy;
        const k = bloom.kernel;
        let cov = 0;
        for (let j = 0; j < k.radii.length; j++) cov += k.weights[j] * Math.exp((-0.5 * r2) / (k.radii[j] * k.radii[j]));
        if (cov > 1e-5) apply(bloom, cov, 1, 0);
      }
      const m = p.light ? 1 + (p.light.x ?? 0) * (u - uMid) + (p.light.y ?? 0) * (v - 0.5) : 1;
      const o = (y * w + x) * 3;
      for (let ch = 0; ch < 3; ch++) img.data[o + ch] = Math.pow(Math.max(0, L[ch]), n) * m;
      if (inkNoise) {
        const y0 = 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2];
        const g0 = Math.pow(Lg[0], n);
        const g1 = Math.pow(Lg[1], n);
        const g2 = Math.pow(Lg[2], n);
        const y1 = (0.2126 * g0 + 0.7152 * g1 + 0.0722 * g2) * m;
        const k = y0 > 1e-6 ? y1 / y0 : 1;
        for (let ch = 0; ch < 3; ch++) img.data[o + ch] *= k;
      }
    }
  }
  return img;
}
