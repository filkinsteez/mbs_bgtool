// Oklab lightness isolines drawn over an image, to show whether boundaries curve and drift or run straight and parallel.
import sharp from 'sharp'

const SRGB_TO_LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

/** Distinct line colors, cycled per level. */
const COLORS = ['#ff5c5c', '#ffb347', '#ffe66d', '#7bd389', '#4ecdc4', '#5c9dff', '#b39ddb', '#ff8ad8', '#ffffff', '#c8c8c8']

/**
 * Oklab L at 1/factor size (area means in linear light), blurred by `blurShare` of the short side so grain, dither
 * and JPEG blocks do not draw their own little loops.
 */
export function lightnessField(image, factor = 2, blurShare = 0.008) {
  const w = Math.max(1, Math.floor(image.width / factor))
  const h = Math.max(1, Math.floor(image.height / factor))
  const sigma = Math.max(1, blurShare * Math.min(w, h))
  const field = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rgb = [0, 0, 0]
      for (let j = 0; j < factor; j++) {
        for (let i = 0; i < factor; i++) {
          const p = ((y * factor + j) * image.width + x * factor + i) * 4
          for (let k = 0; k < 3; k++) rgb[k] += SRGB_TO_LINEAR[image.data[p + k]]
        }
      }
      const [r, g, b] = rgb.map((v) => v / (factor * factor))
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
      field[y * w + x] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    }
  }
  return { width: w, height: h, factor, data: blur(field, w, h, sigma) }
}

function blur(values, w, h, sigma) {
  const radius = Math.max(1, Math.ceil(3 * sigma))
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-0.5 * ((i - radius) / sigma) ** 2))
  const total = kernel.reduce((a, b) => a + b, 0)
  const tmp = new Float32Array(values.length)
  const out = new Float32Array(values.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let t = -radius; t <= radius; t++) s += kernel[t + radius] * values[y * w + Math.min(w - 1, Math.max(0, x + t))]
      tmp[y * w + x] = s / total
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let t = -radius; t <= radius; t++) s += kernel[t + radius] * tmp[Math.min(h - 1, Math.max(0, y + t)) * w + x]
      out[y * w + x] = s / total
    }
  }
  return out
}

/** `count` evenly spaced lightness levels between the 2nd and 98th percentile of a field. */
export function isolineLevels(field, count) {
  const sorted = Float32Array.from(field.data).sort()
  const lo = sorted[Math.floor(0.02 * (sorted.length - 1))]
  const hi = sorted[Math.floor(0.98 * (sorted.length - 1))]
  return Array.from({ length: count }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / count)
}

/** Marching-squares segments of one level, in image pixel coordinates. */
function segments(field, level) {
  const { width: w, height: h, data, factor } = field
  const out = []
  const point = (x, y) => [(x + 0.5) * factor, (y + 0.5) * factor]
  const edge = (a, b, va, vb) => {
    const f = (level - va) / (vb - va)
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
  }
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const v0 = data[y * w + x]
      const v1 = data[y * w + x + 1]
      const v2 = data[(y + 1) * w + x + 1]
      const v3 = data[(y + 1) * w + x]
      const code = (v0 > level ? 1 : 0) | (v1 > level ? 2 : 0) | (v2 > level ? 4 : 0) | (v3 > level ? 8 : 0)
      if (code === 0 || code === 15) continue
      const [p0, p1, p2, p3] = [point(x, y), point(x + 1, y), point(x + 1, y + 1), point(x, y + 1)]
      const top = () => edge(p0, p1, v0, v1)
      const right = () => edge(p1, p2, v1, v2)
      const bottom = () => edge(p3, p2, v3, v2)
      const left = () => edge(p0, p3, v0, v3)
      const centerAbove = (v0 + v1 + v2 + v3) / 4 > level
      switch (code) {
        case 1: case 14: out.push([left(), top()]); break
        case 2: case 13: out.push([top(), right()]); break
        case 3: case 12: out.push([left(), right()]); break
        case 4: case 11: out.push([right(), bottom()]); break
        case 6: case 9: out.push([top(), bottom()]); break
        case 7: case 8: out.push([left(), bottom()]); break
        case 5:
          if (centerAbove) out.push([left(), bottom()], [top(), right()])
          else out.push([left(), top()], [right(), bottom()])
          break
        case 10:
          if (centerAbove) out.push([left(), top()], [right(), bottom()])
          else out.push([left(), bottom()], [top(), right()])
          break
        default:
          break
      }
    }
  }
  return out
}

/** The image with the given levels' isolines drawn over it (dark outline under a colored line). */
export async function drawIsolines(image, field, levels) {
  const paths = levels.map((level, i) => {
    const d = segments(field, level)
      .map(([a, b]) => `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`)
      .join('')
    const color = COLORS[i % COLORS.length]
    return `<path d="${d}" stroke="#000" stroke-opacity="0.6" stroke-width="3" fill="none" stroke-linecap="round"/><path d="${d}" stroke="${color}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`
  })
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}">${paths.join('')}</svg>`)
  const { data, info } = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
    .composite([{ input: svg, left: 0, top: 0 }])
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

/** Target and render with the same isolines: levels evenly spaced over the target's lightness. */
export async function isolinePair(target, render, count) {
  const targetField = lightnessField(target)
  const renderField = lightnessField(render)
  const levels = isolineLevels(targetField, count)
  return {
    levels,
    target: await drawIsolines(target, targetField, levels),
    render: await drawIsolines(render, renderField, levels),
  }
}
