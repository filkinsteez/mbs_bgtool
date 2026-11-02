// Results grid: 3 packs x 3 seeds x 2 aspects, plus guide numbers.
// Usage: node grid.mjs [tag] [seed seed seed] [--controls i,s,r]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderScene } from './render.mjs';
import { composeScene } from './compose.mjs';
import { writeSrgb8, composeRow, composeColumn, resize8, srgb8ToLinear } from './lib/image.mjs';
import { downsample2 } from './lib/blur.mjs';
import { hexToLinear, linearToOklab, oklabLch } from './lib/color.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const args = process.argv.slice(2);
const ci = args.indexOf('--controls');
let controls = {};
if (ci >= 0) {
  const [intensity, softness, rise] = args[ci + 1].split(',').map(Number);
  controls = { intensity, softness, rise };
  args.splice(ci, 2);
}
const tag = args[0] ?? 'grid';
const seeds = args.length > 1 ? args.slice(1).map(Number) : [1, 2, 3];
const PACK_IDS = ['bold', 'elemental', 'atmospheric'];
const ASPECTS = [
  { name: '16x9', w: 1920, h: 1080, tw: 640, th: 360 },
  { name: '9x16', w: 1080, h: 1920, tw: 270, th: 480 },
];
const META_BLUE_HUE = oklabLch(linearToOklab(hexToLinear('#0064E0')))[2];

// Worst-third lightness spread (p95 - p5 of Oklab L, x100) over the three
// horizontal and three vertical thirds, and the share of the frame that
// reads as blue sky (hue within 30 degrees of Meta Blue, chroma > 0.05).
function guideNumbers(img8) {
  let lin = srgb8ToLinear(img8);
  while (lin.w > 200) lin = downsample2(lin);
  const { w, h } = lin;
  const L = new Float32Array(w * h);
  let blue = 0;
  for (let i = 0; i < w * h; i++) {
    const [l, c, hue] = oklabLch(linearToOklab([lin.data[i * 3], lin.data[i * 3 + 1], lin.data[i * 3 + 2]]));
    L[i] = l;
    const dh = Math.abs(((hue - META_BLUE_HUE + 540) % 360) - 180);
    if (c > 0.05 && dh < 30) blue++;
  }
  const spread = (x0, x1, y0, y1) => {
    const v = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) v.push(L[y * w + x]);
    v.sort((a, b) => a - b);
    return (v[Math.floor(v.length * 0.95)] - v[Math.floor(v.length * 0.05)]) * 100;
  };
  const thirds = [];
  for (let k = 0; k < 3; k++) {
    thirds.push(spread(Math.floor((k * w) / 3), Math.floor(((k + 1) * w) / 3), 0, h));
    thirds.push(spread(0, w, Math.floor((k * h) / 3), Math.floor(((k + 1) * h) / 3)));
  }
  // Steepest lightness change, in Oklab L x100 per 10% of the short side.
  const step = Math.max(1, Math.round(Math.min(w, h) / 10));
  let maxGrad = 0;
  for (let y = 0; y + step < h; y++) {
    for (let x = 0; x + step < w; x++) {
      const i = y * w + x;
      maxGrad = Math.max(maxGrad, Math.hypot(L[i + step] - L[i], L[i + step * w] - L[i]) * 100);
    }
  }
  return { worstThird: Math.max(...thirds), bestThird: Math.min(...thirds), blueShare: (blue / (w * h)) * 100, maxGrad };
}

for (const a of ASPECTS) {
  const rows = [];
  for (const packId of PACK_IDS) {
    const tiles = [];
    for (const seed of seeds) {
      const scene = composeScene(packId, seed, controls, a.h / a.w);
      const img = renderScene(scene, a.w, a.h);
      await writeSrgb8(path.join(OUT, `${tag}-${packId}-s${seed}-${a.name}.png`), img);
      const g = guideNumbers(img);
      console.log(
        `${packId} seed ${seed} ${a.name}: third L spread worst ${g.worstThird.toFixed(1)} best ${g.bestThird.toFixed(1)}, steepest ${g.maxGrad.toFixed(1)} L/10%, blue sky ${g.blueShare.toFixed(0)}%`,
      );
      tiles.push(await resize8(img, a.tw, a.th));
    }
    rows.push(composeRow(tiles, 8));
  }
  const grid = composeColumn(rows, 8);
  await writeSrgb8(path.join(OUT, `${tag}-${a.name}.png`), grid);
  await writeSrgb8(path.join(OUT, `${tag}-${a.name}.jpg`), grid);
}
