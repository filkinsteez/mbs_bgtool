// Visual comparison helpers: side-by-side, zoom crops, Oklab profiles and a
// coarse delta-E grid. Metrics guide; the side-by-side images decide.
import sharp from 'sharp';
import { linearToOklab, srgbToLinear } from './color.mjs';

async function raw8(path) {
  const { data, info } = await sharp(path)
    .flatten({ background: '#000000' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { buf: data, w: info.width, h: info.height };
}

// reference | render, same height, with a thin gap.
export async function sideBySide(refPath, renderPath, outPath, { gap = 8 } = {}) {
  const a = await raw8(refPath);
  const b = await raw8(renderPath);
  const h = Math.max(a.h, b.h);
  const w = a.w + gap + b.w;
  await sharp({ create: { width: w, height: h, channels: 3, background: '#808080' } })
    .composite([
      { input: a.buf, raw: { width: a.w, height: a.h, channels: 3 }, left: 0, top: 0 },
      { input: b.buf, raw: { width: b.w, height: b.h, channels: 3 }, left: a.w + gap, top: 0 },
    ])
    .png()
    .toFile(outPath);
}

// Crops the same rect [x, y, w, h] from both images, scales by `scale`
// (nearest neighbour so banding and grain stay visible), and stacks them.
export async function zoomPair(refPath, renderPath, rect, scale, outPath, { gap = 6 } = {}) {
  const [x, y, w, h] = rect.map((v) => Math.round(v));
  const crop = async (p) =>
    sharp(await sharp(p).flatten({ background: '#000000' }).removeAlpha().png().toBuffer())
      .extract({ left: x, top: y, width: w, height: h })
      .resize(w * scale, h * scale, { kernel: 'nearest' })
      .raw()
      .toBuffer();
  const a = await crop(refPath);
  const b = await crop(renderPath);
  const W = w * scale;
  const H = h * scale;
  const wide = W >= H;
  const outW = wide ? W : W * 2 + gap;
  const outH = wide ? H * 2 + gap : H;
  await sharp({ create: { width: outW, height: outH, channels: 3, background: '#808080' } })
    .composite([
      { input: a, raw: { width: W, height: H, channels: 3 }, left: 0, top: 0 },
      {
        input: b,
        raw: { width: W, height: H, channels: 3 },
        left: wide ? 0 : W + gap,
        top: wide ? H + gap : 0,
      },
    ])
    .png()
    .toFile(outPath);
}

// Mean Oklab of each cell in a gx-by-gy grid, skipping masked pixels.
async function oklabGrid(path, gx, gy, mask) {
  const { buf, w, h } = await raw8(path);
  const sums = new Float64Array(gx * gy * 4);
  for (let y = 0; y < h; y++) {
    const cy = Math.min(gy - 1, Math.floor((y / h) * gy));
    for (let x = 0; x < w; x++) {
      if (mask && !mask[y * w + x]) continue;
      const cx = Math.min(gx - 1, Math.floor((x / w) * gx));
      const i = (y * w + x) * 3;
      const lin = [srgbToLinear(buf[i] / 255), srgbToLinear(buf[i + 1] / 255), srgbToLinear(buf[i + 2] / 255)];
      const c = (cy * gx + cx) * 4;
      sums[c] += lin[0];
      sums[c + 1] += lin[1];
      sums[c + 2] += lin[2];
      sums[c + 3] += 1;
    }
  }
  const cells = [];
  for (let c = 0; c < gx * gy; c++) {
    const n = Math.max(1, sums[c * 4 + 3]);
    cells.push(linearToOklab([sums[c * 4] / n, sums[c * 4 + 1] / n, sums[c * 4 + 2] / n]));
  }
  return cells;
}

// Coarse comparison: mean delta-E (Oklab x 100) over a grid of cell means,
// plus the lightness grid of both images for reading by eye.
export async function compareGrid(refPath, renderPath, { gx = 8, gy = 12, mask = null } = {}) {
  const a = await oklabGrid(refPath, gx, gy, mask);
  const b = await oklabGrid(renderPath, gx, gy, mask);
  let sum = 0;
  const rows = [];
  for (let y = 0; y < gy; y++) {
    const ra = [];
    const rb = [];
    const rd = [];
    for (let x = 0; x < gx; x++) {
      const p = a[y * gx + x];
      const q = b[y * gx + x];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100;
      sum += d;
      ra.push(Math.round(p[0] * 100));
      rb.push(Math.round(q[0] * 100));
      rd.push(Math.round(d));
    }
    rows.push({ ref: ra.join(' ').padEnd(gx * 3), out: rb.join(' ').padEnd(gx * 3), dE: rd.join(' ') });
  }
  return { meanDE: sum / (gx * gy), rows, a, b };
}

export function printGrid(result, label = '') {
  console.log(`${label} mean dE(ok x100) = ${result.meanDE.toFixed(2)}`);
  console.log('ref L'.padEnd(26) + ' | out L'.padEnd(27) + ' | dE');
  for (const r of result.rows) console.log(`${r.ref} | ${r.out} | ${r.dE}`);
}

// Mask of opaque pixels from a PNG with alpha (screenshot rounded corners).
export async function opaqueMask(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const m = new Uint8Array(info.width * info.height);
  for (let p = 0; p < m.length; p++) m[p] = data[p * 4 + 3] === 255 ? 1 : 0;
  return m;
}
