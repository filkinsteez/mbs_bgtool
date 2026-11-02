// Image IO and comparison helpers. Images are { width, height, data } where
// data is a Float32Array of linear RGB triplets, or Uint8Array of sRGB bytes.

import sharp from "sharp";
import { srgbToLinear, linearToOklab } from "./color.mjs";

// Loads a reference screenshot as linear RGB plus a mask that drops the
// transparent rounded tile corners (and a small margin around them).
export async function loadReference(path, cornerRadius = 26) {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const rgb = new Float32Array(width * height * 3);
  const mask = new Uint8Array(width * height);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
  const r = cornerRadius;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      rgb[i * 3] = lut[data[i * 4]];
      rgb[i * 3 + 1] = lut[data[i * 4 + 1]];
      rgb[i * 3 + 2] = lut[data[i * 4 + 2]];
      const cx = x < r ? r - x : x > width - 1 - r ? x - (width - 1 - r) : 0;
      const cy = y < r ? r - y : y > height - 1 - r ? y - (height - 1 - r) : 0;
      const inCorner = cx > 0 && cy > 0 && cx * cx + cy * cy > (r - 3) * (r - 3);
      const edge = x < 2 || y < 2 || x > width - 3 || y > height - 3;
      mask[i] = data[i * 4 + 3] === 255 && !inCorner && !edge ? 1 : 0;
    }
  }
  return { width, height, data: rgb, mask };
}

export async function loadBytes(path) {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

export async function saveBytes(path, img) {
  await sharp(Buffer.from(img.data), {
    raw: { width: img.width, height: img.height, channels: 3 },
  })
    .png({ compressionLevel: 6 })
    .toFile(path);
}

export async function saveJpeg(path, img, quality = 88) {
  await sharp(Buffer.from(img.data), {
    raw: { width: img.width, height: img.height, channels: 3 },
  })
    .jpeg({ quality, chromaSubsampling: "4:4:4" })
    .toFile(path);
}

// Linear float image to 8-bit sRGB bytes with plain rounding (for the
// reference side of comparisons only).
export function linearToBytes(img) {
  const out = new Uint8Array(img.width * img.height * 3);
  for (let i = 0; i < out.length; i++) {
    const c = img.data[i];
    const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    out[i] = Math.max(0, Math.min(255, Math.round(s * 255)));
  }
  return { width: img.width, height: img.height, data: out };
}

// Places byte images side by side with a gap.
export function sideBySide(images, gap = 8, gapValue = 255) {
  const height = Math.max(...images.map((im) => im.height));
  const width = images.reduce((s, im) => s + im.width, 0) + gap * (images.length - 1);
  const data = new Uint8Array(width * height * 3).fill(gapValue);
  let x0 = 0;
  for (const im of images) {
    for (let y = 0; y < im.height; y++) {
      const src = y * im.width * 3;
      data.set(im.data.subarray(src, src + im.width * 3), (y * width + x0) * 3);
    }
    x0 += im.width + gap;
  }
  return { width, height, data };
}

// Nearest-neighbour zoomed crop of a byte image. rect = [x, y, w, h].
export function zoomCrop(img, rect, scale) {
  const [rx, ry, rw, rh] = rect;
  const width = rw * scale;
  const height = rh * scale;
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, ry + Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, rx + Math.floor(x / scale));
      const s = (sy * img.width + sx) * 3;
      const d = (y * width + x) * 3;
      data[d] = img.data[s];
      data[d + 1] = img.data[s + 1];
      data[d + 2] = img.data[s + 2];
    }
  }
  return { width, height, data };
}

// Separable box blur on a linear float image (repeated passes approximate a
// gaussian). Used only for measuring.
export function blurFloat(img, radius, passes = 2) {
  const { width, height } = img;
  let src = new Float32Array(img.data);
  let tmp = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < height; y++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        let n = 0;
        for (let x = -radius; x <= radius; x++) {
          const xx = Math.min(width - 1, Math.max(0, x));
          acc += src[(y * width + xx) * 3 + c];
          n++;
        }
        for (let x = 0; x < width; x++) {
          tmp[(y * width + x) * 3 + c] = acc / n;
          const xa = Math.min(width - 1, x + radius + 1);
          const xr = Math.max(0, x - radius);
          acc += src[(y * width + xa) * 3 + c] - src[(y * width + xr) * 3 + c];
        }
      }
    }
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        let n = 0;
        for (let y = -radius; y <= radius; y++) {
          const yy = Math.min(height - 1, Math.max(0, y));
          acc += tmp[(yy * width + x) * 3 + c];
          n++;
        }
        for (let y = 0; y < height; y++) {
          src[(y * width + x) * 3 + c] = acc / n;
          const ya = Math.min(height - 1, y + radius + 1);
          const yr = Math.max(0, y - radius);
          acc += tmp[(ya * width + x) * 3 + c] - tmp[(yr * width + x) * 3 + c];
        }
      }
    }
  }
  return { width, height, data: src };
}

export function bytesToLinear(img) {
  const data = new Float32Array(img.width * img.height * 3);
  for (let i = 0; i < data.length; i++) data[i] = srgbToLinear(img.data[i] / 255);
  return { width: img.width, height: img.height, data };
}

// Mean Oklab per row (masked). Returns an array of [L, a, b].
export function rowProfile(img, mask, x0 = 0, x1 = img.width) {
  const out = [];
  for (let y = 0; y < img.height; y++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let x = x0; x < x1; x++) {
      const i = y * img.width + x;
      if (mask && !mask[i]) continue;
      r += img.data[i * 3];
      g += img.data[i * 3 + 1];
      b += img.data[i * 3 + 2];
      n++;
    }
    out.push(n ? linearToOklab(r / n, g / n, b / n) : [NaN, NaN, NaN]);
  }
  return out;
}

// Mean Oklab distance (x100) between two linear images after blurring both,
// ignoring masked-out pixels.
export function blurredDeltaE(a, b, mask, radius = 6) {
  const ba = blurFloat(a, radius);
  const bb = blurFloat(b, radius);
  let sum = 0;
  let n = 0;
  let max = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    if (mask && !mask[i]) continue;
    const la = linearToOklab(ba.data[i * 3], ba.data[i * 3 + 1], ba.data[i * 3 + 2]);
    const lb = linearToOklab(bb.data[i * 3], bb.data[i * 3 + 1], bb.data[i * 3 + 2]);
    const d = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]) * 100;
    sum += d;
    n++;
    if (d > max) max = d;
  }
  return { mean: sum / n, max };
}
