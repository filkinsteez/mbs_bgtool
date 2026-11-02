// Production compositions for sunset.blooms: pack + seed + controls -> scene.
// Colors come only from the pack. Roles per pack:
//   sky    : Meta Blue (the base field; always the largest area)
//   zenith : a darker pack color the sky deepens toward, away from the light
//   primary: the one light color (the pack's only warm color, or Ice)
//   second : a weaker light from the opposite upper side
import { PACKS } from './lib/color.mjs';
import { rng, hash3 } from './lib/noise.mjs';

// Indices into the pack's color list, each light's nominal intensity, and
// the base curve range (below 1 keeps a dark zenith color near the top).
// widthScale < 1 keeps the primary light narrower so a neutral light (Ice)
// still shows which side it comes from instead of reading as a plain ramp.
export const ROLES = {
  bold: { sky: 0, zenith: 0, zenithI: 0.45, primary: 2, primaryI: 1.0, second: 1, secondI: 0.28, curve: [0.9, 1.3], widthScale: 1 },
  elemental: { sky: 0, zenith: 2, zenithI: 1.0, primary: 3, primaryI: 2.0, second: 1, secondI: 0.22, curve: [0.55, 0.75], widthScale: 1 },
  atmospheric: { sky: 0, zenith: 4, zenithI: 1.0, primary: 1, primaryI: 0.8, second: 2, secondI: 0.55, curve: [0.75, 1.0], widthScale: 0.6 },
};

// Composition types a seed can pick, with their odds.
//   band   : both lights below the bottom edge, horizon near level
//   corner : the light below a lower corner, horizon tilted 14-26 degrees
//   lifted : like band, but the light reaches higher and wider
const TYPES = [
  ['band', 0.5],
  ['corner', 0.3],
  ['lifted', 0.2],
];

function pickType(u) {
  let acc = 0;
  for (const [name, p] of TYPES) {
    acc += p;
    if (u < acc) return name;
  }
  return TYPES[0][0];
}

// controls: intensity, softness and rise are 0..1 with 0.5 as the default.
//   intensity: brightness of the lights
//   softness : longer, gentler falloff (bigger radii, flatter kernel)
//   rise     : how high the light reaches into the sky (mood control)
// aspect is H / W of the output; tall frames get proportionally taller glows.
export function composeScene(packId, seed, controls = {}, aspect = 9 / 16) {
  const pack = PACKS[packId];
  const roles = ROLES[packId];
  if (!pack || !roles) throw new Error(`unknown pack ${packId}`);
  const intensity = controls.intensity ?? 0.5;
  const softness = controls.softness ?? 0.5;
  const rise = controls.rise ?? 0.5;
  // Consecutive seeds give correlated first draws in mulberry32; hash first.
  const r = rng(Math.floor(hash3(seed, 7, 11) * 4294967296));
  const lerp = (a, b, t) => a + (b - a) * t;

  const gain = Math.pow(2, (intensity - 0.5) * 1.2);
  // 1 at 16:9, about 1.33 at 9:16.
  const tall = Math.pow(aspect / (9 / 16), 0.25);
  const radiusScale = lerp(0.85, 1.2, softness) * tall;
  const beta = lerp(2.5, 1.9, softness);

  const type = pickType(r());
  // side -1: the light is on the left.
  const side = r() < 0.5 ? -1 : 1;
  const lift = type === 'lifted' ? 0.1 : 0;
  const reach = type === 'lifted' ? 1.12 : 1;

  // Primary light: off-frame below the bottom edge (band, lifted) or below a
  // lower corner (corner). Never centered. Its long axis follows the horizon,
  // which tilts down away from the light.
  let px;
  let py;
  let tilt;
  if (type === 'corner') {
    px = 0.5 + side * lerp(0.48, 0.62, r());
    py = lerp(1.2, 0.98, rise) + lerp(-0.03, 0.03, r()) - lift;
    tilt = -side * lerp(14, 26, r());
  } else {
    px = 0.5 + side * lerp(0.12, 0.36, r());
    py = lerp(1.26, 1.0, rise) + lerp(-0.03, 0.03, r()) - lift;
    tilt = -side * lerp(2, 8, r());
  }
  const primary = {
    color: roles.primary,
    intensity: roles.primaryI * gain * lerp(0.9, 1.1, r()),
    x: px,
    y: py,
    radius: lerp(0.55, 0.68, r()) * radiusScale * lerp(0.9, 1.15, rise) * reach,
    aniso: (lerp(4.2, 5.6, r()) * roles.widthScale) / tall,
    angle: tilt,
    beta,
    // Dim light with full haze over a hidden sky reads olive, so the haze
    // thins with the light.
    absorb: 1.4 * Math.min(1, gain),
    absorbPow: 2,
  };

  // Second light: the far side of the same horizon, cooler, weaker, wider.
  const second = {
    color: roles.second,
    intensity: roles.secondI * gain * lerp(0.85, 1.15, r()),
    x: 0.5 - side * lerp(0.3, 0.5, r()),
    y: py + lerp(0.02, 0.1, r()) + (type === 'corner' ? 0.08 : 0),
    radius: lerp(0.6, 0.8, r()) * radiusScale * reach,
    aniso: lerp(3.6, 5.0, r()) / tall,
    angle: tilt * lerp(0.6, 1.0, r()),
    beta,
  };

  // The sky deepens toward the upper corner away from the primary light.
  const baseTilt = type === 'corner' ? lerp(24, 34, r()) : lerp(8, 22, r());
  const base = {
    top: roles.zenith,
    topI: roles.zenithI,
    bottom: roles.sky,
    bottomI: 1,
    angle: side * baseTilt,
    curve: lerp(roles.curve[0], roles.curve[1], r()),
  };

  return {
    recipe: 'sunset.blooms',
    seed,
    colors: pack.map((c) => c.hex),
    params: { base, blooms: [primary, second], warp: { amount: 0.08, scale: 1 } },
    lens: { bloom: 0.12 },
    output: { grain: 0.012, exposure: 0 },
  };
}
