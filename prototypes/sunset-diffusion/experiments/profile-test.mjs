// Prints the fill profile between seeds for push-pull (several gains, both
// upsamplers) and the harmonic solve, to see what each solver does between
// two or three horizontal strokes.
import { rasterSeeds } from '../lib/seeds.mjs';
import { pushPull, harmonic } from '../lib/solve.mjs';

const w = 256;
const h = 512;
const palette = ['#000000', '#FFFFFF', '#808080'];
const two = [
  { kind: 'line', y: 0.1, width: 0.004, soft: 0.002, color: '#000000' },
  { kind: 'line', y: 0.9, width: 0.004, soft: 0.002, color: '#FFFFFF' },
];
const three = [
  { kind: 'line', y: 0.1, width: 0.004, soft: 0.002, color: '#000000' },
  { kind: 'line', y: 0.5, width: 0.004, soft: 0.002, color: '#FFFFFF' },
  { kind: 'line', y: 0.9, width: 0.004, soft: 0.002, color: '#000000' },
];
const blob = [
  { kind: 'line', y: 0.02, width: 0.01, soft: 0.002, color: '#000000' },
  { kind: 'blob', u: 0.5, v: 0.6, rx: 0.05, ry: 0.05, soft: 0.2, color: '#FFFFFF' },
];

function column(fill) {
  const x = Math.floor(w / 2);
  const out = [];
  for (let k = 0; k <= 20; k++) {
    const y = Math.min(h - 1, Math.floor((k / 20) * h));
    out.push(fill.ch[0][y * w + x]);
  }
  return out.map((v) => v.toFixed(3)).join(' ');
}

for (const [name, seeds] of [
  ['two', two],
  ['three', three],
  ['blob', blob],
]) {
  const lv = rasterSeeds(seeds, palette, w, h, { secondMoment: false });
  console.log(`--- ${name} (linear-light R at v = 0, 0.05, ... 1)`);
  for (const gain of [2, 3, 4, 6]) {
    for (const up of ['linear', 'bspline']) {
      const r = pushPull(lv, { gain, up });
      console.log(`pushpull g${gain} ${up.padEnd(7)}: ${column(r.fill)}`);
    }
  }
  const hr = harmonic(lv, { cycles: 10 });
  console.log(`harmonic          : ${column(hr.fill)}`);
}
