// Print the structure of a reference: row profiles in Oklab for a few column
// bands, and where a few lightness levels cross each column (tilt, curvature).
// Usage: node measure.mjs <referenceId> [rowStep]
import { gaussianBlur } from './lib/blur.mjs';
import { linearToOklab, linearToHex } from './lib/color.mjs';
import { loadReference } from './lib/refs.mjs';

const id = process.argv[2];
const step = Number(process.argv[3] ?? 25);
const ref = await loadReference(id);
const { w, h, mask } = ref;
const img = gaussianBlur(ref.img, 3);
console.log(id, w, 'x', h, ref.clean ? '(clean target)' : '(screenshot)');

function bandMean(y, x0, x1) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let x = x0; x < x1; x++) {
    if (!mask[y * w + x]) continue;
    const i = (y * w + x) * 3;
    r += img.data[i];
    g += img.data[i + 1];
    b += img.data[i + 2];
    n++;
  }
  return n ? [r / n, g / n, b / n] : null;
}

const bands = [
  ['left', 0.02, 0.15],
  ['center', 0.43, 0.57],
  ['right', 0.85, 0.98],
];
const fmt = (c) => {
  if (!c) return '        --          ';
  const [L, a, bb] = linearToOklab(...c);
  const C = Math.hypot(a, bb);
  const hue = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return `${linearToHex(c)} L${L.toFixed(3)} C${C.toFixed(3)} h${hue.toFixed(0).padStart(3)}`;
};
console.log('row   ' + bands.map((b) => b[0].padEnd(33)).join(''));
for (let y = 0; y < h; y += step) {
  const line = bands.map(([, a, b]) => fmt(bandMean(y, Math.floor(a * w), Math.floor(b * w))).padEnd(33));
  console.log(String(y).padStart(5) + ' ' + line.join(''));
}

// Lightness per pixel for iso-lines.
const Lmap = new Float32Array(w * h);
for (let i = 0; i < w * h; i++) Lmap[i] = linearToOklab(img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2])[0];
const levels = (process.argv[4] ?? '0.45,0.55,0.65,0.75,0.85').split(',').map(Number);
const cols = [0.04, 0.15, 0.3, 0.5, 0.7, 0.85, 0.96].map((f) => Math.floor(f * w));
console.log('\niso-lines: first row (from top) where column lightness crosses level');
console.log('level  ' + cols.map((c) => ('x' + c).padStart(7)).join(''));
for (const lev of levels) {
  const ys = cols.map((x) => {
    let prev = null;
    for (let y = 0; y < h; y++) {
      if (!mask[y * w + x]) continue;
      const v = Lmap[y * w + x];
      if (prev !== null && (prev.v - lev) * (v - lev) <= 0 && prev.v !== v) {
        return (prev.y + ((lev - prev.v) / (v - prev.v)) * (y - prev.y)).toFixed(0);
      }
      prev = { y, v };
    }
    return '-';
  });
  console.log(lev.toFixed(2).padEnd(7) + ys.map((s) => String(s).padStart(7)).join(''));
}
