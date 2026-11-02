// General check: the recommended grain on simple linear-light ramps of the
// three packs (pack order), 16:9 and 9:16, two seeds, strengths 0.5 and 1.
// Also checks that grain leaves the mean colour alone (patch-mean Oklab
// difference against the same ramp without grain).
import fs from 'node:fs';
import path from 'node:path';
import { hexToLinear } from './lib/color.mjs';
import { outputStage } from './lib/filter.mjs';
import { crop, resizeSrgb, writePng, writeSheet, zoomNearest } from './lib/image.mjs';
import { oklabPlanes } from './lib/measure.mjs';
import { PACKS } from './lib/packs.mjs';
import { renderAngledRamp } from './lib/ramp.mjs';
import { OUT } from './refs.mjs';

const DIR = path.join(OUT, 'packs');
fs.mkdirSync(DIR, { recursive: true });

const stopsOf = (hexes) => hexes.map((hex, i) => ({ t: i / (hexes.length - 1), rgb: hexToLinear(hex) }));

function meanShift(a, b, w, h, cell = 64) {
  const A = oklabPlanes(a);
  const B = oklabPlanes(b);
  let worst = 0;
  let sum = 0;
  let n = 0;
  for (let y0 = 0; y0 + cell <= h; y0 += cell) {
    for (let x0 = 0; x0 + cell <= w; x0 += cell) {
      const m = [0, 0, 0, 0, 0, 0];
      for (let y = y0; y < y0 + cell; y++) {
        for (let x = x0; x < x0 + cell; x++) {
          const i = y * w + x;
          m[0] += A.L[i];
          m[1] += A.A[i];
          m[2] += A.B[i];
          m[3] += B.L[i];
          m[4] += B.A[i];
          m[5] += B.B[i];
        }
      }
      const k = cell * cell;
      const d = Math.hypot((m[0] - m[3]) / k, (m[1] - m[4]) / k, (m[2] - m[5]) / k) * 100;
      worst = Math.max(worst, d);
      sum += d;
      n++;
    }
  }
  return { mean: +(sum / n).toFixed(3), worst: +(worst ** 1).toFixed(3) };
}

const SIZES = [
  [1920, 1080],
  [1080, 1920],
];
const full = [];
const zooms = [];
for (const [pack, hexes] of Object.entries(PACKS)) {
  const stops = stopsOf(hexes);
  for (const [w, h] of SIZES) {
    const lin = renderAngledRamp(w, h, stops, 0.12);
    const clean = outputStage(lin, { strength: 0, seed: 1 });
    for (const [s, seed] of [
      [0.5, 1],
      [0.5, 2],
      [1, 1],
    ]) {
      const img = outputStage(lin, { strength: s, seed });
      const tag = `${pack}-${w}x${h}-s${s}-seed${seed}`;
      await writePng(img, path.join(DIR, `${tag}.png`));
      const shift = meanShift(img, clean, w, h);
      console.log(`${tag}: mean colour shift per 64px patch, Oklab x100: mean ${shift.mean}, worst ${shift.worst}`);
      if (seed === 1) {
        const thumbW = w > h ? 480 : 270;
        const thumbH = w > h ? 270 : 480;
        full.push({ img: await resizeSrgb(img, thumbW, thumbH, 'lanczos3'), label: `${pack} ${w}x${h} s${s} (25%)` });
        const n = hexes.length;
        zooms.push(
          hexes.map((hex, k) => {
            const t = k / (n - 1);
            const cx = Math.round(w * (0.35 + 0.3 * t));
            const cy = Math.round(Math.min(h - 41, Math.max(40, t * h)));
            return { img: zoomNearest(crop(img, cx - 40, cy - 40, 80, 80), 2), label: `${pack} ${w > h ? '16:9' : '9:16'} s${s} ${hex} 2x` };
          }),
        );
      }
    }
  }
}
const landscape = full.filter((t) => t.img.w > t.img.h);
const portrait = full.filter((t) => t.img.w < t.img.h);
await writeSheet([landscape.slice(0, 2), landscape.slice(2, 4), landscape.slice(4, 6)], path.join(DIR, 'packs-16x9.png'), {
  title: 'Pack ramps 1920x1080 with grain, strength 0.5 and 1 (shown at 25%)',
});
await writeSheet([portrait.slice(0, 6)], path.join(DIR, 'packs-9x16.png'), {
  title: 'Pack ramps 1080x1920 with grain, strength 0.5 and 1 (shown at 25%)',
});
await writeSheet(zooms.filter((_, i) => i % 4 < 2), path.join(DIR, 'packs-zoom-16x9.png'), {
  title: 'Pack ramps 1920x1080, strength 0.5 and 1, crops at each pack colour, 2x',
});
