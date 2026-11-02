// Largest value and largest slope of the engine's gradientNoise, sampled densely.
// The fold guard in lib/boundary.mjs uses these two numbers.

import { gradientNoise } from '../lib/noise.mjs';

let vmax = 0;
let dmax = 0;
let dxmax = 0;
let s2 = 0;
let d2 = 0;
let n = 0;
const e = 1e-4;
for (let seed = 1; seed <= 6; seed++) {
  for (let i = 0; i < 700000; i++) {
    const x = (Math.sin(i * 12.9898 + seed) * 43758.5453) % 64;
    const y = (Math.sin(i * 78.233 + seed * 3.1) * 12345.678) % 64;
    const v = gradientNoise(x, y, seed);
    const dy = (gradientNoise(x, y + e, seed) - gradientNoise(x, y - e, seed)) / (2 * e);
    const dx = (gradientNoise(x + e, y, seed) - gradientNoise(x - e, y, seed)) / (2 * e);
    vmax = Math.max(vmax, Math.abs(v));
    dmax = Math.max(dmax, Math.abs(dy));
    dxmax = Math.max(dxmax, Math.abs(dx));
    s2 += v * v;
    d2 += dy * dy;
    n++;
  }
}
console.log(
  JSON.stringify({
    maxValue: vmax,
    rmsValue: Math.sqrt(s2 / n),
    maxSlopeY: dmax,
    maxSlopeX: dxmax,
    rmsSlopeY: Math.sqrt(d2 / n),
  }),
);
