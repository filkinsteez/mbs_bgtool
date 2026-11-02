import { linearToOklab, linearToSrgb, luminance } from './color.mjs';
import { gaussBlurPlane, maskedBlurRgb } from './blur.mjs';

// 1 = measure this pixel, 0 = ignore (corners, folds, text).
export function buildMask(w, h, alpha, ignore = []) {
  const m = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = alpha && alpha[i] < 0.999 ? 0 : 1;
  for (const { rect } of ignore) {
    const [x0, y0, rw, rh] = rect;
    for (let y = Math.max(0, y0); y < Math.min(h, y0 + rh); y++) {
      for (let x = Math.max(0, x0); x < Math.min(w, x0 + rw); x++) m[y * w + x] = 0;
    }
  }
  return m;
}

// Mean linear RGB per row over masked pixels. Rows with no valid pixels get NaN.
export function rowMeans(img, mask, x0 = 0, x1 = img.w) {
  const { w, h, data } = img;
  const out = new Float64Array(h * 3);
  for (let y = 0; y < h; y++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      r += data[i * 3];
      g += data[i * 3 + 1];
      b += data[i * 3 + 2];
      n++;
    }
    out[y * 3] = n ? r / n : NaN;
    out[y * 3 + 1] = n ? g / n : NaN;
    out[y * 3 + 2] = n ? b / n : NaN;
  }
  return out;
}

export function rowsToOklab(rows) {
  const h = rows.length / 3;
  const out = [];
  for (let y = 0; y < h; y++) out.push(linearToOklab(rows[y * 3], rows[y * 3 + 1], rows[y * 3 + 2]));
  return out;
}

// Per-row Oklab ΔE (x100) between two row-mean profiles.
export function rowDeltaE(rowsA, rowsB) {
  const la = rowsToOklab(rowsA);
  const lb = rowsToOklab(rowsB);
  return la.map((a, i) => {
    const b = lb[i];
    if (Number.isNaN(a[0]) || Number.isNaN(b[0])) return NaN;
    return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  });
}

// Mean Oklab ΔE (x100) between two images after a masked blur, plus percentiles.
export function blurredDeltaE(imgA, imgB, mask, sigma = 6) {
  const a = maskedBlurRgb(imgA, mask, sigma);
  const b = maskedBlurRgb(imgB, mask, sigma);
  const vals = [];
  const { w, h } = imgA;
  const perRow = new Float64Array(h);
  const perRowN = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const la = linearToOklab(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
      const lb = linearToOklab(b[i * 3], b[i * 3 + 1], b[i * 3 + 2]);
      const d = 100 * Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
      vals.push(d);
      perRow[y] += d;
      perRowN[y]++;
    }
  }
  const map = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    const la = linearToOklab(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
    const lb = linearToOklab(b[i * 3], b[i * 3 + 1], b[i * 3 + 2]);
    // Signed by lightness: positive where the render is lighter.
    map[i] = Math.sign(lb[0] - la[0]) * 100 * Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
  }
  vals.sort((p, q) => p - q);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  for (let y = 0; y < h; y++) perRow[y] = perRowN[y] ? perRow[y] / perRowN[y] : NaN;
  return {
    mean,
    p50: vals[Math.floor(vals.length * 0.5)],
    p90: vals[Math.floor(vals.length * 0.9)],
    p99: vals[Math.floor(vals.length * 0.99)],
    perRow,
    map,
  };
}

// Signed error map to 8-bit: red = render lighter, blue = render darker, white = 0.
export function errorMapImage(map, w, h, scale = 5) {
  const out = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const t = Math.max(-1, Math.min(1, map[i] / scale));
    const k = Math.round(255 * (1 - Math.abs(t)));
    out.set(t >= 0 ? [255, k, k] : [k, k, 255], i * 3);
  }
  return { w, h, data: out };
}

// Grain statistics on sRGB-encoded values (what the eye sees), per band of rows.
// High-pass = value - masked gaussian blur(sigma). Returns per-row-bin std of
// the luma high-pass, per-channel std, channel correlation, and lag-1/2 autocorrelation.
export function grainStats(img, mask, { sigma = 3, bin = 50 } = {}) {
  const { w, h, data } = img;
  const enc = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h * 3; i++) enc[i] = linearToSrgb(data[i]);
  const encImg = { w, h, data: enc };
  const low = maskedBlurRgb(encImg, mask, sigma);
  // Erode the mask so blur edges don't count.
  const er = gaussBlurPlane(mask, w, h, sigma * 1.5);
  const ok = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ok[i] = mask[i] && er[i] > 0.995 ? 1 : 0;
  const hp = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h * 3; i++) hp[i] = enc[i] - low[i];
  const bins = [];
  for (let y0 = 0; y0 < h; y0 += bin) {
    const acc = { n: 0, l2: 0, r2: 0, g2: 0, b2: 0, rg: 0, rb: 0, gb: 0, ax1: 0, ay1: 0, ax2: 0, ay2: 0, nx: 0, ny: 0, nx2: 0, ny2: 0, meanL: 0, meanRgb: [0, 0, 0] };
    for (let y = y0; y < Math.min(h, y0 + bin); y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!ok[i]) continue;
        const r = hp[i * 3];
        const g = hp[i * 3 + 1];
        const b = hp[i * 3 + 2];
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        acc.n++;
        acc.l2 += l * l;
        acc.r2 += r * r;
        acc.g2 += g * g;
        acc.b2 += b * b;
        acc.rg += r * g;
        acc.rb += r * b;
        acc.gb += g * b;
        acc.meanL += luminance(low[i * 3], low[i * 3 + 1], low[i * 3 + 2]);
        acc.meanRgb[0] += low[i * 3];
        acc.meanRgb[1] += low[i * 3 + 1];
        acc.meanRgb[2] += low[i * 3 + 2];
        const lum = (j) => 0.2126 * hp[j * 3] + 0.7152 * hp[j * 3 + 1] + 0.0722 * hp[j * 3 + 2];
        if (x + 1 < w && ok[i + 1]) {
          acc.ax1 += l * lum(i + 1);
          acc.nx++;
        }
        if (x + 2 < w && ok[i + 2]) {
          acc.ax2 += l * lum(i + 2);
          acc.nx2++;
        }
        if (y + 1 < h && ok[i + w]) {
          acc.ay1 += l * lum(i + w);
          acc.ny++;
        }
        if (y + 2 < h && ok[i + 2 * w]) {
          acc.ay2 += l * lum(i + 2 * w);
          acc.ny2++;
        }
      }
    }
    if (acc.n < 100) continue;
    const vl = acc.l2 / acc.n;
    bins.push({
      y0,
      y1: Math.min(h, y0 + bin),
      n: acc.n,
      meanEnc: acc.meanRgb.map((v) => v / acc.n),
      stdL: Math.sqrt(vl) * 255,
      stdR: Math.sqrt(acc.r2 / acc.n) * 255,
      stdG: Math.sqrt(acc.g2 / acc.n) * 255,
      stdB: Math.sqrt(acc.b2 / acc.n) * 255,
      corrRG: acc.rg / Math.sqrt(acc.r2 * acc.g2),
      corrRB: acc.rb / Math.sqrt(acc.r2 * acc.b2),
      corrGB: acc.gb / Math.sqrt(acc.g2 * acc.b2),
      acX1: acc.ax1 / acc.nx / vl,
      acX2: acc.ax2 / acc.nx2 / vl,
      acY1: acc.ay1 / acc.ny / vl,
      acY2: acc.ay2 / acc.ny2 / vl,
    });
  }
  return bins;
}

// Grain energy per scale band in a rect, on sRGB-encoded luma (8-bit units):
// std of DoG(s0, s1) for bands [0.5-1], [1-2], [2-4], [4-8] px.
export function grainBands(img, rect) {
  const [x0, y0, rw, rh] = rect;
  const luma = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = ((y0 + y) * img.w + x0 + x) * 3;
      luma[y * rw + x] =
        0.2126 * linearToSrgb(img.data[i]) + 0.7152 * linearToSrgb(img.data[i + 1]) + 0.0722 * linearToSrgb(img.data[i + 2]);
    }
  }
  const scales = [0.5, 1, 2, 4, 8];
  const blurred = scales.map((s) => gaussBlurPlane(luma, rw, rh, s));
  const m = 10;
  const out = [];
  for (let k = 0; k < scales.length - 1; k++) {
    let s2 = 0;
    let n = 0;
    for (let y = m; y < rh - m; y++) {
      for (let x = m; x < rw - m; x++) {
        const d = blurred[k][y * rw + x] - blurred[k + 1][y * rw + x];
        s2 += d * d;
        n++;
      }
    }
    out.push(Math.sqrt(s2 / n) * 255);
  }
  return out;
}

// Draws curves into an 8-bit RGB image. series: [{ values: number[], color: [r,g,b], min, max }]
export function plotSeries(series, w, h, { bg = 255, grid = 10 } = {}) {
  const data = new Uint8Array(w * h * 3).fill(bg);
  for (let gx = 0; gx <= grid; gx++) {
    const x = Math.min(w - 1, Math.round((gx / grid) * (w - 1)));
    for (let y = 0; y < h; y++) data.set([225, 225, 225], (y * w + x) * 3);
  }
  for (let gy = 0; gy <= 4; gy++) {
    const y = Math.min(h - 1, Math.round((gy / 4) * (h - 1)));
    for (let x = 0; x < w; x++) data.set([225, 225, 225], (y * w + x) * 3);
  }
  for (const s of series) {
    const n = s.values.length;
    let prev = null;
    for (let i = 0; i < n; i++) {
      const v = s.values[i];
      if (v === null || Number.isNaN(v)) {
        prev = null;
        continue;
      }
      const x = Math.round((i / (n - 1)) * (w - 1));
      const y = Math.round((1 - (v - s.min) / (s.max - s.min)) * (h - 1));
      const yc = Math.min(h - 1, Math.max(0, y));
      if (prev) {
        const steps = Math.max(Math.abs(x - prev[0]), Math.abs(yc - prev[1]), 1);
        for (let k = 0; k <= steps; k++) {
          const px = Math.round(prev[0] + ((x - prev[0]) * k) / steps);
          const py = Math.round(prev[1] + ((yc - prev[1]) * k) / steps);
          for (let t = 0; t < (s.thick ?? 2); t++) {
            const yy = Math.min(h - 1, py + t);
            data.set(s.color, (yy * w + px) * 3);
          }
        }
      }
      prev = [x, yc];
    }
  }
  return { w, h, data };
}
