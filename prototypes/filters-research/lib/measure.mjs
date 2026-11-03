// Blur and colour-difference checks.
import sharp from 'sharp'
import { decode8, linearToOklab } from './color.mjs'

/** Box blur of radius r along one axis on an interleaved RGB float image (edge pixels repeat). */
function boxPass(src, w, h, r, horizontal) {
  const out = new Float32Array(src.length)
  const n = horizontal ? w : h
  const lines = horizontal ? h : w
  const span = 2 * r + 1
  for (let line = 0; line < lines; line++) {
    const idx = (k) => {
      const kk = Math.min(n - 1, Math.max(0, k))
      return horizontal ? (line * w + kk) * 3 : (kk * w + line) * 3
    }
    for (let c = 0; c < 3; c++) {
      let sum = 0
      for (let k = -r; k <= r; k++) sum += src[idx(k) + c]
      for (let k = 0; k < n; k++) {
        out[idx(k) + c] = sum / span
        sum += src[idx(k + r + 1) + c] - src[idx(k - r) + c]
      }
    }
  }
  return out
}

/** Gaussian blur of std sigma px, approximated by three box blurs per axis. */
export function gaussianBlur(img, sigma) {
  const { w, h } = img
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2))
  let d = img.data
  for (let pass = 0; pass < 3; pass++) d = boxPass(d, w, h, r, true)
  for (let pass = 0; pass < 3; pass++) d = boxPass(d, w, h, r, false)
  return { w, h, data: d }
}

/** Mean and 95th-percentile Oklab distance between two linear images, skipping a border of `margin` px. */
export function oklabDiff(a, b, margin = 0) {
  const { w, h } = a
  const ds = []
  let sum = 0
  for (let y = margin; y < h - margin; y++) {
    for (let x = margin; x < w - margin; x++) {
      const i = (y * w + x) * 3
      const p = linearToOklab(a.data[i], a.data[i + 1], a.data[i + 2])
      const q = linearToOklab(b.data[i], b.data[i + 1], b.data[i + 2])
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
      ds.push(d)
      sum += d
    }
  }
  ds.sort((u, v) => u - v)
  return { mean: sum / ds.length, p95: ds[Math.floor(ds.length * 0.95)] }
}

/** What an app shows when the image is drawn small: an 8-bit sRGB downscale (sharp, lanczos, no linearisation). */
export async function srgbThumb(buf, w, h, factor) {
  const tw = Math.round(w / factor)
  const th = Math.round(h / factor)
  const data = await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).resize(tw, th, { kernel: 'lanczos3' }).raw().toBuffer()
  const out = new Float32Array(tw * th * 3)
  for (let i = 0; i < out.length; i++) out[i] = decode8(data[i])
  return { w: tw, h: th, data: out }
}
