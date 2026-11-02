import sharp from "sharp";

export async function loadRgb(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

export async function loadRgba(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

export async function saveRgbPng(file, img) {
  await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 3 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(file);
}

// Rotates the image content 90 degrees counterclockwise (the right edge becomes the top edge).
export function rotateCcw(img) {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < h; x++) {
      const si = (x * w + (w - 1 - y)) * 3;
      const di = (y * h + x) * 3;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
    }
  }
  return { width: h, height: w, data: out };
}

const KERNELS = {
  // Catmull-Rom (B=0, C=0.5): closest match to Figma when it enlarges an image fill.
  catmull: {
    radius: 2,
    weight(t) {
      t = Math.abs(t);
      if (t < 1) return 1.5 * t * t * t - 2.5 * t * t + 1;
      if (t < 2) return -0.5 * t * t * t + 2.5 * t * t - 4 * t + 2;
      return 0;
    },
  },
  // Mitchell-Netravali (B=C=1/3): closest match to Figma when it shrinks an image fill.
  mitchell: {
    radius: 2,
    weight(t) {
      t = Math.abs(t);
      const B = 1 / 3;
      const C = 1 / 3;
      if (t < 1) return ((12 - 9 * B - 6 * C) * t ** 3 + (-18 + 12 * B + 6 * C) * t * t + (6 - 2 * B)) / 6;
      if (t < 2) return ((-B - 6 * C) * t ** 3 + (6 * B + 30 * C) * t * t + (-12 * B - 48 * C) * t + (8 * B + 24 * C)) / 6;
      return 0;
    },
  },
};

/**
 * Axis-aligned resample. Target pixel (x, y) covers source coordinates
 * u = u0 + x / scaleX, v = v0 + y / scaleY (pixel edges, not centers).
 * scale is target pixels per source pixel. When shrinking, the kernel is
 * widened by 1 / scale so every source pixel contributes.
 */
export function resampleAxis(src, width, height, { u0, v0, scaleX, scaleY }, kernelName) {
  const kernel = KERNELS[kernelName];
  if (!kernel) throw new Error(`unknown kernel ${kernelName}`);
  const fx = Math.min(1, scaleX);
  const fy = Math.min(1, scaleY);
  const rx = kernel.radius / fx;
  const ry = kernel.radius / fy;

  const colTaps = [];
  for (let x = 0; x < width; x++) {
    const u = u0 + (x + 0.5) / scaleX - 0.5;
    const i0 = Math.ceil(u - rx);
    const i1 = Math.floor(u + rx);
    const idx = [];
    const w = [];
    for (let i = i0; i <= i1; i++) {
      const wt = kernel.weight((u - i) * fx);
      if (wt === 0) continue;
      idx.push(Math.min(Math.max(i, 0), src.width - 1));
      w.push(wt);
    }
    colTaps.push({ idx, w });
  }

  const out = new Uint8Array(width * height * 3);
  const sw = src.width;
  const sd = src.data;
  for (let y = 0; y < height; y++) {
    const v = v0 + (y + 0.5) / scaleY - 0.5;
    const j0 = Math.ceil(v - ry);
    const j1 = Math.floor(v + ry);
    const rows = [];
    const rw = [];
    for (let j = j0; j <= j1; j++) {
      const wt = kernel.weight((v - j) * fy);
      if (wt === 0) continue;
      rows.push(Math.min(Math.max(j, 0), src.height - 1));
      rw.push(wt);
    }
    for (let x = 0; x < width; x++) {
      const { idx, w } = colTaps[x];
      let a0 = 0;
      let a1 = 0;
      let a2 = 0;
      let ws = 0;
      for (let r = 0; r < rows.length; r++) {
        const base = rows[r] * sw;
        const wy = rw[r];
        for (let c = 0; c < idx.length; c++) {
          const wt = w[c] * wy;
          const q = (base + idx[c]) * 3;
          a0 += wt * sd[q];
          a1 += wt * sd[q + 1];
          a2 += wt * sd[q + 2];
          ws += wt;
        }
      }
      const o = (y * width + x) * 3;
      out[o] = clamp8(a0 / ws);
      out[o + 1] = clamp8(a1 / ws);
      out[o + 2] = clamp8(a2 / ws);
    }
  }
  return { width, height, data: out };
}

function clamp8(v) {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}

export function extractRgb(img, x0, y0, w, h) {
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * img.width + x0) * 3;
    out.set(img.data.subarray(s, s + w * 3), y * w * 3);
  }
  return { width: w, height: h, data: out };
}
