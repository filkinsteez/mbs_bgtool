// Renders every reference preset at 16:9 and 9:16 (and its own aspect) to
// check the presets still make sense off their native shape.
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { HERE } from '../lib/refs.mjs';
import { hconcat, vconcat } from '../lib/image.mjs';
import { renderRadiance, outputStage } from '../lib/pipeline.mjs';

const dir = join(HERE, 'out', 'aspects');
mkdirSync(dir, { recursive: true });
const rows = [];
for (const f of readdirSync(join(HERE, 'presets')).filter((x) => x.endsWith('.json'))) {
  const preset = JSON.parse(readFileSync(join(HERE, 'presets', f), 'utf8'));
  const tiles = [];
  for (const [w, h] of [
    [640, 360],
    [203, 360],
  ]) {
    const { img } = renderRadiance(preset.scene, w, h, { solveScale: 0.5 });
    tiles.push({ w, h, data: outputStage(img, preset.scene.output ?? {}, 1) });
  }
  rows.push(hconcat(tiles, 8));
  console.log(f);
}
const sheet = vconcat(rows, 8);
await sharp(Buffer.from(sheet.data), { raw: { width: sheet.w, height: sheet.h, channels: 3 } })
  .png()
  .toFile(join(dir, 'presets-aspects.png'));
