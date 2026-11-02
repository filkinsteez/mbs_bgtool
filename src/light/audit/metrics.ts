import { linearToSrgb } from '../color/srgb'
import { blur, blurMasked, luma8, resizeAreaMasked, toLinear, toOklab, type FloatImage, type RgbaImage } from './image'
import { maskedShare } from './mask'

/** deltaE values are plain Euclidean Oklab distances (L on 0..1); about 0.02 is one just-noticeable difference. */
export const DELTA_E_SCALE = 1
/** Heatmap color scale: 0 (black) .. HEATMAP_MAX (white), in Oklab deltaE. */
export const HEATMAP_MAX = 0.15
/** Metric images are area-downsampled by this factor first. */
export const METRIC_DOWNSAMPLE = 4
/** Then blurred with a gaussian of this share of the short edge (removes grain, dither and JPEG blocks). */
export const METRIC_BLUR = 0.01

export interface ClipShare {
  /** Share of pixels with a channel at 255. */
  high: number
  /** Share of pixels with every channel at 0. */
  low: number
}

export interface AuditMetrics {
  width: number
  height: number
  maskedShare: number
  /** On images area-downsampled by METRIC_DOWNSAMPLE and blurred by METRIC_BLUR of the short edge. */
  deltaE: { mean: number; p95: number; max: number }
  rowProfileDeltaE: { mean: number; max: number }
  columnProfileDeltaE: { mean: number; max: number }
  /** Earth mover's distance between Oklab L histograms and between chroma histograms. */
  histogramDistance: { L: number; C: number }
  /** Share of pixels on long monotonic 8-bit steps (0 = no banding, 1 = fully banded). */
  banding: { target: number; render: number }
  clipped: { target: ClipShare; render: ClipShare }
  /** Robust standard deviation of high-passed luma, in 8-bit code values. */
  grain: { target: number; render: number }
}

export interface RowProfiles {
  /** Mean sRGB (0..255) of each row. */
  target: number[][]
  render: number[][]
  targetL: number[]
  renderL: number[]
  targetC: number[]
  renderC: number[]
}

export interface Comparison {
  metrics: AuditMetrics
  /** Per-pixel deltaE of lightly blurred images on the fixed scale; masked pixels are grey. */
  heatmap: RgbaImage
  rows: RowProfiles
}

function percentile(values: Float32Array | number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = Float32Array.from(values).sort()
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]
}

function deltaEAt(a: Float32Array, b: Float32Array, i: number): number {
  const dl = a[i] - b[i]
  const da = a[i + 1] - b[i + 1]
  const db = a[i + 2] - b[i + 2]
  return Math.sqrt(dl * dl + da * da + db * db) * DELTA_E_SCALE
}

function oklabOfMean(r: number, g: number, b: number): [number, number, number] {
  const lab = toOklab({ width: 1, height: 1, channels: 3, data: new Float32Array([r, g, b]) }).data
  return [lab[0], lab[1], lab[2]]
}

/** Masked mean linear color per row (axis 'rows') or column (axis 'columns'). */
function profile(linear: FloatImage, mask: Uint8Array, axis: 'rows' | 'columns'): { mean: Float64Array; valid: Uint8Array } {
  const { width, height, data } = linear
  const n = axis === 'rows' ? height : width
  const sum = new Float64Array(n * 3)
  const count = new Float64Array(n)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (!mask[p]) continue
      const k = axis === 'rows' ? y : x
      sum[k * 3] += data[p * 3]
      sum[k * 3 + 1] += data[p * 3 + 1]
      sum[k * 3 + 2] += data[p * 3 + 2]
      count[k]++
    }
  }
  const valid = new Uint8Array(n)
  for (let k = 0; k < n; k++) {
    if (count[k] < 1) continue
    valid[k] = 1
    sum[k * 3] /= count[k]
    sum[k * 3 + 1] /= count[k]
    sum[k * 3 + 2] /= count[k]
  }
  return { mean: sum, valid }
}

function profileDeltaE(a: { mean: Float64Array; valid: Uint8Array }, b: { mean: Float64Array; valid: Uint8Array }) {
  let total = 0
  let max = 0
  let n = 0
  for (let k = 0; k < a.valid.length; k++) {
    if (!a.valid[k] || !b.valid[k]) continue
    const la = oklabOfMean(a.mean[k * 3], a.mean[k * 3 + 1], a.mean[k * 3 + 2])
    const lb = oklabOfMean(b.mean[k * 3], b.mean[k * 3 + 1], b.mean[k * 3 + 2])
    const d = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]) * DELTA_E_SCALE
    total += d
    max = Math.max(max, d)
    n++
  }
  return { mean: n ? total / n : 0, max }
}

function histogramEmd(a: Float32Array, b: Float32Array, weight: Float32Array, channel: (lab: Float32Array, i: number) => number, lo: number, hi: number): number {
  const bins = 64
  const ha = new Float64Array(bins)
  const hb = new Float64Array(bins)
  let wa = 0
  let wb = 0
  for (let p = 0; p < weight.length; p++) {
    if (weight[p] < 0.999) continue
    const va = channel(a, p * 3)
    const vb = channel(b, p * 3)
    ha[Math.min(bins - 1, Math.max(0, Math.floor(((va - lo) / (hi - lo)) * bins)))]++
    hb[Math.min(bins - 1, Math.max(0, Math.floor(((vb - lo) / (hi - lo)) * bins)))]++
    wa++
    wb++
  }
  if (!wa || !wb) return 0
  let ca = 0
  let cb = 0
  let emd = 0
  for (let i = 0; i < bins; i++) {
    ca += ha[i] / wa
    cb += hb[i] / wb
    emd += Math.abs(ca - cb) * ((hi - lo) / bins)
  }
  return emd * DELTA_E_SCALE
}

/**
 * Share of valid pixels that sit on monotonic 8-bit steps at least `minRun`
 * pixels long, worst channel and axis. TPDF dither rarely leaves 24 equal
 * values in a row, so a dithered ramp scores near 0 and an undithered one near 1.
 */
export function bandingScore(image: RgbaImage, mask: Uint8Array, minRun = 24): number {
  const { width, height, data } = image
  let worst = 0
  for (let channel = 0; channel < 3; channel++) {
    worst = Math.max(worst, stepShare(data, mask, height, width, width, 1, channel, minRun))
    worst = Math.max(worst, stepShare(data, mask, width, height, 1, width, channel, minRun))
  }
  return worst
}

/** Scans `lines` lines of `length` pixels; pixel i of line l is l * lineStep + i * step. */
function stepShare(data: RgbaImage['data'], mask: Uint8Array, lines: number, length: number, lineStep: number, step: number, channel: number, minRun: number): number {
  let stepped = 0
  let counted = 0
  for (let line = 0; line < lines; line++) {
    const base = line * lineStep
    let start = 0
    let value = data[base * 4 + channel]
    let previous = -1
    let validInRun = mask[base] ? 1 : 0
    for (let i = 1; i <= length; i++) {
      const p = base + i * step
      const current = i < length ? data[p * 4 + channel] : -1
      if (i < length && current === value) {
        if (mask[p]) validInRun++
        continue
      }
      counted += validInRun
      const monotonic = previous >= 0 && current >= 0 && (previous - value) * (value - current) > 0
      if (monotonic && i - start >= minRun) stepped += validInRun
      previous = value
      value = current
      start = i
      validInRun = i < length && mask[p] ? 1 : 0
    }
  }
  return counted > 0 ? stepped / counted : 0
}

function clipShare(image: RgbaImage, mask: Uint8Array): ClipShare {
  const { data } = image
  let high = 0
  let low = 0
  let n = 0
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue
    const r = data[p * 4]
    const g = data[p * 4 + 1]
    const b = data[p * 4 + 2]
    if (r === 255 || g === 255 || b === 255) high++
    if (r === 0 && g === 0 && b === 0) low++
    n++
  }
  return { high: n ? high / n : 0, low: n ? low / n : 0 }
}

/**
 * Robust std (1.4826 x median absolute value) of luma minus its 5x5 box mean,
 * in 8-bit code values, on up to about 250k pixels where the whole box is valid.
 */
export function grainLevel(image: RgbaImage, mask: Uint8Array): number {
  const { width, height } = image
  const luma = luma8(image).data
  const binWidth = 0.02
  const bins = new Uint32Array(2000)
  let count = 0
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 250000)))
  for (let y = 2; y < height - 2; y += stride) {
    for (let x = 2; x < width - 2; x += stride) {
      let sum = 0
      let valid = true
      for (let dy = -2; dy <= 2 && valid; dy++) {
        const row = (y + dy) * width
        for (let dx = -2; dx <= 2; dx++) {
          if (!mask[row + x + dx]) {
            valid = false
            break
          }
          sum += luma[row + x + dx]
        }
      }
      if (!valid) continue
      const residual = Math.abs(luma[y * width + x] - sum / 25)
      bins[Math.min(bins.length - 1, Math.floor(residual / binWidth))]++
      count++
    }
  }
  if (count === 0) return 0
  let seen = 0
  for (let i = 0; i < bins.length; i++) {
    seen += bins[i]
    if (seen >= count / 2) return 1.4826 * (i + 0.5) * binWidth * (25 / 24)
  }
  return 0
}

const HEAT_STOPS: [number, number, number, number][] = [
  [0, 0, 0, 0],
  [0.2, 40, 20, 110],
  [0.45, 150, 30, 120],
  [0.7, 235, 110, 30],
  [0.9, 250, 220, 60],
  [1, 255, 255, 255],
]

export function heatColor(value: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, value / HEATMAP_MAX))
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [t1, r1, g1, b1] = HEAT_STOPS[i]
    const [t0, r0, g0, b0] = HEAT_STOPS[i - 1]
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0)
      return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f]
    }
  }
  return [255, 255, 255]
}

/**
 * Per-pixel Oklab deltaE between two images after a light blur (sigma in full-size px),
 * computed at half size and repeated to full size.
 */
export function deltaEMap(target: RgbaImage, render: RgbaImage, sigma = 1.5): Float32Array {
  const { width, height } = target
  const hw = Math.max(1, Math.round(width / 2))
  const hh = Math.max(1, Math.round(height / 2))
  const half = (image: RgbaImage) => toOklab(blur(resizeAreaMasked(toLinear(image), null, hw, hh).image, sigma / 2)).data
  const a = half(target)
  const b = half(render)
  const small = new Float32Array(hw * hh)
  for (let p = 0; p < small.length; p++) small[p] = deltaEAt(a, b, p * 3)
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(hh - 1, Math.floor((y * hh) / height))
    for (let x = 0; x < width; x++) out[y * width + x] = small[sy * hw + Math.min(hw - 1, Math.floor((x * hw) / width))]
  }
  return out
}

export function heatmapImage(map: Float32Array, width: number, height: number, mask: Uint8Array | null): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < map.length; p++) {
    const [r, g, b] = mask && !mask[p] ? [64, 64, 64] : heatColor(map[p])
    data[p * 4] = r
    data[p * 4 + 1] = g
    data[p * 4 + 2] = b
    data[p * 4 + 3] = 255
  }
  return { width, height, data }
}

/** Compares a render with its target (same size). The mask marks pixels that count. */
export function compareImages(target: RgbaImage, render: RgbaImage, mask: Uint8Array): Comparison {
  if (target.width !== render.width || target.height !== render.height) {
    throw new Error(`Size mismatch: target ${target.width}x${target.height}, render ${render.width}x${render.height}`)
  }
  const { width, height } = target
  const linT = toLinear(target)
  const linR = toLinear(render)

  const dw = Math.max(1, Math.round(width / METRIC_DOWNSAMPLE))
  const dh = Math.max(1, Math.round(height / METRIC_DOWNSAMPLE))
  const sigma = METRIC_BLUR * Math.min(dw, dh)
  const reducedT = resizeAreaMasked(linT, mask, dw, dh)
  const reducedR = resizeAreaMasked(linR, mask, dw, dh)
  const smallT = blurMasked(reducedT.image, reducedT.weight, sigma)
  const smallR = blurMasked(reducedR.image, reducedT.weight, sigma)
  const labT = toOklab(smallT.image).data
  const labR = toOklab(smallR.image).data
  const errors: number[] = []
  let sum = 0
  let max = 0
  for (let p = 0; p < dw * dh; p++) {
    if (reducedT.weight[p] < 0.999) continue
    const d = deltaEAt(labT, labR, p * 3)
    errors.push(d)
    sum += d
    max = Math.max(max, d)
  }

  const rowsT = profile(linT, mask, 'rows')
  const rowsR = profile(linR, mask, 'rows')
  const colsT = profile(linT, mask, 'columns')
  const colsR = profile(linR, mask, 'columns')

  const map = deltaEMap(target, render)
  const rows: RowProfiles = { target: [], render: [], targetL: [], renderL: [], targetC: [], renderC: [] }
  for (let y = 0; y < height; y++) {
    for (const [source, colors, ls, cs] of [
      [rowsT, rows.target, rows.targetL, rows.targetC],
      [rowsR, rows.render, rows.renderL, rows.renderC],
    ] as const) {
      const r = source.mean[y * 3]
      const g = source.mean[y * 3 + 1]
      const b = source.mean[y * 3 + 2]
      colors.push([r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255)))
      const lab = oklabOfMean(r, g, b)
      ls.push(source.valid[y] ? lab[0] : NaN)
      cs.push(source.valid[y] ? Math.hypot(lab[1], lab[2]) : NaN)
    }
  }

  const metrics: AuditMetrics = {
    width,
    height,
    maskedShare: maskedShare(mask),
    deltaE: { mean: errors.length ? sum / errors.length : 0, p95: percentile(errors, 0.95), max },
    rowProfileDeltaE: profileDeltaE(rowsT, rowsR),
    columnProfileDeltaE: profileDeltaE(colsT, colsR),
    histogramDistance: {
      L: histogramEmd(labT, labR, reducedT.weight, (lab, i) => lab[i], 0, 1),
      C: histogramEmd(labT, labR, reducedT.weight, (lab, i) => Math.hypot(lab[i + 1], lab[i + 2]), 0, 0.4),
    },
    banding: { target: bandingScore(target, mask), render: bandingScore(render, mask) },
    clipped: { target: clipShare(target, mask), render: clipShare(render, mask) },
    grain: { target: grainLevel(target, mask), render: grainLevel(render, mask) },
  }
  return { metrics, heatmap: heatmapImage(map, width, height, mask), rows }
}
