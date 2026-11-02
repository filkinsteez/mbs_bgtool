// Tone curve check: each color ramped from 0 to 6x nominal (log scale) for a
// few spill settings, plus the lightness slope along each ramp (a ring shows
// as a step in the slope). Writes out/tonetest.png and out/tonetest-slope.png.
import { join } from 'node:path';
import { hexToLinear, linearToOklab, linearToSrgb } from './lib/color.mjs';
import { saveBytes } from './lib/image.mjs';
import { toneMap } from './lib/output.mjs';
import { makeCanvas, panel } from './lib/plot.mjs';
import { PROTO } from './lib/refs.mjs';

const colors = ['#0064E0', '#1FCDF0', '#FFD61E', '#FF4F00', '#D6F26C', '#B8996E', '#F2A27A', '#7A3FD0'];
const spills = [0, 1, 2];
const w = 900;
const rowH = 28;
const h = colors.length * spills.length * rowH + (spills.length - 1) * 12;
const bytes = new Uint8Array(w * h * 3).fill(255);
const stops = (x) => Math.pow(2, -3 + (x / (w - 1)) * (3 + Math.log2(6)));
const slopeSeries = [];
spills.forEach((spill, si) => {
  colors.forEach((hex, ci) => {
    const c = hexToLinear(hex);
    const y0 = si * (colors.length * rowH + 12) + ci * rowH;
    const Ls = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const k = stops(x);
      const t = toneMap(c[0] * k, c[1] * k, c[2] * k, spill);
      Ls[x] = linearToOklab(...t)[0];
      const px = t.map((v) => Math.round(Math.min(1, linearToSrgb(v)) * 255));
      for (let y = y0; y < y0 + rowH - 4; y++) bytes.set(px, (y * w + x) * 3);
    }
    if (si === spills.length - 1 || si === 0) {
      const sl = new Float32Array(w).fill(NaN);
      for (let x = 2; x < w - 2; x++) sl[x] = (Ls[x + 2] - Ls[x - 2]) * 60;
      const rgb = hexToLinear(hex).map((v) => Math.round(linearToSrgb(v) * 200));
      slopeSeries.push({ values: sl, color: rgb, dashed: si === 0 });
    }
  });
});
await saveBytes(bytes, w, h, join(PROTO, 'out', 'tonetest.png'));
const cv = makeCanvas(w, 300);
panel(cv, 0, 300, slopeSeries, -0.2, 1.4, [0, 0.5, 1]);
await saveBytes(cv.bytes, cv.w, cv.h, join(PROTO, 'out', 'tonetest-slope.png'));
console.log('1x nominal is at x =', Math.round(((3) / (3 + Math.log2(6))) * (w - 1)));
