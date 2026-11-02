// Measures a few spot colours on each riso tile (81 x 9 px patches, mean in
// linear light) and writes them as ramp stops to presets/riso-test-ramps.json.
// The test renderer reads only that file, never the reference pixels.
import fs from 'node:fs';
import path from 'node:path';
import { srgbToLinear, linearToHex } from './lib/color.mjs';
import { readSrgb } from './lib/image.mjs';
import { HERE, refById } from './refs.mjs';

const STOPS = {
  'sunset-green-riso': [0.03, 0.16, 0.3, 0.4, 0.62, 0.76, 0.88, 0.97],
  'sunset-blue-riso': [0.03, 0.12, 0.22, 0.32, 0.4, 0.45, 0.5, 0.58, 0.7, 0.84, 0.97],
  'sunset-pink-riso': [0.03, 0.2, 0.36, 0.46, 0.53, 0.56, 0.585, 0.607, 0.624, 0.66, 0.75, 0.86, 0.97],
};

const out = { note: 'Spot colours measured on the riso tiles; ramps between them are generated.', ramps: {} };
for (const [id, ts] of Object.entries(STOPS)) {
  const ref = refById(id);
  const img = await readSrgb(ref.file);
  const stops = ts.map((t) => {
    const cy = Math.round(t * (img.h - 1));
    const cx = Math.round(img.w / 2);
    const acc = [0, 0, 0];
    let n = 0;
    for (let y = cy - 4; y <= cy + 4; y++) {
      for (let x = cx - 40; x <= cx + 40; x++) {
        const o = (y * img.w + x) * 3;
        for (let c = 0; c < 3; c++) acc[c] += srgbToLinear(img.d[o + c]);
        n++;
      }
    }
    return { t, hex: linearToHex(acc.map((v) => v / n)) };
  });
  out.ramps[id] = { width: img.w, height: img.h, stops };
  console.log(id, stops.map((s) => `${s.t}:${s.hex}`).join(' '));
}
fs.mkdirSync(path.join(HERE, 'presets'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'presets/riso-test-ramps.json'), JSON.stringify(out, null, 2) + '\n');
