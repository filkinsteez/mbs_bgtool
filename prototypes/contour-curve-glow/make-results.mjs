// Copies the final comparison images into results/ as JPEGs under 400 KB.
// Run audit.mjs with tag "final" and generality.mjs first.
//   node make-results.mjs

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const OUT = path.join(import.meta.dirname, 'out');
const RES = path.join(import.meta.dirname, 'results');
fs.mkdirSync(RES, { recursive: true });

const jobs = [];
for (const id of ['contour-rim-edge', 'contour-light-line', 'contour-yellow-halo', 'contour-iridescent-rings']) {
  jobs.push([path.join(OUT, id, 'final-side.png'), path.join(RES, `${id}-side.jpg`), 900]);
  jobs.push([path.join(OUT, id, 'final-crop0.png'), path.join(RES, `${id}-zoom.jpg`), 700]);
}
for (const pack of ['bold', 'elemental', 'atmospheric']) {
  jobs.push([path.join(OUT, 'generality', `sheet-${pack}.png`), path.join(RES, `pack-${pack}.jpg`), 920]);
}

for (const [src, dst, maxH] of jobs) {
  let q = 86;
  for (;;) {
    await sharp(src).resize({ height: maxH, withoutEnlargement: true }).jpeg({ quality: q, mozjpeg: true }).toFile(dst);
    const kb = fs.statSync(dst).size / 1024;
    if (kb <= 390 || q <= 50) {
      console.log(path.basename(dst), `${kb.toFixed(0)} KB q${q}`);
      break;
    }
    q -= 6;
  }
}
