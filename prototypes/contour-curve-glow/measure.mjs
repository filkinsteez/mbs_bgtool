// Measuring tool for reference and render PNGs.
//   node measure.mjs crop <png> <x> <y> <w> <h> <scale> <out.png>
//   node measure.mjs line <png> <x0> <y0> <x1> <y1> <n> [avg]
//   node measure.mjs spot <png> <x> <y> [radius]
// Coordinates are pixels. "line" prints linear RGB, sRGB 0-255 and Oklab L
// along the segment; "avg" averages a (2*avg+1)-pixel strip across it.

import sharp from 'sharp';
import { readLinear } from './lib/image.mjs';
import { linearToSrgb, linearToOklab } from './lib/color.mjs';

const [, , cmd, file, ...args] = process.argv;
const num = (v) => Number(v);

async function crop() {
  const [x, y, w, h, scale, out] = args;
  await sharp(file)
    .removeAlpha()
    .extract({ left: num(x), top: num(y), width: num(w), height: num(h) })
    .resize(num(w) * num(scale), num(h) * num(scale), { kernel: 'nearest' })
    .toFile(out);
  console.log('wrote', out);
}

function fmt(rgb) {
  const s = rgb.map((v) => Math.round(linearToSrgb(Math.max(0, v)) * 255));
  const lab = linearToOklab(...rgb.map((v) => Math.max(0, v)));
  return (
    `lin ${rgb.map((v) => v.toFixed(4)).join(' ')}  ` +
    `srgb ${s.map((v) => String(v).padStart(3)).join(' ')}  ` +
    `L ${lab[0].toFixed(3)} a ${lab[1].toFixed(3)} b ${lab[2].toFixed(3)}`
  );
}

async function line() {
  const [x0, y0, x1, y1, n, avg = '0'] = args.map(num);
  const { img } = await readLinear(file);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const tmp = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const px = x0 + dx * t;
    const py = y0 + dy * t;
    const acc = [0, 0, 0];
    let count = 0;
    for (let k = -avg; k <= avg; k++) {
      img.sample(px + nx * k + 0.5, py + ny * k + 0.5, tmp);
      acc[0] += tmp[0];
      acc[1] += tmp[1];
      acc[2] += tmp[2];
      count++;
    }
    const rgb = acc.map((v) => v / count);
    console.log(`${px.toFixed(1).padStart(7)} ${py.toFixed(1).padStart(7)}  ${fmt(rgb)}`);
  }
}

async function spot() {
  const [x, y, r = 2] = args.map(num);
  const { img } = await readLinear(file);
  const acc = [0, 0, 0];
  let count = 0;
  for (let j = -r; j <= r; j++) {
    for (let i = -r; i <= r; i++) {
      const p = img.get(Math.min(img.w - 1, Math.max(0, x + i)), Math.min(img.h - 1, Math.max(0, y + j)));
      acc[0] += p[0];
      acc[1] += p[1];
      acc[2] += p[2];
      count++;
    }
  }
  console.log(`${x} ${y}  ${fmt(acc.map((v) => v / count))}`);
}

const commands = { crop, line, spot };
if (!commands[cmd]) {
  console.log('commands: crop, line, spot');
  process.exit(1);
}
await commands[cmd]();
