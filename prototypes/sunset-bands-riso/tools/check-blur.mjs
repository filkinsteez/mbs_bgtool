// Checks that the box-pass gaussian keeps energy, centers, and has the requested sigma.
import { gaussBlurPlane } from '../lib/blur.mjs';

for (const sigma of [1.5, 10, 60]) {
  const w = 801;
  const p = new Float32Array(w);
  p[400] = 1;
  const b = gaussBlurPlane(p, w, 1, sigma, 0);
  let s = 0;
  let m = 0;
  for (let i = 0; i < w; i++) {
    s += b[i];
    m += i * b[i];
  }
  m /= s;
  let v = 0;
  for (let i = 0; i < w; i++) v += b[i] * (i - m) ** 2;
  v /= s;
  const c = gaussBlurPlane(new Float32Array(w).fill(0.5), w, 1, sigma, 0);
  console.log(`sigma ${sigma}: sum ${s.toFixed(4)} mean ${m.toFixed(2)} measured sigma ${Math.sqrt(v).toFixed(2)} const ${c[0].toFixed(4)} ${c[400].toFixed(4)}`);
}
