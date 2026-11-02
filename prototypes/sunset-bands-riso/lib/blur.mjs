// Separable blurs on planar Float32Array fields. Large radii use three box
// passes (close to a gaussian); a GPU port would use a downsample pyramid.

function boxSizesForGauss(sigma, n = 3) {
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

// Box blur along one axis with clamp-to-edge.
function boxLine(src, dst, n, stride, offset, r) {
  const inv = 1 / (2 * r + 1);
  const first = src[offset];
  const last = src[offset + (n - 1) * stride];
  let acc = r * first;
  for (let i = 0; i < r; i++) acc += src[offset + Math.min(i, n - 1) * stride];
  for (let i = 0; i < n; i++) {
    const add = i + r < n ? src[offset + (i + r) * stride] : last;
    acc += add;
    dst[offset + i * stride] = acc * inv;
    const sub = i - r >= 0 ? src[offset + (i - r) * stride] : first;
    acc -= sub;
  }
}

export function gaussBlurPlane(plane, w, h, sigmaX, sigmaY = sigmaX) {
  let a = new Float32Array(plane);
  let b = new Float32Array(plane.length);
  if (sigmaX > 0.3) {
    for (const size of boxSizesForGauss(sigmaX)) {
      const r = (size - 1) >> 1;
      for (let y = 0; y < h; y++) boxLine(a, b, w, 1, y * w, r);
      [a, b] = [b, a];
    }
  }
  if (sigmaY > 0.3) {
    for (const size of boxSizesForGauss(sigmaY)) {
      const r = (size - 1) >> 1;
      for (let x = 0; x < w; x++) boxLine(a, b, h, w, x, r);
      [a, b] = [b, a];
    }
  }
  return a;
}

// Blur an interleaved RGB Float32Array image.
export function gaussBlurRgb(img, sigmaX, sigmaY = sigmaX) {
  const { w, h } = img;
  const out = new Float32Array(w * h * 3);
  const plane = new Float32Array(w * h);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < w * h; i++) plane[i] = img.data[i * 3 + c];
    const blurred = gaussBlurPlane(plane, w, h, sigmaX, sigmaY);
    for (let i = 0; i < w * h; i++) out[i * 3 + c] = blurred[i];
  }
  return out;
}

// Masked blur: normalized convolution so masked pixels don't leak in.
export function maskedBlurRgb(img, mask, sigmaX, sigmaY = sigmaX) {
  const { w, h } = img;
  const out = new Float32Array(w * h * 3);
  const wsum = gaussBlurPlane(mask, w, h, sigmaX, sigmaY);
  const plane = new Float32Array(w * h);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < w * h; i++) plane[i] = img.data[i * 3 + c] * mask[i];
    const blurred = gaussBlurPlane(plane, w, h, sigmaX, sigmaY);
    for (let i = 0; i < w * h; i++) out[i * 3 + c] = wsum[i] > 1e-6 ? blurred[i] / wsum[i] : 0;
  }
  return out;
}
