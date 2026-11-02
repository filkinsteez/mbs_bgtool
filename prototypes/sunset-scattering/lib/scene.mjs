// Turns a scene (palette colors + a few light parameters) into a linear RGB
// image. Steps:
// 1. medium from the palette (mode "spectra": RGB channels with palette
//    spectra; mode "bands": one channel per palette color);
// 2. multiple scattering table for that medium;
// 3. sky-view table: per-channel radiance integrated along view rays over the
//    frame's range of (azimuth, warped elevation);
// 4. per pixel: camera ray -> azimuth/elevation -> horizon warp -> bilinear
//    lookup in the sky-view table -> linear RGB.

import {
  EARTH_R,
  bandMedium,
  spectraMedium,
  twoLightMedium,
  twoLightGrayMedium,
  buildOpticalDepthTable,
  buildMultiScatterTable,
  setHazeHeight,
  viewRay,
  viewRayTwoLight,
} from "./atmosphere.mjs";
import { hexToLinear } from "./color.mjs";
import { fbm1 } from "./noise.mjs";

const DEG = Math.PI / 180;
const odTableCache = new Map();

export const DEFAULT_PARAMS = {
  mode: "spectra",
  roles: null,
  airModel: "split",
  airWarmth: 0.25,
  redden: 1,
  sunElevation: -2,
  sunAzimuth: 0,
  fov: 50,
  horizon: 1.0,
  tilt: 0,
  air: 1,
  haze: 1,
  ozone: 0,
  spread: 5.7,
  mieG: 0.8,
  observer: 0.2,
  hazeHeight: 1.2,
  groundAlbedo: 0.1,
  msScale: 1,
  sunIntensity: 20,
  wbTemp: 0,
  wbTint: 0,
  warp: 0,
  warpScale: 1.5,
  warpPhase: 0,
  warpSeedOffset: 0,
  softness: 0,
  softnessVar: 0.5,
  steps: 40,
};

function cameraBasis(p, width, height) {
  const tanY = Math.tan((p.fov * DEG) / 2);
  const tanX = tanY * (width / height);
  const pitch = Math.atan((2 * p.horizon - 1) * tanY);
  const roll = p.tilt * DEG;
  return { tanX, tanY, cp: Math.cos(pitch), sp: Math.sin(pitch), cr: Math.cos(roll), sr: Math.sin(roll) };
}

// Pixel (u, v in 0..1, v down) to azimuth and elevation in radians.
function pixelToAngles(cam, u, v, out) {
  const xc = (2 * u - 1) * cam.tanX;
  const yc = (1 - 2 * v) * cam.tanY;
  const x1 = xc * cam.cr - yc * cam.sr;
  const y1 = xc * cam.sr + yc * cam.cr;
  const wy = y1 * cam.cp + cam.sp;
  const wz = -y1 * cam.sp + cam.cp;
  const len = Math.sqrt(x1 * x1 + wy * wy + wz * wz);
  out[0] = Math.atan2(x1, wz);
  out[1] = Math.asin(wy / len);
  return out;
}

// Horizon warp: low-frequency noise over azimuth, in radians of elevation.
// warp is the amplitude as a fraction of the vertical field of view,
// warpScale the number of noise cells across the frame width.
function makeWarp(p, seed, azWidth) {
  if (!p.warp) return () => 0;
  const amp = p.warp * p.fov * DEG;
  const freq = p.warpScale / azWidth;
  const s = seed * 31 + p.warpSeedOffset;
  const oct = p.warpOctaves ?? 3;
  return (az) => amp * fbm1(az * freq + 17.3 + p.warpPhase, s, oct);
}

// Horizon softness: width (radians) of a blur along elevation, varying along
// the horizon with a second noise.
function makeSoftness(p, seed, azWidth) {
  if (!p.softness) return () => 0;
  const base = p.softness * p.fov * DEG;
  const freq = (p.warpScale * 1.7) / azWidth;
  const s = seed * 57 + 9;
  return (az) => base * Math.max(0.05, 1 + p.softnessVar * fbm1(az * freq + 3.1, s, 2));
}

// 9-tap gaussian weights at offsets -2..2 sigma.
const SOFT_TAPS = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];
const SOFT_W = (() => {
  const w = SOFT_TAPS.map((t) => Math.exp(-0.5 * t * t));
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / s);
})();

const H0 = 1.5 * DEG;
const gOf = (h) => Math.asinh(h / H0);
const hOf = (g) => H0 * Math.sinh(g);

// Palette roles for modes "spectra" and "twolight": index of the palette
// color for each role (-1 = none). Without roles, colors are taken in order.
function resolveRoles(scene, p) {
  const r = p.roles ?? {};
  const pick = (name, fallback) => {
    const i = r[name] ?? fallback;
    return i >= 0 && i < scene.colors.length ? scene.colors[i] : null;
  };
  return { sky: pick("sky", 0), warm: pick("warm", 1), haze: pick("haze", 2), ground: pick("ground", 3) };
}

// Returns the medium, the palette colors (band mode only), the ground albedo,
// the medium used for the multiple scattering table and the view-ray function.
export function buildMedium(scene, p) {
  const groundOf = (roles) =>
    roles.ground ? hexToLinear(roles.ground).map((c) => c * p.groundAlbedo) : p.groundAlbedo;
  switch (p.mode) {
    case "bands": {
      const colors = scene.colors.map(hexToLinear);
      const medium = bandMedium(colors.length, p);
      return { medium, colors, groundAlbedo: p.groundAlbedo, msMedium: medium, msAlbedo: p.groundAlbedo, ray: viewRay };
    }
    case "spectra": {
      const roles = resolveRoles(scene, p);
      const medium = spectraMedium(roles, p);
      const g = groundOf(roles);
      return { medium, colors: null, groundAlbedo: g, msMedium: medium, msAlbedo: g, ray: viewRay };
    }
    case "twolight": {
      const roles = resolveRoles(scene, p);
      const medium = twoLightMedium(roles, p);
      const g = groundOf(roles);
      const gy = Array.isArray(g) ? 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2] : g;
      return {
        medium,
        colors: null,
        groundAlbedo: g,
        msMedium: twoLightGrayMedium(medium),
        msAlbedo: gy,
        ray: viewRayTwoLight,
      };
    }
    default:
      throw new Error(`unknown mode ${p.mode}`);
  }
}

export function renderScene(scene, width, height, opts = {}) {
  const p = { ...DEFAULT_PARAMS, ...(scene.params ?? {}) };
  const seed = scene.seed ?? 1;
  setHazeHeight(p.hazeHeight);
  if (!odTableCache.has(p.hazeHeight)) odTableCache.set(p.hazeHeight, buildOpticalDepthTable());
  const odTable = odTableCache.get(p.hazeHeight);
  const { medium, colors, groundAlbedo, msMedium, msAlbedo, ray } = buildMedium(scene, p);
  const n = medium.count;
  const msTable = buildMultiScatterTable(msMedium, odTable, msAlbedo);
  const cam = cameraBasis(p, width, height);

  // Frame range in azimuth and elevation (sampled on a coarse grid).
  const ang = [0, 0];
  let aMin = Infinity;
  let aMax = -Infinity;
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let j = 0; j <= 32; j++) {
    for (let i = 0; i <= 32; i++) {
      pixelToAngles(cam, i / 32, j / 32, ang);
      aMin = Math.min(aMin, ang[0]);
      aMax = Math.max(aMax, ang[0]);
      hMin = Math.min(hMin, ang[1]);
      hMax = Math.max(hMax, ang[1]);
    }
  }
  const warp = makeWarp(p, seed, aMax - aMin);
  const soft = makeSoftness(p, seed, aMax - aMin);
  const wAmp = p.warp ? p.warp * p.fov * DEG * 1.05 : 0;
  const sAmp = p.softness ? p.softness * p.fov * DEG * (2 + 2 * p.softnessVar) : 0;
  hMin -= wAmp + sAmp + 0.5 * DEG;
  hMax += wAmp + sAmp + 0.5 * DEG;
  aMin -= 0.5 * DEG;
  aMax += 0.5 * DEG;

  // Sky-view table, one channel per band.
  const NA = opts.lutAzimuth ?? 48;
  const NH = opts.lutElevation ?? 320;
  const gMin = gOf(hMin);
  const gMax = gOf(hMax);
  const lut = new Float32Array(NA * NH * n);
  const sunEl = p.sunElevation * DEG;
  const sunAz = p.sunAzimuth * DEG;
  const sx = Math.cos(sunEl) * Math.sin(sunAz);
  const sy = Math.sin(sunEl);
  const sz = Math.cos(sunEl) * Math.cos(sunAz);
  const ctx = {
    medium,
    odTable,
    msTable,
    steps: p.steps,
    groundAlbedo,
    msScale: p.msScale,
  };
  const scratch = { T: new Float64Array(n), ms: new Float64Array(n), od: [0, 0, 0] };
  const L = new Float64Array(n);
  const r0 = EARTH_R + p.observer;
  const E = p.sunIntensity;
  // Camera white balance: per-channel gains in linear light (blue-orange axis
  // and green-magenta axis), applied to RGB output channels.
  const wb = [Math.exp(-p.wbTemp), Math.exp(-p.wbTint), Math.exp(p.wbTemp)];
  for (let ih = 0; ih < NH; ih++) {
    const h = hOf(gMin + ((gMax - gMin) * ih) / (NH - 1));
    const ch = Math.cos(h);
    const vy = Math.sin(h);
    for (let ia = 0; ia < NA; ia++) {
      const a = aMin + ((aMax - aMin) * ia) / (NA - 1);
      const vx = ch * Math.sin(a);
      const vz = ch * Math.cos(a);
      ray(ctx, r0, vx, vy, vz, sx, sy, sz, 0, L, scratch);
      const o = (ih * NA + ia) * n;
      for (let b = 0; b < n; b++) lut[o + b] = L[b] * E;
    }
  }

  // Per-pixel lookup. With opts.basis the per-channel images are returned
  // instead of the color (used to solve for band colors in mode "bands").
  const basis = opts.basis ? Array.from({ length: n }, () => new Float32Array(width * height)) : null;
  const data = new Float32Array(width * height * 3);
  const px = new Float64Array(n);
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      pixelToAngles(cam, u, v, ang);
      const a = ang[0];
      const h = ang[1] - warp(a);
      const fa = ((a - aMin) / (aMax - aMin)) * (NA - 1);
      const ia = Math.max(0, Math.min(NA - 2, Math.floor(fa)));
      const ta = Math.max(0, Math.min(1, fa - ia));
      const sw = soft(a);
      px.fill(0);
      const taps = sw > 0 ? SOFT_TAPS.length : 1;
      for (let k = 0; k < taps; k++) {
        const hk = sw > 0 ? h + SOFT_TAPS[k] * sw : h;
        const wk = sw > 0 ? SOFT_W[k] : 1;
        const fh = ((gOf(hk) - gMin) / (gMax - gMin)) * (NH - 1);
        const ih = Math.max(0, Math.min(NH - 2, Math.floor(fh)));
        const th = Math.max(0, Math.min(1, fh - ih));
        const i00 = (ih * NA + ia) * n;
        const i01 = (ih * NA + ia + 1) * n;
        const i10 = ((ih + 1) * NA + ia) * n;
        const i11 = ((ih + 1) * NA + ia + 1) * n;
        for (let b = 0; b < n; b++) {
          px[b] +=
            wk *
            ((lut[i00 + b] * (1 - ta) + lut[i01 + b] * ta) * (1 - th) +
              (lut[i10 + b] * (1 - ta) + lut[i11 + b] * ta) * th);
        }
      }
      const i = y * width + x;
      if (basis) {
        for (let b = 0; b < n; b++) basis[b][i] = px[b];
        continue;
      }
      if (!colors) {
        data[i * 3] = px[0] * wb[0];
        data[i * 3 + 1] = px[1] * wb[1];
        data[i * 3 + 2] = px[2] * wb[2];
        continue;
      }
      let R = 0;
      let G = 0;
      let B = 0;
      for (let b = 0; b < n; b++) {
        R += px[b] * colors[b][0];
        G += px[b] * colors[b][1];
        B += px[b] * colors[b][2];
      }
      data[i * 3] = R * wb[0];
      data[i * 3 + 1] = G * wb[1];
      data[i * 3 + 2] = B * wb[2];
    }
  }
  if (basis) return { width, height, basis };
  return { width, height, data };
}
