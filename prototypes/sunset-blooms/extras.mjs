// Supporting images for the README: contrast panel, control sweeps, seeds.
// Usage: node extras.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderScene } from './render.mjs';
import { composeScene } from './compose.mjs';
import { writeSrgb8, composeRow, composeColumn, resize8 } from './lib/image.mjs';
import { hexToSrgb, PACKS } from './lib/color.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const W = 1920;
const H = 1080;

// What a mesh gradient tool does: gaussian blobs of the same pack colors,
// averaged in sRGB. Shown only as the look to avoid.
function meshGradient(w, h) {
  const pts = [
    { hex: PACKS.bold[0].hex, x: 0.75, y: 0.15, s: 0.35 },
    { hex: PACKS.bold[1].hex, x: 0.15, y: 0.25, s: 0.3 },
    { hex: PACKS.bold[2].hex, x: 0.3, y: 0.9, s: 0.28 },
    { hex: PACKS.bold[3].hex, x: 0.85, y: 0.85, s: 0.28 },
  ].map((p) => ({ ...p, c: hexToSrgb(p.hex) }));
  const out = { w, h, data: new Uint8Array(w * h * 3) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sw = 0;
      const acc = [0, 0, 0];
      for (const p of pts) {
        const dx = (x / w - p.x) * (w / h);
        const dy = y / h - p.y;
        const wt = Math.exp(-(dx * dx + dy * dy) / (2 * p.s * p.s));
        sw += wt;
        for (let c = 0; c < 3; c++) acc[c] += p.c[c] * wt;
      }
      for (let c = 0; c < 3; c++) out.data[(y * w + x) * 3 + c] = Math.round((acc[c] / sw) * 255);
    }
  }
  return out;
}

const tile = (img) => resize8(img, 640, 360);

const natural = renderScene(composeScene('bold', 2, {}, H / W), W, H);
const orange = composeScene('bold', 2, {}, H / W);
orange.params.blooms[0].color = 3;
orange.params.blooms[0].intensity = 1.2;
orange.params.blooms[1].color = 0;
orange.params.blooms[1].intensity = 0.2;
await writeSrgb8(
  path.join(OUT, 'contrast.png'),
  composeRow([await tile(natural), await tile(meshGradient(W, H)), await tile(renderScene(orange, W, H))], 8),
);

const rows = [];
for (const key of ['rise', 'softness', 'intensity']) {
  const tiles = [];
  for (const v of [0, 0.5, 1]) tiles.push(await resize8(renderScene(composeScene('bold', 2, { [key]: v }, H / W), W, H), 480, 270));
  rows.push(composeRow(tiles, 8));
}
await writeSrgb8(path.join(OUT, 'controls.png'), composeColumn(rows, 8));

const seedRows = [];
for (let r = 0; r < 3; r++) {
  const tiles = [];
  for (let c = 0; c < 3; c++) tiles.push(await resize8(renderScene(composeScene('bold', r * 3 + c + 1, {}, H / W), W, H), 400, 225));
  seedRows.push(composeRow(tiles, 6));
}
await writeSrgb8(path.join(OUT, 'seeds-1-9.png'), composeColumn(seedRows, 6));
console.log('wrote contrast.png, controls.png, seeds-1-9.png');
