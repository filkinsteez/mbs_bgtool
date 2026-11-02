// Prints Oklab L (and C) of the middle columns every `step` rows for several
// PNGs side by side. Usage: node rows.mjs step x0 x1 a.png b.png ...
import { loadReference } from '../lib/image.mjs';
import { linearToOklab } from '../lib/color.mjs';

const [step, fx0, fx1, ...files] = process.argv.slice(2);
const imgs = await Promise.all(files.map((f) => loadReference(f)));
const h = Math.min(...imgs.map((i) => i.h));
console.log('   y  ' + files.map((f) => f.split('/').pop().slice(0, 18).padEnd(18)).join(' '));
for (let y = 0; y < h; y += Number(step)) {
  const cells = imgs.map((img) => {
    const x0 = Math.round(img.w * Number(fx0));
    const x1 = Math.round(img.w * Number(fx1));
    const acc = [0, 0, 0];
    let n = 0;
    for (let yy = y; yy < Math.min(img.h, y + 4); yy++) {
      for (let x = x0; x < x1; x++) {
        const i = yy * img.w + x;
        for (let c = 0; c < 3; c++) acc[c] += img.lin.ch[c][i];
        n++;
      }
    }
    const [L, a, b] = linearToOklab(acc[0] / n, acc[1] / n, acc[2] / n);
    const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    return `${L.toFixed(3)} ${Math.hypot(a, b).toFixed(3)} ${hue.toFixed(0).padStart(3)}`.padEnd(18);
  });
  console.log(`${String(y).padStart(4)}  ${cells.join(' ')}`);
}
