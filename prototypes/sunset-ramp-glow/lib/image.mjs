import sharp from 'sharp';
import { srgbToLinear } from './color.mjs';

/** Linear-RGB float image, 3 channels, row-major. */
export function makeImage(w, h) {
  return { w, h, data: new Float32Array(w * h * 3) };
}

/** Load a PNG as both 8-bit sRGB bytes and a linear float image. */
export async function loadImage(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const img = makeImage(w, h);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
  for (let i = 0; i < w * h * 3; i++) img.data[i] = lut[data[i]];
  return { img, bytes: new Uint8Array(data.buffer, data.byteOffset, data.length), w, h };
}

export async function saveBytes(bytes, w, h, path) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  const s = sharp(buf, { raw: { width: w, height: h, channels: 3 } });
  if (path.endsWith('.jpg')) await s.jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toFile(path);
  else await s.png({ compressionLevel: 9 }).toFile(path);
}

/** Place 8-bit RGB images next to each other with a gap. */
export function sideBySide(items, gap = 8, bg = 255) {
  const h = Math.max(...items.map((it) => it.h));
  const w = items.reduce((acc, it) => acc + it.w, 0) + gap * (items.length - 1);
  const out = new Uint8Array(w * h * 3).fill(bg);
  let x0 = 0;
  for (const it of items) {
    for (let y = 0; y < it.h; y++) {
      const src = y * it.w * 3;
      out.set(it.bytes.subarray(src, src + it.w * 3), (y * w + x0) * 3);
    }
    x0 += it.w + gap;
  }
  return { bytes: out, w, h };
}

export function stackVertical(items, gap = 8, bg = 255) {
  const w = Math.max(...items.map((it) => it.w));
  const h = items.reduce((acc, it) => acc + it.h, 0) + gap * (items.length - 1);
  const out = new Uint8Array(w * h * 3).fill(bg);
  let y0 = 0;
  for (const it of items) {
    for (let y = 0; y < it.h; y++) {
      const src = y * it.w * 3;
      out.set(it.bytes.subarray(src, src + it.w * 3), ((y0 + y) * w) * 3);
    }
    y0 += it.h + gap;
  }
  return { bytes: out, w, h };
}

/** Crop an 8-bit RGB image and scale it up by an integer factor (nearest). */
export function zoomCrop(bytes, w, x, y, cw, ch, k) {
  const out = new Uint8Array(cw * k * ch * k * 3);
  for (let yy = 0; yy < ch * k; yy++) {
    const sy = y + Math.floor(yy / k);
    for (let xx = 0; xx < cw * k; xx++) {
      const sx = x + Math.floor(xx / k);
      const si = (sy * w + sx) * 3;
      const di = (yy * cw * k + xx) * 3;
      out[di] = bytes[si];
      out[di + 1] = bytes[si + 1];
      out[di + 2] = bytes[si + 2];
    }
  }
  return { bytes: out, w: cw * k, h: ch * k };
}

/**
 * Mask for the Figma screenshots: 1 inside the tile, 0 on the white border
 * and in the rounded corners. Found by walking in from each edge until the
 * pixel stops being near-white.
 */
export function tileMask(bytes, w, h, extra = 3) {
  const isWhite = (x, y) => {
    const i = (y * w + x) * 3;
    return bytes[i] > 245 && bytes[i + 1] > 245 && bytes[i + 2] > 245;
  };
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let x0 = 0;
    while (x0 < w && isWhite(x0, y)) x0++;
    let x1 = w - 1;
    while (x1 > x0 && isWhite(x1, y)) x1--;
    for (let x = x0 + extra; x <= x1 - extra; x++) mask[y * w + x] = 1;
  }
  for (let x = 0; x < w; x++) {
    let y0 = 0;
    while (y0 < h && isWhite(x, y0)) y0++;
    let y1 = h - 1;
    while (y1 > y0 && isWhite(x, y1)) y1--;
    for (let y = 0; y < Math.min(h, y0 + extra); y++) mask[y * w + x] = 0;
    for (let y = Math.max(0, y1 - extra + 1); y < h; y++) mask[y * w + x] = 0;
  }
  return mask;
}

/** Box-downsample a linear image by an integer factor. */
export function downsample(img, k) {
  const w = Math.floor(img.w / k);
  const h = Math.floor(img.h / k);
  const out = makeImage(w, h);
  const inv = 1 / (k * k);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < k; j++) {
        for (let i = 0; i < k; i++) {
          const si = ((y * k + j) * img.w + x * k + i) * 3;
          r += img.data[si];
          g += img.data[si + 1];
          b += img.data[si + 2];
        }
      }
      const di = (y * w + x) * 3;
      out.data[di] = r * inv;
      out.data[di + 1] = g * inv;
      out.data[di + 2] = b * inv;
    }
  }
  return out;
}

export function downsampleMask(mask, w0, k) {
  const w = Math.floor(w0 / k);
  const h = Math.floor(mask.length / w0 / k);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ok = 1;
      for (let j = 0; j < k && ok; j++) {
        for (let i = 0; i < k; i++) {
          if (!mask[(y * k + j) * w0 + x * k + i]) {
            ok = 0;
            break;
          }
        }
      }
      out[y * w + x] = ok;
    }
  }
  return out;
}
