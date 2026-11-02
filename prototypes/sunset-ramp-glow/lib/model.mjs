// Sunset "ramp + warped horizon + flat glow" light model.
// Everything here is per-pixel math that ports 1:1 to a fragment shader.
//
// radiance(p) = haze(p) * (ramp(s(p)) * (1 + sunlight(p)) * extinction(p) + horizonGlow(p) + sunGlow(p))
import { parseColor } from './color.mjs';
import { makeImage } from './image.mjs';
import { fbm1, fbm2 } from './noise.mjs';

// Logistic step whose 10%-90% rise spans `width`.
const STEP_K = 2 * Math.log(9);

export function step(x, width) {
  return 1 / (1 + Math.exp((-STEP_K * x) / width));
}

/** Smooth-peaked exponential: flat top over ~eps, then exp(-|d| / tau). */
function softExp(d, tau, eps) {
  return Math.exp(-(Math.sqrt(d * d + eps * eps) - eps) / tau);
}

/** Frame-fraction point [fx, fy] -> height units, x measured from the frame center. */
function framePoint(p, aspect) {
  return [(p[0] - 0.5) * aspect, p[1]];
}

export function prepareScene(scene, w, h) {
  const p = scene.params;
  const aspect = w / h;
  const axis = p.axis ?? {};
  const tilt = ((axis.tilt ?? 0) * Math.PI) / 180;
  const dir = [Math.sin(tilt), Math.cos(tilt)];
  const anchor = framePoint(axis.anchor ?? [0.5, 0.5], aspect);
  const toAxis = (pt) => {
    const dx = pt[0] - anchor[0];
    const dy = pt[1] - anchor[1];
    return [dx * dir[0] + dy * dir[1], dx * dir[1] - dy * dir[0]];
  };
  const stopColors = scene.colors.map(parseColor);
  const gains = p.gains ?? stopColors.map(() => 1);
  const colors = stopColors.map((c, i) => c.map((v) => v * gains[i]));
  const hz = p.horizon ?? {};
  const hIndex = hz.index ?? Math.floor((colors.length - 1) / 2);
  const stops = p.stops;
  const reach = hz.reach ?? 0.3;
  const sl = p.sunlight;
  const sun = p.sunGlow;
  const hg = p.horizonGlow;
  const hz2 = p.haze;
  const sunPos = framePoint(sl?.pos ?? sun?.pos ?? [0.5, 1], aspect);
  return {
    haze: hz2 && {
      scale: hz2.scale ?? 2,
      stretch: hz2.stretch ?? 3,
      octaves: hz2.octaves ?? 3,
      warp: hz2.warp ?? 0,
      light: hz2.light ?? 0,
    },
    anchor,
    dir,
    bend: axis.bend ?? 0,
    colors,
    deltas: colors.slice(1).map((c, i) => c.map((v, k) => v - colors[i][k])),
    stops,
    widths: p.widths,
    warpGain: stops.map((m) => Math.exp(-Math.abs(m - stops[hIndex]) / reach)),
    softGain: stops.map((m) => Math.exp(-Math.abs(m - stops[hIndex]) / (hz.softReach ?? reach))),
    hIndex,
    warp: hz.warp ?? 0,
    warpScale: hz.scale ?? 1.5,
    warpOctaves: hz.octaves ?? 3,
    warpPhase: 3.7 + (hz.phase ?? 0),
    soft: hz.soft ?? 0,
    softScale: hz.softScale ?? 1,
    seed: scene.seed ?? 1,
    sunPos,
    sunAxis: toAxis(sunPos),
    sunlight: sl && {
      gain: sl.gain ?? 0,
      width: sl.width ?? 0.5,
      tint: sl.tint ? parseColor(sl.tint) : [1, 1, 1],
    },
    hg: hg && {
      // [weight, tauUp, tauDown, color?]; a layer without its own color uses hg.color.
      layers: hg.layers.map(([weight, up, down, color]) => [
        weight,
        up,
        down,
        parseColor(color ?? hg.color).map((v) => v * hg.intensity),
      ]),
      lateral: hg.lateral ?? 0,
      lateralWidth: hg.lateralWidth ?? sl?.width ?? 0.5,
      offset: hg.offset ?? 0,
      extinction: hg.extinction ?? 0,
      // Optional own horizon line (a level horizon under a tilted sky ramp).
      line: hg.line && {
        anchor: framePoint(hg.line.anchor, aspect),
        dir: [Math.sin(((hg.line.tilt ?? 0) * Math.PI) / 180), Math.cos(((hg.line.tilt ?? 0) * Math.PI) / 180)],
      },
    },
    sun: sun && {
      pos: toAxis(sun.pos ? framePoint(sun.pos, aspect) : sunPos),
      // [weight, radius, color?]; a layer without its own color uses sun.color.
      layers: sun.layers.map(([weight, radius, color]) => [
        weight,
        radius,
        parseColor(color ?? sun.color).map((v) => v * sun.intensity),
      ]),
      aspect: sun.aspect ?? 1,
      beta: sun.beta ?? 1.5,
      occlude: sun.occlude ?? 0,
      occludeWidth: sun.occludeWidth ?? 0.05,
    },
  };
}

/** Linear radiance at one point (height units; x from the frame center, y down). */
export function shade(S, px, py, out) {
  const dx = px - S.anchor[0];
  const dy = py - S.anchor[1];
  // a: along the axis (sky -> ground); e: across it; s: bent axis coordinate.
  const a = dx * S.dir[0] + dy * S.dir[1];
  const e = dx * S.dir[1] - dy * S.dir[0];
  let s = a - 0.5 * S.bend * e * e;

  // Low-frequency haze, stretched across the axis: bends the bands slightly
  // and makes the light uneven.
  let haze = 1;
  if (S.haze) {
    const hx = (e * S.haze.scale) / S.haze.stretch;
    const hy = a * S.haze.scale;
    if (S.haze.warp) s += S.haze.warp * fbm2(hx + 1.3, hy + 7.1, S.seed + 301, S.haze.octaves);
    if (S.haze.light) haze = 1 + S.haze.light * fbm2(hx - 4.2, hy + 2.9, S.seed + 433, S.haze.octaves);
  }

  const n1 = S.warp ? fbm1(e * S.warpScale + S.warpPhase, S.seed, S.warpOctaves) : 0;
  const n2 = S.soft ? fbm1(e * S.softScale + 11.3, S.seed + 57, 2) : 0;

  let r = S.colors[0][0];
  let g = S.colors[0][1];
  let b = S.colors[0][2];
  let horizonPos = S.stops[S.hIndex];
  for (let j = 0; j < S.stops.length; j++) {
    const m = S.stops[j] + S.warp * n1 * S.warpGain[j];
    if (j === S.hIndex) horizonPos = m;
    const wj = S.widths[j] * Math.exp(S.soft * n2 * S.softGain[j]);
    const t = step(s - m, wj);
    const d = S.deltas[j];
    r += d[0] * t;
    g += d[1] * t;
    b += d[2] * t;
  }

  if (S.sunlight) {
    const q = (e - S.sunAxis[1]) / S.sunlight.width;
    const k = S.sunlight.gain / (1 + q * q);
    r *= 1 + k * S.sunlight.tint[0];
    g *= 1 + k * S.sunlight.tint[1];
    b *= 1 + k * S.sunlight.tint[2];
  }

  if (S.hg) {
    let dh;
    let latQ;
    if (S.hg.line) {
      const L = S.hg.line;
      const lx = px - L.anchor[0];
      const ly = py - L.anchor[1];
      const sx = S.sunPos[0] - L.anchor[0];
      const sy = S.sunPos[1] - L.anchor[1];
      const along = lx * L.dir[1] - ly * L.dir[0];
      const nh = S.warp ? fbm1(along * S.warpScale + S.warpPhase, S.seed, S.warpOctaves) : 0;
      dh = lx * L.dir[0] + ly * L.dir[1] - S.warp * nh - S.hg.offset;
      latQ = (along - (sx * L.dir[1] - sy * L.dir[0])) / S.hg.lateralWidth;
    } else {
      dh = s - horizonPos - S.hg.offset;
      latQ = (e - S.sunAxis[1]) / S.hg.lateralWidth;
    }
    const lat = S.hg.lateral ? 1 - S.hg.lateral + S.hg.lateral / (1 + latQ * latQ) : 1;
    let gr = 0;
    let gg = 0;
    let gb = 0;
    let depth = 0;
    for (const [weight, up, down, color] of S.hg.layers) {
      const tau = dh < 0 ? up : down;
      const f = lat * weight * softExp(dh, tau, 0.5 * tau);
      depth += f;
      gr += color[0] * f;
      gg += color[1] * f;
      gb += color[2] * f;
    }
    // The haze that scatters the glow also dims the sky seen through it.
    const keep = S.hg.extinction ? Math.exp(-S.hg.extinction * depth) : 1;
    r = r * keep + gr;
    g = g * keep + gg;
    b = b * keep + gb;
  }

  if (S.sun) {
    const da = a - S.sun.pos[0];
    const de = (e - S.sun.pos[1]) / S.sun.aspect;
    const rr = da * da + de * de;
    const vis = S.sun.occlude ? 1 - S.sun.occlude * step(s - horizonPos, S.sun.occludeWidth) : 1;
    for (const [weight, radius, color] of S.sun.layers) {
      const f = vis * weight * Math.pow(1 + rr / (radius * radius), -S.sun.beta);
      r += color[0] * f;
      g += color[1] * f;
      b += color[2] * f;
    }
  }

  out[0] = r * haze;
  out[1] = g * haze;
  out[2] = b * haze;
}

export function renderScene(scene, w, h) {
  const S = prepareScene(scene, w, h);
  const img = makeImage(w, h);
  const c = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const py = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      shade(S, (x + 0.5 - w / 2) / h, py, c);
      const i = (y * w + x) * 3;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
    }
  }
  return img;
}
