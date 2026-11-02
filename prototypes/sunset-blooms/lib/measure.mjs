// Measurement helpers. These guide the eye; they never feed the renderer.
import { gaussianBlur } from './blur.mjs';
import { linearToOklab, linearToHex, oklabLch } from './color.mjs';

// 1 = measure, 0 = ignore (rounded tile corners and ignore rects).
export function makeMask(w, h, cornerRadius = 30, rects = []) {
  const m = new Uint8Array(w * h).fill(1);
  const r = cornerRadius;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = x < r ? r : x > w - 1 - r ? w - 1 - r : x;
      const cy = y < r ? r : y > h - 1 - r ? h - 1 - r : y;
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r * 0.8) m[y * w + x] = 0;
    }
  }
  for (const [rx, ry, rw, rh] of rects) {
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) if (x >= 0 && y >= 0 && x < w && y < h) m[y * w + x] = 0;
  }
  return m;
}

// Fills masked pixels with the nearest unmasked row value so blurs don't
// pull in the white tile corners.
function fillMasked(img, mask) {
  const out = { w: img.w, h: img.h, data: new Float32Array(img.data) };
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (mask[y * img.w + x]) continue;
      let best = -1;
      for (let d = 1; d < img.w; d++) {
        if (x + d < img.w && mask[y * img.w + x + d]) { best = x + d; break; }
        if (x - d >= 0 && mask[y * img.w + x - d]) { best = x - d; break; }
      }
      if (best < 0) continue;
      for (let c = 0; c < 3; c++) out.data[(y * img.w + x) * 3 + c] = img.data[(y * img.w + best) * 3 + c];
    }
  }
  return out;
}

export function blurredLab(img, mask, sigma) {
  const filled = mask ? fillMasked(img, mask) : img;
  const b = gaussianBlur(filled, sigma);
  const lab = new Float32Array(img.w * img.h * 3);
  for (let i = 0; i < img.w * img.h; i++) {
    const L = linearToOklab([b.data[i * 3], b.data[i * 3 + 1], b.data[i * 3 + 2]]);
    lab[i * 3] = L[0];
    lab[i * 3 + 1] = L[1];
    lab[i * 3 + 2] = L[2];
  }
  return { w: img.w, h: img.h, lab, lin: b };
}

export function deltaEStats(A, B, mask) {
  const vals = [];
  for (let i = 0; i < A.w * A.h; i++) {
    if (mask && !mask[i]) continue;
    const d = Math.hypot(A.lab[i * 3] - B.lab[i * 3], A.lab[i * 3 + 1] - B.lab[i * 3 + 1], A.lab[i * 3 + 2] - B.lab[i * 3 + 2]);
    vals.push(d * 100);
  }
  vals.sort((a, b) => a - b);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  return { mean, p50: vals[Math.floor(vals.length * 0.5)], p95: vals[Math.floor(vals.length * 0.95)], max: vals[vals.length - 1] };
}

function cell(B, x0, y0, x1, y1, mask) {
  const acc = [0, 0, 0];
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * B.w + x;
      if (mask && !mask[i]) continue;
      acc[0] += B.lin.data[i * 3];
      acc[1] += B.lin.data[i * 3 + 1];
      acc[2] += B.lin.data[i * 3 + 2];
      n++;
    }
  }
  return n ? acc.map((v) => v / n) : null;
}

// Prints a cols x rows table of patch colors: reference vs render with ΔE.
export function gridReport(A, B, mask, cols = 5, rows = 6) {
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const parts = [];
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c / cols) * A.w);
      const x1 = Math.floor(((c + 1) / cols) * A.w);
      const y0 = Math.floor((r / rows) * A.h);
      const y1 = Math.floor(((r + 1) / rows) * A.h);
      const a = cell(A, x0, y0, x1, y1, mask);
      const b = cell(B, x0, y0, x1, y1, mask);
      if (!a || !b) {
        parts.push('   ---   ');
        continue;
      }
      const la = linearToOklab(a);
      const lb = linearToOklab(b);
      const d = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]) * 100;
      parts.push(`${linearToHex(a)}/${linearToHex(b)} ${d.toFixed(1).padStart(4)}`);
    }
    lines.push(parts.join(' | '));
  }
  return lines.join('\n');
}

// L, C, h profile along a vertical line (x fraction) at n points.
export function columnProfile(B, xf, n = 12) {
  const x = Math.min(B.w - 1, Math.floor(xf * B.w));
  const out = [];
  for (let k = 0; k < n; k++) {
    const y = Math.min(B.h - 1, Math.floor(((k + 0.5) / n) * B.h));
    const i = y * B.w + x;
    out.push(oklabLch([B.lab[i * 3], B.lab[i * 3 + 1], B.lab[i * 3 + 2]]));
  }
  return out;
}

export function rowProfile(B, yf, n = 12) {
  const y = Math.min(B.h - 1, Math.floor(yf * B.h));
  const out = [];
  for (let k = 0; k < n; k++) {
    const x = Math.min(B.w - 1, Math.floor(((k + 0.5) / n) * B.w));
    const i = y * B.w + x;
    out.push(oklabLch([B.lab[i * 3], B.lab[i * 3 + 1], B.lab[i * 3 + 2]]));
  }
  return out;
}

export function fmtProfile(p) {
  return p.map(([L, C, h]) => `${(L * 100).toFixed(0)}/${(C * 100).toFixed(0)}/${h.toFixed(0)}`).join(' ');
}
