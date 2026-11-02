// Builds the committed result images (JPEG, each at most 400 KB) from out/.
// node make-results.mjs  (run measure.mjs, tables.mjs, render.mjs <preset> final,
// failures.mjs, packs.mjs and contour.mjs first)

import fs from 'node:fs';
import path from 'node:path';
import { PROTO } from './lib/refs.mjs';
import { loadCanvas, resizeCanvas, row, column, saveCanvas } from './lib/image.mjs';

const OUT = path.join(PROTO, 'out');
const RES = path.join(PROTO, 'results');
fs.mkdirSync(RES, { recursive: true });

async function fitHeight(file, h) {
  const c = await loadCanvas(file);
  return resizeCanvas(c, Math.round((c.w / c.h) * h), h);
}
async function fitWidth(c, w) {
  return c.w <= w ? c : resizeCanvas(c, w, Math.round((c.h / c.w) * w));
}
async function save(c, name, width) {
  let q = 84;
  const file = path.join(RES, name);
  for (;;) {
    await saveCanvas(await fitWidth(c, width), file, { quality: q });
    const kb = fs.statSync(file).size / 1024;
    if (kb <= 390 || q <= 50) {
      console.log(`${name}: ${kb.toFixed(0)} KB`);
      return;
    }
    q -= 8;
  }
}

// reference isolines: overlay and lines alone for four references
const refs = ['sunset-sky-peach', 'sunset-violet-wave', 'sunset-film-poster-bands', 'sunset-pink-riso'];
const pairs = [];
for (const id of refs) {
  const h = 420;
  pairs.push(await row([await fitHeight(path.join(OUT, 'measure', id, 'overlay.png'), h), await fitHeight(path.join(OUT, 'measure', id, 'lines.png'), h)], { labels: [id.replace('sunset-', ''), 'isolines alone, 10-90 zone shaded'], labelSize: 14, gap: 4 }));
}
await save(await column([await row(pairs.slice(0, 2), { gap: 12 }), await row(pairs.slice(2), { gap: 12 })], { gap: 12 }), 'reference-isolines.jpg', 1800);

// the two measurement plots
await save(await row([await loadCanvas(path.join(OUT, 'measure', 'corr-vs-separation.png')), await loadCanvas(path.join(OUT, 'measure', 'wiggle-vs-height.png'))], { gap: 10 }), 'measured-correlation-and-wiggle.jpg', 1800);

// one sheet per iterated reference: side by side, then isolines side by side
for (const id of ['sunset-sky-peach', 'sunset-red-yellow-arcs', 'sunset-blue-diagonal', 'sunset-violet-wave', 'sunset-film-poster-bands', 'sunset-pink-riso']) {
  const d = path.join(OUT, id, 'final');
  const side = await loadCanvas(path.join(d, 'side.png'));
  const iso = await loadCanvas(path.join(d, 'iso.png'));
  const h = 640;
  const sheet = await row([await resizeCanvas(side, Math.round((side.w / side.h) * h), h), await resizeCanvas(iso, Math.round((iso.w / iso.h) * h), h)], { gap: 10 });
  await save(sheet, `${id.replace('sunset-', '')}-final.jpg`, 1800);
}

await save(await loadCanvas(path.join(OUT, 'failures', 'failures.jpg')), 'failure-modes.jpg', 1100);
await save(await loadCanvas(path.join(OUT, 'packs', 'packs.jpg')), 'packs.jpg', 1800);

const contour = [];
for (const id of ['contour-light-line', 'contour-rim-edge', 'contour-yellow-halo', 'contour-beam-pool']) contour.push(await fitHeight(path.join(OUT, 'contour', `${id}.png`), 520));
await save(await column([await row(contour.slice(0, 2), { gap: 10 }), await row(contour.slice(2), { gap: 10 })], { gap: 10 }), 'contour-edges.jpg', 1800);
