// Prints the mean color (hex and Oklab L) of small patches at the same
// fractional positions in two images, to compare colors spot by spot.
//
//   node prototypes/contour-beams/spots.mjs <a.png> <b.png> <fx,fy;fx,fy;...> [radius]
import sharp from 'sharp';
import { linearToHex, linearToOklab, srgbToLinear } from './lib/color.mjs';

const [aPath, bPath, list, radS = '6'] = process.argv.slice(2);
const rad = Number(radS);

async function load(p) {
  const { data, info } = await sharp(p).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function patch(img, fx, fy) {
  const cx = Math.round(fx * img.w);
  const cy = Math.round(fy * img.h);
  const acc = [0, 0, 0];
  let n = 0;
  for (let y = cy - rad; y <= cy + rad; y++) {
    for (let x = cx - rad; x <= cx + rad; x++) {
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const i = (y * img.w + x) * 3;
      for (let c = 0; c < 3; c++) acc[c] += srgbToLinear(img.data[i + c] / 255);
      n++;
    }
  }
  return acc.map((v) => v / n);
}

const a = await load(aPath);
const b = await load(bPath);
for (const s of list.split(';')) {
  const [fx, fy] = s.split(',').map(Number);
  const pa = patch(a, fx, fy);
  const pb = patch(b, fx, fy);
  const la = linearToOklab(pa);
  const lb = linearToOklab(pb);
  const dE = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]) * 100;
  console.log(
    `(${fx.toFixed(3)}, ${fy.toFixed(3)})  ref ${linearToHex(pa)} L${(la[0] * 100).toFixed(0).padStart(3)}   out ${linearToHex(pb)} L${(lb[0] * 100).toFixed(0).padStart(3)}   dE ${dE.toFixed(1)}`,
  );
}
