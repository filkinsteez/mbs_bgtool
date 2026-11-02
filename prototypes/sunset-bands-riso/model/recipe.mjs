// Production-style "sunset.bands" scene from a color pack, a seed and the
// three user controls. Pure light: linear light (mixN 1), translucent light
// layers over the sky, defocus (disk) edges. The riso ink look is not used here.
import { hexToLinear, linearToOklab, oklabToLch } from '../lib/color.mjs';
import { rng } from '../lib/noise.mjs';

export const PACKS = {
  bold: ['#0064E0', '#1FCDF0', '#FFD61E', '#FF4F00'],
  elemental: ['#0064E0', '#D6F26C', '#0F3D33', '#B8996E', '#4A0A3C'],
  atmospheric: ['#0064E0', '#F2F4F7', '#6A7788', '#384753', '#1C2B33'],
};

function lch(hex) {
  return oklabToLch(linearToOklab(...hexToLinear(hex)));
}

// Warm: hue from red through yellow (Oklab h <= 110 or >= 330) with some chroma.
function isWarm(hex) {
  const [, C, h] = lch(hex);
  return C > 0.04 && (h <= 110 || h >= 330);
}

// Pack order, Meta Blue first, and at most one warm color (the first one).
export function sunsetColors(pack) {
  const out = [];
  let warm = false;
  for (const hex of PACKS[pack]) {
    if (isWarm(hex)) {
      if (warm) continue;
      warm = true;
    }
    out.push(hex);
  }
  return out;
}

// controls: softness 0..1 (edge blur), intensity 0..1 (glow brightness),
// horizon 0..1 (height of the horizon line, 0 = top, 1 = bottom).
export function sunsetBandsScene({ pack, seed = 1, softness = 0.5, intensity = 0.5, horizon = 0.62 }) {
  const r = rng(seed * 7919 + 13);
  const jitter = (amt) => (r() * 2 - 1) * amt;
  const colors = sunsetColors(pack);
  const L = colors.map((c) => lch(c)[0]);
  // The horizon glow is the brightest color after the sky.
  let g = 1;
  for (let i = 2; i < colors.length; i++) if (L[i] > L[g]) g = i;
  const H = Math.min(0.8, Math.max(0.3, horizon + jitter(0.02)));
  const soft = 0.06 + 0.2 * softness;
  const glowI = 0.85 + 0.75 * intensity;
  const glowH = 0.09 * (1 + jitter(0.25));
  const horizonWarp = { amp: 0.018, scale: 0.7, softVar: 0.4 };
  // Every band is a layer from its top edge down; the next band paints over
  // it, so a crossover mixes the two colors and never shows the sky below.
  const bands = [];
  let top = H - glowH;
  for (let i = g - 1; i >= 1; i--) {
    const hgt = 0.11 * (1 + jitter(0.2));
    bands.unshift({ color: i, top: top - hgt, bottom: 2, softUp: soft, softDown: soft, warp: { amp: 0.02, scale: 0.9, softVar: 0.3 } });
    top -= hgt;
  }
  // Glow: soft top (light scattering up into the sky), firmer warped horizon.
  bands.push({ color: g, top: H - glowH, bottom: 2, softUp: soft, softDown: soft, intensity: glowI, warp: { amp: 0.02, scale: 0.9, softVar: 0.3 } });
  // Ground: the colors after the glow share the space below the horizon.
  const ground = colors.map((_, i) => i).filter((i) => i > g);
  if (ground.length === 0) {
    bands.push({ color: 0, top: H, bottom: 2, softUp: soft * 0.3, softDown: soft, intensity: 0.35, warp: horizonWarp });
  } else {
    const span = (1.02 - H) / ground.length;
    ground.forEach((i, k) => {
      bands.push({
        color: i,
        top: H + k * span + (k ? jitter(span * 0.15) : 0),
        bottom: 2,
        softUp: k === 0 ? soft * 0.3 : soft * 0.8,
        softDown: soft,
        warp: k === 0 ? horizonWarp : { amp: 0.02, scale: 0.8, softVar: 0.3 },
      });
    });
  }
  return {
    recipe: 'sunset.bands',
    seed,
    colors,
    params: { mode: 'over', mixN: 1, base: 0, kernel: { shape: 'disk', soft: 0.1, haze: 0.08, hazeRadius: 2 }, bands },
    lens: {},
    output: { exposure: 0, grain: { type: 'riso', tooth: 0.012, size: 0.8, paper: '#FFFFFF' } },
  };
}
