// Renders a preset through recipe -> lens -> output stage, and when the
// preset names a reference, writes a side-by-side, zoom crops and a coarse
// Oklab comparison.
//
//   node prototypes/contour-beams/render.mjs <preset.json> [--size WxH] [--seed N] [--out name] [--no-compare]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { renderBeam } from './beam.mjs';
import { renderStreaks } from './streaks.mjs';
import { bloom, halation } from './lib/lens.mjs';
import { saveLinear } from './lib/image.mjs';
import { compareGrid, printGrid, sideBySide, zoomPair } from './lib/compare.mjs';
import { hexToLinear } from './lib/color.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');

const SCREENSHOTS = {
  'contour-beam-pool': 'artifacts/brief-screens/contour/c49-beam-floor.png',
  'contour-radial-streaks': 'artifacts/brief-screens/contour/c62-streaks.png',
};

export function referencePath(id) {
  const manifest = path.join(repo, 'public/references/awe/manifest.json');
  if (fs.existsSync(manifest)) {
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const ref = m.references?.find((r) => r.id === id);
    if (ref) {
      const p = path.join(repo, 'public/references/awe', ref.file);
      if (fs.existsSync(p)) return { file: p, clean: true, entry: ref };
    }
  }
  const s = SCREENSHOTS[id];
  return s ? { file: path.join(repo, s), clean: false, entry: null } : null;
}

// Mask of the screenshot's white rounded corners (1 = measure this pixel).
export function cornerMask(w, h, radius) {
  const m = new Uint8Array(w * h).fill(1);
  if (radius <= 0) return m;
  const r = radius + 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = x < r ? r : x >= w - r ? w - 1 - r : x;
      const cy = y < r ? r : y >= h - r ? h - 1 - r : y;
      if ((x - cx) ** 2 + (y - cy) ** 2 > (r - 2) ** 2 - 1 && (x < r || x >= w - r) && (y < r || y >= h - r)) {
        m[y * w + x] = 0;
      }
    }
  }
  return m;
}

function vignette(img, { strength = 0, radius = 0.9, power = 2 } = {}) {
  if (strength <= 0) return img;
  const { w, h } = img;
  const diag = Math.hypot(w, h) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) / diag / radius;
      const f = 1 - strength * Math.pow(Math.min(d, 1.5), power);
      const o = (y * w + x) * 3;
      const k = Math.max(0, f);
      img.data[o] *= k;
      img.data[o + 1] *= k;
      img.data[o + 2] *= k;
    }
  }
  return img;
}

export function runRecipe(scene, W, H) {
  const [c0, c1, c2] = scene.colors ?? [];
  const params = structuredClone(scene.params ?? {});
  params.seed = scene.seed ?? 1;
  params.colors = { ...(params.colors ?? {}) };
  if (c0) params.colors.light = c0;
  if (c1) params.colors.haze = c1;
  if (c2) params.colors.base = c2;
  switch (scene.recipe) {
    case 'contour.beam':
      return renderBeam(W, H, params).image;
    case 'contour.streaks':
      return renderStreaks(W, H, params).image;
    default:
      throw new Error(`unknown recipe ${scene.recipe}`);
  }
}

export function applyLens(img, lens = {}) {
  let out = img;
  if (lens.vignette) out = vignette(out, lens.vignette);
  if (lens.bloom) {
    const b = { ...lens.bloom };
    if (b.tints) b.tints = b.tints.map((t) => (typeof t === 'string' ? hexToLinear(t) : t));
    out = bloom(out, b);
  }
  if (lens.halation) {
    const hl = { ...lens.halation };
    if (typeof hl.tint === 'string') hl.tint = hexToLinear(hl.tint);
    out = halation(out, hl);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const presetPath = args[0];
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const preset = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
  const scene = preset.scene;
  if (opt('seed')) scene.seed = Number(opt('seed'));
  const ref = preset.referenceId ? referencePath(preset.referenceId) : null;
  let W;
  let H;
  if (opt('size')) [W, H] = opt('size').split('x').map(Number);
  else if (ref) {
    const m = await sharp(ref.file).metadata();
    W = m.width;
    H = m.height;
  } else [W, H] = [1920, 1080];

  const name = opt('out') ?? `${path.basename(presetPath, '.json')}-${W}x${H}`;
  const outDir = path.join(here, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  const lin = runRecipe(scene, W, H);
  const lensed = applyLens(lin, scene.lens);
  const file = path.join(outDir, `${name}.png`);
  await saveLinear(file, lensed, { grain: scene.output?.grain ?? 0, seed: scene.seed ?? 1, exposure: scene.output?.exposure ?? 0 });
  console.log(`wrote ${path.relative(repo, file)} in ${Date.now() - t0} ms`);

  if (ref && !args.includes('--no-compare')) {
    const refM = await sharp(ref.file).metadata();
    if (refM.width === W && refM.height === H) {
      await sideBySide(ref.file, file, path.join(outDir, `${name}-sbs.png`));
      const zooms = preset.audit?.zooms ?? [];
      for (let i = 0; i < zooms.length; i++) {
        const z = zooms[i];
        await zoomPair(ref.file, file, z.rect, z.scale ?? 3, path.join(outDir, `${name}-zoom${i}.png`));
      }
      const mask = cornerMask(W, H, ref.clean ? 0 : (preset.audit?.cornerRadius ?? 30));
      const grid = await compareGrid(ref.file, file, { gx: preset.audit?.grid?.[0] ?? 8, gy: preset.audit?.grid?.[1] ?? 12, mask });
      printGrid(grid, name);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
