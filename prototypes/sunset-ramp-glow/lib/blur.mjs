import { makeImage } from './image.mjs';

function boxSizesForGauss(sigma, n) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}

function boxPass(src, dst, w, h, r, horizontal) {
  const n = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 3 : w * 3;
  const inv = 1 / (2 * r + 1);
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * w * 3 : line * 3;
    for (let c = 0; c < 3; c++) {
      const at = (i) => src[base + Math.min(n - 1, Math.max(0, i)) * step + c];
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += at(i);
      for (let i = 0; i < n; i++) {
        dst[base + i * step + c] = acc * inv;
        acc += at(i + r + 1) - at(i - r);
      }
    }
  }
}

/** Gaussian blur approximated by three box passes per axis, clamp-to-edge. */
export function gaussianBlur(img, sigma) {
  const out = makeImage(img.w, img.h);
  out.data.set(img.data);
  if (sigma < 0.3) return out;
  const tmp = new Float32Array(img.data.length);
  for (const size of boxSizesForGauss(sigma, 3)) {
    const r = (size - 1) >> 1;
    boxPass(out.data, tmp, img.w, img.h, r, true);
    boxPass(tmp, out.data, img.w, img.h, r, false);
  }
  return out;
}
