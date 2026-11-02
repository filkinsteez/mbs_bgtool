// Production-style Sunset scenes from a color pack and a seed number.
// Rules from the deck: Meta Blue holds the sky, one warm color at most, the
// horizon is never a ruler line. Colors are pack colors only; tints come from
// light (gain above 1 rolls toward white, bridge light adds pale light).
import { rng } from './noise.mjs';

export const PACKS = {
  bold: { blue: '#0064E0', cyan: '#1FCDF0', yellow: '#FFD61E', orange: '#FF4F00' },
  elemental: { blue: '#0064E0', lime: '#D6F26C', forest: '#0F3D33', tan: '#B8996E', plum: '#4A0A3C' },
  atmospheric: { blue: '#0064E0', ice: '#F2F4F7', steel: '#6A7788', slate: '#384753', night: '#1C2B33' },
};

const lerp = (a, b, t) => a + (b - a) * t;

// Vertical ramp with a warped horizon line and a flat glow (Bold pack).
function horizonRamp(pack, seed, opts) {
  const r = rng(seed * 977 + 3);
  const c = PACKS[pack];
  const warm = opts.warm ?? (r() < 0.5 ? c.yellow : c.orange);
  const h = lerp(0.76, 0.88, r());
  const warp = { amp: lerp(0.025, 0.045, r()), freq: lerp(0.6, 1.2, r()), seed: Math.floor(r() * 1000), octaves: 2 };
  return {
    colors: [],
    params: {
      solver: 'harmonic',
      pad: 0.12,
      seeds: [
        { kind: 'line', y: -0.02, width: 0.02, soft: 0.01, color: c.blue },
        { kind: 'line', y: h - lerp(0.2, 0.26, r()), width: 0.002, soft: 0.01, color: c.cyan, gain: 1.5, warp: { ...warp, amp: warp.amp * 0.6 } },
        { kind: 'line', y: h, width: 0.002, soft: 0.01, softVar: 1, color: warm, gain: 1.0, warp },
        { kind: 'line', y: h + 0.07, width: 0.002, soft: 0.02, softVar: 1, color: c.blue, gain: 0.35, warp },
        { kind: 'line', y: 1.05, width: 0.02, soft: 0.01, color: c.blue, gain: 0.2 },
      ],
      bridge: { mode: 'neutral', amount: opts.bridge ?? 0.55, lift: 0.35, color: '#FFF4E8', blur: 0.01 },
      glows: [
        {
          kind: 'line', y: h - 0.01, warp, color: warm, strength: 0.35,
          profile: [[0.012, 0.3], [0.06, 0.3], [0.2, 0.2]], above: 1, below: 3,
        },
      ],
      warp: { ampX: 0.0, ampY: 0.008, freqX: 1.5, freqY: 2, octaves: 3, seed: seed + 5 },
      blur: 0.025,
    },
  };
}

// Three to five stacked bands in pack order, blurred hard (Elemental pack).
function stackedBands(pack, seed, opts) {
  const r = rng(seed * 613 + 11);
  const c = PACKS[pack];
  // Meta Blue is the largest band; one warm color (tan) at most.
  const order = [c.blue, c.lime, c.forest, c.tan, c.plum];
  const sizes = [lerp(0.36, 0.46, r()), lerp(0.06, 0.1, r()), lerp(0.14, 0.2, r()), lerp(0.08, 0.12, r()), 0.2];
  const total = sizes.reduce((s, x) => s + x, 0);
  let y = 0;
  const seeds = [];
  const warp = { amp: lerp(0.01, 0.03, r()), freq: lerp(0.7, 1.4, r()), seed: Math.floor(r() * 1000), octaves: 2 };
  // a second Meta Blue seed near the bottom of its band holds the sky
  seeds.push({ kind: 'line', y: (sizes[0] / total) * 0.78, width: 0.002, soft: 0.01, color: c.blue, warp });
  order.forEach((col, i) => {
    const hgt = sizes[i] / total;
    const mid = y + hgt / 2;
    // thin seeds: the fill makes long ramps between bands instead of plateaus
    const k = seeds.length;
    seeds.push({
      kind: 'line', y: i === 0 ? 0.0 : mid, width: 0.002, soft: 0.01, softVar: 0.8, color: col,
      gain: i === 1 ? 1.15 : 1, warp: { ...warp, seed: warp.seed + k * 7, amp: warp.amp * (0.6 + 0.8 * r()) },
    });
    y += hgt;
  });
  return {
    colors: [],
    params: {
      solver: opts.solver ?? 'harmonic',
      gain: 3,
      pad: 0.12,
      seeds,
      bridge: { mode: 'neutral', amount: opts.bridge ?? 0.45, lift: 0.3, color: '#FFF4E8', blur: 0.01 },
      warp: { ampX: 0.0, ampY: 0.02, freqX: 1.0, freqY: 1.2, octaves: 3, fold: 1.0, seed: seed + 9 },
      blur: 0.06,
    },
  };
}

// No horizon, a few wide blooms (Atmospheric pack). The blooms are added
// light, not seeds: a seed blob in a membrane fill becomes a flat disc.
function wideBlooms(pack, seed, opts) {
  const r = rng(seed * 331 + 17);
  const c = PACKS[pack];
  const bu = lerp(0.2, 0.8, r());
  const bv = lerp(0.25, 0.55, r());
  return {
    colors: [],
    params: {
      solver: 'harmonic',
      pad: 0.12,
      seeds: [
        { kind: 'line', y: -0.02, width: 0.02, soft: 0.01, color: c.blue },
        { kind: 'line', y: lerp(0.28, 0.36, r()), width: 0.002, soft: 0.02, color: c.blue, warp: { amp: 0.04, freq: 0.8, seed: seed + 1 } },
        { kind: 'stroke', points: [[-0.2, lerp(0.55, 0.75, r())], [0.5, lerp(0.6, 0.8, r())], [1.2, lerp(0.55, 0.75, r())]], width: 0.004, soft: 0.02, color: c.steel },
        { kind: 'line', y: 0.9, width: 0.004, soft: 0.02, color: c.slate, warp: { amp: 0.04, freq: 1, seed: seed + 3 } },
        { kind: 'line', y: 1.04, width: 0.02, soft: 0.01, color: c.night },
      ],
      bridge: { mode: 'neutral', amount: opts.bridge ?? 0.4, lift: 0.3, color: c.ice, blur: 0.01 },
      glows: [
        { kind: 'blob', u: bu, v: bv, sx: 2.4, sy: 1, color: c.ice, strength: 0.35, profile: [[0.12, 0.35], [0.3, 0.3], [0.6, 0.12]] },
        { kind: 'blob', u: 1 - bu + lerp(-0.2, 0.2, r()), v: lerp(0.7, 0.9, r()), sx: 3, sy: 1, color: c.steel, strength: 0.35, profile: [[0.15, 0.4], [0.35, 0.25]] },
      ],
      warp: { ampX: 0.01, ampY: 0.01, freqX: 1, freqY: 1, octaves: 3, fold: 1.5, seed: seed + 13 },
      blur: 0.02,
    },
  };
}

export function productionScene(pack, technique, seed, opts = {}) {
  let scene;
  switch (technique) {
    case 'horizon':
      scene = horizonRamp(pack, seed, opts);
      break;
    case 'bands':
      scene = stackedBands(pack, seed, opts);
      break;
    case 'blooms':
      scene = wideBlooms(pack, seed, opts);
      break;
    default:
      throw new Error(`unknown technique ${technique}`);
  }
  return { recipe: 'sunset.diffusion', seed, ...scene, output: { grain: 0, exposure: 0 } };
}
