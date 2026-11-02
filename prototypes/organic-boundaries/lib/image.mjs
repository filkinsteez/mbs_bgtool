// Planar float images in linear RGB, PNG/JPEG I/O through sharp, and an 8-bit
// RGB canvas for diagnostic drawings (isoline overlays, plots, sheets).

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { srgbToLinear, linearToSrgb, linearToOklab } from './color.mjs';

export function makeImage(w, h) {
  return { w, h, ch: [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)] };
}

const LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) LUT[i] = srgbToLinear(i / 255);

export async function loadLinear(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const img = makeImage(info.width, info.height);
  const n = info.width * info.height;
  for (let i = 0; i < n; i++) {
    img.ch[0][i] = LUT[data[i * info.channels]];
    img.ch[1][i] = LUT[data[i * info.channels + 1]];
    img.ch[2][i] = LUT[data[i * info.channels + 2]];
  }
  return img;
}

export function toOklabPlanes(img) {
  const n = img.w * img.h;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lab = linearToOklab(img.ch[0][i], img.ch[1][i], img.ch[2][i]);
    L[i] = lab[0];
    A[i] = lab[1];
    B[i] = lab[2];
  }
  return { w: img.w, h: img.h, L, A, B };
}

// 8-bit RGB canvas
export function makeCanvas(w, h, fill = [0, 0, 0]) {
  const data = new Uint8ClampedArray(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    data[i * 3] = fill[0];
    data[i * 3 + 1] = fill[1];
    data[i * 3 + 2] = fill[2];
  }
  return { w, h, data };
}

// Linear image to an 8-bit canvas with a plain clamp (for display of measured images).
export function canvasFromLinear(img) {
  const c = makeCanvas(img.w, img.h);
  const n = img.w * img.h;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) c.data[i * 3 + k] = Math.round(linearToSrgb(Math.min(1, img.ch[k][i])) * 255);
  }
  return c;
}

export async function loadCanvas(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const c = makeCanvas(info.width, info.height);
  for (let i = 0; i < info.width * info.height; i++) {
    for (let k = 0; k < 3; k++) c.data[i * 3 + k] = data[i * info.channels + k];
  }
  return c;
}

export async function saveCanvas(c, file, opts = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let s = sharp(Buffer.from(c.data.buffer, c.data.byteOffset, c.data.byteLength), {
    raw: { width: c.w, height: c.h, channels: 3 },
  });
  if (opts.width) s = s.resize({ width: opts.width, kernel: 'lanczos3' });
  if (file.endsWith('.jpg')) s = s.jpeg({ quality: opts.quality ?? 86, mozjpeg: true });
  else s = s.png({ compressionLevel: 6 });
  await s.toFile(file);
}

export function dimCanvas(c, k) {
  const out = makeCanvas(c.w, c.h);
  for (let i = 0; i < c.data.length; i++) out.data[i] = c.data[i] * k;
  return out;
}

export function blit(dst, src, ox, oy) {
  for (let y = 0; y < src.h; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const tx = x + ox;
      if (tx < 0 || tx >= dst.w) continue;
      const si = (y * src.w + x) * 3;
      const di = (ty * dst.w + tx) * 3;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
    }
  }
}

export function cropCanvas(c, x0, y0, w, h) {
  const out = makeCanvas(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(c.w - 1, Math.max(0, x0 + x));
      const sy = Math.min(c.h - 1, Math.max(0, y0 + y));
      const si = (sy * c.w + sx) * 3;
      const di = (y * w + x) * 3;
      out.data[di] = c.data[si];
      out.data[di + 1] = c.data[si + 1];
      out.data[di + 2] = c.data[si + 2];
    }
  }
  return out;
}

export async function resizeCanvas(c, w, h) {
  const buf = await sharp(Buffer.from(c.data.buffer, c.data.byteOffset, c.data.byteLength), {
    raw: { width: c.w, height: c.h, channels: 3 },
  })
    .resize({ width: w, height: h, fit: 'fill', kernel: w > c.w ? 'nearest' : 'lanczos3' })
    .raw()
    .toBuffer();
  const out = makeCanvas(w, h);
  out.data.set(buf);
  return out;
}

// Anti-aliased thick polyline: stamps the distance to each segment.
export function drawPolyline(c, pts, color, radius = 1, alpha = 1) {
  for (let k = 0; k + 1 < pts.length; k++) {
    const [x0, y0] = pts[k];
    const [x1, y1] = pts[k + 1];
    if (!Number.isFinite(x0 + y0 + x1 + y1)) continue;
    drawSegment(c, x0, y0, x1, y1, color, radius, alpha);
  }
}

export function drawSegment(c, x0, y0, x1, y1, color, radius, alpha) {
  const pad = radius + 1.5;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
  const maxX = Math.min(c.w - 1, Math.ceil(Math.max(x0, x1) + pad));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
  const maxY = Math.min(c.h - 1, Math.ceil(Math.max(y0, y1) + pad));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1e-9;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5 - x0;
      const py = y + 0.5 - y0;
      const u = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const ex = px - u * dx;
      const ey = py - u * dy;
      const d = Math.sqrt(ex * ex + ey * ey);
      const cov = Math.max(0, Math.min(1, radius + 0.5 - d)) * alpha;
      if (cov <= 0) continue;
      const i = (y * c.w + x) * 3;
      for (let k = 0; k < 3; k++) c.data[i + k] = c.data[i + k] * (1 - cov) + color[k] * cov;
    }
  }
}

export function fillRect(c, x0, y0, w, h, color) {
  for (let y = Math.max(0, y0); y < Math.min(c.h, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(c.w, x0 + w); x++) {
      const i = (y * c.w + x) * 3;
      c.data[i] = color[0];
      c.data[i + 1] = color[1];
      c.data[i + 2] = color[2];
    }
  }
}

// Text label rendered by sharp (pango) and blended onto the canvas.
export async function drawText(c, text, x, y, opts = {}) {
  const size = opts.size ?? 16;
  const color = opts.color ?? [255, 255, 255];
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="white" font_desc="Helvetica ${size}">${esc}</span>`,
      rgba: true,
      dpi: 72,
    },
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (opts.background) {
    fillRect(c, x - 3, y - 2, info.width + 6, info.height + 4, opts.background);
  }
  for (let yy = 0; yy < info.height; yy++) {
    for (let xx = 0; xx < info.width; xx++) {
      const a = data[(yy * info.width + xx) * 4 + 3] / 255;
      if (a <= 0) continue;
      const tx = x + xx;
      const ty = y + yy;
      if (tx < 0 || ty < 0 || tx >= c.w || ty >= c.h) continue;
      const i = (ty * c.w + tx) * 3;
      for (let k = 0; k < 3; k++) c.data[i + k] = c.data[i + k] * (1 - a) + color[k] * a;
    }
  }
  return { w: info.width, h: info.height };
}

// Lay out canvases left to right with a gap, optional labels above each.
export async function row(canvases, opts = {}) {
  const gap = opts.gap ?? 8;
  const label = opts.labels ? (opts.labelSize ?? 18) + 10 : 0;
  const h = Math.max(...canvases.map((c) => c.h)) + label;
  const w = canvases.reduce((s, c) => s + c.w, 0) + gap * (canvases.length - 1);
  const out = makeCanvas(w, h, opts.background ?? [24, 24, 24]);
  let x = 0;
  for (let i = 0; i < canvases.length; i++) {
    blit(out, canvases[i], x, label);
    if (opts.labels && opts.labels[i]) {
      await drawText(out, opts.labels[i], x + 4, 3, { size: opts.labelSize ?? 18, color: [235, 235, 235] });
    }
    x += canvases[i].w + gap;
  }
  return out;
}

export async function column(canvases, opts = {}) {
  const gap = opts.gap ?? 8;
  const w = Math.max(...canvases.map((c) => c.w));
  const h = canvases.reduce((s, c) => s + c.h, 0) + gap * (canvases.length - 1);
  const out = makeCanvas(w, h, opts.background ?? [24, 24, 24]);
  let y = 0;
  for (const c of canvases) {
    blit(out, c, 0, y);
    y += c.h + gap;
  }
  return out;
}
