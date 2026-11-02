// Write the committed result images: reference | render side by sides for the
// reference presets, plus the generality sheet, the tone curve chart and the
// controls sheet if they have been rendered into out/.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { saveBytes, sideBySide } from './lib/image.mjs';
import { renderScene } from './lib/model.mjs';
import { applyLens, encodeOutput } from './lib/output.mjs';
import { PROTO, loadReference } from './lib/refs.mjs';

const dir = join(PROTO, 'results');
mkdirSync(dir, { recursive: true });
const refs = ['sunset-sky-peach', 'sunset-red-yellow-arcs', 'sunset-blue-diagonal', 'sunset-violet-wave'];
for (const id of refs) {
  const preset = JSON.parse(readFileSync(join(PROTO, 'presets', `ref-${id}.json`), 'utf8'));
  const ref = await loadReference(id);
  const { scene } = preset;
  const bytes = encodeOutput(applyLens(renderScene(scene, ref.w, ref.h), scene.lens), scene.output, scene.seed);
  const sbs = sideBySide([
    { bytes: ref.bytes, w: ref.w, h: ref.h },
    { bytes, w: ref.w, h: ref.h },
  ]);
  const path = join(dir, `${id}-sbs.jpg`);
  await saveBytes(sbs.bytes, sbs.w, sbs.h, path);
  console.log(path, (statSync(path).size / 1024).toFixed(0) + ' KB');
}
for (const name of ['generality.png', 'controls-elemental.png', 'tonetest.png']) {
  const src = join(PROTO, 'out', name);
  if (!existsSync(src)) continue;
  const dst = join(dir, name === 'tonetest.png' ? name : name.replace('.png', '.jpg'));
  if (dst.endsWith('.jpg')) await sharp(src).jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toFile(dst);
  else copyFileSync(src, dst);
  console.log(dst, (statSync(dst).size / 1024).toFixed(0) + ' KB');
}
