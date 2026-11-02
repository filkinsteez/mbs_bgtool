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

/** Gaussian along one line of `count` samples `stride` apart starting at `start`; edges clamped. */
function blurLine(src: Float32Array, dst: Float32Array, start: number, count: number, stride: number, kernel: Float32Array): void {
  const r = (kernel.length - 1) / 2
  const taps = kernel.length
  for (let i = 0; i < count; i++) {
    let s = 0
    if (i >= r && i < count - r) {
      let index = start + (i - r) * stride
      for (let t = 0; t < taps; t++, index += stride) s += kernel[t] * src[index]
    } else {
      for (let t = 0; t < taps; t++) {
        const j = Math.min(count - 1, Math.max(0, i + t - r))
        s += kernel[t] * src[start + j * stride]
      }
    }
    dst[start + i * stride] = s
  }
}

/** Separable gaussian blur with clamped edges. */
export function blur(image: FloatImage, sigma: number): FloatImage {
  if (sigma <= 0) return image
  const { width, height, channels: c, data } = image
  const kernel = gaussianKernel(sigma)
  const tmp = new Float32Array(data.length)
  const out = new Float32Array(data.length)
  for (let k = 0; k < c; k++) {
    for (let y = 0; y < height; y++) blurLine(data, tmp, y * width * c + k, width, c, kernel)
    for (let x = 0; x < width; x++) blurLine(tmp, out, x * c + k, height, width * c, kernel)
  }
  return { width, height, channels: c, data: out }
}

/** Gaussian blur that ignores pixels with zero weight (normalized convolution). Returns the blurred image and weight. */
export function blurMasked(image: FloatImage, weight: Float32Array, sigma: number): { image: FloatImage; weight: Float32Array } {
  const { width, height, channels: c, data } = image
  if (weight.every((w) => w === 1)) return { image: blur(image, sigma), weight }
  const premultiplied = new Float32Array(width * height * (c + 1))
  for (let p = 0; p < width * height; p++) {
    const w = weight[p]
    for (let k = 0; k < c; k++) premultiplied[p * (c + 1) + k] = data[p * c + k] * w
    premultiplied[p * (c + 1) + c] = w
  }
  const blurred = blur({ width, height, channels: c + 1, data: premultiplied }, sigma).data
  const out = new Float32Array(width * height * c)
  const outWeight = new Float32Array(width * height)
  for (let p = 0; p < width * height; p++) {
    const w = blurred[p * (c + 1) + c]
    outWeight[p] = w
    for (let k = 0; k < c; k++) out[p * c + k] = w > 1e-6 ? blurred[p * (c + 1) + k] / w : 0
  }
  return { image: { width, height, channels: c, data: out }, weight: outWeight }
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
