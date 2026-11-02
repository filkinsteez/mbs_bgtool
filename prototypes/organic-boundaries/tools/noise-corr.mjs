// Correlation of gradientNoise with itself at a vertical lag d (lattice units),
// so a measured half-correlation distance can be turned into a lattice size.

import { gradientNoise } from '../lib/noise.mjs';

const lags = [0.1, 0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.8, 1.0, 1.5];
const out = {};
for (const d of lags) {
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < 400000; i++) {
    const x = (i * 0.6180339) % 200;
    const y = (i * 0.4142135) % 200;
    const a = gradientNoise(x, y, 3);
    const b = gradientNoise(x, y + d, 3);
    sab += a * b;
    saa += a * a;
    sbb += b * b;
  }
  out[d] = +(sab / Math.sqrt(saa * sbb)).toFixed(3);
}
console.log(JSON.stringify(out));
