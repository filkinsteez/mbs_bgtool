// Full render: seeds -> diffusion fill -> bridge light -> added glows ->
// domain warp -> blur -> exposure -> tone curve -> sRGB -> grain -> dither.
import { hexToLinear, linearToSrgb, toneMap } from './color.mjs';
import { fbm, rng } from './noise.mjs';
import { blurChannel, blurImage, makeImage, sampleBilinear } from './image.mjs';
import { rasterSeeds, lineCenter, extentMask } from './seeds.mjs';
import { pushPull, harmonic, upsample } from './solve.mjs';

function colorOf(c, palette) {
  if (typeof c === 'number') return hexToLinear(palette[c]);
  return hexToLinear(c);
}

// IQ-style domain warp: q = fbm(p), optionally r = fbm(p + fold * q).
// Returns [du, dv] in canvas units.
export function makeWarp(cfg, aspect) {
  if (!cfg) return null;
  const { ampX = 0, ampY = 0.02, freqX = 1.5, freqY = 1.5, octaves = 3, fold = 0, seed = 1 } = cfg;
  return (u, v) => {
    const px = u * freqX * aspect;
    const py = v * freqY;
    let qx = fbm(px + 1.7, py + 9.2, seed, octaves);
    let qy = fbm(px + 8.3, py + 2.8, seed + 7, octaves);
    if (fold) {
      const rx = fbm(px + fold * qx + 4.1, py + fold * qy + 7.3, seed + 13, octaves);
      const ry = fbm(px + fold * qx + 1.2, py + fold * qy + 5.9, seed + 19, octaves);
      qx = rx;
      qy = ry;
    }
    return [ampX * qx, ampY * qy];
  };
}

function glowProfile(d, profile) {
  let s = 0;
  for (const [r, wgt] of profile) s += wgt * Math.exp(-0.5 * (d / r) * (d / r));
  return s;
}

// Adds glow layers (light adds). Each glow reuses seed geometry for its
// centerline and adds color * strength * sum_i w_i * gauss(d / r_i).
function addGlows(img, glows, palette, warpField) {
  const { w, h } = img;
  const aspect = w / h;
  for (const [k, g] of glows.entries()) {
    const col = colorOf(g.color, palette).map((x) => x * (g.strength ?? 1));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let u = (x + 0.5) / w;
        let v = (y + 0.5) / h;
        if (warpField) {
          const [du, dv] = warpField(u, v);
          u += du;
          v += dv;
        }
        let d;
        if (g.kind === 'line') {
          const center = lineCenter(g, u, 100 + k);
          d = Math.abs(v - center);
          d *= v < center ? (g.above ?? 1) : (g.below ?? 1);
        } else {
          const X = (u - 0.5) * aspect;
          const cx = (g.u - 0.5) * aspect;
          const dx = (X - cx) / (g.sx ?? 1);
          const dy = (v - g.v) / (g.sy ?? 1);
          d = Math.sqrt(dx * dx + dy * dy);
          if (g.kind === 'ring') d = Math.abs(d - g.r);
        }
        const s = glowProfile(d, g.profile) * extentMask(g, u);
        const i = y * w + x;
        img.ch[0][i] += col[0] * s;
        img.ch[1][i] += col[1] * s;
        img.ch[2][i] += col[2] * s;
      }
    }
  }
}

// Returns linear radiance before exposure and tone (3 channels).
export function renderRadiance(scene, w, h, opts = {}) {
  const p = scene.params;
  const palette = scene.colors ?? [];
  const aspect = w / h;
  const seedWarp = makeWarp(p.seedWarp, aspect);
  // The fill is solved on a padded area and cropped, so the frame edges don't
  // act as walls that bend the color flow.
  const pad = p.pad ?? 0;
  // The fill has no fine detail away from the seeds, so it can be solved on a
  // smaller grid (solveScale < 1) and upsampled with a B-spline.
  const ss = opts.solveScale ?? 1;
  const PW = Math.round(w * (1 + 2 * pad));
  const PH = Math.round(h * (1 + 2 * pad));
  const SW = Math.max(8, Math.round(PW * ss));
  const SH = Math.max(8, Math.round(PH * ss));
  const ox = Math.round((PW - w) / 2);
  const oy = Math.round((PH - h) / 2);
  const level0 = rasterSeeds(p.seeds, palette, SW, SH, { secondMoment: true, warpField: seedWarp, pad, aspect });
  const solver = opts.solver ?? p.solver ?? 'pushpull';
  let res;
  if (solver === 'harmonic') {
    const pp = pushPull(level0, { gain: p.gain ?? 4, up: p.up ?? 'bspline' });
    res = harmonic(level0, { cycles: p.cycles ?? 6, init: [...pp.fill.ch, ...pp.second.ch] });
  } else {
    res = pushPull(level0, { gain: p.gain ?? 4, up: p.up ?? 'bspline' });
  }
  if (SW !== PW || SH !== PH) {
    const upF = upsample(res.fill, PW, PH, 'bspline');
    const upS = res.second ? upsample(res.second, PW, PH, 'bspline') : null;
    res = { fill: upF, second: upS };
  }
  const crop = (src) => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) out.set(src.subarray((y + oy) * PW + ox, (y + oy) * PW + ox + w), y * w);
    return out;
  };
  res = {
    fill: { w, h, ch: res.fill.ch.map(crop) },
    second: res.second ? { w, h, ch: res.second.ch.map(crop) } : null,
  };
  const img = makeImage(w, h, 3);
  for (let c = 0; c < 3; c++) img.ch[c].set(res.fill.ch[c]);

  // Bridge light: where seeds of distant hues meet, add broad-band light so
  // the bridge comes out lighter and less saturated instead of a dark mix.
  if (p.bridge && p.bridge.amount) {
    const bc = colorOf(p.bridge.color ?? '#FFFFFF', palette);
    const amt = p.bridge.amount;
    const ref = p.bridge.ref ?? 0.25;
    // variance of seed chromaticity around this pixel: 0 where all nearby
    // seeds share a hue; halfway between two seeds it is 0.05 for sky blue /
    // peach, 0.17 for cyan / yellow and 0.4 for Meta Blue / orange-red. It
    // rises smoothly (w * (1 - w)) across a transition.
    const weight = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const sum = res.fill.ch[0][i] + res.fill.ch[1][i] + res.fill.ch[2][i] + 1e-6;
      let s = 0;
      for (let c = 0; c < 3; c++) {
        const m = res.fill.ch[c][i] / sum;
        s += Math.max(0, res.second.ch[c][i] - m * m);
      }
      weight[i] = (amt * s) / ref;
    }
    if (p.bridge.blur) blurChannel(weight, w, h, p.bridge.blur * h);
    if (p.bridge.mode === 'neutral') {
      // pull the mix toward a neutral whose luminance is raised part of the
      // way to white (lift 0..1)
      const lift = p.bridge.lift ?? 0.35;
      for (let i = 0; i < w * h; i++) {
        const r = img.ch[0][i];
        const g = img.ch[1][i];
        const b = img.ch[2][i];
        const Y = 1 - (1 - Math.min(1, 0.2126 * r + 0.7152 * g + 0.0722 * b)) * (1 - lift);
        const t = Math.min(1, weight[i]);
        img.ch[0][i] = r + (Y * bc[0] - r) * t;
        img.ch[1][i] = g + (Y * bc[1] - g) * t;
        img.ch[2][i] = b + (Y * bc[2] - b) * t;
      }
    } else {
      for (let i = 0; i < w * h; i++) {
        for (let c = 0; c < 3; c++) img.ch[c][i] += weight[i] * bc[c];
      }
    }
    if (opts.debug) opts.debug.bridge = weight;
  }

  // Sky brightness falls off away from an off-frame source: an exposure
  // gradient in stops along a direction (angle 0 = brighter to the right).
  if (p.light && p.light.stops) {
    const ang = ((p.light.angle ?? 0) * Math.PI) / 180;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const curve = p.light.curve ?? 0;
    // a warm source raises red more than blue: per-channel stop multipliers
    const tint = p.light.tint ?? [1, 1, 1];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = ((x + 0.5) / w - 0.5) * dx + ((y + 0.5) / h - 0.5) * dy;
        const s = p.light.stops * (t + curve * t * t);
        const i = y * w + x;
        for (let c = 0; c < 3; c++) img.ch[c][i] *= Math.pow(2, s * tint[c]);
      }
    }
  }

  if (p.glows && p.glows.length) addGlows(img, p.glows, palette, seedWarp);

  const postWarp = makeWarp(p.warp, aspect);
  let out = img;
  if (postWarp) {
    out = makeImage(w, h, 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w;
        const v = (y + 0.5) / h;
        const [du, dv] = postWarp(u, v);
        const sx = (u + du) * w;
        const sy = (v + dv) * h;
        for (let c = 0; c < 3; c++) out.ch[c][y * w + x] = sampleBilinear(img.ch[c], w, h, sx, sy);
      }
    }
  }
  if (p.blur) blurImage(out, p.blur * h, (p.blurY ?? p.blur) * h);
  return { img: out, debug: opts.debug };
}

function gaussian(rand) {
  const u1 = Math.max(1e-9, rand());
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Exposure, tone curve, exact sRGB, grain, dither, 8-bit.
export function outputStage(img, output = {}, seed = 1) {
  const { w, h } = img;
  const exposure = Math.pow(2, output.exposure ?? 0);
  const srgb = makeImage(w, h, 3);
  for (let i = 0; i < w * h; i++) {
    const t = toneMap(img.ch[0][i] * exposure, img.ch[1][i] * exposure, img.ch[2][i] * exposure);
    for (let c = 0; c < 3; c++) srgb.ch[c][i] = linearToSrgb(t[c]);
  }
  const grain = output.grain ?? 0;
  if (grain > 0) {
    const rand = rng(seed * 7919 + 13);
    const size = output.grainSize ?? 0;
    const chroma = output.grainChroma ?? 0;
    const planes = [];
    const nPlanes = chroma > 0 ? 4 : 1;
    for (let k = 0; k < nPlanes; k++) {
      const n = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) n[i] = gaussian(rand);
      if (size > 0) {
        blurChannel(n, w, h, size);
        let ss = 0;
        for (let i = 0; i < w * h; i++) ss += n[i] * n[i];
        const inv = 1 / Math.sqrt(ss / (w * h));
        for (let i = 0; i < w * h; i++) n[i] *= inv;
      }
      planes.push(n);
    }
    // grainInk: print grain grows where the strongest channel is low (dense
    // dark ink); amplitude = grain * (1 + grainInk * (1 - max channel))
    const ink = output.grainInk ?? 0;
    for (let i = 0; i < w * h; i++) {
      const maxc = Math.max(srgb.ch[0][i], srgb.ch[1][i], srgb.ch[2][i]);
      const tone = 1 + ink * Math.max(0, 1 - maxc);
      for (let c = 0; c < 3; c++) {
        const mono = planes[0][i];
        const n = chroma > 0 ? (1 - chroma) * mono + chroma * planes[c + 1][i] : mono;
        srgb.ch[c][i] += grain * tone * n;
      }
    }
  }
  const rand = rng(seed * 104729 + 7);
  const out = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) {
      const d = (rand() + rand() - 1) / 255;
      out[i * 3 + c] = Math.max(0, Math.min(255, Math.round((srgb.ch[c][i] + d) * 255)));
    }
  }
  return out;
}

// Stop-based baseline: linear-light interpolation between colors at given v.
export function stopRamp(stops, palette, w, h) {
  const img = makeImage(w, h, 3);
  const cols = stops.map((s) => colorOf(s.color, palette));
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    let j = 0;
    while (j < stops.length - 2 && v > stops[j + 1].v) j++;
    const t = Math.min(1, Math.max(0, (v - stops[j].v) / (stops[j + 1].v - stops[j].v)));
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) img.ch[c][y * w + x] = cols[j][c] + (cols[j + 1][c] - cols[j][c]) * t;
    }
  }
  return img;
}
