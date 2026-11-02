import { blur, toLinear, type FloatImage, type RgbaImage } from './image'

/** Distances from the light, as fractions of the short side, where the audit compares glows. */
export const FALLOFF_DISTANCES = [0.01, 0.02, 0.04, 0.07] as const
/** Far ring whose level is taken as the background and subtracted. */
const BACKGROUND_DISTANCE = 0.15
/** Pixels at least this share of the target's (lightly blurred) peak count as the light. */
const LIGHT_LEVEL = 0.5
/** Glow excess below this (linear luminance, about one code value near black) is too faint to compare. */
const FLOOR = 3e-4

export interface FalloffProfile {
  /** Distances from the light, short-side units. */
  distances: number[]
  /** Glow above the far background, as a share of the light's own mean level, per distance. */
  target: number[]
  render: number[]
  /** Render glow / target glow (linear light above the background) per distance; null where the target glow is too faint. */
  ratio: (number | null)[]
  /** Exponential falloff length fitted over the distances (short-side units); null when it cannot be fitted. */
  length: { target: number | null; render: number | null }
  /** Share of the frame that counts as the light. */
  lightShare: number
}

/** Linear luminance at half size (2 x 2 means), with a validity share from the mask. */
function halfLuminance(image: RgbaImage, mask: Uint8Array | null): { lum: Float32Array; valid: Float32Array; width: number; height: number } {
  const linear = toLinear(image).data
  const width = Math.max(1, Math.floor(image.width / 2))
  const height = Math.max(1, Math.floor(image.height / 2))
  const lum = new Float32Array(width * height)
  const valid = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      let count = 0
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
          const p = (y * 2 + j) * image.width + x * 2 + i
          if (mask && !mask[p]) continue
          sum += 0.2126 * linear[p * 3] + 0.7152 * linear[p * 3 + 1] + 0.0722 * linear[p * 3 + 2]
          count++
        }
      }
      lum[y * width + x] = count ? sum / count : 0
      valid[y * width + x] = count / 4
    }
  }
  return { lum, valid, width, height }
}

/** Squared Euclidean distance to the nearest set pixel, in pixels (Felzenszwalb & Huttenlocher, 1D passes). */
function distanceSquared(seed: Uint8Array, width: number, height: number): Float32Array {
  const INF = 1e20
  const out = new Float32Array(width * height)
  for (let i = 0; i < out.length; i++) out[i] = seed[i] ? 0 : INF
  const n = Math.max(width, height)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  const pass = (length: number, get: (i: number) => number, set: (i: number, value: number) => void) => {
    for (let i = 0; i < length; i++) f[i] = get(i)
    let k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF
    for (let q = 1; q < length; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) {
        k--
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < length; q++) {
      while (z[k + 1] < q) k++
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
    }
    for (let i = 0; i < length; i++) set(i, d[i])
  }
  for (let x = 0; x < width; x++) pass(height, (y) => out[y * width + x], (y, value) => (out[y * width + x] = value))
  for (let y = 0; y < height; y++) pass(width, (x) => out[y * width + x], (x, value) => (out[y * width + x] = value))
  return out
}

/** Mean of `values` over the darker half (by `order`) of the given pixels. */
function darkerHalfMean(pixels: number[], order: Float32Array, values: Float32Array): number {
  if (pixels.length === 0) return NaN
  const sorted = [...pixels].sort((a, b) => order[a] - order[b])
  const half = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)))
  return half.reduce((sum, p) => sum + values[p], 0) / half.length
}

function fitLength(distances: readonly number[], glow: number[]): number | null {
  const points = distances.map((d, i) => [d, glow[i]]).filter(([, g]) => g > 0)
  if (points.length < 2) return null
  const n = points.length
  const mx = points.reduce((s, [d]) => s + d, 0) / n
  const my = points.reduce((s, [, g]) => s + Math.log(g), 0) / n
  let sxy = 0
  let sxx = 0
  for (const [d, g] of points) {
    sxy += (d - mx) * (Math.log(g) - my)
    sxx += (d - mx) * (d - mx)
  }
  const slope = sxy / sxx
  return slope < 0 ? -1 / slope : null
}

/**
 * How a glow falls off outward from the brightest light, in target and render.
 * The light is where the target, lightly blurred, is at least half its peak.
 * At each distance a thin ring around the light is taken, its darker half by
 * target luminance (the outer side of a rim or line), and the same pixels are
 * read in both images. The far ring at 0.15 of the short side is subtracted as
 * the background.
 */
export function falloffProfile(
  target: RgbaImage,
  render: RgbaImage,
  mask: Uint8Array | null,
  distances: readonly number[] = FALLOFF_DISTANCES,
): FalloffProfile {
  const t = halfLuminance(target, mask)
  const r = halfLuminance(render, mask)
  const { width, height } = t
  const short = Math.min(width, height)
  const smooth: FloatImage = blur({ width, height, channels: 1, data: t.lum }, Math.max(0.6, 0.002 * short))
  let peak = 0
  for (let p = 0; p < smooth.data.length; p++) if (t.valid[p] >= 0.5) peak = Math.max(peak, smooth.data[p])
  const light = new Uint8Array(width * height)
  let lightCount = 0
  for (let p = 0; p < light.length; p++) {
    if (t.valid[p] >= 0.5 && smooth.data[p] >= LIGHT_LEVEL * peak) {
      light[p] = 1
      lightCount++
    }
  }
  const dist2 = distanceSquared(light, width, height)
  const ring = (d: number): number[] => {
    const center = d * short
    const half = Math.max(1, 0.12 * center)
    const lo = (center - half) ** 2
    const hi = (center + half) ** 2
    const pixels: number[] = []
    for (let p = 0; p < dist2.length; p++) if (t.valid[p] >= 0.99 && dist2[p] >= lo && dist2[p] <= hi) pixels.push(p)
    return pixels
  }
  const lightPixels: number[] = []
  for (let p = 0; p < light.length; p++) if (light[p]) lightPixels.push(p)
  const levelT = lightPixels.reduce((s, p) => s + t.lum[p], 0) / Math.max(1, lightPixels.length)
  const levelR = lightPixels.reduce((s, p) => s + r.lum[p], 0) / Math.max(1, lightPixels.length)
  const far = ring(BACKGROUND_DISTANCE)
  const backgroundT = far.length ? darkerHalfMean(far, t.lum, t.lum) : 0
  const backgroundR = far.length ? darkerHalfMean(far, t.lum, r.lum) : 0
  const glowT: number[] = []
  const glowR: number[] = []
  const ratio: (number | null)[] = []
  for (const d of distances) {
    const pixels = ring(d)
    const excessT = darkerHalfMean(pixels, t.lum, t.lum) - backgroundT
    const excessR = darkerHalfMean(pixels, t.lum, r.lum) - backgroundR
    glowT.push(excessT / Math.max(levelT, 1e-6))
    glowR.push(excessR / Math.max(levelR, 1e-6))
    ratio.push(Number.isFinite(excessT) && excessT > FLOOR ? excessR / excessT : null)
  }
  return {
    distances: [...distances],
    target: glowT,
    render: glowR,
    ratio,
    length: { target: fitLength(distances, glowT), render: fitLength(distances, glowR) },
    lightShare: lightCount / light.length,
  }
}

/** One line for logs and compare sheets. */
export function formatFalloff(profile: FalloffProfile): string {
  const ratios = profile.distances.map((d, i) => `${d}: ${profile.ratio[i] === null ? '-' : (profile.ratio[i] as number).toFixed(2)}`).join('  ')
  const length = (v: number | null) => (v === null ? '-' : v.toFixed(3))
  return `falloff render/target ${ratios}; length target ${length(profile.length.target)} render ${length(profile.length.render)}`
}
