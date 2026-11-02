// Clean reference targets and their ignore rects from the shared manifest.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLinear } from './image.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../../..');
export const PROTO = path.resolve(here, '..');
const REF_DIR = path.join(ROOT, 'public/references/awe');

export function manifestEntry(id) {
  const m = JSON.parse(fs.readFileSync(path.join(REF_DIR, 'manifest.json'), 'utf8'));
  const e = m.references.find((r) => r.id === id);
  if (!e) throw new Error(`no reference ${id}`);
  return e;
}

export async function loadReference(id) {
  const e = manifestEntry(id);
  const img = await loadLinear(path.join(REF_DIR, e.file));
  const mask = new Uint8Array(img.w * img.h).fill(1);
  for (const r of e.ignore ?? []) {
    const [x0, y0, rw, rh] = r.rect;
    for (let y = Math.max(0, y0); y < Math.min(img.h, y0 + rh); y++) {
      for (let x = Math.max(0, x0); x < Math.min(img.w, x0 + rw); x++) mask[y * img.w + x] = 0;
    }
  }
  return { id, entry: e, img, mask };
}

// Fill masked pixels column by column, interpolating between the nearest valid
// rows above and below (or copying the nearest one at the frame edge). The masks
// in this set (folds, text rows) lie inside flat bands, so this only removes them.
export function fillMasked(img, mask) {
  const { w, h } = img;
  const out = { w, h, ch: img.ch.map((c) => Float32Array.from(c)) };
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (mask[y * w + x]) {
        y++;
        continue;
      }
      const y0 = y - 1;
      while (y < h && !mask[y * w + x]) y++;
      const y1 = y;
      for (let yy = y0 + 1; yy < y1; yy++) {
        const i = yy * w + x;
        for (let k = 0; k < 3; k++) {
          const a = y0 >= 0 ? img.ch[k][y0 * w + x] : null;
          const b = y1 < h ? img.ch[k][y1 * w + x] : null;
          if (a !== null && b !== null) {
            const f = (yy - y0) / (y1 - y0);
            out.ch[k][i] = a + (b - a) * f;
          } else out.ch[k][i] = a ?? b ?? 0;
        }
      }
    }
  }
  return out;
}
