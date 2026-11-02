// Samples reference colors along a smoothed stroke path at arc-length t.
// Usage: node along-stroke.mjs <id> '[[u,v],...]' [t ...]
import { loadReference } from '../lib/image.mjs';
import { resolveReference } from '../lib/refs.mjs';
import { meanColor } from '../lib/measure.mjs';
import { linearToHex, linearToOklab } from '../lib/color.mjs';
import { prepareStroke } from '../lib/seeds.mjs';

const [id, pts, ...ts] = process.argv.slice(2);
const ref = await resolveReference(id);
const img = await loadReference(ref.path);
const aspect = img.w / img.h;
const st = prepareStroke({ points: JSON.parse(pts) }, aspect);
const list = ts.length ? ts.map(Number) : [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const out = [];
for (const t of list) {
  const target = t * st.total;
  let i = 0;
  while (i < st.acc.length - 2 && st.acc[i + 1] < target) i++;
  const seg = st.acc[i + 1] - st.acc[i] || 1;
  const a = (target - st.acc[i]) / seg;
  const X = st.pts[i][0] + (st.pts[i + 1][0] - st.pts[i][0]) * a;
  const Y = st.pts[i][1] + (st.pts[i + 1][1] - st.pts[i][1]) * a;
  const u = X / aspect + 0.5;
  const v = Y;
  if (u < 0 || u > 1 || v < 0 || v > 1) {
    out.push(`t${t}:out`);
    continue;
  }
  const x = Math.min(img.w - 7, Math.max(0, Math.round(u * img.w) - 3));
  const y = Math.min(img.h - 7, Math.max(0, Math.round(v * img.h) - 3));
  const c = meanColor(img.lin, x, y, 6, 6);
  const [L] = linearToOklab(...c);
  out.push(`t${t}(u${u.toFixed(2)}):${linearToHex(c)}/${L.toFixed(2)}`);
}
console.log(out.join(' '));
