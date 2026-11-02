// Renders a reference preset at the reference's size and writes comparison
// images and numbers to out/<referenceId>/.
//   node audit.mjs presets/<referenceId>.json [tag]

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { renderPreset } from './lib/render.mjs';
import { writeRgb8 } from './lib/image.mjs';
import { sideBySide, cropPair, metrics, lineProfile } from './lib/compare.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SHOTS = path.join(ROOT, 'artifacts/brief-screens/contour');
const MANIFEST = path.join(ROOT, 'public/references/awe/manifest.json');

// Crops, profile lines and ignore rects are in screenshot pixels and get
// scaled when a clean target with another size is used.
const AUDIT = {
  'contour-rim-edge': {
    shot: 'c47-rim-edge.png',
    size: [788, 1400],
    ignore: [],
    crops: [
      [480, 120, 200, 200, 3],
      [300, 700, 200, 200, 3],
      [0, 120, 260, 160, 3],
    ],
    lines: [
      [400, 150, 400, 260, 23],
      [435, 582, 525, 627, 31],
      [600, 224, 700, 162, 26],
      [400.4, 166.1, 400.4, 200.2, 41],
      [452.8, 588.9, 479.2, 602.0, 33],
      [606.5, 216.6, 637.8, 197.2, 37],
    ],
  },
  'contour-light-line': {
    shot: 'c51-line-flame.png',
    size: [788, 1400],
    ignore: [],
    crops: [
      [300, 1150, 200, 250, 3],
      [330, 380, 120, 200, 3],
      [200, 700, 400, 300, 2],
    ],
    lines: [
      [200, 1380, 640, 1380, 23],
      [250, 1100, 560, 1100, 21],
      [330, 800, 500, 800, 18],
      [380, 600, 410, 600, 16],
    ],
  },
  'contour-yellow-halo': {
    shot: 'c57-yellow-arc.png',
    size: [925, 1309],
    ignore: [[280, 1020, 360, 260]],
    crops: [
      [0, 380, 460, 460, 1],
      [600, 150, 300, 300, 2],
    ],
    lines: [
      [726, 1047, 207, 54, 30],
      [578, 1165, 31, 697, 24],
    ],
  },
  'contour-iridescent-rings': {
    shot: 'c48-rings.png',
    size: [925, 1234],
    ignore: [[300, 1040, 240, 194]],
    crops: [
      [100, 700, 300, 200, 3],
      [250, 80, 260, 200, 3],
      [560, 800, 300, 260, 2],
      [0, 300, 220, 340, 2],
    ],
    lines: [
      [737 - 160, 322, 737 + 40, 322, 26],
      [48 + 0.766 * 120, 693 - 0.643 * 120, 48 - 0.766 * 20, 693 + 0.643 * 20, 24],
      [200, 700, 200, 960, 27],
      [39 + 160, 1100, 39 - 10, 1100, 18],
    ],
  },
};

function referencePath(id) {
  if (fs.existsSync(MANIFEST)) {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const ref = m.references?.find((r) => r.id === id);
    if (ref) {
      const p = path.join(ROOT, 'public/references/awe', ref.file);
      if (fs.existsSync(p)) return { file: p, clean: true, entry: ref };
    }
  }
  return { file: path.join(SHOTS, AUDIT[id].shot), clean: false };
}

const presetPath = process.argv[2];
const tag = process.argv[3] ?? 'cur';
const preset = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
const id = preset.referenceId;
const cfg = AUDIT[id];
const ref = referencePath(id);
const meta = await sharp(ref.file).metadata();
const W = meta.width;
const H = meta.height;
const sx = W / cfg.size[0];
const sy = H / cfg.size[1];
const outDir = path.join(import.meta.dirname, 'out', id);
fs.mkdirSync(outDir, { recursive: true });

const { bytes, timing } = renderPreset(preset, W, H);
await writeRgb8(path.join(outDir, `${tag}-render.png`), W, H, bytes);
await sideBySide(ref.file, bytes, W, H, path.join(outDir, `${tag}-side.png`));
for (const [i, [x, y, w, h, s]] of cfg.crops.entries()) {
  const rect = [Math.round(x * sx), Math.round(y * sy), Math.round(w * sx), Math.round(h * sy)];
  await cropPair(ref.file, bytes, W, H, rect, s, path.join(outDir, `${tag}-crop${i}.png`));
}
const ignore = (ref.clean ? (ref.entry.ignore ?? []).map((g) => g.rect) : cfg.ignore).map(([x, y, w, h]) =>
  ref.clean ? [x, y, w, h] : [x * sx, y * sy, w * sx, h * sy],
);
const m = await metrics(ref.file, bytes, W, H, { ignore, cornerRadius: ref.clean ? (ref.entry.cornerRadius ?? 0) : 28 });
console.log(`${id} ${W}x${H} ${ref.clean ? 'clean target' : 'screenshot'}  time scene ${timing.scene.toFixed(0)}ms lens ${timing.lens.toFixed(0)}ms`);
console.log(`dE ${m.dE.toFixed(2)}  dL ${m.dL.toFixed(2)}  da ${m.da.toFixed(2)}  db ${m.db.toFixed(2)}`);
for (let r = 0; r < m.grid.length / m.gridW; r++) console.log('  ' + m.grid.slice(r * m.gridW, (r + 1) * m.gridW).join('  '));
if (process.env.PROFILES !== '0') {
  for (const [x0, y0, x1, y1, n] of cfg.lines) {
    const rows = await lineProfile(ref.file, bytes, W, H, [x0 * sx, y0 * sy, x1 * sx, y1 * sy], n);
    console.log(`-- line ${[x0, y0, x1, y1].map((v) => Math.round(v)).join(',')}`);
    for (const r of rows) console.log(`   ${String(r.x).padStart(4)},${String(r.y).padStart(4)}  ref ${r.ref.map((v) => String(v).padStart(3)).join(' ')}  ren ${r.ren.map((v) => String(v).padStart(3)).join(' ')}`);
  }
}
