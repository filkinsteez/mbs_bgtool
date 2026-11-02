// Side-by-side images, zoomed crop pairs, and masked Oklab error numbers.

import sharp from 'sharp';
import { srgbToLinear, linearToOklab } from './color.mjs';

export async function sideBySide(refPath, bytes, w, h, outPath) {
  const ref = await sharp(refPath).removeAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer();
  const gap = 8;
  const W = w * 2 + gap;
  const out = Buffer.alloc(W * h * 3, 255);
  for (let y = 0; y < h; y++) {
    ref.copy(out, y * W * 3, y * w * 3, (y + 1) * w * 3);
    Buffer.from(bytes.buffer, bytes.byteOffset + y * w * 3, w * 3).copy(out, (y * W + w + gap) * 3);
  }
  await sharp(out, { raw: { width: W, height: h, channels: 3 } }).png().toFile(outPath);
}

export async function cropPair(refPath, bytes, w, h, rect, scale, outPath) {
  const [x, y, cw, ch] = rect;
  const refRaw = await sharp(refPath).removeAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer();
  const ref = await sharp(refRaw, { raw: { width: w, height: h, channels: 3 } })
    .extract({ left: x, top: y, width: cw, height: ch })
    .resize(cw * scale, ch * scale, { kernel: 'nearest' })
    .raw()
    .toBuffer();
  const ren = await sharp(Buffer.from(bytes), { raw: { width: w, height: h, channels: 3 } })
    .extract({ left: x, top: y, width: cw, height: ch })
    .resize(cw * scale, ch * scale, { kernel: 'nearest' })
    .raw()
    .toBuffer();
  const gap = 6;
  const W = cw * scale * 2 + gap;
  const H = ch * scale;
  const out = Buffer.alloc(W * H * 3, 255);
  for (let yy = 0; yy < H; yy++) {
    ref.copy(out, yy * W * 3, yy * cw * scale * 3, (yy + 1) * cw * scale * 3);
    ren.copy(out, (yy * W + cw * scale + gap) * 3, yy * cw * scale * 3, (yy + 1) * cw * scale * 3);
  }
  await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toFile(outPath);
}

function maskFn(w, h, cornerRadius, ignore) {
  return (x, y) => {
    const r = cornerRadius;
    const cx = x < r ? r : x > w - 1 - r ? w - 1 - r : x;
    const cy = y < r ? r : y > h - 1 - r ? h - 1 - r : y;
    if ((x - cx) ** 2 + (y - cy) ** 2 > (r - 2) ** 2 && (x < r || x > w - 1 - r) && (y < r || y > h - 1 - r)) return false;
    if (x < 3 || y < 3 || x > w - 4 || y > h - 4) return false;
    for (const [ix, iy, iw, ih] of ignore) if (x >= ix && x < ix + iw && y >= iy && y < iy + ih) return false;
    return true;
  };
}

// Mean Oklab dE (x100) on box-blurred copies, overall and on a grid.
export async function metrics(refPath, bytes, w, h, { cornerRadius = 28, ignore = [], grid = [3, 4], blur = 4 } = {}) {
  const ref = await sharp(refPath).removeAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer();
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
  const ok = maskFn(w, h, cornerRadius, ignore);
  const bw = Math.floor(w / blur);
  const bh = Math.floor(h / blur);
  const cells = [];
  for (let i = 0; i < grid[0] * grid[1]; i++) cells.push({ s: 0, n: 0, dl: 0 });
  let sum = 0;
  let n = 0;
  let dL = 0;
  let da = 0;
  let db = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const a = [0, 0, 0];
      const b = [0, 0, 0];
      let cnt = 0;
      for (let j = 0; j < blur; j++) {
        for (let i = 0; i < blur; i++) {
          const x = bx * blur + i;
          const y = by * blur + j;
          if (!ok(x, y)) continue;
          const o = (y * w + x) * 3;
          for (let c = 0; c < 3; c++) {
            a[c] += lut[ref[o + c]];
            b[c] += lut[bytes[o + c]];
          }
          cnt++;
        }
      }
      if (cnt < blur * blur) continue;
      // Blocks that are black in both images only measure dither.
      const black = 2 * srgbToLinear(3 / 255);
      if (Math.max(...a) / cnt < black && Math.max(...b) / cnt < black) continue;
      const la = linearToOklab(a[0] / cnt, a[1] / cnt, a[2] / cnt);
      const lb = linearToOklab(b[0] / cnt, b[1] / cnt, b[2] / cnt);
      const e = 100 * Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
      sum += e;
      n++;
      dL += lb[0] - la[0];
      da += lb[1] - la[1];
      db += lb[2] - la[2];
      const gx = Math.min(grid[0] - 1, Math.floor((bx / bw) * grid[0]));
      const gy = Math.min(grid[1] - 1, Math.floor((by / bh) * grid[1]));
      const cell = cells[gy * grid[0] + gx];
      cell.s += e;
      cell.n++;
      cell.dl += 100 * (lb[0] - la[0]);
    }
  }
  return {
    dE: sum / n,
    dL: (100 * dL) / n,
    da: (100 * da) / n,
    db: (100 * db) / n,
    grid: cells.map((c) => (c.n ? `${(c.s / c.n).toFixed(1)}(${c.dl / c.n >= 0 ? '+' : ''}${(c.dl / c.n).toFixed(1)})` : '-')),
    gridW: grid[0],
  };
}

// Samples reference and render along a segment; returns rows of sRGB triples.
export async function lineProfile(refPath, bytes, w, h, [x0, y0, x1, y1], n) {
  const ref = await sharp(refPath).removeAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer();
  const rows = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const o = (y * w + x) * 3;
    rows.push({ x, y, ref: [ref[o], ref[o + 1], ref[o + 2]], ren: [bytes[o], bytes[o + 1], bytes[o + 2]] });
  }
  return rows;
}
