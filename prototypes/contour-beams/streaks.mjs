// "Long-exposure radial streaks converging to a bright horizon."
//
// A zoom burst: the camera zooms during a long exposure, so every scene
// point smears along the line toward the zoom center. Lines through the
// center (the horizon) stay sharp; everything else becomes streaks.
//
// Screen coordinates are in frame-height units: sx = (x - W/2) / H,
// sy = y / H. The zoom center sits on the horizon.
//
// Passes:
//   1. scene (per pixel), two layers:
//      streak layer: base + sky light (angular fans around the center times
//        a rise away from it, times screen-space fbm clouds) + the sky's
//        reflection in a glossy floor
//      soft layer: horizon glow (core + glow radii, streaked along the
//        horizon), thin horizon line, a band of haze light above it, the
//        floor's own light (fans and lobes in angle below the horizon,
//        streaked along the horizon), a pool under the glow
//   2. radial zoom blur toward the center (GPU Gems 3 ch. 13 sampling,
//      repeated passes with growing steps): long on the streak layer, short
//      on the soft layer; then the layers add
// Lens and output stage run afterwards.
import { hexToLinear } from './lib/color.mjs';
import { createImage } from './lib/image.mjs';
import { fbm2, hash1u } from './lib/noise.mjs';
import { radialBlur } from './lib/blur.mjs';

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mergeDeep(a, b) {
  if (!b) return structuredClone(a);
  const out = structuredClone(a);
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      out[k] = mergeDeep(out[k], v);
    } else out[k] = v;
  }
  return out;
}

// Intensities are relative to each color's own hex: 1 renders the hex.
// Defaults are the fit to contour-radial-streaks; production presets set
// pack colors, placement and jitter.
export const STREAK_DEFAULTS = {
  seed: 11,
  colors: { light: '#B4D4F2', haze: '#3A6699', base: '#02050B' },
  center: { x: -0.14, y: 0.718 },
  // Sky light around the center (angles in radians, 0 = right along the
  // horizon, -pi/2 = straight up, -pi = left). Fans cover [from, to] with
  // soft edges of half-width `soft`; level and pale ramp linearly from the
  // `from` end to the `to` end. Lobes are gaussians in angle. `pale` is the
  // share of luminance carried by the light color. `rise` makes the sky
  // brighter away from the center (up to 1 + rise at riseScale).
  sky: {
    fans: [
      {
        from: -3.2,
        to: -0.72,
        soft: 0.22,
        level: [3.4, 3.2, 2.5, 1.7, 1.1, 0.65, 0.42, 0.3, 0.22, 0.18],
        pale: [0.6, 0.55, 0.45, 0.35, 0.25, 0.2, 0.15, 0.12, 0.1, 0.1],
      },
    ],
    lobes: [],
    floorLevel: 0,
    rise: 14,
    riseStart: 0.16,
    riseScale: 0.65,
    risePower: 3.5,
    risePale: 0.5,
  },
  // Rays. mode 'screen': isotropic fbm clouds in screen space (`scale` per
  // frame height); the zoom blur turns them into streaks, wide near the
  // center and narrow far out, as a real zoom burst does. mode 'polar': fbm
  // in polar coordinates around the center, `count` per full turn and
  // `radial` per unit of ln r (rays crowd toward the center).
  rays: { mode: 'screen', scale: 4.5, count: 70, radial: 1.2, contrast: 1.5, gain: 2.4, octaves: 4 },
  glow: {
    x: -0.3,
    y: 0.718,
    intensity: 1.35,
    core: 0.03,
    mid: 0.26,
    wide: 0.4,
    weights: [0.4, 0.6, 0],
    squash: 0.2,
    pale: 0.6,
    streaks: 1.1,
  },
  // Thin horizon line plus a soft band of haze light just above it (`up`,
  // falling off over `upDepth`), both brightest near the glow and falling to
  // `base` with distance `reach` to its right.
  line: { intensity: 0.6, width: 0.0018, reach: 0.9, base: 0.35, up: 2.5, upDepth: 0.02, upPale: 0.2 },
  // Floor: the sky mirrored (glossy), the floor's own light as fans and
  // lobes in angle below the horizon (0 = right along the horizon, pi/2 =
  // straight down, pi = left), each fading with distance over its `reach`,
  // broken into streaks by fbm stretched along the horizon, and a pool under
  // the glow.
  floor: {
    reflect: 0.15,
    fans: [
      { from: -0.3, to: 0.3, soft: 0.07, level: 3.4, pale: 0.3, reach: 0.5 },
      { from: 1.6, to: 3.4, soft: 0.3, level: 2.4, pale: 0.5, reach: 1.2 },
    ],
    lobes: [{ angle: 0.85, width: 0.5, level: 6.5, pale: 0.4, reach: 0.24 }],
    noise: 1.0,
    noiseScale: [3, 22],
    pool: 1.0,
    poolX: -0.3,
    poolY: 0.8,
    poolW: 0.2,
    poolH: 0.07,
  },
  // length: zoom of the streak layer; soft: zoom of the soft layer.
  zoom: { length: 0.85, soft: 0.35, taps: 12, passes: 3, decay: 0.93 },
};

// Seeded variation for production presets (`amount` 0 = none): moves the
// edge of the dark sector, the glow and the floor lobes a little. The cloud
// pattern itself already follows the seed.
function jitterStreaks(p, seed, amount) {
  if (!amount) return p;
  const j = (k, range) => (hash1u(k, seed) * 2 - 1) * range * amount;
  p.sky.fans.forEach((f, i) => {
    f.to += j(1 + i, 0.15);
  });
  p.glow.x += j(10, 0.06);
  p.floor.lobes.forEach((l, i) => {
    l.angle += j(20 + i, 0.12);
  });
  p.line.up *= 1 + j(30, 0.25);
  return p;
}

export function streakParams(params) {
  const p = mergeDeep(STREAK_DEFAULTS, params);
  return jitterStreaks(p, (p.seed >>> 0) ^ 0x5eed, p.jitter ?? 0);
}

export function renderStreaks(W, H, params) {
  const p = streakParams(params);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  let cLight = hexToLinear(p.colors.light);
  let cHaze = hexToLinear(p.colors.haze);
  // Optional: one haze or light unit carries this luminance, so packs with
  // very dark or very pale colors give the same structure.
  if (p.hazeLuminance) cHaze = cHaze.map((v) => (v * p.hazeLuminance) / lum(cHaze));
  if (p.lightLuminance) cLight = cLight.map((v) => (v * p.lightLuminance) / lum(cLight));
  const cBase = hexToLinear(p.colors.base).map((v) => v * (p.baseLevel ?? 1));
  const seed = p.seed >>> 0;
  const { center, sky, glow, line, floor } = p;
  const lumRatio = lum(cHaze) / lum(cLight);

  // Ray modulation (clouds), scaled to a mean of 1 so it changes the
  // structure but not the average light.
  const rays = p.rays;
  const rayRaw = (sx, sy) => {
    let n;
    if (rays.mode === 'polar') {
      const dx = sx - center.x;
      const dy = sy - center.y;
      const r = Math.hypot(dx, dy);
      const th = Math.atan2(dy, dx);
      const u = ((th / (2 * Math.PI)) * rays.count) % rays.count;
      n = fbm2(u, Math.log(r + 1e-3) * rays.radial + 3.1, seed, rays.octaves);
    } else {
      n = fbm2(sx * rays.scale + 3.1, sy * rays.scale + 7.7, seed, rays.octaves);
    }
    return Math.max(0, 1 + rays.contrast * n) ** rays.gain;
  };
  let rayMean = 0;
  for (let i = 0; i < 4096; i++) rayMean += rayRaw((i % 64) * 0.031 - 1, Math.floor(i / 64) * 0.031);
  rayMean /= 4096;
  const rayAt = (sx, sy) => rayRaw(sx, sy) / rayMean;

  // Angular light: fans and lobes at angle th. Writes [haze, light]
  // intensities; `pale` is a share of luminance, so the light-colored part
  // carries the haze color's luminance.
  // An optional `reach` per fan or lobe fades it with distance r from the
  // center as exp(-r / reach).
  // A list of values for level or pale is spread evenly across [from, to]
  // and interpolated linearly.
  const ramp = (v, t) => {
    if (!Array.isArray(v)) return v;
    const s = t * (v.length - 1);
    const i = Math.min(v.length - 2, Math.floor(s));
    return v[i] + (v[i + 1] - v[i]) * (s - i);
  };
  const angular = (th, r, fans, lobes, out) => {
    let aH = 0;
    let aL = 0;
    for (const f of fans) {
      const t = Math.min(1, Math.max(0, (th - f.from) / (f.to - f.from)));
      const lv = ramp(f.level, t);
      const pl = ramp(f.pale, t);
      const fade = f.reach ? Math.exp(-r / f.reach) : 1;
      const v = lv * fade * smoothstep(f.from - f.soft, f.from + f.soft, th) * (1 - smoothstep(f.to - f.soft, f.to + f.soft, th));
      aH += v * (1 - pl);
      aL += v * pl * lumRatio;
    }
    for (const l of lobes) {
      let d = th - l.angle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const fade = l.reach ? Math.exp(-r / l.reach) : 1;
      const v = l.level * fade * Math.exp(-0.5 * (d / l.width) ** 2);
      aH += v * (1 - l.pale);
      aL += v * l.pale * lumRatio;
    }
    out[0] = aH;
    out[1] = aL;
    return out;
  };

  // Sky light at a point above the horizon, before the zoom.
  const skyAt = (sx, sy, out) => {
    const dx = sx - center.x;
    const dy = sy - center.y;
    const r = Math.hypot(dx, dy);
    const th = Math.atan2(dy, dx);
    angular(th, r, sky.fans, sky.lobes, out);
    // The rise is strongest straight up and fades toward the horizon. Its
    // light has its own pale share (bright high clouds read paler).
    const riseW = Math.pow(Math.abs(Math.sin(th)), sky.risePower ?? 0);
    const rise = sky.rise * riseW * smoothstep(sky.riseStart ?? 0, sky.riseScale, r);
    const level = out[0] + out[1] / lumRatio;
    const rp = sky.risePale ?? 0;
    const ray = rayAt(sx, sy);
    out[0] = (out[0] + sky.floorLevel + level * rise * (1 - rp)) * ray;
    out[1] = (out[1] + level * rise * rp * lumRatio) * ray;
    return out;
  };

  // Horizon glow: core + glow + haze radii, squashed vertically.
  const glowAt = (sx, sy) => {
    const dx = sx - glow.x;
    const dy = (sy - glow.y) / glow.squash;
    const r2 = dx * dx + dy * dy;
    const [w0, w1, w2] = glow.weights;
    return (
      glow.intensity *
      (w0 * Math.exp(-r2 / (2 * glow.core * glow.core)) +
        w1 * Math.exp(-r2 / (2 * glow.mid * glow.mid)) +
        w2 * Math.exp(-r2 / (2 * glow.wide * glow.wide)))
    );
  };

  const scene = createImage(W, H);
  const sk = [0, 0];
  // Two layers: the streak layer (the sky times clouds, and the sky's
  // reflection in the floor) gets the long zoom; the soft layer (glow, line,
  // band above the horizon, the floor's own light, pool) gets a short one,
  // so the bright center does not smear across the dark side.
  const soft = createImage(W, H);
  const lobeSk = [0, 0];
  for (let y = 0; y < H; y++) {
    const sy = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const sx = (x + 0.5 - W / 2) / H;
      let sH = 0;
      let sL = 0;
      let qH = 0;
      let qL = 0;
      const below = sy > center.y;
      if (!below) {
        skyAt(sx, sy, sk);
        sH += sk[0];
        sL += sk[1];
        // Band of haze light just above the horizon.
        const side = line.base + (1 - line.base) * Math.exp(-Math.max(0, sx - glow.x) / line.reach);
        const up = line.up * Math.exp(-(center.y - sy) / line.upDepth) * side;
        qH += up * (1 - line.upPale);
        qL += up * line.upPale * lumRatio;
      } else {
        // Glossy floor: the sky mirrored about the horizon, dimmer.
        skyAt(sx, 2 * center.y - sy, sk);
        sH += floor.reflect * sk[0];
        sL += floor.reflect * sk[1];
        // The floor's own light: fans in angle below the horizon, broken
        // into streaks along the horizon; lobes go to the soft layer.
        const fdx = sx - center.x;
        const fdy = sy - center.y;
        const fth = Math.atan2(fdy, fdx);
        const fr = Math.hypot(fdx, fdy);
        const [fnx, fny] = floor.noiseScale;
        const fk = Math.max(0, 1 + floor.noise * fbm2(sx * fnx + 1.3, sy * fny + 4.4, seed ^ 0x77, 3));
        angular(fth, fr, floor.fans, floor.lobes, lobeSk);
        qH += lobeSk[0] * fk;
        qL += lobeSk[1] * fk;
        // Pool: the glow's reflection, stretched toward the camera.
        const px = (sx - floor.poolX) / floor.poolW;
        const py = (sy - floor.poolY) / floor.poolH;
        qL += floor.pool * Math.exp(-0.5 * (px * px + py * py));
      }
      // Glow: `pale` share of its luminance in the light color, the rest in
      // the haze color, so its edges go blue instead of grey. `streaks`
      // breaks it into bands along the horizon with the floor's noise.
      const [gnx, gny] = floor.noiseScale;
      const gs = glow.streaks ?? 0;
      const gn = gs > 0 ? Math.max(0, 1 + gs * fbm2(sx * gnx + 8.1, sy * gny + 0.6, seed ^ 0x99, 3)) : 1;
      const gl = glowAt(sx, sy) * gn;
      const gp = glow.pale ?? 1;
      qL += gl * gp;
      qH += (gl * (1 - gp)) / lumRatio;
      // Thin horizon line, brightest near the glow.
      const ld = (sy - center.y) / line.width;
      const lineReach = line.base + (1 - line.base) * Math.exp(-Math.abs(sx - glow.x) / line.reach);
      qL += line.intensity * Math.exp(-0.5 * ld * ld) * lineReach;

      const o = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) {
        scene.data[o + c] = cBase[c] + cHaze[c] * sH + cLight[c] * sL;
        soft.data[o + c] = cHaze[c] * qH + cLight[c] * qL;
      }
    }
  }

  const z = p.zoom;
  const cx = W / 2 + center.x * H;
  const cy = center.y * H;
  const blur = (img, length) =>
    length > 0 ? radialBlur(img, cx, cy, { length, taps: z.taps, passes: z.passes, decay: z.decay ?? 1 }) : img;
  const image = blur(scene, z.length);
  const softZ = blur(soft, z.soft ?? z.length);
  for (let i = 0; i < image.data.length; i++) image.data[i] += softZ.data[i];
  return { image, scene };
}
