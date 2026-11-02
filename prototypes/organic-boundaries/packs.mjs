// Task 4: pack variations at 16:9 and 9:16 with several seeds, measured with the
// same boundary audit as the references. node packs.mjs [seeds...]
// Writes out/packs/<pack>-<aspect>-s<seed>.png, sheet-<pack>.jpg, iso-<pack>.jpg.

import fs from 'node:fs';
import path from 'node:path';
import { PROTO } from './lib/refs.mjs';
import { renderScene } from './lib/scene.mjs';
import { encode, canvasToLinear } from './lib/output.mjs';
import { saveCanvas, row, column, resizeCanvas, loadCanvas } from './lib/image.mjs';
import { rampCoordinate, measureBoundaries, summarize, EQUAL_LEVELS } from './lib/audit.mjs';
import { overlay } from './lib/draw.mjs';
import { productionScene, auditStops } from './lib/production.mjs';

const seeds = process.argv.slice(2).map(Number).filter(Boolean);
const SEEDS = seeds.length ? seeds : [1, 2, 3];
const ASPECTS = { '16x9': [1280, 720], '9x16': [720, 1280] };
const dir = path.join(PROTO, 'out/packs');
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const report = {};

for (const pack of ['bold', 'elemental', 'atmospheric']) {
  const tiles = { '16x9': [], '9x16': [] };
  const isoTiles = [];
  for (const seed of SEEDS) {
    for (const [asp, [w, h]] of Object.entries(ASPECTS)) {
      const scene = productionScene(pack, seed);
      const { img, guard } = renderScene(scene, w, h);
      const c = encode(img, {}, seed);
      await saveCanvas(c, path.join(dir, `${pack}-${asp}-s${seed}.png`));
      const cfg = { angle: 90, band: 0.4, window: null, stops: auditStops(scene) };
      const R = rampCoordinate(canvasToLinear(c), null, cfg, null, 4);
      const res = measureBoundaries(R.T, R.path, cfg);
      const s = summarize(res, w);
      report[`${pack}-${asp}-s${seed}`] = { guard, ...s };
      const bs = s.boundaries;
      console.log(
        `${pack} ${asp} seed ${seed}: guard ${f(guard.scale)}, wiggle ${bs.map((b) => f(b.wiggleRmsH)).join('/')} %H, range ${bs.map((b) => f(b.rangeH, 1)).join('/')} %H, width min/max ${bs.map((b) => f(b.width?.minOverMax)).join('/')}, adjacent corr ${f(s.adjacentCorrWiggle)}, spacing cv ${f(s.adjacentSpacingCv)}, folds ${f(s.foldShare * 100)}%`,
      );
      const th = 270;
      tiles[asp].push(await resizeCanvas(c, Math.round((w / h) * th), th));
      if (asp === '16x9' && seed === SEEDS[0]) isoTiles.push(await resizeCanvas(overlay(c, R.T, EQUAL_LEVELS, res.main), 640, 360));
    }
  }
  const sheet = await row([...tiles['16x9'], ...tiles['9x16']], { gap: 6, labels: [...SEEDS.map((s) => `${pack} 16:9 seed ${s}`), ...SEEDS.map((s) => `9:16 s${s}`)], labelSize: 13 });
  await saveCanvas(sheet, path.join(dir, `sheet-${pack}.jpg`));
  await saveCanvas(isoTiles[0], path.join(dir, `iso-${pack}.jpg`));
}
const sheets = [];
for (const pack of ['bold', 'elemental', 'atmospheric']) sheets.push(await loadCanvas(path.join(dir, `sheet-${pack}.jpg`)));
await saveCanvas(await column(sheets, { gap: 6 }), path.join(dir, 'packs.jpg'));
fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 1));
