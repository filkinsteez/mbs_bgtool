// Separable gaussian blur on planar Float32 images, edges clamped.

function kernel(sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    s += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return { k, r };
}

export function blurPlane(src, w, h, sigma) {
  if (!(sigma > 0.3)) return Float32Array.from(src);
  const { k, r } = kernel(sigma);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        let xx = x + i;
        if (xx < 0) xx = 0;
        else if (xx >= w) xx = w - 1;
        s += k[i + r] * src[row + xx];
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        let yy = y + i;
        if (yy < 0) yy = 0;
        else if (yy >= h) yy = h - 1;
        s += k[i + r] * tmp[yy * w + x];
      }
      out[y * w + x] = s;
    }
  }
  return out;
}

export function blurImage(img, sigma) {
  return { w: img.w, h: img.h, ch: img.ch.map((c) => blurPlane(c, img.w, img.h, sigma)) };
}

// 1D gaussian smoothing of a sampled curve; NaN samples are skipped.
export function smooth1d(v, sigma) {
  const n = v.length;
  if (!(sigma > 0.3)) return Float64Array.from(v);
  const r = Math.ceil(sigma * 3);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let ws = 0;
    for (let j = -r; j <= r; j++) {
      const k = i + j;
      if (k < 0 || k >= n || !Number.isFinite(v[k])) continue;
      const wgt = Math.exp(-(j * j) / (2 * sigma * sigma));
      s += wgt * v[k];
      ws += wgt;
    }
    out[i] = ws > 0 ? s / ws : NaN;
  }
  return out;
}
