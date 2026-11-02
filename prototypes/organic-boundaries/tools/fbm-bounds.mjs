// RMS, largest value and largest vertical slope of the boundary warp's 2D term
// for fixed octave settings, so the fold guard can use measured numbers.
// Slopes are per unit of the first octave's vertical lattice.

import { gradientNoise } from '../lib/noise.mjs';

function stats(octaves, gain, lacX, lacY) {
  const ow = Array.from({ length: octaves }, (_, o) => gain ** o);
  const f = (x, y, seed) => {
    let s = 0;
    let fx = 1;
    let fy = 1;
    for (let o = 0; o < octaves; o++) {
      s += ow[o] * gradientNoise(x * fx + 1.7 * o + 0.13, y * fy + 3.3 * o + 0.71, seed + 131 * (o + 1));
      fx *= lacX;
      fy *= lacY;
    }
    return s;
  };
  let s2 = 0;
  let vmax = 0;
  let dmax = 0;
  let d2 = 0;
  const e = 1e-4;
  let n = 0;
  for (let seed = 1; seed <= 4; seed++) {
    for (let i = 0; i < 600000; i++) {
      const x = (i * 0.6180339887 + seed * 0.37) % 300;
      const y = (i * 0.7548776662 + seed * 0.11) % 300;
      const v = f(x, y, seed);
      const d = (f(x, y + e, seed) - f(x, y - e, seed)) / (2 * e);
      s2 += v * v;
      d2 += d * d;
      vmax = Math.max(vmax, Math.abs(v));
      dmax = Math.max(dmax, Math.abs(d));
      n++;
    }
  }
  const rms = Math.sqrt(s2 / n);
  return { octaves, gain, lacX, lacY, rms: +rms.toFixed(4), maxOverRms: +(vmax / rms).toFixed(3), slopeMaxOverRms: +(dmax / rms).toFixed(3), slopeRmsOverRms: +(Math.sqrt(d2 / n) / rms).toFixed(3) };
}

for (const s of [[1, 0.5, 2, 1.5], [2, 0.5, 2, 1.5], [3, 0.5, 2, 1.5], [2, 0.45, 2.1, 1.6], [3, 0.45, 2.1, 1.6]]) console.log(JSON.stringify(stats(...s)));
