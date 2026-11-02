// Generality check: render production presets at 16:9 and 9:16 for a few
// seeds and put them on one contact sheet (out/generality.png).
// Usage: node generality.mjs presets/prod-*.json [--seeds 1,2] [--scale 0.25]
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { saveBytes } from './lib/image.mjs';
import { renderScene } from './lib/model.mjs';
import { applyLens, encodeOutput } from './lib/output.mjs';
import { PROTO } from './lib/refs.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const files = args.filter((a, i) => a.endsWith('.json') && !args[i - 1]?.startsWith('--'));
const seeds = opt('seeds', '1,2').split(',').map(Number);
const k = Number(opt('scale', 0.25));
const sizes = [
  [1920, 1080],
  [1080, 1920],
];
const gap = 12;
const tiles = [];
for (const file of files) {
  const preset = JSON.parse(readFileSync(file, 'utf8'));
  const row = [];
  for (const [w, h] of sizes) {
    for (const seed of seeds) {
      const scene = { ...structuredClone(preset.scene), seed };
      const bytes = encodeOutput(applyLens(renderScene(scene, w, h), scene.lens), scene.output, seed);
      const name = `${basename(file, '.json')}-${w}x${h}-s${seed}`;
      await saveBytes(bytes, w, h, join(PROTO, 'out', name + '.png'));
      const small = await sharp(Buffer.from(bytes.buffer), { raw: { width: w, height: h, channels: 3 } })
        .resize(Math.round(w * k), Math.round(h * k))
        .raw()
        .toBuffer();
      row.push({ bytes: new Uint8Array(small), w: Math.round(w * k), h: Math.round(h * k) });
    }
  }
  tiles.push(row);
  console.log('rendered', file);
}
const rowH = Math.max(...tiles[0].map((t) => t.h));
const sheetW = tiles[0].reduce((s, t) => s + t.w, 0) + gap * (tiles[0].length + 1);
const sheetH = tiles.length * (rowH + gap) + gap;
const sheet = new Uint8Array(sheetW * sheetH * 3).fill(255);
tiles.forEach((row, r) => {
  let x0 = gap;
  const y0 = gap + r * (rowH + gap);
  for (const t of row) {
    for (let y = 0; y < t.h; y++) sheet.set(t.bytes.subarray(y * t.w * 3, (y + 1) * t.w * 3), ((y0 + y) * sheetW + x0) * 3);
    x0 += t.w + gap;
  }
});
await saveBytes(sheet, sheetW, sheetH, join(PROTO, 'out', opt('out', 'generality.png')));
console.log(`sheet ${sheetW}x${sheetH}`);
