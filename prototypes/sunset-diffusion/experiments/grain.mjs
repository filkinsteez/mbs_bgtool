// Grain statistics of an image in sRGB: high-pass std at several scales, the
// correlation of the residual between channels, and std per tone band.
// Usage: node grain.mjs <png> [y0 y1]
import { loadReference, blurChannel } from '../lib/image.mjs';

const [file, ya = '0', yb = '-1'] = process.argv.slice(2);
const img = await loadReference(file);
const { w, h } = img;
const y0 = Number(ya);
const y1 = Number(yb) < 0 ? h : Number(yb);
const x0 = Math.round(w * 0.05);
const x1 = Math.round(w * 0.95);
for (const s of [0.7, 1.5, 3, 6]) {
  const res = [0, 1, 2].map((c) => {
    const a = new Float32Array(img.srgb.ch[c]);
    const b = new Float32Array(a);
    blurChannel(b, w, h, s);
    for (let i = 0; i < a.length; i++) a[i] -= b[i];
    return a;
  });
  const std = [0, 0, 0];
  let cov01 = 0;
  let cov12 = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      for (let c = 0; c < 3; c++) std[c] += res[c][i] ** 2;
      cov01 += res[0][i] * res[1][i];
      cov12 += res[1][i] * res[2][i];
      n++;
    }
  }
  const sd = std.map((v) => Math.sqrt(v / n));
  console.log(
    `sigma ${s}: std R ${(sd[0] * 255).toFixed(2)} G ${(sd[1] * 255).toFixed(2)} B ${(sd[2] * 255).toFixed(2)}  corr RG ${(cov01 / n / (sd[0] * sd[1])).toFixed(2)} GB ${(cov12 / n / (sd[1] * sd[2])).toFixed(2)}`,
  );
}
// tone dependence at sigma 1.5 (green)
const g = new Float32Array(img.srgb.ch[1]);
const gb = new Float32Array(g);
blurChannel(gb, w, h, 1.5);
const bands = Array.from({ length: 5 }, () => [0, 0]);
for (let y = y0; y < y1; y++) {
  for (let x = x0; x < x1; x++) {
    const i = y * w + x;
    const k = Math.min(4, Math.floor(gb[i] * 5));
    bands[k][0] += (g[i] - gb[i]) ** 2;
    bands[k][1]++;
  }
}
console.log('green std by tone band (0-0.2 ... 0.8-1): ' + bands.map(([s, n]) => (n ? (Math.sqrt(s / n) * 255).toFixed(2) : '-')).join(' '));
