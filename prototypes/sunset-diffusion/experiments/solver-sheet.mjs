// Contact sheet: the same seeds filled by each solver variant, with and
// without the post blur, to compare smoothness and artifacts by eye.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HERE } from '../lib/refs.mjs';
import { hconcat, vconcat, writePng } from '../lib/image.mjs';
import { renderRadiance, outputStage } from '../lib/pipeline.mjs';

const w = 360;
const h = 480;
const base = {
  colors: ['#0064E0', '#FFD61E', '#FF4F00', '#1FCDF0'],
  params: {
    seeds: [
      { kind: 'line', y: 0.0, width: 0.02, soft: 0.01, color: 0 },
      { kind: 'line', y: 0.62, width: 0.004, soft: 0.006, color: 2, warp: { amp: 0.04, freq: 1.2 } },
      { kind: 'blob', u: 0.75, v: 0.45, rx: 0.06, ry: 0.03, soft: 0.6, color: 1 },
      { kind: 'line', y: 1.0, width: 0.02, soft: 0.01, color: 0, gain: 0.35 },
    ],
  },
};

const variants = [
  ['pp g2 lin', { solver: 'pushpull', gain: 2, up: 'linear' }],
  ['pp g3 bsp', { solver: 'pushpull', gain: 3, up: 'bspline' }],
  ['pp g4 lin', { solver: 'pushpull', gain: 4, up: 'linear' }],
  ['pp g4 bsp', { solver: 'pushpull', gain: 4, up: 'bspline' }],
  ['harmonic', { solver: 'harmonic' }],
];

const rows = [];
for (const blur of [0, 0.02]) {
  const tiles = [];
  for (const [, v] of variants) {
    const scene = { ...base, params: { ...base.params, ...v, blur } };
    const { img } = renderRadiance(scene, w, h, { solver: v.solver });
    tiles.push({ w, h, data: outputStage(img, {}, 1) });
  }
  rows.push(hconcat(tiles, 8));
}
const sheet = vconcat(rows, 8);
const dir = join(HERE, 'out', 'experiments');
mkdirSync(dir, { recursive: true });
await writePng(join(dir, 'solver-sheet.png'), sheet.w, sheet.h, sheet.data);
console.log('columns:', variants.map((v) => v[0]).join(' | '), '; rows: blur 0, blur 0.02');
