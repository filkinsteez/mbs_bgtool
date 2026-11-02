// Compares the two ways to build the grain field: blurred white noise at
// output size versus B-spline lattice noise in picture-relative
// coordinates. Checks statistics and whether the preview and the export
// show the same clumps.
import fs from 'node:fs';
import path from 'node:path';
import { hexToLinear } from './lib/color.mjs';
import { outputStage } from './lib/filter.mjs';
import { crop, resizeSrgb, writeSheet, zoomNearest } from './lib/image.mjs';
import { analyze, highpass, oklabPlanes } from './lib/measure.mjs';
import { PACKS } from './lib/packs.mjs';
import { renderAngledRamp } from './lib/ramp.mjs';
import { OUT } from './refs.mjs';

const DIR = path.join(OUT, 'lattice');
fs.mkdirSync(DIR, { recursive: true });
const stops = PACKS.atmospheric.map((hex, i, a) => ({ t: i / (a.length - 1), rgb: hexToLinear(hex) }));
const big = renderAngledRamp(3840, 2160, stops, 0.25);
const small = renderAngledRamp(960, 540, stops, 0.25);

const rows = [];
for (const strength of [0.5, 1]) {
  for (const method of ['blur', 'lattice']) {
    const exp = outputStage(big, { strength, seed: 4, method });
    const pre = outputStage(small, { strength, seed: 4, method });
    const region = { fx: 0.52, fy: 0.62, fw: 0.06, fh: 0.08 };
    const pc = crop(pre, Math.round(region.fx * 960), Math.round(region.fy * 540), Math.round(region.fw * 960), Math.round(region.fh * 540));
    const ec = crop(exp, Math.round(region.fx * 3840), Math.round(region.fy * 2160), Math.round(region.fw * 3840), Math.round(region.fh * 2160));
    const ecSmall = await resizeSrgb(ec, pc.w, pc.h, 'lanczos3');
    const m = analyze(crop(exp, 1900, 1200, 600, 600), { hpSigma: 6 * (2160 / 925), border: 8, structureThreshold: 0, maxLag: 8 });
    const a = highpass(oklabPlanes(pc).L, pc.w, pc.h, 4).hp;
    const b = highpass(oklabPlanes(ecSmall).L, pc.w, pc.h, 4).hp;
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    for (let i = 0; i < a.length; i++) {
      sab += a[i] * b[i];
      saa += a[i] * a[i];
      sbb += b[i] * b[i];
    }
    console.log(
      `strength ${strength} ${method}: export crop stdL=${(m.overall.stdL * 100).toFixed(2)} hwhm=${m.acfL.hwhm} acf=${m.acfL.radial.slice(0, 7).join(',')} | preview vs shrunk export, same area, pixel correlation r=${(sab / Math.sqrt(saa * sbb)).toFixed(2)}`,
    );
    rows.push([
      { img: zoomNearest(pc, 4), label: `s${strength} ${method}: preview 960, 4x` },
      { img: zoomNearest(ecSmall, 4), label: `same area of 3840 export, shrunk, 4x` },
      { img: zoomNearest(crop(ec, 60, 60, 60, 60), 4), label: `export 100% detail, 4x` },
    ]);
  }
}
await writeSheet(rows, path.join(DIR, 'blur-vs-lattice.png'), {
  title: 'Grain field: blurred white noise vs picture-relative lattice noise (preview vs export, same area)',
});
