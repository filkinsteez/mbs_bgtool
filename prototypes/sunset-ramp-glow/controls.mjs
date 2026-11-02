// Controls sheet: rows Intensity, Softness, Horizon; columns 0, 0.5, 1.
// Usage: node controls.mjs presets/prod-elemental-sunset.json [--size 960x540] [--out controls.png]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyControls } from './lib/controls.mjs';
import { saveBytes } from './lib/image.mjs';
import { renderScene } from './lib/model.mjs';
import { applyLens, encodeOutput } from './lib/output.mjs';
import { PROTO } from './lib/refs.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const preset = JSON.parse(readFileSync(args[0], 'utf8'));
const [w, h] = opt('size', '960x540').split('x').map(Number);
const gap = 12;
const rows = ['intensity', 'softness', 'horizon'];
const values = [0, 0.5, 1];
const sheetW = values.length * (w + gap) + gap;
const sheetH = rows.length * (h + gap) + gap;
const sheet = new Uint8Array(sheetW * sheetH * 3).fill(255);
rows.forEach((control, r) => {
  values.forEach((v, c) => {
    const scene = applyControls(preset.scene, { [control]: v });
    const bytes = encodeOutput(applyLens(renderScene(scene, w, h), scene.lens), scene.output, scene.seed);
    const x0 = gap + c * (w + gap);
    const y0 = gap + r * (h + gap);
    for (let y = 0; y < h; y++) sheet.set(bytes.subarray(y * w * 3, (y + 1) * w * 3), ((y0 + y) * sheetW + x0) * 3);
  });
});
await saveBytes(sheet, sheetW, sheetH, join(PROTO, 'out', opt('out', 'controls.png')));
console.log(`sheet ${sheetW}x${sheetH}`);
