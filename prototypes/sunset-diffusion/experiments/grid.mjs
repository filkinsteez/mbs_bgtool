// Prints a grid of mean colors (hex and Oklab L) over the reference.
// Usage: node grid.mjs <id> cols rows
import { loadReference } from '../lib/image.mjs';
import { resolveReference } from '../lib/refs.mjs';
import { meanColor } from '../lib/measure.mjs';
import { linearToHex, linearToOklab } from '../lib/color.mjs';

const [id, cols = '8', rows = '8'] = process.argv.slice(2);
const ref = await resolveReference(id);
const img = await loadReference(ref.path);
const nc = Number(cols);
const nr = Number(rows);
for (let r = 0; r < nr; r++) {
  const cells = [];
  for (let c = 0; c < nc; c++) {
    const x0 = Math.round(((c + 0.5) / nc) * img.w) - 4;
    const y0 = Math.round(((r + 0.5) / nr) * img.h) - 4;
    const col = meanColor(img.lin, x0, y0, 8, 8);
    const [L] = linearToOklab(...col);
    cells.push(`${linearToHex(col)}/${L.toFixed(2)}`);
  }
  console.log(`v${((r + 0.5) / nr).toFixed(3)} ${cells.join(' ')}`);
}
