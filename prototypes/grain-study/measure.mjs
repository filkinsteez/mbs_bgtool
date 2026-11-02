// Step 2: grain measurements on the references, the original riso scan and
// the deck's grain illustration. Writes out/measure/*.json and prints a
// summary. Lengths are reported in pixels at the 925 px reference width.
import fs from 'node:fs';
import path from 'node:path';
import { crop, readSrgb, rot90ccw } from './lib/image.mjs';
import { analyze, gridPeriodicity, highpass, powerSpectrum, spectrumSummary } from './lib/measure.mjs';
import { OUT, REFS, REPO, RISO_SCAN } from './refs.mjs';

const DIR = path.join(OUT, 'measure');
fs.mkdirSync(DIR, { recursive: true });

const fmt = (v, d = 2) => (v === undefined ? '-' : (+v).toFixed(d));

function report(name, res, scaleTo925, extra = {}) {
  const o = res.overall;
  const acf = res.acfL;
  const line = {
    name,
    kept: res.kept,
    stdL100: +(o.stdL * 100).toFixed(2),
    stdChroma100: +(Math.hypot(o.stdA, o.stdB) * 100).toFixed(2),
    monoShare: +o.monoShare.toFixed(2),
    skewL: +o.skewL.toFixed(2),
    exKurtL: +o.exKurtL.toFixed(2),
    acfHwhmPx925: +(acf.hwhm * scaleTo925).toFixed(2),
    acfHwhmXY925: [+(acf.hwhmX * scaleTo925).toFixed(2), +(acf.hwhmY * scaleTo925).toFixed(2)],
    blobSigma925: +(acf.blobSigma * scaleTo925).toFixed(2),
    acfChromaHwhm925: +(res.acfChroma.hwhm * scaleTo925).toFixed(2),
    ...extra,
  };
  return line;
}

function binsTable(res) {
  return res.bins.map((b) => ({
    L: `${b.bin[0].toFixed(1)}-${b.bin[1].toFixed(1)}`,
    n: b.n,
    stdL100: +(b.stdL * 100).toFixed(2),
    stdChroma100: +(Math.hypot(b.stdA, b.stdB) * 100).toFixed(2),
    mono: +b.monoShare.toFixed(2),
    skew: +b.skewL.toFixed(2),
    exKurt: +b.exKurtL.toFixed(2),
    rgb255: b.stdRGB ? b.stdRGB.map((v) => +(v * 255).toFixed(2)) : undefined,
    corrRG: b.corrRG !== undefined ? +b.corrRG.toFixed(2) : undefined,
    corrGB: b.corrGB !== undefined ? +b.corrGB.toFixed(2) : undefined,
  }));
}

function strongestGrid(L, mask, w, h, lo, hi, step) {
  const periods = [];
  for (let p = lo; p <= hi + 1e-9; p += step) periods.push(+p.toFixed(3));
  const g = gridPeriodicity(L, mask, w, h, periods);
  const byCol = [...g].sort((a, b) => b.col - a.col).slice(0, 3);
  const byRow = [...g].sort((a, b) => b.row - a.row).slice(0, 3);
  return { byCol, byRow };
}

const summary = [];
const only = process.argv[2];

// References at their screenshot or export resolution.
for (const ref of REFS) {
  if (only && ref.id !== only && only !== 'refs') continue;
  const img = await readSrgb(ref.file);
  const s925 = ref.figmaWidth / img.w;
  const rects = ref.rects.map(([x, y, w, h]) => [x / s925, y / s925, w / s925, h / s925].map(Math.round));
  const res = analyze(img, { hpSigma: 6 / s925, rects, border: Math.round(24 / s925) });
  const grid = strongestGrid(res.planes.L, res.mask, img.w, img.h, 6, 32, 0.25);
  const line = report(ref.id, res, s925, {
    gridCol: grid.byCol.map((g) => `${(g.period * s925).toFixed(2)}:${g.col}`).join(' '),
    gridRow: grid.byRow.map((g) => `${(g.period * s925).toFixed(2)}:${g.row}`).join(' '),
  });
  summary.push(line);
  const out = { ...line, bins: binsTable(res), acfL: res.acfL, acfChroma: res.acfChroma, octavesL: res.octavesL, octavesA: res.octavesA };
  if (ref.kind === 'poster') {
    const { L } = res.planes;
    const hp = highpass(L, img.w, img.h, 6).hp;
    out.spectrum = {
      greyBand: spectrumSummary(powerSpectrum(hp, img.w, 340, 560, 256), 256).peaks,
      blueBand: spectrumSummary(powerSpectrum(hp, img.w, 140, 250, 256), 256).peaks,
      red: spectrumSummary(powerSpectrum(hp, img.w, 340, 860, 128), 128).peaks,
    };
  }
  fs.writeFileSync(path.join(DIR, `${ref.id}.json`), JSON.stringify(out, null, 1));
}

// The original riso scan, each print measured at scan resolution.
if (!only || only === 'scan') {
  const scan = rot90ccw(await readSrgb(RISO_SCAN));
  for (const ref of REFS.filter((r) => r.source)) {
    const { s, ox, oy } = ref.source;
    const w = Math.floor(925 / s);
    const h = Math.floor(1448 / s);
    const sub = crop(scan, ox, oy, w, h);
    const rects = ref.rects.map(([x, y, rw, rh]) => [x / s, y / s, rw / s, rh / s].map(Math.round));
    const res = analyze(sub, { hpSigma: 6 / s, rects, border: Math.round(24 / s), structureThreshold: 0.012 });
    const grid = strongestGrid(res.planes.L, res.mask, w, h, 4, 20, 0.25);
    const line = report(`${ref.id} (scan)`, res, s, {
      scanAcfHwhmPx: res.acfL.hwhm,
      gridCol: grid.byCol.map((g) => `${g.period}:${g.col}`).join(' '),
      gridRow: grid.byRow.map((g) => `${g.period}:${g.row}`).join(' '),
    });
    summary.push(line);
    fs.writeFileSync(
      path.join(DIR, `${ref.id}-scan.json`),
      JSON.stringify({ ...line, bins: binsTable(res), acfL: res.acfL, octavesL: res.octavesL, octavesA: res.octavesA }, null, 1),
    );
  }
}

// The deck's own grain illustration (slide 44:204), 330 px tiles.
if (!only || only === 'deck') {
  const slide = await readSrgb(path.join(REPO, 'artifacts/brief-screens/slides/44-204-layers.png'));
  for (const [name, x] of [
    ['deck grain layer', 956],
    ['deck output', 1386],
    ['deck light layer', 526],
  ]) {
    const tile = crop(slide, x + 8, 308, 314, 314);
    const res = analyze(tile, { hpSigma: 6, border: 4, structureThreshold: 0 });
    const line = report(name, res, 1, {});
    summary.push(line);
    fs.writeFileSync(
      path.join(DIR, `${name.replace(/ /g, '-')}.json`),
      JSON.stringify({ ...line, bins: binsTable(res), acfL: res.acfL, octavesL: res.octavesL }, null, 1),
    );
  }
}

console.log(
  [
    'name | stdL% | chroma% | mono | skew | exKurt | ACF HWHM px@925 (x,y) | blob sigma | chroma HWHM | grid col | grid row',
    ...summary.map(
      (l) =>
        `${l.name} | ${fmt(l.stdL100)} | ${fmt(l.stdChroma100)} | ${fmt(l.monoShare)} | ${fmt(l.skewL)} | ${fmt(l.exKurtL)} | ${fmt(l.acfHwhmPx925)} (${l.acfHwhmXY925.join(', ')}) | ${fmt(l.blobSigma925)} | ${fmt(l.acfChromaHwhm925)} | ${l.gridCol ?? ''} | ${l.gridRow ?? ''}`,
    ),
  ].join('\n'),
);
fs.writeFileSync(path.join(DIR, 'summary.json'), JSON.stringify(summary, null, 1));
