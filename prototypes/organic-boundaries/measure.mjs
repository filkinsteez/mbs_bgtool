// Task 1: boundary geometry of the Sunset references.
// node measure.mjs [id ...] [--blur 6]
// Writes out/measure/<id>/{overlay,lines,tmap}.png and metrics.json, and
// out/measure/summary.json.

import fs from 'node:fs';
import path from 'node:path';
import { loadReference, PROTO } from './lib/refs.mjs';
import { canvasFromLinear, saveCanvas, row } from './lib/image.mjs';
import { rampCoordinate, measureBoundaries, summarize, EQUAL_LEVELS } from './lib/audit.mjs';
import { overlay, linesPlot, tMap } from './lib/draw.mjs';
import { SUNSET, SUNSET_IDS } from './lib/config.mjs';
import { oklabToHex } from './lib/color.mjs';

const args = process.argv.slice(2);
const blurAt = args.indexOf('--blur');
const blur = blurAt >= 0 ? Number(args[blurAt + 1]) : 6;
const raw = args.includes('--raw');
const ids = args.filter((a, i) => !a.startsWith('--') && (blurAt < 0 || i !== blurAt + 1));
const suffix = (blur === 6 ? '' : `-blur${blur}`) + (raw ? '-raw' : '');
const list = ids.length ? ids : SUNSET_IDS;
const outRoot = path.join(PROTO, 'out/measure');

const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');

const summary = {};
for (const id of list) {
  const cfg = SUNSET[id];
  const ref = await loadReference(id);
  const t0 = Date.now();
  const { T, path: p, gain } = rampCoordinate(ref.img, ref.mask, cfg, null, blur, raw ? { removeGain: false } : {});
  const res = measureBoundaries(T, p, cfg);
  const sum = summarize(res, ref.img.w);
  sum.h = ref.img.h;
  if (gain) sum.gain = { left: gain.left, right: gain.right };
  const dir = path.join(outRoot, id + suffix);
  const base = canvasFromLinear(ref.img);
  const ov = overlay(base, T, EQUAL_LEVELS, res.main);
  const lp = linesPlot(T, EQUAL_LEVELS, res.main);
  await saveCanvas(ov, path.join(dir, 'overlay.png'));
  await saveCanvas(lp, path.join(dir, 'lines.png'));
  await saveCanvas(tMap(T), path.join(dir, 'tmap.png'));
  const sheet = await row([base, ov, lp], { labels: [id, 'isolines', 'isolines alone (10-90 shaded)'] });
  await saveCanvas(sheet, path.join(dir, 'sheet.jpg'), { width: Math.min(sheet.w, 2000) });
  const pathHex = p.lab.filter((_, i) => i % 20 === 0).map(oklabToHex);
  fs.writeFileSync(
    path.join(dir, 'metrics.json'),
    JSON.stringify(
      {
        id,
        blur,
        path: { angle: p.angle, band: p.band, lengthOklab: p.total, every20: pathHex },
        summary: sum,
        main: res.main.map((m) => ({ name: m.name, t10: m.t10, t50: m.t50, t90: m.t90, geom: m.geom && { ...m.geom, resid: undefined, xs: undefined }, width: m.width, finePx: m.fine })),
        equal: res.equal.map((e) => ({ level: e.level, geom: e.geom && { ...e.geom, resid: undefined, xs: undefined } })),
        pairs: res.pairs,
        adjacent: res.adjacent,
      },
      null,
      1,
    ),
  );
  summary[id] = sum;
  const gainNote = gain ? `, gain removed ${f(gain.left, 2)} left / ${f(gain.right, 2)} right` : '';
  console.log(`\n${id}  (${ref.img.w}x${ref.img.h}, path ${f(p.total, 3)} Oklab, ${Date.now() - t0} ms, fold share ${f(sum.foldShare * 100, 2)}%${gainNote})`);
  console.log('  boundary                     meanH  rangeH  tiltH  bowH  wigRMS  dominant(lambdaW:ampH)        width%H  min/max  cv    varLW  fine');
  for (const b of sum.boundaries) {
    const dom = b.dominant.map((d) => `${d.lambdaW}:${d.ampH}`).join(' ');
    console.log(
      `  ${b.name.padEnd(28)} ${f(b.meanH).padStart(5)} ${f(b.rangeH).padStart(6)} ${f(b.tiltH).padStart(6)} ${f(b.bowH).padStart(5)} ${f(b.wiggleRmsH, 2).padStart(6)}  ${dom.padEnd(29)} ${f(b.width?.meanH).padStart(6)}  ${f(b.width?.minOverMax, 2).padStart(5)}  ${f(b.width?.cv, 2)}  ${f(b.width?.varLambdaW, 2)}  ${f(b.finePx, 1)}px ${f(b.finePctWidth, 1)}%`,
    );
  }
  console.log('  adjacent pairs: ' + res.adjacent.filter(Boolean).map((a) => `sep ${f(a.sepH)} corrW ${f(a.corrWiggle, 2)} corrF ${f(a.corrFull, 2)} spCV ${f(a.spacingCv, 2)}`).join(' | '));
  console.log(`  vertical corr length ${f(sum.vertCorrLenH)}% H, horizontal ${f(sum.horizCorrLenW, 3)} W`);
}
fs.mkdirSync(outRoot, { recursive: true });
if (!ids.length) fs.writeFileSync(path.join(outRoot, `summary${suffix}.json`), JSON.stringify(summary, null, 1));
