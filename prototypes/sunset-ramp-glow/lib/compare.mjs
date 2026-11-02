import { gaussianBlur } from './blur.mjs';
import { linearToOklab, srgbToLinear } from './color.mjs';
import { makeImage } from './image.mjs';
import { makeCanvas, panel } from './plot.mjs';

export function bytesToLinear(bytes, w, h) {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
  const img = makeImage(w, h);
  for (let i = 0; i < w * h * 3; i++) img.data[i] = lut[bytes[i]];
  return img;
}

function oklabImage(img) {
  const out = new Float32Array(img.w * img.h * 3);
  for (let i = 0; i < img.w * img.h; i++) {
    const lab = linearToOklab(img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]);
    out[i * 3] = lab[0];
    out[i * 3 + 1] = lab[1];
    out[i * 3 + 2] = lab[2];
  }
  return out;
}

/** Oklab difference (x100) between two blurred images inside the mask. */
export function deltaE(refImg, outImg, mask, sigma = 6) {
  const a = oklabImage(gaussianBlur(refImg, sigma));
  const b = oklabImage(gaussianBlur(outImg, sigma));
  const vals = [];
  let dL = 0;
  for (let i = 0; i < refImg.w * refImg.h; i++) {
    if (!mask[i]) continue;
    const l = b[i * 3] - a[i * 3];
    const d = Math.hypot(l, b[i * 3 + 1] - a[i * 3 + 1], b[i * 3 + 2] - a[i * 3 + 2]) * 100;
    vals.push(d);
    dL += l;
  }
  vals.sort((x, y) => x - y);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  return { mean, p95: vals[Math.floor(vals.length * 0.95)], max: vals[vals.length - 1], meanDL: (dL / vals.length) * 100 };
}

/**
 * Signed difference map of blurred images: lightness (red = render lighter,
 * blue = render darker) on the left half, chroma-plane distance (green) on
 * the right half. `range` is the Oklab difference shown at full strength.
 */
export function diffMap(refImg, outImg, mask, range = 0.03, sigma = 4) {
  const a = oklabImage(gaussianBlur(refImg, sigma));
  const b = oklabImage(gaussianBlur(outImg, sigma));
  const { w, h } = refImg;
  const bytes = new Uint8Array(w * 2 * h * 3).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const dl = Math.max(-1, Math.min(1, (b[i * 3] - a[i * 3]) / range));
      const dc = Math.min(1, Math.hypot(b[i * 3 + 1] - a[i * 3 + 1], b[i * 3 + 2] - a[i * 3 + 2]) / range);
      const li = (y * 2 * w + x) * 3;
      bytes[li] = 255 - Math.round(255 * Math.max(0, -dl));
      bytes[li + 1] = 255 - Math.round(255 * Math.abs(dl));
      bytes[li + 2] = 255 - Math.round(255 * Math.max(0, dl));
      const ci = (y * 2 * w + w + x) * 3;
      bytes[ci] = 255 - Math.round(255 * dc);
      bytes[ci + 1] = 255 - Math.round(90 * dc);
      bytes[ci + 2] = 255 - Math.round(255 * dc);
    }
  }
  return { bytes, w: w * 2, h };
}

/** Per-row Oklab mean over a column band [x0, x1), masked. */
export function rowProfile(img, mask, x0, x1) {
  const out = { L: new Float32Array(img.h), a: new Float32Array(img.h), b: new Float32Array(img.h) };
  for (let y = 0; y < img.h; y++) {
    let r = 0;
    let g = 0;
    let bb = 0;
    let n = 0;
    for (let x = x0; x < x1; x++) {
      if (!mask[y * img.w + x]) continue;
      const i = (y * img.w + x) * 3;
      r += img.data[i];
      g += img.data[i + 1];
      bb += img.data[i + 2];
      n++;
    }
    const lab = n ? linearToOklab(r / n, g / n, bb / n) : [NaN, NaN, NaN];
    out.L[y] = lab[0];
    out.a[y] = lab[1];
    out.b[y] = lab[2];
  }
  return out;
}

/** Per-column Oklab mean over a row band [y0, y1), masked. */
export function colProfile(img, mask, y0, y1) {
  const out = { L: new Float32Array(img.w), a: new Float32Array(img.w), b: new Float32Array(img.w) };
  for (let x = 0; x < img.w; x++) {
    let r = 0;
    let g = 0;
    let bb = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      if (!mask[y * img.w + x]) continue;
      const i = (y * img.w + x) * 3;
      r += img.data[i];
      g += img.data[i + 1];
      bb += img.data[i + 2];
      n++;
    }
    const lab = n ? linearToOklab(r / n, g / n, bb / n) : [NaN, NaN, NaN];
    out.L[x] = lab[0];
    out.a[x] = lab[1];
    out.b[x] = lab[2];
  }
  return out;
}

function slope(values, radius = 6) {
  const n = values.length;
  const out = new Float32Array(n).fill(NaN);
  for (let i = radius; i < n - radius; i++) out[i] = ((values[i + radius] - values[i - radius]) / (2 * radius)) * n;
  return out;
}

const BAND_COLORS = [
  [40, 90, 220],
  [0, 0, 0],
  [220, 40, 40],
];

/**
 * Profile sheet: lightness for three bands (reference solid, render dashed),
 * a/b for the middle band, and the lightness slope (kinks and bands show here).
 */
export function profileSheet(refImg, outImg, mask, byRows = true, width = 900) {
  const n = byRows ? refImg.w : refImg.h;
  const bands = [
    [0.03, 0.17],
    [0.43, 0.57],
    [0.83, 0.97],
  ].map(([a, b]) => [Math.floor(a * n), Math.floor(b * n)]);
  const prof = (img, [a, b]) => (byRows ? rowProfile(img, mask, a, b) : colProfile(img, mask, a, b));
  const ref = bands.map((b) => prof(refImg, b));
  const out = bands.map((b) => prof(outImg, b));
  const cv = makeCanvas(width, 3 * 260 + 20);
  panel(
    cv,
    0,
    260,
    ref.flatMap((p, i) => [
      { values: p.L, color: BAND_COLORS[i] },
      { values: out[i].L, color: BAND_COLORS[i], dashed: true },
    ]),
    0.15,
    1.0,
    [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
  );
  panel(
    cv,
    270,
    260,
    [
      { values: ref[1].a, color: [200, 0, 120] },
      { values: out[1].a, color: [200, 0, 120], dashed: true },
      { values: ref[1].b, color: [230, 150, 0] },
      { values: out[1].b, color: [230, 150, 0], dashed: true },
    ],
    -0.25,
    0.25,
    [-0.2, -0.1, 0, 0.1, 0.2],
  );
  panel(
    cv,
    540,
    260,
    [
      { values: slope(ref[1].L), color: [0, 0, 0] },
      { values: slope(out[1].L), color: [220, 40, 40] },
    ],
    -2.5,
    2.5,
    [-2, -1, 0, 1, 2],
  );
  return cv;
}
