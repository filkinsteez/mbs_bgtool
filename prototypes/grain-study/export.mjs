// Step 5: 3840x2160 exports with the recommended grain, viewed at 100%
// (crops) and at 25% (the whole export shrunk 4x), next to a 960x540
// preview rendered directly. Also a fixed per-pixel grain for contrast, and
// a dark-gradient banding check.
import fs from 'node:fs';
import path from 'node:path';
import { hexToLinear } from './lib/color.mjs';
import { outputStage } from './lib/filter.mjs';
import { dither, encodeOnly, filmGrain } from './lib/grain.mjs';
import { crop, makeImage, resizeSrgb, writePng, writeSheet, zoomNearest } from './lib/image.mjs';
import { analyze } from './lib/measure.mjs';
import { PACKS } from './lib/packs.mjs';
import { renderAngledRamp } from './lib/ramp.mjs';
import { OUT } from './refs.mjs';

const DIR = path.join(OUT, 'export');
fs.mkdirSync(DIR, { recursive: true });

const stopsOf = (hexes) => hexes.map((hex, i) => ({ t: i / (hexes.length - 1), rgb: hexToLinear(hex) }));
const ATMOS = stopsOf(PACKS.atmospheric);
const ANGLE = 0.25;

function measureStd(img) {
  const res = analyze(img, { hpSigma: 6, border: 16, structureThreshold: 0, maxLag: 4 });
  return {
    stdL: +(res.overall.stdL * 100).toFixed(2),
    hwhm: res.acfL.hwhm,
    bins: res.bins.map((b) => `${b.bin[0].toFixed(1)}:${(b.stdL * 100).toFixed(2)}`).join(' '),
  };
}

const t0 = Date.now();
const big = renderAngledRamp(3840, 2160, ATMOS, ANGLE);
const small = renderAngledRamp(960, 540, ATMOS, ANGLE);
console.log('ramps', Date.now() - t0, 'ms');

const cases = [
  { name: 'film 0.5', make: (lin) => outputStage(lin, { strength: 0.5, seed: 5 }) },
  { name: 'riso 1.0', make: (lin) => outputStage(lin, { strength: 1, seed: 5 }) },
  {
    name: 'per-pixel 1.25%',
    make: (lin) => dither(filmGrain(lin, { sigma: 0.5, amp: () => 0.0125, seed: 5 })),
  },
];

const spots = [
  { name: 'blue', fx: 0.12, fy: 0.1 },
  { name: 'ice', fx: 0.3, fy: 0.3 },
  { name: 'steel', fx: 0.55, fy: 0.62 },
  { name: 'near-black', fx: 0.85, fy: 0.92 },
];

for (const c of cases) {
  const tag = c.name.replace(/[ .%]/g, '');
  const t1 = Date.now();
  const exp = c.make(big);
  const pre = c.make(small);
  await writePng(exp, path.join(DIR, `atmospheric-3840-${tag}.png`));
  const quarter = await resizeSrgb(exp, 960, 540, 'lanczos3');
  console.log(c.name, 'render', Date.now() - t1, 'ms');
  const mq = measureStd(quarter);
  const mp = measureStd(pre);
  console.log(`  preview 960 direct: stdL=${mp.stdL} hwhm=${mp.hwhm} bins ${mp.bins}`);
  console.log(`  export shrunk 25%:  stdL=${mq.stdL} hwhm=${mq.hwhm} bins ${mq.bins}`);
  const cropRow = spots.map((sp) => ({
    img: crop(exp, Math.round(sp.fx * 3840) - 160, Math.round(sp.fy * 2160) - 160, 320, 320),
    label: `export 100%: ${sp.name}`,
  }));
  const zoomRow = spots.map((sp) => ({
    img: zoomNearest(crop(exp, Math.round(sp.fx * 3840) - 40, Math.round(sp.fy * 2160) - 40, 80, 80), 4),
    label: `export 400%: ${sp.name}`,
  }));
  await writeSheet([cropRow, zoomRow], path.join(DIR, `atmospheric-${tag}-100.png`), {
    title: `Atmospheric ramp 3840x2160, ${c.name}: export crops at 100% and 400%`,
  });
  await writeSheet(
    [
      [
        { img: pre, label: 'preview rendered at 960x540' },
        { img: quarter, label: 'export 3840 shrunk to 25% (lanczos)' },
      ],
    ],
    path.join(DIR, `atmospheric-${tag}-25.png`),
    { title: `${c.name}: whole image, preview vs export at 25%` },
  );
  const pz = spots.map((sp) => ({
    img: zoomNearest(crop(pre, Math.round(sp.fx * 960) - 40, Math.round(sp.fy * 540) - 40, 80, 80), 3),
    label: `preview 300%: ${sp.name}`,
  }));
  const qz = spots.map((sp) => ({
    img: zoomNearest(crop(quarter, Math.round(sp.fx * 960) - 40, Math.round(sp.fy * 540) - 40, 80, 80), 3),
    label: `export@25% 300%: ${sp.name}`,
  }));
  await writeSheet([pz, qz], path.join(DIR, `atmospheric-${tag}-25-zoom.png`), {
    title: `${c.name}: preview vs export shrunk to 25%, crops zoomed 3x`,
  });
}

// Dark gradient: Atmospheric Slate -> Near-black -> black over 3840 px.
// Shown with a contrast stretch (x6 around the mean) so banding is visible.
const darkStops = [
  { t: 0, rgb: hexToLinear('#384753') },
  { t: 0.45, rgb: hexToLinear('#1C2B33') },
  { t: 1, rgb: [0, 0, 0] },
];
const dark = renderAngledRamp(3840, 2160, darkStops, Math.PI / 2);
const darkCases = [
  ['no dither, no grain', encodeOnly(dark)],
  ['dither only', dither(encodeOnly(dark))],
  ['grain 0.5', outputStage(dark, { strength: 0.5, seed: 9 })],
  ['grain 1.0', outputStage(dark, { strength: 1, seed: 9 })],
];
const stretch = (img) => {
  const q = makeImage(img.w, img.h);
  let m = 0;
  for (let i = 0; i < img.d.length; i++) m += Math.round(img.d[i] * 255) / 255;
  m /= img.d.length;
  for (let i = 0; i < img.d.length; i++) q.d[i] = 0.5 + (Math.round(img.d[i] * 255) / 255 - m) * 6;
  return q;
};
const darkRows = [];
for (const [name, img] of darkCases) {
  await writePng(img, path.join(DIR, `dark-3840-${name.replace(/[ ,.]/g, '')}.png`));
  const seg = crop(img, 2600, 900, 900, 160);
  darkRows.push([
    { img: stretch(seg), label: `${name}: 100% crop, contrast x6` },
    { img: stretch(await resizeSrgb(crop(img, 2600, 900, 900, 160), 225, 40, 'lanczos3')), label: '25%, x6' },
  ]);
}
await writeSheet(darkRows, path.join(DIR, 'dark-gradient-banding.png'), {
  title: 'Slate to black over 3840 px (code values about 0-30): banding check',
});
console.log('done', Date.now() - t0, 'ms');
