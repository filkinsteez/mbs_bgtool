// Step 1: crops of the references at 1:1 and 4x (and, for the riso tiles,
// the same spots in the original scan) for looking at grain by eye.
import fs from 'node:fs';
import path from 'node:path';
import { crop, readSrgb, rot90ccw, writeSheet, zoomNearest } from './lib/image.mjs';
import { OUT, REFS, REPO, RISO_SCAN } from './refs.mjs';

const DIR = path.join(OUT, 'study');
fs.mkdirSync(DIR, { recursive: true });

const C1 = 192;
const C4 = 48;

const only = process.argv[2];
const scan = rot90ccw(await readSrgb(RISO_SCAN));

for (const ref of REFS) {
  if (only && ref.id !== only) continue;
  const img = await readSrgb(ref.file);
  const scale = ref.figmaWidth / img.w;
  const rows = [[], []];
  const extra = [[], []];
  for (const sp of ref.spots) {
    const cx = Math.round(sp.fx * img.w);
    const cy = Math.round(sp.fy * img.h);
    rows[0].push({ img: crop(img, cx - C1 / 2, cy - C1 / 2, C1, C1), label: `${sp.name} 1:1` });
    rows[1].push({ img: zoomNearest(crop(img, cx - C4 / 2, cy - C4 / 2, C4, C4), 4), label: `${sp.name} 4x` });
    if (ref.source) {
      const { s, ox, oy } = ref.source;
      const sx = Math.round(ox + cx / s);
      const sy = Math.round(oy + cy / s);
      const n = Math.round(C4 / s);
      extra[0].push({
        img: zoomNearest(crop(scan, sx - Math.floor(n / 2), sy - Math.floor(n / 2), n, n), 12),
        label: `scan, same area, 12x`,
      });
      extra[1].push({ img: zoomNearest(crop(scan, sx - C4 / 2, sy - C4 / 2, C4, C4), 4), label: `scan 4x (3x the area)` });
    }
  }
  const all = ref.source ? [...rows, ...extra] : rows;
  const title = `${ref.id}  ${img.w}x${img.h}${scale !== 1 ? ` (x${scale.toFixed(3)} = 925 wide)` : ''}`;
  await writeSheet(all, path.join(DIR, `${ref.id}.png`), { title });
  console.log('wrote', ref.id);
}

// The deck's own picture of the grain filter: slide 44:204 "Every
// background is three layers", 330 px tiles in the 1920 px slide.
if (!only || only === 'deck') {
  const slide = await readSrgb(path.join(REPO, 'artifacts/brief-screens/slides/44-204-layers.png'));
  const tile = { light: 526, filter: 956, output: 1386 };
  const y = 300;
  const rows = [
    [
      { img: crop(slide, tile.filter + 20, y + 20, C1, C1), label: 'deck grain layer 1:1' },
      { img: zoomNearest(crop(slide, tile.filter + 120, y + 120, C4, C4), 4), label: 'grain layer 4x' },
      { img: crop(slide, tile.output + 10, y + 120, C1, C1), label: 'deck output 1:1 (peach)' },
      { img: zoomNearest(crop(slide, tile.output + 40, y + 200, C4, C4), 4), label: 'output 4x (peach)' },
    ],
    [
      { img: crop(slide, tile.light + 10, y + 120, C1, C1), label: 'light layer 1:1 (no grain)' },
      { img: zoomNearest(crop(slide, tile.light + 40, y + 200, C4, C4), 4), label: 'light layer 4x' },
      { img: crop(slide, tile.output + 130, y + 20, C1, C1), label: 'deck output 1:1 (blue)' },
      { img: zoomNearest(crop(slide, tile.output + 250, y + 40, C4, C4), 4), label: 'output 4x (blue)' },
    ],
  ];
  await writeSheet(rows, path.join(DIR, 'deck-layers-grain.png'), {
    title: 'slide 44:204: the deck grain layer and output (330 px tiles in a 1920 px slide)',
  });
  console.log('wrote deck-layers-grain');
}
