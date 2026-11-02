// Offline preset fitting for straight bands: renders one column and runs a
// coordinate search on chosen parameters to lower the row-mean Oklab error
// against the reference over [y0, y1]. Used to make reference presets only;
// the renderer never fits anything.
// Usage: node tools/fit1d.mjs <preset.json> <y0> <y1> <path=min:max> ... [--out file]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { renderBands } from '../model/bands.mjs';
import { readLinear, readAlpha } from '../lib/image.mjs';
import { buildMask, rowMeans } from '../lib/measure.mjs';
import { linearToOklab, hexToLinear, linearToHex } from '../lib/color.mjs';
import { getRef, HERE } from '../refs.mjs';

const args = process.argv.slice(2);
const presetPath = args[0];
const y0 = +args[1];
const y1 = +args[2];
const outIdx = args.indexOf('--out');
const specs = args.slice(3).filter((a, i) => !a.startsWith('--') && i + 3 !== outIdx + 1 && (a.includes('=') || a.startsWith('colors.')));
const roundsIdx = args.indexOf('--rounds');
const nRounds = roundsIdx >= 0 ? +args[roundsIdx + 1] : 6;
const preset = JSON.parse(readFileSync(presetPath, 'utf8'));
const ref = getRef(preset.referenceId);
const refImg = await readLinear(ref.file);
const { a } = await readAlpha(ref.file);
const mask = buildMask(refImg.w, refImg.h, a, ref.ignore);
const H = refImg.h;
const W = refImg.w;
// --strips N: compare N columns (strip centers) with their strip row means.
const stripsIdx = args.indexOf('--strips');
const nStrips = stripsIdx >= 0 ? +args[stripsIdx + 1] : 1;
const xs = [];
const targets = [];
for (let k = 0; k < nStrips; k++) {
  const x0 = nStrips === 1 ? 0 : Math.floor((k * W) / nStrips);
  const x1 = nStrips === 1 ? W : Math.floor(((k + 1) * W) / nStrips);
  xs.push(nStrips === 1 ? Math.floor(W / 2) : Math.floor((x0 + x1) / 2));
  const rows = rowMeans(refImg, mask, x0, x1);
  const t = [];
  for (let y = y0; y <= y1; y++) t.push(Number.isNaN(rows[y * 3]) ? null : linearToOklab(rows[y * 3], rows[y * 3 + 1], rows[y * 3 + 2]));
  targets.push(t);
}

// Parameter paths into scene; "colors.N" fits a color as three linear channels.
const params = [];
for (const s of specs) {
  const [path, range] = s.split('=');
  if (path.startsWith('colors.')) {
    const idx = +path.split('.')[1];
    for (let c = 0; c < 3; c++) params.push({ path, color: idx, ch: c, min: 0, max: 1 });
  } else {
    const [min, max] = range.split(':').map(Number);
    params.push({ path, min, max });
  }
}
const scene = structuredClone(preset.scene);
delete scene.params.grainSize;
for (const b of scene.params.bands) delete b.grain;
const colorLin = scene.colors.map(hexToLinear);
const get = (p) => {
  if (p.color !== undefined) return colorLin[p.color][p.ch];
  return p.path.split('.').reduce((o, k) => o[k], scene);
};
const set = (p, v) => {
  if (p.color !== undefined) {
    colorLin[p.color][p.ch] = v;
    scene.colors[p.color] = colorLin[p.color];
    return;
  }
  const keys = p.path.split('.');
  let o = scene;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = v;
};
for (const p of params) if (p.color !== undefined) scene.colors[p.color] = colorLin[p.color];

function cost() {
  const nc = xs.length;
  const img = renderBands(scene, nc, H, { xs, fullW: W });
  let s = 0;
  let n = 0;
  for (let k = 0; k < nc; k++) {
    for (let y = y0; y <= y1; y++) {
      const t = targets[k][y - y0];
      if (!t) continue;
      const i = (y * nc + k) * 3;
      const l = linearToOklab(img.data[i], img.data[i + 1], img.data[i + 2]);
      s += (l[0] - t[0]) ** 2 + (l[1] - t[1]) ** 2 + (l[2] - t[2]) ** 2;
      n++;
    }
  }
  return Math.sqrt(s / n) * 100;
}

let best = cost();
console.log(`start rms dE ${best.toFixed(3)}`);
for (let round = 0; round < nRounds; round++) {
  const frac = 0.25 / 2 ** round;
  for (const p of params) {
    const step = (p.max - p.min) * frac;
    for (const dir of [1, -1]) {
      for (let k = 0; k < 6; k++) {
        const old = get(p);
        const nv = Math.min(p.max, Math.max(p.min, old + dir * step));
        if (nv === old) break;
        set(p, nv);
        const c = cost();
        if (c < best) best = c;
        else {
          set(p, old);
          break;
        }
      }
    }
  }
  console.log(`round ${round} rms dE ${best.toFixed(3)}`);
}
for (const p of params) {
  if (p.color !== undefined) continue;
  console.log(`${p.path} = ${(+get(p)).toFixed(5)}`);
}
const out = structuredClone(preset);
const fittedScene = structuredClone(scene);
fittedScene.colors = scene.colors.map((c) => (typeof c === 'string' ? c : linearToHex(c)));
for (let i = 0; i < out.scene.params.bands.length; i++) {
  const orig = preset.scene.params.bands[i];
  if (orig.grain) fittedScene.params.bands[i].grain = orig.grain;
}
if (preset.scene.params.grainSize) fittedScene.params.grainSize = preset.scene.params.grainSize;
out.scene = fittedScene;
console.log('colors', JSON.stringify(fittedScene.colors));
const outArg = args.indexOf('--out');
const outPath = outArg >= 0 ? args[outArg + 1] : join(HERE, 'out', 'fit', basename(presetPath));
mkdirSync(join(HERE, 'out', 'fit'), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('wrote', outPath);
