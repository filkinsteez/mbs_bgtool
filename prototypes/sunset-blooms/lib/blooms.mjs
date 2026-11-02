// sunset.blooms light model (CPU prototype).
//
// Radiance per pixel, in linear RGB, channel c:
//   L_c(p) = B_c(p) * exp(-sum_i a_i K_i(p)^q_i) + sum_i I_i C_ic K_ic(p)
// B is a smooth two-color sky field. K_ic is a very wide long-tail glow
// kernel whose radius differs a little per channel (spread), so one glow's
// tail can be redder or bluer than its core. C_i is its color at nominal
// intensity, I_i its intensity. a_i and q_i set how much the glow's haze
// hides the sky near its core (q > 1 keeps the overlap zone additive).
// Optional horizon (base.front): the base's second color becomes a ground
// layer in front of the sky and the glows behind it:
//   L = (Sky * T + E_behind) * (1 - e) + Ground * e + E_front
// Then lens bloom and the output stage.
import { hexToLinear } from './color.mjs';
import { fbm2 } from './noise.mjs';
import { makeImage } from './image.mjs';
import { bloomPyramid } from './blur.mjs';

const DEG = Math.PI / 180;

function resolveColor(c, colors) {
  if (typeof c === 'number') return hexToLinear(colors[c]);
  if (Array.isArray(c)) return c;
  return hexToLinear(c);
}

function scaled(rgb, k) {
  return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
}

// Kernels are 1 at the center and fall off with squared normalized distance.
function makeKernel(b) {
  const kind = b.kernel ?? 'moffat';
  switch (kind) {
    case 'moffat': {
      const beta = b.beta ?? 1;
      return (d2) => Math.pow(1 + d2, -beta);
    }
    case 'gauss': {
      return (d2) => Math.exp(-0.5 * d2);
    }
    case 'gauss3': {
      const s = b.spread ?? 3;
      const [w0, w1, w2] = b.weights ?? [0.25, 0.35, 0.4];
      const n = w0 + w1 + w2;
      const i1 = 1 / (s * s);
      const i2 = 1 / (s * s * s * s);
      return (d2) => (w0 * Math.exp(-0.5 * d2) + w1 * Math.exp(-0.5 * d2 * i1) + w2 * Math.exp(-0.5 * d2 * i2)) / n;
    }
    default:
      throw new Error(`unknown kernel ${kind}`);
  }
}

export function prepareScene(scene, W, H) {
  const p = scene.params;
  const colors = scene.colors ?? [];
  const R = Math.sqrt(W * H);
  const ax = W / R;
  const ay = H / R;
  const base = p.base;
  const top = scaled(resolveColor(base.top, colors), base.topI ?? 1);
  const bottom = scaled(resolveColor(base.bottom ?? base.top, colors), base.bottomI ?? base.topI ?? 1);
  const th = (base.angle ?? 0) * DEG;
  const dx = Math.sin(th);
  const dy = Math.cos(th);
  const proj = [
    [-ax / 2, -ay / 2],
    [ax / 2, -ay / 2],
    [-ax / 2, ay / 2],
    [ax / 2, ay / 2],
  ].map(([x, y]) => x * dx + y * dy);
  const tmin = Math.min(...proj);
  const tmax = Math.max(...proj);
  const blooms = (p.blooms ?? []).map((b) => {
    const c = resolveColor(b.color, colors);
    const I = b.intensity ?? 1;
    const an = b.aniso ?? 1;
    const r = b.radius ?? 1;
    const ang = (b.angle ?? 0) * DEG;
    const spread = b.spread ?? 0;
    // Squared-distance scale per channel: red reaches 1 + spread times as
    // far as green, blue 1 / (1 + spread) times as far.
    const sr = 1 / (1 + spread) ** 2;
    const sb = (1 + spread) ** 2;
    return {
      er: c[0] * I,
      eg: c[1] * I,
      eb: c[2] * I,
      cx: (b.x - 0.5) * ax,
      cy: (b.y - 0.5) * ay,
      cos: Math.cos(ang),
      sin: Math.sin(ang),
      irx: 1 / (r * Math.sqrt(an)),
      iry: Math.sqrt(an) / r,
      absorb: b.absorb ?? 0,
      absorbPow: b.absorbPow ?? 2,
      front: b.front ?? false,
      sr,
      sb,
      chromatic: spread !== 0,
      kernel: makeKernel(b),
      warp: b.warp ?? 1,
    };
  });
  const warp = p.warp ?? {};
  return {
    W,
    H,
    R,
    ax,
    ay,
    seed: scene.seed ?? 1,
    top,
    bottom,
    dx,
    dy,
    tmin,
    tspan: tmax - tmin,
    curve: base.curve ?? 1,
    // Optional soft step instead of a power ramp: smoothstep(c - w, c + w, t).
    groundFront: base.front ?? false,
    stepCenter: base.center,
    stepWidth: base.width ?? 0.2,
    // Optional wave on the step: t += sum amp * sin(2 pi (freq * u + phase)),
    // u = horizontal frame position 0..1. This is a warped horizon line.
    wave: (base.wave ?? []).map((w) => ({ amp: w.amp ?? 0, freq: w.freq ?? 1, phase: w.phase ?? 0 })),
    blooms,
    warpAmount: warp.amount ?? 0,
    warpScale: warp.scale ?? 1,
  };
}

// Evaluates radiance at frame point (px, py), frame centered at 0, units of
// sqrt(W*H). Writes into out[0..2].
export function radianceAt(s, px, py, out) {
  let wx = 0;
  let wy = 0;
  if (s.warpAmount) {
    const k = 1 / s.warpScale;
    wx = s.warpAmount * fbm2(px * k, py * k, s.seed * 13 + 1);
    wy = s.warpAmount * fbm2(px * k + 31.7, py * k - 17.3, s.seed * 13 + 2);
  }
  let t = (px * s.dx + py * s.dy - s.tmin) / s.tspan;
  if (s.wave.length) {
    const u = px / s.ax + 0.5;
    for (const w of s.wave) t += w.amp * Math.sin(2 * Math.PI * (w.freq * u + w.phase));
  }
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  let e;
  if (s.stepCenter !== undefined) {
    let k = (t - s.stepCenter + s.stepWidth) / (2 * s.stepWidth);
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    e = k * k * (3 - 2 * k);
    if (s.curve !== 1) e = Math.pow(e, s.curve);
  } else {
    e = s.curve === 1 ? t : Math.pow(t, s.curve);
  }
  // With groundFront the step's far side is a ground layer in front of the
  // sky and of every glow not marked front (a horizon). Otherwise the base
  // is just the sky's own two-color field.
  const sw = s.groundFront ? 0 : e;
  const br = s.top[0] + (s.bottom[0] - s.top[0]) * sw;
  const bg = s.top[1] + (s.bottom[1] - s.top[1]) * sw;
  const bb = s.top[2] + (s.bottom[2] - s.top[2]) * sw;
  let ext = 0;
  const behind = [0, 0, 0];
  const front = [0, 0, 0];
  for (let i = 0; i < s.blooms.length; i++) {
    const b = s.blooms[i];
    const qx = px + wx * b.warp - b.cx;
    const qy = py + wy * b.warp - b.cy;
    const u = (qx * b.cos + qy * b.sin) * b.irx;
    const v = (-qx * b.sin + qy * b.cos) * b.iry;
    const d2 = u * u + v * v;
    const k = b.kernel(d2);
    if (b.absorb && !b.front) ext += b.absorb * (b.absorbPow === 1 ? k : Math.pow(k, b.absorbPow));
    const acc = b.front ? front : behind;
    if (b.chromatic) {
      acc[0] += b.er * b.kernel(d2 * b.sr);
      acc[1] += b.eg * k;
      acc[2] += b.eb * b.kernel(d2 * b.sb);
    } else {
      acc[0] += b.er * k;
      acc[1] += b.eg * k;
      acc[2] += b.eb * k;
    }
  }
  const T = ext > 0 ? Math.exp(-ext) : 1;
  let r = br * T + behind[0];
  let g = bg * T + behind[1];
  let bl = bb * T + behind[2];
  if (s.groundFront) {
    r = r * (1 - e) + s.bottom[0] * e;
    g = g * (1 - e) + s.bottom[1] * e;
    bl = bl * (1 - e) + s.bottom[2] * e;
  }
  out[0] = r + front[0];
  out[1] = g + front[1];
  out[2] = bl + front[2];
  return out;
}

export function renderRadiance(scene, W, H) {
  const s = prepareScene(scene, W, H);
  const img = makeImage(W, H);
  const o = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    const py = (y + 0.5) / s.R - s.ay / 2;
    for (let x = 0; x < W; x++) {
      const px = (x + 0.5) / s.R - s.ax / 2;
      radianceAt(s, px, py, o);
      const i = (y * W + x) * 3;
      img.data[i] = o[0];
      img.data[i + 1] = o[1];
      img.data[i + 2] = o[2];
    }
  }
  return img;
}

// Energy-preserving lens bloom: mix the image with its blur pyramid.
export function applyLens(img, lens = {}) {
  const strength = lens.bloom ?? 0;
  if (strength <= 0) return img;
  const pyr = bloomPyramid(img, lens.weights ?? [1, 1, 1, 1, 1, 1]);
  const tint = lens.tint ? hexToLinear(lens.tint) : [1, 1, 1];
  const out = makeImage(img.w, img.h);
  for (let i = 0; i < img.data.length; i += 3) {
    for (let c = 0; c < 3; c++) out.data[i + c] = img.data[i + c] * (1 - strength) + pyr.data[i + c] * strength * tint[c];
  }
  return out;
}
