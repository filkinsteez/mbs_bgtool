// Step 3: render the riso test ramps (generated from measured stop colours)
// with grain models (a)-(d), measure them like the references, and build
// side-by-side crop sheets: reference | no grain | a | b | c | d.
import fs from 'node:fs';
import path from 'node:path';
import { hexToLinear } from './lib/color.mjs';
import { dither, encodeOnly, filmGrain, jitterField, knotCurve, octaveGrain, risoGrain, smoothstep } from './lib/grain.mjs';
import { crop, readSrgb, writePng, writeSheet, zoomNearest } from './lib/image.mjs';
import { analyze } from './lib/measure.mjs';
import { renderRamp } from './lib/ramp.mjs';
import { HERE, OUT, refById } from './refs.mjs';

const DIR = path.join(OUT, 'models');
fs.mkdirSync(DIR, { recursive: true });
const presets = JSON.parse(fs.readFileSync(path.join(HERE, 'presets/riso-test-ramps.json'), 'utf8'));
const params = JSON.parse(fs.readFileSync(path.join(HERE, 'presets/grain-models.json'), 'utf8'));

// Amplitude over Oklab L: `paper` above lHi, `ink` below lLo, smooth between.
export function inkCurve({ paper, ink, lHi = 0.78, lLo = 0.45 }) {
  return (L) => paper + (ink - paper) * smoothstep(lHi, lLo, L);
}

function ampFrom(spec) {
  return spec.knots ? knotCurve(spec.knots) : inkCurve(spec);
}

const only = process.argv[2];
const results = {};

for (const [id, ramp] of Object.entries(presets.ramps)) {
  if (only && only !== id) continue;
  const ref = refById(id);
  const refImg = await readSrgb(ref.file);
  const { width: w, height: h } = ramp;
  const stops = ramp.stops.map((s) => ({ t: s.t, rgb: hexToLinear(s.hex) }));
  const lin = renderRamp(w, h, stops);
  const p = params.refs[id];
  const variants = {
    reference: refImg,
    'no grain': dither(encodeOnly(lin)),
    'a film': dither(filmGrain(lin, { sigma: p.film.sigma, amp: ampFrom(p.film.amp), seed: 11 })),
    'b octaves': dither(octaveGrain(lin, { octaves: p.octaves.octaves, amp: ampFrom(p.octaves.amp), seed: 12 })),
    'c riso': dither(risoGrain(lin, { ...p.riso, seed: 13 })),
    'd jitter': dither(
      encodeOnly(renderRamp(w, h, stops, jitterField(w, h, { jitterPx: p.jitter.jitterPx, sigma: p.jitter.sigma, seed: 14 }))),
    ),
  };
  results[id] = {};
  for (const [name, img] of Object.entries(variants)) {
    if (name !== 'reference') await writePng(img, path.join(DIR, `${id}-${name.replace(/ /g, '-')}.png`));
    const res = analyze(img, { hpSigma: 6, rects: ref.rects, border: 24 });
    results[id][name] = {
      stdL: +(res.overall.stdL * 100).toFixed(2),
      mono: +res.overall.monoShare.toFixed(2),
      skew: +res.overall.skewL.toFixed(2),
      hwhm: res.acfL.hwhm,
      acf: res.acfL.radial.slice(0, 5),
      bins: Object.fromEntries(res.bins.map((b) => [b.bin[0].toFixed(1), +(b.stdL * 100).toFixed(2)])),
      skewBins: Object.fromEntries(res.bins.map((b) => [b.bin[0].toFixed(1), +b.skewL.toFixed(2)])),
      octaves: res.octavesL.map((o) => +(o.std * 100).toFixed(2)),
    };
  }
  for (const [zoom, size, label] of [
    [4, 40, '4x'],
    [1, 160, '1:1'],
  ]) {
    const shown = Object.entries(variants).filter(([name]) => zoom === 1 || name !== 'no grain');
    const rows = shown.map(([name, img]) =>
      ref.spots.map((sp) => {
        const cx = Math.round(sp.fx * w);
        const cy = Math.round(sp.fy * h);
        const c = crop(img, cx - size / 2, cy - size / 2, size, size);
        return { img: zoom > 1 ? zoomNearest(c, zoom) : c, label: `${name}: ${sp.name}` };
      }),
    );
    await writeSheet(rows, path.join(DIR, `${id}-compare-${label === '4x' ? '4x' : '1x'}.png`), {
      title: `${id} ${label}: reference, then test ramp with no grain and models a-d`,
    });
  }
  console.log(`== ${id}`);
  for (const [name, r] of Object.entries(results[id])) {
    console.log(
      `${name.padEnd(10)} stdL=${r.stdL} mono=${r.mono} skew=${r.skew} hwhm=${r.hwhm} acf=${r.acf.join(',')} bins=${JSON.stringify(r.bins)} skewBins=${JSON.stringify(r.skewBins)} oct=${r.octaves.join(',')}`,
    );
  }
}
fs.writeFileSync(path.join(DIR, `metrics${only ? '-' + only : ''}.json`), JSON.stringify(results, null, 1));
