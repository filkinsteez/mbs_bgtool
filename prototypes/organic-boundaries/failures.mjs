// Task 3: failure modes, each next to the working model, from one Bold scene.
// node failures.mjs  ->  out/failures/<name>.jpg and out/failures/failures.jpg

import path from 'node:path';
import { PROTO } from './lib/refs.mjs';
import { renderScene } from './lib/scene.mjs';
import { encode, canvasToLinear } from './lib/output.mjs';
import { saveCanvas, row, column, resizeCanvas } from './lib/image.mjs';
import { rampCoordinate, measureBoundaries, summarize, EQUAL_LEVELS } from './lib/audit.mjs';
import { overlay, linesPlot } from './lib/draw.mjs';
import { productionScene, auditStops } from './lib/production.mjs';

const W = 960;
const H = 540;
const dir = path.join(PROTO, 'out/failures');
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-');

const good = () => productionScene('bold', 2);
const withBoundary = (patch) => {
  const s = good();
  s.boundary = { ...s.boundary, ...patch };
  return s;
};

const CASES = [
  {
    name: 'folds',
    title: 'isolines cross: guard off, big independent warp',
    scene: () => withBoundary({ wander: [[0, 0.05], [1, 0.05]], share: 0, lyMode: undefined, ly: 0.06, scale: 0.3, slopeBudget: 1e9 }),
  },
  {
    name: 'too-fine',
    title: 'frequency too high: marble and smoke',
    scene: () => withBoundary({ wander: [[0, 0.012], [1, 0.012]], share: 0, lyMode: undefined, ly: 0.05, scale: 0.035, octaves: 3, gain: 0.6, slopeBudget: 1e9 }),
  },
  {
    name: 'sine',
    title: 'uniform waviness: one wavelength, one amplitude',
    scene: () => withBoundary({ sine: { wavelength: 0.45 }, share: 1, wander: [[0, 0.018], [1, 0.018]], alongMod: { amount: 0 } }),
  },
  {
    name: 'blobs',
    title: 'warp visible as blobs: wander large for its wavelength',
    scene: () => withBoundary({ wander: [[0, 0.045], [1, 0.03]], scale: 0.12, sharedScale: 0.12, clip: 0, octaves: 1, alongMod: { amount: 0 }, slopeBudget: 1e9 }),
  },
  {
    name: 'stamped',
    title: 'all boundaries wiggle together',
    scene: () => withBoundary({ share: 1, wander: [[0, 0.02], [1, 0.02]] }),
  },
  {
    name: 'too-even',
    title: 'edges too even: one softness everywhere',
    scene: () => {
      const s = withBoundary({ share: 1, wander: [[0, 0.012], [1, 0.012]], soft: { amount: 0 } });
      s.stops = s.stops.map((st) => ({ ...st, width: 0.16 }));
      return s;
    },
  },
];

async function panel(scene, label) {
  const { img } = renderScene(scene, W, H);
  const c = encode(img, {}, scene.seed);
  const cfg = { angle: 90, band: 0.4, window: null, stops: auditStops(scene) };
  const R = rampCoordinate(canvasToLinear(c), null, cfg, null, 3);
  const res = measureBoundaries(R.T, R.path, cfg);
  const s = summarize(res, W);
  const tiles = [c, overlay(c, R.T, EQUAL_LEVELS, res.main), linesPlot(R.T, EQUAL_LEVELS, res.main)];
  const small = [];
  for (const t of tiles) small.push(await resizeCanvas(t, 480, 270));
  return { canvas: await row(small, { labels: [label, 'isolines', 'isolines alone'], labelSize: 14, gap: 4 }), s };
}

const goodPanel = await panel(good(), 'model (Bold, seed 2)');
const sheets = [];
const describe = (s) => {
  const b = s.boundaries;
  const maxDom = b.map((x) => {
    const tot = Object.values(x.bands).reduce((q, v) => q + v * v, 0);
    return tot ? (x.dominant[0]?.ampH ?? 0) ** 2 / 2 / tot : 0;
  });
  return `folds ${f(s.foldShare * 100)}%, wiggle ${b.map((x) => f(x.wiggleRmsH)).join('/')} %H, main wavelength ${b.map((x) => f(x.dominant[0]?.lambdaW)).join('/')} W, top component share ${maxDom.map((v) => f(v)).join('/')}, adjacent corr ${f(s.adjacentCorrWiggle)}, width min/max ${b.map((x) => f(x.width?.minOverMax)).join('/')}, fine ${b.map((x) => f(x.finePctWidth, 1)).join('/')}% of width`;
};
console.log(`model: ${describe(goodPanel.s)}`);
for (const c of CASES) {
  const p = await panel(c.scene(), c.title);
  console.log(`${c.name}: ${describe(p.s)}`);
  const sheet = await column([p.canvas, goodPanel.canvas], { gap: 6 });
  await saveCanvas(sheet, path.join(dir, `${c.name}.jpg`));
  sheets.push(p.canvas);
}
await saveCanvas(await column([...sheets, goodPanel.canvas], { gap: 6 }), path.join(dir, 'failures.jpg'));
