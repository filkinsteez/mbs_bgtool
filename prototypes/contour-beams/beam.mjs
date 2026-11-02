// "A beam through haze with a pool where it lands."
//
// Screen coordinates are in frame-height units: sx = (x - W/2) / H,
// sy = y / H (0 at the top). The beam comes from a source above the frame,
// lands on a floor seen in perspective, and lights a pool there.
//
// One per-pixel pass computes:
//   - base: dark ambient room light
//   - beam in-scatter: super-gaussian cross-section, layered haze density
//     (denser near the ceiling and near the floor), fbm density noise
//   - pool glow: the pool's light scattered by the haze above it
//     (point-light airlight, exp(-s h) / h, Lambert lobe pointing up)
//   - floor, below the stage edge (an arch in the frame):
//       pool footprint: pale core and haze-colored skirt in floor
//         coordinates
//       reflection streaks: pairs stretched toward the camera along floor
//         lines that meet at the horizon (glossy floor), glossy-lobe falloff
//       side streaks: parabolas through the pool that follow the round stage
//       fine surface texture
// Then an optional multiple-scattering spread (pyramid blur tinted with the
// haze color). Lens and output stage run afterwards.
import { hexToLinear } from './lib/color.mjs';
import { createImage } from './lib/image.mjs';
import { fbm2, hash1u, noise1Periodic, noise2 } from './lib/noise.mjs';
import { bloom } from './lib/lens.mjs';

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Intensities are relative to each color's own hex: 1 renders the hex.
export const BEAM_DEFAULTS = {
  seed: 1,
  colors: { light: '#C6E4F8', haze: '#366685', base: '#00040B' },
  base: { level: 1, floorLevel: 1 },
  beam: {
    x: 0,
    tilt: 0,
    intensity: 1,
    width: 0.076,
    widthGrowth: 0.1,
    shape: 3,
    noise: 0.12,
    noiseScale: [2.5, 1.6],
  },
  // floorSpread widens the floor layer's cross-section (lit by the pool too).
  haze: { mid: 0.03, top: 1.12, topHeight: 0.09, floor: 3.4, floorHeight: 0.085, floorTint: 0.55, floorSpread: 1 },
  // texture: fine multiplicative floor surface noise (relative amplitude),
  // with a cell size in frame heights.
  floor: { y: 0.714, horizonY: 0.604, edgeSoft: 0.0015, curve: 0.3, texture: 0.06, textureCell: 0.0007 },
  // Pool: a pale core (light color) and a haze-colored skirt around it.
  // Core: super-gaussian on the elliptical radius (depth stretches it toward
  // the camera). Skirt: haze-colored gaussian, its own widths across and in
  // depth, all in pool radii.
  pool: { intensity: 1.0, width: 0.092, depth: 1.3, shape: 2.4, skirt: 0.9, skirtAcross: 0.7, skirtDepth: 2.4 },
  // lipFrom / lipTo: the stage's low rim shadows haze seen from the pool
  // below this elevation slope (gy / gx), so a dark band sits just above
  // the stage edge at the sides.
  glow: { intensity: 1.3, falloff: 13, radius: 0.04, lambert: 1, widthScale: 2.2, color: 'haze', lipFrom: 0.03, lipTo: 0.12 },
  // Side streaks that follow the round stage: parabolas through the pool,
  // dy = c * dx^2 (the stage edge is c = floor.curve). Each streak is a
  // gaussian in ln(c); it starts `start` frame heights from the pool and
  // fades over `reach`.
  sideStreaks: [
    { c: 1.05, width: 0.15, intensity: 2.4, start: 0.1, reach: 0.12 },
    { c: 0.42, width: 0.2, intensity: 1.2, start: 0.12, reach: 0.3 },
  ],
  // Reflection streaks on a glossy floor: pairs of streaks at lateral floor
  // offsets (in pool radii), stretched toward the camera along floor lines
  // that meet at the horizon. widthIn / widthOut are the gaussian widths on
  // the side toward the center and away from it. Falloff below the edge:
  // (1 + (dy / length)^2)^-power. `start` delays a streak below the edge.
  streaks: [
    { intensity: 1.1, offset: 0, widthIn: 0.25, widthOut: 0.25, length: 0.045, power: 1.6, start: 0 },
    { intensity: 5.8, offset: 0.52, widthIn: 0.11, widthOut: 0.21, length: 0.065, power: 1.72, start: 0 },
  ],
  streakPale: { amount: 0.3, length: 0.08 },
  // Left/right balance of the floor reflections (-1..1, positive = right
  // brighter), as if the light sat a little off the camera's axis.
  floorBalance: 0,
  streakNoise: { amount: 0, scale: 6 },
  floorGlow: { intensity: 0.012, reach: 4 },
  spread: { amount: 0.015, weights: [0.5, 1, 1, 1, 0.8, 0.6] },
};

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

// Seeded variation for production presets: `amount` 0 leaves the preset
// as is; 1 moves the floor reflections, side streaks, haze layers and the
// beam by a modest amount so each seed gives a different picture.
function jitterBeam(p, seed, amount) {
  if (!amount) return p;
  const j = (k, range) => (hash1u(k, seed) * 2 - 1) * range * amount;
  p.beam.x += j(1, 0.05);
  p.beam.tilt += j(2, 0.06);
  p.beam.width *= 1 + j(3, 0.18);
  p.haze.top *= 1 + j(4, 0.35);
  p.haze.floor *= 1 + j(5, 0.3);
  p.haze.topHeight *= 1 + j(6, 0.25);
  p.floor.y += j(7, 0.02);
  p.floor.horizonY += j(8, 0.025);
  p.streaks.forEach((s, i) => {
    s.offset *= 1 + j(10 + i, 0.3);
    s.widthIn *= 1 + j(20 + i, 0.25);
    s.widthOut *= 1 + j(30 + i, 0.25);
    s.intensity *= 1 + j(40 + i, 0.3);
    s.length *= 1 + j(50 + i, 0.3);
  });
  p.sideStreaks.forEach((s, i) => {
    s.c *= 1 + j(60 + i, 0.4);
    s.intensity *= 1 + j(70 + i, 0.35);
  });
  p.floorBalance += j(90, 0.25);
  return p;
}

export function beamParams(params) {
  const p = mergeDeep(BEAM_DEFAULTS, params);
  return jitterBeam(p, (p.seed >>> 0) ^ 0x5eed, p.jitter ?? 0);
}

// Super-gaussian cross-section: exp(-0.5 |u|^p).
function profile(u, p) {
  return Math.exp(-0.5 * Math.pow(Math.abs(u), p));
}

export function renderBeam(W, H, params) {
  const p = beamParams(params);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  let cLight = hexToLinear(p.colors.light);
  let cHaze = hexToLinear(p.colors.haze);
  // Optional: one haze or light unit carries this luminance, so dark pack
  // colors still give a visible beam and very pale ones do not wash out
  // (the pack hex then appears where the light is dimmer or brighter).
  if (p.hazeLuminance) cHaze = cHaze.map((v) => (v * p.hazeLuminance) / lum(cHaze));
  if (p.lightLuminance) cLight = cLight.map((v) => (v * p.lightLuminance) / lum(cLight));
  const cBase = hexToLinear(p.colors.base);
  const seed = p.seed >>> 0;
  const { beam, haze, floor, pool, glow } = p;
  // The stage curve and the side streaks' bend are set for a 1:2 frame
  // (half-width 0.25 frame heights); wider frames get a flatter stage.
  const halfW = W / (2 * H);
  const frameK = floor.scaleWithFrame === false ? 1 : (0.25 / halfW) ** 2;
  const curve = floor.curve * frameK;

  const img = createImage(W, H);
  const tanTilt = Math.tan(beam.tilt);
  const cosTilt = Math.cos(beam.tilt);
  const poolX = beam.x;
  const poolY = floor.y;
  // Floor perspective: the floor point seen at screen (sx, sy) lies at depth
  // Z = 1 / (sy - horizonY) and lateral position X = (sx - vanishX) * Z.
  // vanishX 'pool' puts the vanishing point under the pool (camera aimed at
  // it, lens shifted), so the floor reflections stay symmetric.
  const vanishX = floor.vanishX === 'pool' ? poolX : (floor.vanishX ?? 0);
  const zPool = 1 / Math.max(1e-4, poolY - floor.horizonY);
  const xPool = (poolX - vanishX) * zPool;
  const R = pool.width * zPool;
  const lumRatio = lum(cHaze) / lum(cLight);

  for (let y = 0; y < H; y++) {
    const sy = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const sx = (x + 0.5 - W / 2) / H;
      let r = cBase[0] * p.base.level;
      let g = cBase[1] * p.base.level;
      let b = cBase[2] * p.base.level;

      // The floor's far edge: the back of a round stage, an arch in the
      // frame (lower toward the sides).
      const edgeY = poolY + curve * (sx - poolX) * (sx - poolX);
      const above = 1 - smoothstep(edgeY - floor.edgeSoft, edgeY + floor.edgeSoft, sy);
      const below = 1 - above;

      if (above > 0) {
        // Beam in-scatter across the axis, with the haze denser near the
        // ceiling and near the floor.
        const axisX = poolX - tanTilt * (poolY - sy);
        const w = beam.width * (1 + beam.widthGrowth * (sy - 0.5));
        const u = ((sx - axisX) * cosTilt) / w;
        const n = fbm2(u * beam.noiseScale[0] + 11.3, sy * beam.noiseScale[1] + 3.7, seed, 3);
        const hTop = haze.top * Math.exp(-sy / haze.topHeight);
        const hFloor = haze.floor * Math.exp(-Math.max(0, poolY - sy) / haze.floorHeight);
        const dens = beam.intensity * (beam.width / w) * Math.max(0, 1 + beam.noise * n);
        const across = dens * profile(u, beam.shape);
        const acrossFloor = (dens * profile(u / haze.floorSpread, beam.shape)) / haze.floorSpread;
        const lHaze = across * (haze.mid + hTop) + acrossFloor * hFloor * (1 - haze.floorTint);
        const lPale = acrossFloor * hFloor * haze.floorTint;

        // Pool light scattered by the haze above the floor.
        const gx = (sx - poolX) / glow.widthScale;
        const gy = Math.max(0, poolY - sy);
        const h = Math.sqrt(gx * gx + gy * gy + glow.radius * glow.radius);
        const lam = Math.pow((gy + 0.25 * glow.radius) / (h + 0.25 * glow.radius), glow.lambert);
        const lip = smoothstep(glow.lipFrom, glow.lipTo, gy / Math.max(1e-4, Math.abs(sx - poolX)));
        const lg = (glow.intensity * glow.radius * Math.exp(-glow.falloff * h) * lam * lip) / h;

        const gH = glow.color === 'haze' ? lg : 0;
        const gL = glow.color === 'haze' ? 0 : lg * lumRatio;
        r += (cHaze[0] * (lHaze + gH) + cLight[0] * (lPale * lumRatio + gL)) * above;
        g += (cHaze[1] * (lHaze + gH) + cLight[1] * (lPale * lumRatio + gL)) * above;
        b += (cHaze[2] * (lHaze + gH) + cLight[2] * (lPale * lumRatio + gL)) * above;
      }

      if (below > 0 && sy > floor.horizonY) {
        const Z = 1 / (sy - floor.horizonY);
        const fx = (sx - vanishX) * Z - xPool;
        const fz = Z - zPool;
        const dy = Math.max(0, sy - edgeY);

        // Pool footprint: pale core and haze-colored skirt.
        const rx = fx / R;
        const rz = fz / R;
        const core = profile(Math.sqrt(rx * rx + (rz / pool.depth) ** 2), pool.shape);
        const ePool = pool.intensity * core;
        const eSkirt =
          pool.skirt * Math.exp(-0.5 * ((rx / pool.skirtAcross) ** 2 + (rz / pool.skirtDepth) ** 2)) * (1 - core);

        // Side streaks along parabolas through the pool center.
        const ddx = Math.abs(sx - poolX);
        const lnC = Math.log(Math.max(1e-6, sy - poolY) / (ddx * ddx + 1e-6));
        let eSideS = 0;
        for (const s of p.sideStreaks) {
          const lobe = Math.exp(-0.5 * ((lnC - Math.log(s.c * frameK)) / s.width) ** 2);
          const along = smoothstep(s.start * 0.4, s.start, ddx) * Math.exp(-Math.max(0, ddx - s.start) / s.reach);
          eSideS += s.intensity * lobe * along;
        }
        eSideS *= 1 + p.floorBalance * Math.sign(sx - poolX);

        // Reflection streaks: each pair has a lateral profile in floor X and
        // a glossy-lobe falloff in screen distance below the edge. Optional
        // noise along X (seeded) breaks them into uneven streaks.
        const ax = Math.abs(fx) / R;
        const sn = p.streakNoise;
        const nX = sn.amount > 0 ? Math.max(0, 1 + sn.amount * noise1Periodic(ax * sn.scale + (fx < 0 ? 0 : 37), 1024, seed ^ 0xbeef)) : 1;
        let eStreak = 0;
        for (const s of p.streaks) {
          const d = ax - s.offset;
          const wdt = d < 0 ? s.widthIn : s.widthOut;
          const lat = Math.exp(-0.5 * (d / wdt) ** 2);
          const dd = Math.max(0, dy - s.start);
          const on = s.start > 0 ? smoothstep(0, s.start, dy) : 1;
          eStreak += s.intensity * lat * on * Math.pow(1 + (dd / s.length) ** 2, -s.power);
        }
        const bal = 1 + p.floorBalance * Math.sign(fx) * smoothstep(0, 0.3 * R, Math.abs(fx));
        eStreak *= nX * bal;
        const pale = p.streakPale.amount * Math.exp(-dy / p.streakPale.length);

        // Broad floor glow around the pool, gaussian in floor distance.
        const fg = p.floorGlow;
        const eGlowFloor = fg.intensity * Math.exp(-(fx * fx + fz * fz) / (2 * (fg.reach * R) ** 2));

        // Fine surface texture of the floor.
        const tc = floor.textureCell;
        const tex = floor.texture > 0 ? 1 + floor.texture * noise2(sx / tc, sy / tc, seed ^ 0xf100) : 1;

        // The pale part of the streaks carries the haze color's luminance
        // in the light color.
        const fb = p.base.floorLevel;
        const eL = (ePool + eStreak * pale * lumRatio) * tex;
        const eH = (eStreak * (1 - pale) + eGlowFloor + eSkirt + eSideS) * tex;
        r = r * (above + below * fb) + (cLight[0] * eL + cHaze[0] * eH) * below;
        g = g * (above + below * fb) + (cLight[1] * eL + cHaze[1] * eH) * below;
        b = b * (above + below * fb) + (cLight[2] * eL + cHaze[2] * eH) * below;
      }
      const o = (y * W + x) * 3;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
    }
  }

  // Multiple scattering: wide blur levels tinted with the haze color by
  // luminance, mixed in as an energy-conserving point spread.
  const sp = p.spread;
  if (sp.amount > 0) {
    const yh = 0.2126 * cHaze[0] + 0.7152 * cHaze[1] + 0.0722 * cHaze[2];
    const tint = [cHaze[0] / yh, cHaze[1] / yh, cHaze[2] / yh];
    const lum = createImage(W, H);
    for (let q = 0; q < W * H; q++) {
      const yv = 0.2126 * img.data[q * 3] + 0.7152 * img.data[q * 3 + 1] + 0.0722 * img.data[q * 3 + 2];
      lum.data[q * 3] = yv * tint[0];
      lum.data[q * 3 + 1] = yv * tint[1];
      lum.data[q * 3 + 2] = yv * tint[2];
    }
    const spread = bloom(lum, { strength: 1, weights: sp.weights });
    for (let i = 0; i < img.data.length; i++) img.data[i] = img.data[i] * (1 - sp.amount) + spread.data[i] * sp.amount;
  }
  return { image: img };
}
