// Linear RGB float images and PNG input/output through sharp.

import sharp from 'sharp';
import { srgbToLinear } from './color.mjs';

export class Img {
  constructor(w, h, data) {
    this.w = w;
    this.h = h;
    this.data = data ?? new Float32Array(w * h * 3);
  }

  clone() {
    return new Img(this.w, this.h, new Float32Array(this.data));
  }

  get(x, y) {
    const i = (y * this.w + x) * 3;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }

  // Bilinear sample with clamp-to-edge, pixel centers at integer + 0.5.
  sample(x, y, out) {
    const { w, h, data } = this;
    const fx = Math.min(Math.max(x - 0.5, 0), w - 1);
    const fy = Math.min(Math.max(y - 0.5, 0), h - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, w - 1);
    const y1 = Math.min(y0 + 1, h - 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const i00 = (y0 * w + x0) * 3;
    const i10 = (y0 * w + x1) * 3;
    const i01 = (y1 * w + x0) * 3;
    const i11 = (y1 * w + x1) * 3;
    for (let c = 0; c < 3; c++) {
      const a = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * tx;
      const b = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * tx;
      out[c] = a + (b - a) * ty;
    }
    return out;
  }
}

// Reads a PNG as linear RGB. Alpha is returned separately so masks can skip
// the screenshot's transparent rounded corners.
export async function readLinear(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const img = new Img(w, h);
  const alpha = new Float32Array(w * h);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
  for (let p = 0; p < w * h; p++) {
    img.data[p * 3] = lut[data[p * 4]];
    img.data[p * 3 + 1] = lut[data[p * 4 + 1]];
    img.data[p * 3 + 2] = lut[data[p * 4 + 2]];
    alpha[p] = data[p * 4 + 3] / 255;
  }
  return { img, alpha };
}

export async function writeRgb8(path, w, h, bytes) {
  const opts = path.endsWith('.jpg') ? { quality: 88 } : {};
  let pipeline = sharp(Buffer.from(bytes), { raw: { width: w, height: h, channels: 3 } });
  pipeline = path.endsWith('.jpg') ? pipeline.jpeg(opts) : pipeline.png();
  await pipeline.toFile(path);
}

export async function readRgb8(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, bytes: new Uint8Array(data) };
}
