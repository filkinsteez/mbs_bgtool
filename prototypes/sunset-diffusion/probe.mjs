// Prints facts about a reference: tile corner radius, row profiles, spot
// colors and grain level. Usage: node probe.mjs <referenceId> [x,y,w,h ...]
import { loadReference, blurChannel } from './lib/image.mjs';
import { linearToHex, srgbToHex } from './lib/color.mjs';
import { makeMask, rowProfile, meanColor } from './lib/measure.mjs';
import { resolveReference } from './lib/refs.mjs';

const id = process.argv[2];
const spots = process.argv.slice(3).map((s) => s.split(',').map(Number));
const ref = await resolveReference(id);
const img = await loadReference(ref.path);
const { w, h } = img;
console.log(`${id}: ${ref.path} ${w}x${h} corner=${ref.cornerRadius}`);

// corner radius: count near-white pixels along the top row from the left
let cx = 0;
while (cx < w && img.srgb.ch[0][cx] > 0.97 && img.srgb.ch[1][cx] > 0.97 && img.srgb.ch[2][cx] > 0.97) cx++;
console.log(`white run on top-left row: ${cx}px`);

const mask = makeMask(w, h, ref.cornerRadius, ref.ignore);
const prof = rowProfile(img.lin, mask, 24);
console.log('row  L     C     h    hex(mean)');
for (const p of prof) {
  const y0 = Math.max(0, Math.round(p.y - 2));
  const c = meanColor(img.lin, Math.round(w * 0.1), y0, Math.round(w * 0.8), 4);
  console.log(`${String(Math.round(p.y)).padStart(4)} ${p.L.toFixed(3)} ${p.C.toFixed(3)} ${p.h.toFixed(0).padStart(4)}  ${linearToHex(c)}`);
}

const left = rowProfile(img.lin, mask, 24, Math.round(w * 0.03), Math.round(w * 0.2));
const mid = rowProfile(img.lin, mask, 24, Math.round(w * 0.4), Math.round(w * 0.6));
const right = rowProfile(img.lin, mask, 24, Math.round(w * 0.8), Math.round(w * 0.97));
console.log('row   left L/C/h        mid L/C/h         right L/C/h');
const f = (p) => `${p.L.toFixed(3)} ${p.C.toFixed(3)} ${p.h.toFixed(0).padStart(3)}`;
for (let i = 0; i < left.length; i++) {
  console.log(`${String(Math.round(left[i].y)).padStart(4)}  ${f(left[i])}   ${f(mid[i])}   ${f(right[i])}`);
}

for (const [x, y, sw = 8, sh = 8] of spots) {
  const c = meanColor(img.lin, x, y, sw, sh);
  console.log(`spot ${x},${y} ${sw}x${sh}: ${linearToHex(c)}`);
}

// grain: std of (image - blur(image, 2px)) in sRGB, central region
const g = new Float32Array(img.srgb.ch[1]);
const gb = new Float32Array(g);
blurChannel(gb, w, h, 2.5);
let ss = 0;
let n = 0;
for (let y = Math.round(h * 0.1); y < h * 0.9; y++) {
  for (let x = Math.round(w * 0.1); x < w * 0.9; x++) {
    const d = g[y * w + x] - gb[y * w + x];
    ss += d * d;
    n++;
  }
}
console.log(`grain (green, sRGB std of high-pass): ${(Math.sqrt(ss / n) * 255).toFixed(2)} / 255`);
console.log(`top-left px ${srgbToHex([img.srgb.ch[0][0], img.srgb.ch[1][0], img.srgb.ch[2][0]])}`);
