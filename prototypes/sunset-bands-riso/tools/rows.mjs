// Prints masked row-mean colors of a reference, optionally next to a render.
// Usage: node tools/rows.mjs <referenceId> <y0> <y1> [step] [render.png]
import { readLinear, readAlpha } from '../lib/image.mjs';
import { buildMask, rowMeans } from '../lib/measure.mjs';
import { linearToHex, linearToOklab } from '../lib/color.mjs';
import { getRef } from '../refs.mjs';

const [, , id, y0s, y1s, steps = '10', renderPath] = process.argv;
const ref = getRef(id);
const img = await readLinear(ref.file);
const { a } = await readAlpha(ref.file);
const mask = buildMask(img.w, img.h, a, ref.ignore);
const rows = rowMeans(img, mask);
const ren = renderPath ? rowMeans(await readLinear(renderPath), mask) : null;
const fmt = (r) => {
  const [L, A, B] = linearToOklab(...r);
  return `${linearToHex(r)} L${L.toFixed(3)} a${A.toFixed(3)} b${B.toFixed(3)} C${Math.hypot(A, B).toFixed(3)}`;
};
for (let y = +y0s; y <= +y1s; y += +steps) {
  const r = [rows[y * 3], rows[y * 3 + 1], rows[y * 3 + 2]];
  if (Number.isNaN(r[0])) continue;
  const line = `${String(y).padStart(5)} ${fmt(r)}`;
  console.log(ren ? `${line}   | render ${fmt([ren[y * 3], ren[y * 3 + 1], ren[y * 3 + 2]])}` : line);
}
