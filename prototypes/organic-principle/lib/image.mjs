// Images as Float32 planes. Loading decodes sRGB to linear RGB; saving encodes with a
// small TPDF dither so smooth ramps don't band.
import sharp from 'sharp'
import { linearToOklab, linearToSrgb, srgbToLinear, oklabToLinear } from './color.mjs'

const DECODE = new Float32Array(256).map((_, i) => srgbToLinear(i / 255))

/**
 * Loads an image as linear RGB planes. Options: crop {left, top, width, height} in source
 * pixels (applied first), then width/height for a resize (sharp, Lanczos).
 */
export async function loadLinear(file, { crop, width, height } = {}) {
  let img = sharp(file).removeAlpha()
  if (crop) img = img.extract(crop)
  if (width || height) img = img.resize({ width, height, fit: 'fill', kernel: 'lanczos3' })
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const r = new Float32Array(w * h)
  const g = new Float32Array(w * h)
  const b = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    r[i] = DECODE[data[3 * i]]
    g[i] = DECODE[data[3 * i + 1]]
    b[i] = DECODE[data[3 * i + 2]]
  }
  return { w, h, r, g, b }
}

let ditherState = 12345
const rand = () => {
  ditherState = (Math.imul(ditherState, 1664525) + 1013904223) >>> 0
  return ditherState / 4294967296
}

/** Saves linear RGB planes (display-linear, clamped) as an 8-bit PNG or JPEG. */
export async function saveLinear(img, file, { quality = 92 } = {}) {
  const { w, h } = img
  const out = Buffer.alloc(w * h * 3)
  const planes = [img.r, img.g, img.b]
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) {
      const v = linearToSrgb(Math.min(1, Math.max(0, planes[c][i]))) * 255 + (rand() + rand() - 1)
      out[3 * i + c] = Math.min(255, Math.max(0, Math.round(v)))
    }
  }
  let s = sharp(out, { raw: { width: w, height: h, channels: 3 } })
  s = file.endsWith('.jpg') ? s.jpeg({ quality, chromaSubsampling: '4:4:4' }) : s.png({ compressionLevel: 9 })
  await s.toFile(file)
}

/** Saves sRGB-encoded planes (values 0..1) without changing them. */
export async function saveEncoded(planes, w, h, file, { quality = 92 } = {}) {
  const out = Buffer.alloc(w * h * 3)
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) out[3 * i + c] = Math.min(255, Math.max(0, Math.round(planes[c][i] * 255)))
  let s = sharp(out, { raw: { width: w, height: h, channels: 3 } })
  s = file.endsWith('.jpg') ? s.jpeg({ quality, chromaSubsampling: '4:4:4' }) : s.png({ compressionLevel: 9 })
  await s.toFile(file)
}

export function toOklab(img) {
  const n = img.w * img.h
  const L = new Float32Array(n)
  const A = new Float32Array(n)
  const B = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const o = linearToOklab(Math.max(0, img.r[i]), Math.max(0, img.g[i]), Math.max(0, img.b[i]))
    L[i] = o[0]
    A[i] = o[1]
    B[i] = o[2]
  }
  return { w: img.w, h: img.h, L, A, B }
}

export function fromOklab(lab) {
  const n = lab.w * lab.h
  const r = new Float32Array(n)
  const g = new Float32Array(n)
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const c = oklabToLinear(lab.L[i], lab.A[i], lab.B[i])
    r[i] = c[0]
    g[i] = c[1]
    b[i] = c[2]
  }
  return { w: lab.w, h: lab.h, r, g, b }
}

export function cropPlanes(img, left, top, width, height) {
  const out = { w: width, h: height }
  for (const k of ['r', 'g', 'b', 'L', 'A', 'B']) {
    if (!img[k]) continue
    const p = new Float32Array(width * height)
    for (let y = 0; y < height; y++) p.set(img[k].subarray((top + y) * img.w + left, (top + y) * img.w + left + width), y * width)
    out[k] = p
  }
  return out
}
