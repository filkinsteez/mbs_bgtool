// Measures fine noise (grain) in small patches: the standard deviation of
// the 8-bit luma after removing a 7x7 box blur, at fractional positions.
//
//   node prototypes/contour-beams/grain.mjs <png> <fx,fy;fx,fy;...>
import sharp from 'sharp';

const [file, list] = process.argv.slice(2);
const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const luma = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) luma[i] = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
for (const s of list.split(';')) {
  const [fx, fy] = s.split(',').map(Number);
  const cx = Math.round(fx * W);
  const cy = Math.round(fy * H);
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  let mean = 0;
  for (let y = cy - 12; y <= cy + 12; y++) {
    for (let x = cx - 12; x <= cx + 12; x++) {
      let b = 0;
      for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) b += luma[(y + j) * W + x + i];
      b /= 49;
      const d = luma[y * W + x] - b;
      sum += d;
      sum2 += d * d;
      mean += luma[y * W + x];
      n++;
    }
  }
  const sd = Math.sqrt(sum2 / n - (sum / n) ** 2);
  console.log(`(${fx}, ${fy}) mean luma ${(mean / n).toFixed(1)}  grain sd ${sd.toFixed(2)} (8-bit)`);
}
