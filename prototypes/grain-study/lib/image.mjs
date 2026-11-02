// Float RGB images: { w, h, d: Float32Array(w*h*3) }. Callers track whether
// values are sRGB-encoded or linear; files on disk are always sRGB 8-bit.
import sharp from 'sharp';

export function makeImage(w, h) {
  return { w, h, d: new Float32Array(w * h * 3) };
}

export async function readSrgb(path) {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .toColorspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const img = makeImage(info.width, info.height);
  for (let i = 0; i < img.d.length; i++) img.d[i] = data[i] / 255;
  return img;
}

// Plain rounding to 8 bits. Dither, when wanted, is applied before this.
export function toBytes(img) {
  const out = Buffer.alloc(img.d.length);
  for (let i = 0; i < img.d.length; i++) {
    out[i] = Math.max(0, Math.min(255, Math.round(img.d[i] * 255)));
  }
  return out;
}

function rawSharp(img) {
  return sharp(toBytes(img), { raw: { width: img.w, height: img.h, channels: 3 } });
}

export async function writePng(img, path) {
  await rawSharp(img).png({ compressionLevel: 9 }).toFile(path);
}

export function crop(img, x, y, w, h) {
  const out = makeImage(w, h);
  for (let j = 0; j < h; j++) {
    const sy = Math.min(img.h - 1, Math.max(0, y + j));
    for (let i = 0; i < w; i++) {
      const sx = Math.min(img.w - 1, Math.max(0, x + i));
      const s = (sy * img.w + sx) * 3;
      const o = (j * w + i) * 3;
      out.d[o] = img.d[s];
      out.d[o + 1] = img.d[s + 1];
      out.d[o + 2] = img.d[s + 2];
    }
  }
  return out;
}

export function rot90ccw(img) {
  const out = makeImage(img.h, img.w);
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const s = (x * img.w + (img.w - 1 - y)) * 3;
      const o = (y * out.w + x) * 3;
      out.d[o] = img.d[s];
      out.d[o + 1] = img.d[s + 1];
      out.d[o + 2] = img.d[s + 2];
    }
  }
  return out;
}

export function zoomNearest(img, k) {
  const out = makeImage(img.w * k, img.h * k);
  for (let j = 0; j < out.h; j++) {
    const sy = Math.floor(j / k);
    for (let i = 0; i < out.w; i++) {
      const s = (sy * img.w + Math.floor(i / k)) * 3;
      const o = (j * out.w + i) * 3;
      out.d[o] = img.d[s];
      out.d[o + 1] = img.d[s + 1];
      out.d[o + 2] = img.d[s + 2];
    }
  }
  return out;
}

// Resample with sharp (lanczos3 by default), sRGB in and out, like a browser
// or Figma showing the image at another size.
export async function resizeSrgb(img, w, h, kernel = 'lanczos3') {
  const { data, info } = await rawSharp(img)
    .resize(w, h, { kernel, fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = makeImage(info.width, info.height);
  for (let i = 0; i < out.d.length; i++) out.d[i] = data[i] / 255;
  return out;
}

// A contact sheet: rows of { img, label } tiles, labels drawn above tiles.
export async function writeSheet(rows, path, { gap = 8, labelH = 18, bg = 0.12, title } = {}) {
  const titleH = title ? 26 : 0;
  const rowH = rows.map((r) => Math.max(...r.map((t) => t.img.h)) + labelH);
  const rowW = rows.map((r) => r.reduce((s, t) => s + t.img.w, 0) + gap * (r.length + 1));
  const titleText = title ? await textImage(title, 15) : null;
  const W = Math.max(...rowW, titleText ? titleText.w + 2 * gap : 0);
  const H = titleH + rowH.reduce((s, v) => s + v + gap, gap);
  const sheet = makeImage(W, H);
  sheet.d.fill(bg);
  const labels = [];
  let y = titleH + gap;
  rows.forEach((r, ri) => {
    let x = gap;
    for (const t of r) {
      for (let j = 0; j < t.img.h; j++) {
        const so = j * t.img.w * 3;
        const oo = ((y + labelH + j) * W + x) * 3;
        sheet.d.set(t.img.d.subarray(so, so + t.img.w * 3), oo);
      }
      if (t.label) labels.push({ x, y, text: t.label, maxW: t.img.w });
      x += t.img.w + gap;
    }
    y += rowH[ri] + gap;
  });
  const overlays = [];
  if (titleText) overlays.push({ input: titleText.buf, left: gap, top: 5 });
  for (const l of labels) {
    const t = await textImage(l.text, 12);
    const buf = t.w > l.maxW ? await sharp(t.buf).extract({ left: 0, top: 0, width: l.maxW, height: t.h }).toBuffer() : t.buf;
    overlays.push({ input: buf, left: l.x, top: l.y + 1 });
  }
  const base = rawSharp(sheet);
  const pipeline = overlays.length ? sharp(await base.png().toBuffer()).composite(overlays) : base;
  if (path.endsWith('.jpg')) {
    await pipeline.jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(path);
  } else {
    await pipeline.png({ compressionLevel: 9 }).toFile(path);
  }
  return { w: W, h: H };
}

async function textImage(text, size) {
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="#e8e8e8">${escapeMarkup(text)}</span>`,
      font: `sans ${size}`,
      rgba: true,
      dpi: 96,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { buf: data, w: info.width, h: info.height };
}

function escapeMarkup(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
