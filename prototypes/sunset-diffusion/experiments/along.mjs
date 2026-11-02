// Samples reference colors along a tilted line y(u) = y0 + slope*(u-0.5) + bend*(u-0.5)^2
// at several u. Usage: node along.mjs <id> y0 slope bend [u ...]
import { loadReference } from '../lib/image.mjs';
import { resolveReference } from '../lib/refs.mjs';
import { meanColor } from '../lib/measure.mjs';
import { linearToHex, linearToOklab } from '../lib/color.mjs';

const [id, y0, slope, bend, ...us] = process.argv.slice(2);
const ref = await resolveReference(id);
const img = await loadReference(ref.path);
const list = us.length ? us.map(Number) : [0.05, 0.15, 0.3, 0.5, 0.7, 0.85, 0.95];
const out = [];
for (const u of list) {
  const du = u - 0.5;
  const v = Number(y0) + Number(slope) * du + Number(bend) * du * du;
  if (v < 0 || v > 1) {
    out.push(`u${u}:out`);
    continue;
  }
  const x = Math.min(img.w - 9, Math.max(0, Math.round(u * img.w) - 4));
  const y = Math.min(img.h - 9, Math.max(0, Math.round(v * img.h) - 4));
  const c = meanColor(img.lin, x, y, 8, 8);
  const [L] = linearToOklab(...c);
  out.push(`u${u}:${linearToHex(c)}(L${L.toFixed(2)})`);
}
console.log(out.join(' '));
