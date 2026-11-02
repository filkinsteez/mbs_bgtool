// Step 4 check: the recommended filter on the riso test ramps at 925 px.
// Strength 1 should match the riso prints; 0.5 is the film default.
import fs from 'node:fs';
import path from 'node:path';
import { hexToLinear } from './lib/color.mjs';
import { ampCurve, grainParams, outputStage } from './lib/filter.mjs';
import { crop, readSrgb, writePng, writeSheet, zoomNearest } from './lib/image.mjs';
import { analyze } from './lib/measure.mjs';
import { renderRamp } from './lib/ramp.mjs';
import { HERE, OUT, refById } from './refs.mjs';

const DIR = path.join(OUT, 'recommend');
fs.mkdirSync(DIR, { recursive: true });
const presets = JSON.parse(fs.readFileSync(path.join(HERE, 'presets/riso-test-ramps.json'), 'utf8'));
const STRENGTHS = [0.5, 0.8, 1];

for (const s of [0.2, 0.4, 0.5, 0.6, 0.8, 1]) {
  const p = grainParams(s);
  const a = ampCurve(p);
  console.log(
    `strength ${s}: size ${(p.size * 1000).toFixed(3)}/1000 of short side, amp% at L .1/.2/.45/.65/.85/.95 =`,
    [0.1, 0.2, 0.45, 0.65, 0.85, 0.95].map((L) => (a(L) * 100).toFixed(2)).join(' '),
  );
}

const only = process.argv[2];
for (const [id, ramp] of Object.entries(presets.ramps)) {
  if (only && only !== id) continue;
  const ref = refById(id);
  const refImg = await readSrgb(ref.file);
  const { width: w, height: h } = ramp;
  const lin = renderRamp(w, h, ramp.stops.map((st) => ({ t: st.t, rgb: hexToLinear(st.hex) })));
  const variants = { reference: refImg };
  for (const s of STRENGTHS) variants[`strength ${s}`] = outputStage(lin, { strength: s, seed: 3, method: 'lattice' });
  for (const [name, img] of Object.entries(variants)) {
    if (name !== 'reference') await writePng(img, path.join(DIR, `${id}-${name.replace(/ /g, '-')}.png`));
    const res = analyze(img, { hpSigma: 6, rects: ref.rects, border: 24 });
    console.log(
      `${id} ${name.padEnd(12)} stdL=${(res.overall.stdL * 100).toFixed(2)} skew=${res.overall.skewL.toFixed(2)} hwhm=${res.acfL.hwhm} acf=${res.acfL.radial.slice(0, 5).join(',')} bins=${res.bins.map((b) => `${b.bin[0].toFixed(1)}:${(b.stdL * 100).toFixed(2)}`).join(' ')}`,
    );
  }
  for (const [zoom, size] of [
    [4, 40],
    [1, 160],
  ]) {
    const rows = Object.entries(variants).map(([name, img]) =>
      ref.spots.map((sp) => {
        const c = crop(img, Math.round(sp.fx * w) - size / 2, Math.round(sp.fy * h) - size / 2, size, size);
        return { img: zoom > 1 ? zoomNearest(c, zoom) : c, label: `${name}: ${sp.name}` };
      }),
    );
    await writeSheet(rows, path.join(DIR, `${id}-${zoom}x.png`), {
      title: `${id} ${zoom === 1 ? '1:1' : '4x'}: reference vs recommended filter`,
    });
  }
}
