// For each column band, prints the v where Oklab L first drops below each
// threshold (scanning down), to trace horizon shapes.
// Usage: node contour.mjs <id> cols L1 L2 ...
import { loadReference } from '../lib/image.mjs';
import { resolveReference } from '../lib/refs.mjs';
import { linearToOklab } from '../lib/color.mjs';

const [id, cols, ...ths] = process.argv.slice(2);
const ref = await resolveReference(id);
const img = await loadReference(ref.path);
const nc = Number(cols);
const lines = ths.map((t) => [`L<${t}`]);
for (let c = 0; c < nc; c++) {
  const x0 = Math.round((c / nc) * img.w);
  const x1 = Math.round(((c + 1) / nc) * img.w);
  const prof = [];
  for (let y = 0; y < img.h; y++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let x = x0; x < x1; x++) {
      const i = y * img.w + x;
      r += img.lin.ch[0][i];
      g += img.lin.ch[1][i];
      b += img.lin.ch[2][i];
    }
    const n = x1 - x0;
    prof.push(linearToOklab(r / n, g / n, b / n)[0]);
  }
  ths.forEach((t, k) => {
    // first y below the brightest row where L drops under t
    let yMax = 0;
    for (let y = 0; y < img.h; y++) if (prof[y] > prof[yMax]) yMax = y;
    let y = yMax;
    while (y < img.h && prof[y] >= Number(t)) y++;
    lines[k].push(((y + 0.5) / img.h).toFixed(3));
  });
}
console.log('u     ' + Array.from({ length: nc }, (_, c) => ((c + 0.5) / nc).toFixed(2)).join('  '));
for (const l of lines) console.log(l[0].padEnd(6) + l.slice(1).join(' '));
