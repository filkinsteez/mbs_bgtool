import { srgbToLinear } from '../color/srgb'

/** 8-bit RGBA, rows top to bottom. */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

/** Interleaved float channels, rows top to bottom. */
export interface FloatImage {
  width: number
  height: number
  channels: number
  data: Float32Array
}

const LINEAR_LUT = (() => {
  const lut = new Float32Array(256)
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255)
  return lut
})()

export function toLinear(image: RgbaImage): FloatImage {
  const { width, height, data } = image
  const out = new Float32Array(width * height * 3)
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    out[j] = LINEAR_LUT[data[i]]
    out[j + 1] = LINEAR_LUT[data[i + 1]]
    out[j + 2] = LINEAR_LUT[data[i + 2]]
  }
  return { width, height, channels: 3, data: out }
}

/** Oklab per pixel from a linear RGB image. */
export function toOklab(linear: FloatImage): FloatImage {
  const { width, height, data } = linear
  const out = new Float32Array(width * height * 3)
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    out[i] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    out[i + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    out[i + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  }
  return { width, height, channels: 3, data: out }
}

/**
 * Area resize of a linear image to an arbitrary smaller size, ignoring masked
 * pixels. Returns the image and, per output pixel, the share of its area that
 * was valid (0 means fully masked).
 */
export function resizeAreaMasked(
  image: FloatImage,
  mask: Uint8Array | null,
  width: number,
  height: number,
): { image: FloatImage; weight: Float32Array } {
  const { width: sw, height: sh, channels: c, data } = image
  const out = new Float32Array(width * height * c)
  const weight = new Float32Array(width * height)
  const sx = sw / width
  const sy = sh / height
  const acc = new Float64Array(c)
  for (let y = 0; y < height; y++) {
    const y0 = y * sy
    const y1 = y0 + sy
    for (let x = 0; x < width; x++) {
      const x0 = x * sx
      const x1 = x0 + sx
      acc.fill(0)
      let total = 0
      let valid = 0
      for (let yy = Math.floor(y0); yy < Math.min(sh, Math.ceil(y1)); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy)
        for (let xx = Math.floor(x0); xx < Math.min(sw, Math.ceil(x1)); xx++) {
          const w = wy * (Math.min(x1, xx + 1) - Math.max(x0, xx))
          total += w
          const p = yy * sw + xx
          if (mask && !mask[p]) continue
          valid += w
          for (let k = 0; k < c; k++) acc[k] += w * data[p * c + k]
        }
      }
      const o = y * width + x
      weight[o] = total > 0 ? valid / total : 0
      for (let k = 0; k < c; k++) out[o * c + k] = valid > 0 ? acc[k] / valid : 0
    }
  }
  return { image: { width, height, channels: c, data: out }, weight }
}

function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(3 * sigma))
  const kernel = new Float32Array(2 * radius + 1)
  let sum = 0
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp((-0.5 * i * i) / (sigma * sigma))
    kernel[i + radius] = v
    sum += v
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum
  return kernel
}

/** Separable gaussian blur with clamped edges. */
export function blur(image: FloatImage, sigma: number): FloatImage {
  if (sigma <= 0) return image
  const { width, height, channels: c, data } = image
  const kernel = gaussianKernel(sigma)
  const r = (kernel.length - 1) / 2
  const tmp = new Float32Array(data.length)
  const out = new Float32Array(data.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < c; k++) {
        let s = 0
        for (let i = -r; i <= r; i++) {
          const xx = Math.min(width - 1, Math.max(0, x + i))
          s += kernel[i + r] * data[(row + xx) * c + k]
        }
        tmp[(row + x) * c + k] = s
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < c; k++) {
        let s = 0
        for (let i = -r; i <= r; i++) {
          const yy = Math.min(height - 1, Math.max(0, y + i))
          s += kernel[i + r] * tmp[(yy * width + x) * c + k]
        }
        out[(y * width + x) * c + k] = s
      }
    }
  }
  return { width, height, channels: c, data: out }
}

/** Encoded luma (0..255) per pixel. */
export function luma8(image: RgbaImage): FloatImage {
  const { width, height, data } = image
  const out = new Float32Array(width * height)
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
  }
  return { width, height, channels: 1, data: out }
}
