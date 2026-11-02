// Prints Oklab lightness (x100) along rows or columns of an image, averaged
// over a small band, to read shapes (beam cross-section, falloff) by number.
//
//   node prototypes/contour-beams/profile.mjs <png> row|col <pos,...> <samples> [band]
import sharp from 'sharp';
import { linearToOklab, srgbToLinear } from './lib/color.mjs';

const [file, mode, posList, samplesS = '35', bandS = '6'] = process.argv.slice(2);
const samples = Number(samplesS);
const band = Number(bandS);
const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const lin = (x, y) => {
  const i = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 3;
  return [srgbToLinear(data[i] / 255), srgbToLinear(data[i + 1] / 255), srgbToLinear(data[i + 2] / 255)];
};
for (const ps of posList.split(',')) {
  const pos = Number(ps);
  const vals = [];
  for (let s = 0; s < samples; s++) {
    const t = (s + 0.5) / samples;
    const acc = [0, 0, 0];
    let n = 0;
    for (let k = -band; k <= band; k++) {
      for (let j = -2; j <= 2; j++) {
        const x = mode === 'row' ? Math.round(t * w) + j : pos + k;
        const y = mode === 'row' ? pos + k : Math.round(t * h) + j;
        const c = lin(x, y);
        acc[0] += c[0];
        acc[1] += c[1];
        acc[2] += c[2];
        n++;
      }
    }
    vals.push(Math.round(linearToOklab([acc[0] / n, acc[1] / n, acc[2] / n])[0] * 100));
  }
  console.log(`${mode} ${String(pos).padStart(5)}: ${vals.map((v) => String(v).padStart(3)).join('')}`);
}
