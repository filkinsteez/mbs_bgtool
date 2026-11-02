import { blur, resizeAreaMasked, toLinear, toOklab, type FloatImage, type RgbaImage } from './image'
import { DELTA_E_SCALE } from './metrics'

export interface FitWeights {
  /** Weight of the mean per-pixel deltaE. */
  image: number
  /** Weight of the mean row-profile deltaE. */
  rows: number
  /** Weight of the mean column-profile deltaE. */
  columns: number
}

export const DEFAULT_FIT_WEIGHTS: FitWeights = { image: 1, rows: 0.5, columns: 0.5 }

/** A target prepared once for repeated loss evaluations at the fit size. */
export interface FitTarget {
  width: number
  height: number
  /** Oklab of the blurred, downsampled target. */
  lab: Float32Array
  /** Share of each pixel's area that counts (0 = masked). */
  weight: Float32Array
  rowLab: Float32Array
  columnLab: Float32Array
}

/** Blur sigma in fit pixels applied to target and render before comparing. */
const FIT_BLUR = 1

function weightedProfiles(linear: FloatImage, weight: Float32Array) {
  const { width, height, data } = linear
  const rows = new Float64Array(height * 4)
  const cols = new Float64Array(width * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const w = weight[p]
      if (w <= 0) continue
      for (let k = 0; k < 3; k++) {
        rows[y * 4 + k] += w * data[p * 3 + k]
        cols[x * 4 + k] += w * data[p * 3 + k]
      }
      rows[y * 4 + 3] += w
      cols[x * 4 + 3] += w
    }
  }
  const toLab = (acc: Float64Array, n: number) => {
    const lin = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const w = acc[i * 4 + 3]
      for (let k = 0; k < 3; k++) lin[i * 3 + k] = w > 0 ? acc[i * 4 + k] / w : NaN
    }
    return toOklab({ width: n, height: 1, channels: 3, data: lin }).data
  }
  return { rows: toLab(rows, height), columns: toLab(cols, width) }
}

export function prepareFitTarget(target: RgbaImage, mask: Uint8Array, width: number, height: number): FitTarget {
  const small = resizeAreaMasked(toLinear(target), mask, width, height)
  const blurred = blur(small.image, FIT_BLUR)
  const profiles = weightedProfiles(blurred, small.weight)
  return {
    width,
    height,
    lab: toOklab(blurred).data,
    weight: small.weight,
    rowLab: profiles.rows,
    columnLab: profiles.columns,
  }
}

function meanProfileDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0
  let n = 0
  for (let i = 0; i < a.length; i += 3) {
    if (Number.isNaN(a[i]) || Number.isNaN(b[i])) continue
    sum += Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2])
    n++
  }
  return n ? (sum / n) * DELTA_E_SCALE : 0
}

export interface FitLossParts {
  total: number
  image: number
  rows: number
  columns: number
}

/** Loss of a render at the fit size against a prepared target, in deltaE x 100 units. */
export function fitLoss(prepared: FitTarget, render: RgbaImage, weights: FitWeights = DEFAULT_FIT_WEIGHTS): FitLossParts {
  if (render.width !== prepared.width || render.height !== prepared.height) {
    throw new Error(`Fit render is ${render.width}x${render.height}, expected ${prepared.width}x${prepared.height}`)
  }
  const linear = blur(toLinear(render), FIT_BLUR)
  const lab = toOklab(linear).data
  let sum = 0
  let total = 0
  for (let p = 0; p < prepared.weight.length; p++) {
    const w = prepared.weight[p]
    if (w <= 0) continue
    const i = p * 3
    sum += w * Math.hypot(lab[i] - prepared.lab[i], lab[i + 1] - prepared.lab[i + 1], lab[i + 2] - prepared.lab[i + 2])
    total += w
  }
  const image = total ? (sum / total) * DELTA_E_SCALE : 0
  const profiles = weightedProfiles(linear, prepared.weight)
  const rows = meanProfileDistance(profiles.rows, prepared.rowLab)
  const columns = meanProfileDistance(profiles.columns, prepared.columnLab)
  return {
    total: weights.image * image + weights.rows * rows + weights.columns * columns,
    image,
    rows,
    columns,
  }
}
