// Display-linear float images (interleaved RGB, max channel <= 1) to and from 8-bit sRGB files.
import sharp from 'sharp'

export const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
export const linearToSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
const DECODE = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255))

export async function loadLinear(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const out = new Float32Array(info.width * info.height * 3)
  for (let i = 0; i < out.length; i++) out[i] = DECODE[data[i]]
  return { w: info.width, h: info.height, data: out }
}

/** 32-bit integer hash (lowbias32, Chris Wellons). */
export function hash32(x) {
  x = (x ^ (x >>> 16)) >>> 0
  x = Math.imul(x, 0x7feb352d) >>> 0
  x = (x ^ (x >>> 15)) >>> 0
  x = Math.imul(x, 0x846ca68b) >>> 0
  return (x ^ (x >>> 16)) >>> 0
}
export const hash3 = (a, b, c) => hash32((hash32((hash32(a | 0) ^ (b | 0)) >>> 0) ^ (c | 0)) >>> 0)
export const unit = (h) => (h >>> 8) / 16777216

/** 8-bit sRGB bytes with triangular dither of +-1 LSB (seeded per pixel), like the engine's output pass. */
export function encode8(img, seed = 1) {
  const { w, h, data } = img
  const out = Buffer.alloc(w * h * 3)
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++, i++) {
        const v = linearToSrgb(Math.min(1, Math.max(0, data[i]))) * 255
        const a = hash3(x, y, seed * 3 + c)
        const t = unit(a) + unit(hash32(a ^ 0x9e3779b9)) - 1
        const edge = Math.min(Math.min(1, Math.max(0, v / 0.5)), 1 - Math.min(1, Math.max(0, (v - 254.5) / 0.5)))
        const n = (unit(a) - 0.5) * (1 - edge) + t * edge
        out[i] = Math.min(255, Math.max(0, Math.floor(v + n + 0.5)))
      }
    }
  }
  return out
}

export function toSharp(img, seed = 1) {
  return sharp(encode8(img, seed), { raw: { width: img.w, height: img.h, channels: 3 } })
}

export function crop(img, x0, y0, cw, ch) {
  const out = new Float32Array(cw * ch * 3)
  for (let y = 0; y < ch; y++) out.set(img.data.subarray(((y0 + y) * img.w + x0) * 3, ((y0 + y) * img.w + x0 + cw) * 3), y * cw * 3)
  return { w: cw, h: ch, data: out }
}

/** Display-linear image from 8-bit sRGB RGBA bytes (alpha dropped). */
export function fromRgba(data, w, h) {
  const out = new Float32Array(w * h * 3)
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = DECODE[data[i * 4 + c]]
  return { w, h, data: out }
}

/** The crop window (cw x ch) with the most structure: largest summed luminance gradient on a 1/8 copy. */
export function busiestWindow(img, cw, ch) {
  const f = 8
  const w = Math.floor(img.w / f)
  const h = Math.floor(img.h / f)
  const lum = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let j = 0; j < f; j++) {
        for (let i = 0; i < f; i++) {
          const k = ((y * f + j) * img.w + x * f + i) * 3
          s += Math.cbrt(0.2126 * img.data[k] + 0.7152 * img.data[k + 1] + 0.0722 * img.data[k + 2])
        }
      }
      lum[y * w + x] = s / (f * f)
    }
  }
  const grad = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) grad[y * w + x] = Math.hypot(lum[y * w + x + 1] - lum[y * w + x - 1], lum[(y + 1) * w + x] - lum[(y - 1) * w + x])
  const ww = Math.floor(cw / f)
  const wh = Math.floor(ch / f)
  let best = [0, 0]
  let bestScore = -1
  for (let y = 0; y + wh <= h; y += 2) {
    for (let x = 0; x + ww <= w; x += 2) {
      let s = 0
      for (let j = 0; j < wh; j++) for (let i = 0; i < ww; i++) s += grad[(y + j) * w + x + i]
      if (s > bestScore) {
        bestScore = s
        best = [x * f, y * f]
      }
    }
  }
  return best
}

function oklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** Oklab distance between two linear RGB pixel arrays of the same size: mean, 95th percentile, worst, mean dL (b - a). */
export function oklabDistance(a, b) {
  const n = a.length / 3
  const de = new Float32Array(n)
  let dL = 0
  for (let i = 0; i < n; i++) {
    const p = oklab(a[i * 3], a[i * 3 + 1], a[i * 3 + 2])
    const q = oklab(b[i * 3], b[i * 3 + 1], b[i * 3 + 2])
    de[i] = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
    dL += q[0] - p[0]
  }
  const sorted = Float32Array.from(de).sort()
  let sum = 0
  for (const v of de) sum += v
  return { mean: sum / n, p95: sorted[Math.floor(n * 0.95)], max: sorted[n - 1], dL: dL / n }
}

/** Area average by an integer factor in linear light (what the eye does at a distance). */
export function shrink(img, f) {
  const w = Math.floor(img.w / f)
  const h = Math.floor(img.h / f)
  const out = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0
        for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += img.data[((y * f + j) * img.w + x * f + i) * 3 + c]
        out[(y * w + x) * 3 + c] = s / (f * f)
      }
    }
  }
  return { w, h, data: out }
}
