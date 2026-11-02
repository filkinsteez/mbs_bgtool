// Copies the images the README shows from out/ into results/ as JPEGs under
// 400 KB. Run after iterate.mjs (bd-best, vw-best and the failed rounds),
// grid.mjs final 2 5 8, and extras.mjs.
import path from 'node:path';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { readSrgb8, composeRow, resize8 } from './lib/image.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const RES = path.join(HERE, 'results');
const LIMIT = 400 * 1024;

async function saveJpeg(img, name) {
  const file = path.join(RES, name);
  for (let q = 90; q >= 50; q -= 5) {
    await sharp(Buffer.from(img.data), { raw: { width: img.w, height: img.h, channels: 3 } })
      .jpeg({ quality: q, chromaSubsampling: '4:4:4' })
      .toFile(file);
    const size = statSync(file).size;
    if (size <= LIMIT) {
      console.log(`${name} ${img.w}x${img.h} q${q} ${(size / 1024).toFixed(0)} KB`);
      return;
    }
  }
  throw new Error(`${name} does not fit in 400 KB`);
}

async function scaled(file, width) {
  const im = await readSrgb8(path.join(OUT, file));
  return width && im.w > width ? resize8(im, width, Math.round((im.h * width) / im.w)) : im;
}

await saveJpeg(await scaled('bd-best-sbs.png', 1400), 'blue-diagonal-sbs.jpg');
await saveJpeg(await scaled('bd-best-zoom.png', 1400), 'blue-diagonal-zoom.jpg');
await saveJpeg(await scaled('vw-best-sbs.png', 1600), 'violet-wave-sbs.jpg');
await saveJpeg(await scaled('vw-best-zoom.png', 1400), 'violet-wave-zoom.jpg');
await saveJpeg(await scaled('final-16x9.png'), 'grid-16x9.jpg');
await saveJpeg(await scaled('final-9x16.png'), 'grid-9x16.jpg');
await saveJpeg(await scaled('contrast.png'), 'contrast-blooms-mesh-instagram.jpg');
await saveJpeg(await scaled('controls.png'), 'controls-rise-softness-intensity.jpg');
await saveJpeg(await scaled('seeds-1-9.png'), 'bold-seeds-1-9.jpg');

// Failed rounds, same height: blue-diagonal r06 (green bridge), r10 (blobs),
// violet-wave r03 (white oval), r06 (glow tails wash out the dark ground).
const fails = [];
for (const f of ['bd-r06.png', 'bd-r10.png', 'vw-r03.png', 'vw-r06.png']) {
  const im = await readSrgb8(path.join(OUT, f));
  fails.push(await resize8(im, Math.round((im.w * 420) / im.h), 420));
}
await saveJpeg(composeRow(fails, 8), 'failed-rounds.jpg');
