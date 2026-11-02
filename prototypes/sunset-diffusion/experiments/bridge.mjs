// Bridge light on/off: a Meta Blue -> orange-red pair of strokes with no
// other seeds, filled in linear light, with bridge amounts 0, 0.5, 1. Prints
// Oklab L down the middle column and writes a side-by-side image.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { HERE } from '../lib/refs.mjs';
import { hconcat, writePng } from '../lib/image.mjs';
import { renderRadiance, outputStage } from '../lib/pipeline.mjs';
import { linearToOklab } from '../lib/color.mjs';

const w = 240;
const h = 480;
const pairs = [
  ['#0064E0', '#FF4F00'],
  ['#1FCDF0', '#FFD61E'],
];
const tiles = [];
for (const [a, b] of pairs) {
  for (const amount of (process.env.BA ?? '0,0.5,1').split(',').map(Number)) {
    const scene = {
      colors: [],
      params: {
        solver: 'harmonic',
        pad: 0.1,
        seeds: [
          { kind: 'line', y: 0.1, width: 0.004, soft: 0.004, color: a },
          { kind: 'line', y: 0.9, width: 0.004, soft: 0.004, color: b },
        ],
        bridge: { amount, color: process.env.BC ?? '#FFFFFF', blur: 0.01, mode: process.env.BM, lift: Number(process.env.BL ?? 0.15) },
        blur: 0.005,
      },
    };
    const { img } = renderRadiance(scene, w, h, { solveScale: 0.5 });
    const Ls = [];
    for (let k = 1; k <= 9; k++) {
      const i = Math.floor((k / 10) * h) * w + w / 2;
      Ls.push(linearToOklab(img.ch[0][i], img.ch[1][i], img.ch[2][i])[0].toFixed(2));
    }
    console.log(`${a} -> ${b} bridge ${amount}: L at v=0.1..0.9: ${Ls.join(' ')}`);
    tiles.push({ w, h, data: outputStage(img, {}, 1) });
  }
}
const dir = join(HERE, 'out', 'experiments');
mkdirSync(dir, { recursive: true });
const sheet = hconcat(tiles, 8);
await writePng(join(dir, 'bridge.png'), sheet.w, sheet.h, sheet.data);
