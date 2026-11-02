// Prints the rendered linear color of a preset at a few heights (center column).
// Usage: node tools/probe.mjs <preset.json> [w] [h]
import { readFileSync } from 'node:fs';
import { renderBands } from '../model/bands.mjs';
import { linearToHex } from '../lib/color.mjs';

const [, , presetPath, ws = '64', hs = '1447'] = process.argv;
const preset = JSON.parse(readFileSync(presetPath, 'utf8'));
const w = +ws;
const h = +hs;
const img = renderBands(preset.scene, w, h);
console.log('mode', preset.scene.params.mode, 'mixN', preset.scene.params.mixN);
for (const v of [0.05, 0.2, 0.4, 0.6, 0.8, 0.9, 0.99]) {
  const y = Math.min(h - 1, Math.floor(v * h));
  const i = (y * w + (w >> 1)) * 3;
  const rgb = [img.data[i], img.data[i + 1], img.data[i + 2]];
  console.log(`v=${v} ${linearToHex(rgb)} ${rgb.map((c) => c.toFixed(4)).join(' ')}`);
}
