// Color helpers: sRGB <-> linear, Oklab, luminance, and image loading with sharp.
import sharp from 'sharp'

export const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
export const linearToSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055)

export function hexToLinear(hex) {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255))
}

export function linearToHex(rgb) {
  return (
    '#' +
    rgb
      .map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

export const LUMA = [0.2126, 0.7152, 0.0722]
export const luminance = (c) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2]

export function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export function linearToOklch(c) {
  const [L, a, b] = linearToOklab(c)
  const C = Math.hypot(a, b)
  let h = (Math.atan2(b, a) * 180) / Math.PI
  if (h < 0) h += 360
  return [L, C, h]
}

/** Loads an image as linear RGB floats, row-major, 3 channels. */
export async function loadLinear(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const lut = new Float32Array(256).map((_, i) => srgbToLinear(i / 255))
  const px = new Float32Array(width * height * 3)
  for (let i = 0; i < width * height * 3; i++) px[i] = lut[data[i]]
  return { width, height, px }
}

/** Mean linear color over a rectangle [x0, x1) x [y0, y1). */
export function meanRect(img, x0, x1, y0, y1) {
  const { width, px } = img
  const s = [0, 0, 0]
  let n = 0
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
      const i = (y * width + x) * 3
      s[0] += px[i]
      s[1] += px[i + 1]
      s[2] += px[i + 2]
      n++
    }
  }
  return n ? s.map((v) => v / n) : [0, 0, 0]
}

export const fmt = (v, d = 3) => (typeof v === 'number' ? v.toFixed(d) : String(v))
export const describe = (c) => {
  const [L, C, h] = linearToOklch(c)
  return `${linearToHex(c)} L ${L.toFixed(3)} C ${C.toFixed(3)} h ${h.toFixed(0)}`
}
