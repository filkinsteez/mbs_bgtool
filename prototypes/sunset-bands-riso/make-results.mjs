// Builds the committed result images (JPEG, under 400 KB each) from out/ renders.
// Run render.mjs for each preset with tag "final", the light-over variants with
// tag "fit", and general.mjs first.
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSrgb8, writeJpeg, hstack, vstack, crop8, zoom8, shrink8 } from './lib/image.mjs';
import { getRef, HERE } from './refs.mjs';

const out = join(HERE, 'results');
mkdirSync(out, { recursive: true });
const o = (...p) => join(HERE, 'out', ...p);

async function save(name, im, quality = 84) {
  const path = join(out, name);
  await writeJpeg(path, im.w, im.h, im.data, quality);
  const kb = statSync(path).size / 1024;
  console.log(`${name} ${im.w}x${im.h} ${kb.toFixed(0)} KB`);
  if (kb > 400) throw new Error(`${name} is over 400 KB`);
}

// Reference | render, half size.
for (const [id, file] of [
  ['sunset-green-riso', 'green-riso'],
  ['sunset-blue-riso', 'blue-riso'],
  ['sunset-pink-riso', 'pink-riso'],
  ['sunset-film-poster-bands', 'poster'],
]) {
  const ref = await readSrgb8(getRef(id).file);
  const ren = await readSrgb8(o(`ref-${id}`, 'final', 'render.png'));
  await save(`${file}.jpg`, shrink8(hstack([ref, ren], 16), 2));
}

// Pink horizon at 3x: reference above, render below.
{
  const ref = await readSrgb8(getRef('sunset-pink-riso').file);
  const ren = await readSrgb8(o('ref-sunset-pink-riso', 'final', 'render.png'));
  const rect = [330, 760, 260, 170];
  await save('pink-horizon-3x.jpg', vstack([zoom8(crop8(ref, ...rect), 3), zoom8(crop8(ren, ...rect), 3)], 12));
}

// Green ramp: reference | light only (mixN 1) | ink step (mixN 3.7).
{
  const ref = await readSrgb8(getRef('sunset-green-riso').file);
  const light = await readSrgb8(o('ref-sunset-green-riso.light-over', 'fit', 'render.png'));
  const ink = await readSrgb8(o('ref-sunset-green-riso', 'final', 'render.png'));
  const rect = [330, 60, 260, 560];
  await save('green-ramp-light-vs-ink.jpg', hstack([crop8(ref, ...rect), crop8(light, ...rect), crop8(ink, ...rect)], 12));
}

// Packs: one row per pack (16:9 and 9:16, two seeds), plus the controls row.
{
  const rows = [];
  for (const pack of ['bold', 'elemental', 'atmospheric']) rows.push(await readSrgb8(o('general', `${pack}-sheet.png`)));
  rows.push(await readSrgb8(o('general', 'controls-sheet.png')));
  await save('packs-and-controls.jpg', vstack(rows, 16), 86);
}
