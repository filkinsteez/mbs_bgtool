// Masks and comparison numbers. These guide the iteration; the side-by-side
// images decide.
import { linearToOklab } from './color.mjs';
import { blurImage, cloneImage } from './image.mjs';

// 1 = measure, 0 = ignore (rounded tile corners and ignore rects).
export function makeMask(w, h, cornerRadius, ignore = []) {
  const m = new Uint8Array(w * h).fill(1);
  const r = cornerRadius;
  if (r > 0) {
    const pad = r + 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inCorner = (x < pad || x >= w - pad) && (y < pad || y >= h - pad);
        if (inCorner) m[y * w + x] = 0;
      }
    }
    // a thin border too: the screenshots have a 1-2 px light edge
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3) m[y * w + x] = 0;
      }
    }
  }
  for (const { rect } of ignore) {
    const [x0, y0, rw, rh] = rect;
    for (let y = Math.max(0, y0); y < Math.min(h, y0 + rh); y++) {
      for (let x = Math.max(0, x0); x < Math.min(w, x0 + rw); x++) m[y * w + x] = 0;
    }
  }
  return m;
}

export function oklabImage(lin) {
  const n = lin.w * lin.h;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [l, a, b] = linearToOklab(lin.ch[0][i], lin.ch[1][i], lin.ch[2][i]);
    L[i] = l;
    A[i] = a;
    B[i] = b;
  }
  return { L, A, B };
}

// Mean and 95th percentile Oklab distance (x100) after blurring both images.
export function compare(refLin, renLin, mask, sigma = 4) {
  const a = oklabImage(blurImage(cloneImage(refLin), sigma));
  const b = oklabImage(blurImage(cloneImage(renLin), sigma));
  const d = [];
  let sum = 0;
  let sumL = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const dl = a.L[i] - b.L[i];
    const da = a.A[i] - b.A[i];
    const db = a.B[i] - b.B[i];
    const e = 100 * Math.sqrt(dl * dl + da * da + db * db);
    d.push(e);
    sum += e;
    sumL += 100 * dl;
  }
  d.sort((x, y) => x - y);
  return {
    mean: sum / d.length,
    p95: d[Math.floor(d.length * 0.95)],
    max: d[d.length - 1],
    biasL: sumL / d.length,
  };
}

// Mean Oklab (L, C, h) per horizontal strip of rows.
export function rowProfile(lin, mask, strips = 20, x0 = 0, x1 = lin.w) {
  const lab = oklabImage(lin);
  const out = [];
  for (let s = 0; s < strips; s++) {
    const y0 = Math.floor((s * lin.h) / strips);
    const y1 = Math.floor(((s + 1) * lin.h) / strips);
    let l = 0;
    let a = 0;
    let b = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * lin.w + x;
        if (!mask[i]) continue;
        l += lab.L[i];
        a += lab.A[i];
        b += lab.B[i];
        n++;
      }
    }
    l /= n || 1;
    a /= n || 1;
    b /= n || 1;
    out.push({ y: (y0 + y1) / 2, L: l, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 });
  }
  return out;
}

export function meanColor(lin, x0, y0, w, h) {
  const acc = [0, 0, 0];
  let n = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = y * lin.w + x;
      for (let c = 0; c < 3; c++) acc[c] += lin.ch[c][i];
      n++;
    }
  }
  return acc.map((v) => v / n);
}

// Per-pixel Oklab difference as an 8-bit heat image (0 = black, >= `scale` = white).
export function diffHeat(refLin, renLin, sigma = 4, scale = 12) {
  const a = oklabImage(blurImage(cloneImage(refLin), sigma));
  const b = oklabImage(blurImage(cloneImage(renLin), sigma));
  const n = refLin.w * refLin.h;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const dl = 100 * (b.L[i] - a.L[i]);
    const e = 100 * Math.hypot(a.L[i] - b.L[i], a.A[i] - b.A[i], a.B[i] - b.B[i]);
    const t = Math.min(1, e / scale);
    // red = render too light, blue = render too dark, brightness = size of error
    const v = Math.round(255 * t);
    out[i * 3] = dl > 0 ? v : Math.round(v * 0.35);
    out[i * 3 + 1] = Math.round(v * 0.35);
    out[i * 3 + 2] = dl > 0 ? Math.round(v * 0.35) : v;
  }
  return out;
}
