// One audit round for a reference preset: render at the reference's size,
// write render / side-by-side / 3x zoom crop, print guide metrics.
// Usage: node iterate.mjs <preset.json> <tag>
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderScene, loadPreset } from './render.mjs';
import { readSrgb8, srgb8ToLinear, writeSrgb8, composeRow, crop8, zoom8 } from './lib/image.mjs';
import { makeMask, blurredLab, deltaEStats, gridReport, columnProfile, rowProfile, fmtProfile } from './lib/measure.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'out');

// Zoom rects are in reference pixels and cover the transition that matters most.
export const REFS = {
  'sunset-violet-wave': {
    shot: 'artifacts/brief-screens/sunset/s58-wave.png',
    zoom: [470, 150, 300, 200],
    columns: [0.1, 0.45, 0.75, 0.95],
    rows: [0.2, 0.45, 0.7],
  },
  'sunset-blue-diagonal': {
    shot: 'artifacts/brief-screens/sunset/s41-blue-diagonal.png',
    zoom: [0, 600, 300, 400],
    columns: [0.05, 0.5, 0.95],
    rows: [0.3, 0.6, 0.85],
  },
};

export function referencePath(id) {
  const manifestPath = path.join(ROOT, 'public/references/awe/manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entry = manifest.references?.find((r) => r.id === id);
    if (entry) {
      const p = path.join(ROOT, 'public/references/awe', entry.file);
      if (existsSync(p)) return { file: p, clean: true, entry };
    }
  }
  return { file: path.join(ROOT, REFS[id].shot), clean: false, entry: null };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [presetPath, tag] = process.argv.slice(2);
  const preset = await loadPreset(presetPath);
  const id = preset.referenceId;
  const cfg = REFS[id];
  const ref = referencePath(id);
  const ref8 = await readSrgb8(ref.file);
  const t0 = performance.now();
  const img8 = renderScene(preset.scene, ref8.w, ref8.h);
  const ms = performance.now() - t0;
  await writeSrgb8(path.join(OUT, `${tag}.png`), img8);
  await writeSrgb8(path.join(OUT, `${tag}-sbs.png`), composeRow([ref8, img8], 10));
  const [zx, zy, zw, zh] = cfg.zoom;
  await writeSrgb8(
    path.join(OUT, `${tag}-zoom.png`),
    composeRow([zoom8(crop8(ref8, zx, zy, zw, zh), 3), zoom8(crop8(img8, zx, zy, zw, zh), 3)], 10),
  );

  const ignore = (ref.entry?.ignore ?? []).map((g) => g.rect);
  const mask = makeMask(ref8.w, ref8.h, ref.clean ? (ref.entry?.cornerRadius ?? 0) : 30, ignore);
  const A = blurredLab(srgb8ToLinear(ref8), mask, 6);
  const B = blurredLab(srgb8ToLinear(img8), null, 6);
  const st = deltaEStats(A, B, mask);
  console.log(`${tag}: ${ref8.w}x${ref8.h} in ${ms.toFixed(0)} ms, ref ${path.relative(ROOT, ref.file)}`);
  console.log(`ΔE (blur 6px, x100): mean ${st.mean.toFixed(2)} p50 ${st.p50.toFixed(2)} p95 ${st.p95.toFixed(2)} max ${st.max.toFixed(2)}`);
  console.log(gridReport(A, B, mask, 5, 6));
  for (const xf of cfg.columns) {
    console.log(`col ${xf} ref ${fmtProfile(columnProfile(A, xf, 10))}`);
    console.log(`col ${xf} out ${fmtProfile(columnProfile(B, xf, 10))}`);
  }
  for (const yf of cfg.rows) {
    console.log(`row ${yf} ref ${fmtProfile(rowProfile(A, yf, 10))}`);
    console.log(`row ${yf} out ${fmtProfile(rowProfile(B, yf, 10))}`);
  }
}
