// Offline parameter search for a reference preset. Never runs at render time;
// it only proposes numbers that get checked by eye with iterate.mjs.
// Pattern search on mean Oklab ΔE between the blurred, downsampled reference
// and the render (radiance + tone curve, no lens or grain).
// Usage: node fit.mjs <preset.json> <out.json> [sweeps] [scale]
import { writeFile } from 'node:fs/promises';
import { loadPreset } from './render.mjs';
import { referencePath } from './iterate.mjs';
import { readLinear } from './lib/image.mjs';
import { gaussianBlur, downsample2 } from './lib/blur.mjs';
import { prepareScene, radianceAt } from './lib/blooms.mjs';
import { toneMap } from './lib/output.mjs';
import { hexToLinear, linearToOklab, oklabToLinear, linearToHex, oklabLch } from './lib/color.mjs';

const [presetPath, outPath, sweepsArg, scaleArg] = process.argv.slice(2);
const sweeps = Number(sweepsArg ?? 20);
const levels = Number(scaleArg ?? 2);
const AB_WEIGHT = Number(process.env.AB_WEIGHT ?? 2.5);
const preset = await loadPreset(presetPath);
const ref = referencePath(preset.referenceId);
let target = await readLinear(ref.file);
for (let i = 0; i < levels; i++) target = downsample2(target);
target = gaussianBlur(target, 2);
const W = target.w;
const H = target.h;
const targetLab = new Float32Array(W * H * 3);
for (let i = 0; i < W * H; i++) targetLab.set(linearToOklab([target.data[i * 3], target.data[i * 3 + 1], target.data[i * 3 + 2]]), i * 3);

// Parameter vector: every numeric bloom/base/warp field listed below plus
// each color as Oklab L, a, b.
const scene = structuredClone(preset.scene);
const fixed = new Set(scene.fitFixed ?? []);
const BOUNDS = {
  intensity: [0, 6, 0.1],
  x: [-1.2, 2.2, 0.05],
  y: [-1.2, 2.2, 0.05],
  radius: [0.04, 3, 0.04],
  aniso: [0.3, 12, 0.2],
  angle: [-180, 180, 4],
  beta: [0.4, 4, 0.1],
  absorb: [0, 8, 0.2],
  absorbPow: [1, 4, 0.2],
  spread: [-0.6, 1.2, 0.05],
  curve: [0.3, 4, 0.1],
  baseAngle: [-180, 180, 4],
  topI: [0, 3, 0.05],
  bottomI: [0, 3, 0.05],
  warpAmount: [0, 0.3, 0.01],
};
const params = [];
scene.params.blooms.forEach((b, i) => {
  for (const k of ['intensity', 'x', 'y', 'radius', 'aniso', 'angle', 'beta', 'absorb', 'absorbPow', 'spread']) {
    if (fixed.has(`blooms.${i}.${k}`) || fixed.has(`*.${k}`) || b[k] === undefined) continue;
    const bounds = scene.fitBounds?.[`blooms.${i}.${k}`] ?? scene.fitBounds?.[k] ?? BOUNDS[k];
    params.push({ name: `blooms.${i}.${k}`, get: () => b[k], set: (v) => (b[k] = v), bounds });
  }
});
const base = scene.params.base;
if (!fixed.has('base.angle')) params.push({ name: 'base.angle', get: () => base.angle, set: (v) => (base.angle = v), bounds: BOUNDS.baseAngle });
if (!fixed.has('base.curve')) params.push({ name: 'base.curve', get: () => base.curve, set: (v) => (base.curve = v), bounds: BOUNDS.curve });
if (base.center !== undefined && !fixed.has('base.center')) params.push({ name: 'base.center', get: () => base.center, set: (v) => (base.center = v), bounds: [0, 1, 0.02] });
if (base.width !== undefined && !fixed.has('base.width')) params.push({ name: 'base.width', get: () => base.width, set: (v) => (base.width = v), bounds: [0.02, 0.8, 0.02] });
(base.wave ?? []).forEach((w, i) => {
  if (fixed.has('base.wave')) return;
  params.push({ name: `base.wave.${i}.amp`, get: () => w.amp, set: (v) => (w.amp = v), bounds: [-0.3, 0.3, 0.01] });
  params.push({ name: `base.wave.${i}.phase`, get: () => w.phase, set: (v) => (w.phase = v), bounds: [-2, 2, 0.03] });
});
// Colors are searched as Oklab L, C, h so a hue can be pinned with
// "colors.<i>.h" in scene.fitFixed.
const lchColors = scene.colors.map((hex) => oklabLch(linearToOklab(hexToLinear(hex))));
const COLOR_BOUNDS = { L: [0.05, 1, 0.02], C: [0, 0.32, 0.01], h: [-720, 720, 4] };
lchColors.forEach((lch, ci) => {
  if (fixed.has(`colors.${ci}`)) return;
  ['L', 'C', 'h'].forEach((ch, j) => {
    if (fixed.has(`colors.${ci}.${ch}`)) return;
    params.push({ name: `colors.${ci}.${ch}`, get: () => lch[j], set: (v) => (lch[j] = v), bounds: COLOR_BOUNDS[ch] });
  });
});

// Out-of-gamut colors lose chroma (same L and hue) until they fit, so a
// pinned hue stays pinned.
function inGamut(L, C, h) {
  const r = (h * Math.PI) / 180;
  const lin = oklabToLinear([L, C * Math.cos(r), C * Math.sin(r)]);
  return lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4) ? lin : null;
}

function sceneColors() {
  return lchColors.map(([L, C, h]) => {
    let lin = inGamut(L, C, h);
    if (!lin) {
      let lo = 0;
      let hi = C;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (inGamut(L, mid, h)) lo = mid;
        else hi = mid;
      }
      lin = inGamut(L, lo, h) ?? [L, L, L];
    }
    return lin.map((v) => Math.min(1, Math.max(0, v)));
  });
}

// Lightness gradient of the target, in Oklab L per 1% of the image width.
// A glow with a visible shoulder or rim shows up here even when its mean
// color is right.
const GRAD_WEIGHT = Number(process.env.GRAD_WEIGHT ?? 0);
const gscale = W / 100;
function gradients(Lch0) {
  const gx = new Float32Array(W * H);
  const gy = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xl = Math.max(0, x - 1);
      const xr = Math.min(W - 1, x + 1);
      const yu = Math.max(0, y - 1);
      const yd = Math.min(H - 1, y + 1);
      gx[i] = ((Lch0[(y * W + xr) * 3] - Lch0[(y * W + xl) * 3]) / (xr - xl)) * gscale;
      gy[i] = ((Lch0[(yd * W + x) * 3] - Lch0[(yu * W + x) * 3]) / (yd - yu)) * gscale;
    }
  }
  return { gx, gy };
}
const targetGrad = gradients(targetLab);
const renderLab = new Float32Array(W * H * 3);

const tmp = [0, 0, 0];
const tm = [0, 0, 0];
function loss() {
  const cols = sceneColors();
  const resolved = {
    ...scene,
    params: {
      ...scene.params,
      blooms: scene.params.blooms.map((b) => ({ ...b, color: cols[b.color] })),
      base: { ...base, top: cols[base.top], bottom: cols[base.bottom ?? base.top] },
    },
  };
  const s = prepareScene(resolved, W, H);
  let sum = 0;
  for (let y = 0; y < H; y++) {
    const py = (y + 0.5) / s.R - s.ay / 2;
    for (let x = 0; x < W; x++) {
      const px = (x + 0.5) / s.R - s.ax / 2;
      radianceAt(s, px, py, tmp);
      toneMap(tmp[0], tmp[1], tmp[2], tm);
      const lab = linearToOklab(tm);
      const i = (y * W + x) * 3;
      renderLab[i] = lab[0];
      // Hue errors in pale, low-chroma bridges (lavender vs green) are small in
      // plain ΔE but obvious to the eye, so a and b count extra.
      sum += Math.hypot(lab[0] - targetLab[i], AB_WEIGHT * (lab[1] - targetLab[i + 1]), AB_WEIGHT * (lab[2] - targetLab[i + 2]));
    }
  }
  let g = 0;
  if (GRAD_WEIGHT > 0) {
    const rg = gradients(renderLab);
    for (let i = 0; i < W * H; i++) g += Math.hypot(rg.gx[i] - targetGrad.gx[i], rg.gy[i] - targetGrad.gy[i]);
  }
  return ((sum + GRAD_WEIGHT * g) / (W * H)) * 100;
}

for (const p of params) p.set(Math.min(p.bounds[1], Math.max(p.bounds[0], p.get())));
let best = loss();
console.log(`start ΔE ${best.toFixed(3)} with ${params.length} params at ${W}x${H}`);
const steps = params.map((p) => p.bounds[2] * 2);
for (let sweep = 0; sweep < sweeps; sweep++) {
  let improved = 0;
  params.forEach((p, i) => {
    for (const dir of [1, -1]) {
      const old = p.get();
      const v = Math.min(p.bounds[1], Math.max(p.bounds[0], old + dir * steps[i]));
      if (v === old) continue;
      p.set(v);
      const l = loss();
      if (l < best - 1e-4) {
        best = l;
        improved++;
        steps[i] *= 1.3;
        return;
      }
      p.set(old);
    }
    steps[i] *= 0.6;
  });
  console.log(`sweep ${sweep + 1}: ΔE ${best.toFixed(3)} (${improved} moves)`);
  if (!improved && steps.every((s, i) => s < params[i].bounds[2] * 0.05)) break;
}

const outPreset = structuredClone(preset);
outPreset.scene = structuredClone(scene);
outPreset.scene.colors = sceneColors().map((c) => linearToHex(c));
for (const b of outPreset.scene.params.blooms) {
  for (const k of Object.keys(b)) if (typeof b[k] === 'number' && k !== 'color') b[k] = Math.round(b[k] * 1000) / 1000;
}
base.angle = Math.round(base.angle * 10) / 10;
base.curve = Math.round(base.curve * 100) / 100;
outPreset.scene.params.base = base;
delete outPreset.scene.fitFixed;
delete outPreset.scene.fitBounds;
await writeFile(outPath, JSON.stringify(outPreset, null, 2) + '\n');
console.log(`wrote ${outPath}`);
