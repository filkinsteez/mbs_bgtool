import { boxBlur } from '@/core/math/blur'
import type { AnalysisMaps } from './analysis'
import { fieldFromMap, type Field, type FitRect } from './field'
import type { LabSource } from './sourceCache'

const MAX_BORDER_SAMPLES = 512
const RGB_DIAGONAL = Math.sqrt(3 * 255 * 255)
const maskCache = new Map<string, Float32Array>()

function percentile(values: readonly number[], amount: number): number {
  if (!values.length) return 0
  const ordered = [...values].sort((a, b) => a - b)
  const index = Math.max(
    0,
    Math.min(ordered.length - 1, Math.round((ordered.length - 1) * amount)),
  )
  return ordered[index]
}

function smoothstep(from: number, to: number, value: number): number {
  if (to <= from) return value >= to ? 1 : 0
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

function pixelDistance(
  rgba: Uint8ClampedArray,
  offset: number,
  red: number,
  green: number,
  blue: number,
): number {
  const dr = rgba[offset] - red
  const dg = rgba[offset + 1] - green
  const db = rgba[offset + 2] - blue
  return Math.sqrt(dr * dr + dg * dg + db * db) / RGB_DIAGONAL
}

function alphaCarriesShape(maps: AnalysisMaps): boolean {
  let transparent = 0
  let opaque = 0
  const stride = Math.max(1, Math.floor(maps.alpha.length / 4096))
  for (let index = 0; index < maps.alpha.length; index += stride) {
    if (maps.alpha[index] < 0.92) transparent += 1
    if (maps.alpha[index] > 0.12) opaque += 1
  }
  return transparent > 2 && opaque > 2
}

/**
 * Separates a rendered subject from the scene color sampled at the frame
 * border. Material captures are opaque, so alpha and raw luminance cannot
 * distinguish a bright, dark, or similarly hued model from its background.
 */
export function buildBorderDistanceMask(maps: AnalysisMaps): Float32Array {
  if (alphaCarriesShape(maps)) {
    const alphaMask = Float32Array.from(
      maps.alpha,
      (alpha) => smoothstep(0.04, 0.96, alpha),
    )
    return boxBlur(alphaMask, maps.w, maps.h, 1, 1)
  }
  const { rgba, w, h } = maps
  const perimeter = Math.max(1, w * 2 + Math.max(0, h - 2) * 2)
  const step = Math.max(1, Math.ceil(perimeter / MAX_BORDER_SAMPLES))
  const red: number[] = []
  const green: number[] = []
  const blue: number[] = []
  const push = (x: number, y: number) => {
    const offset = (y * w + x) * 4
    red.push(rgba[offset])
    green.push(rgba[offset + 1])
    blue.push(rgba[offset + 2])
  }
  for (let x = 0; x < w; x += step) {
    push(x, 0)
    if (h > 1) push(x, h - 1)
  }
  for (let y = step; y < h - 1; y += step) {
    push(0, y)
    if (w > 1) push(w - 1, y)
  }

  const backgroundRed = percentile(red, 0.5)
  const backgroundGreen = percentile(green, 0.5)
  const backgroundBlue = percentile(blue, 0.5)
  const distances = new Float32Array(w * h)
  const borderDistances: number[] = []
  const allDistances: number[] = []
  for (let index = 0; index < w * h; index += 1) {
    const distance = pixelDistance(
      rgba,
      index * 4,
      backgroundRed,
      backgroundGreen,
      backgroundBlue,
    )
    distances[index] = distance
    allDistances.push(distance)
    const x = index % w
    const y = Math.floor(index / w)
    if (x === 0 || x === w - 1 || y === 0 || y === h - 1) {
      borderDistances.push(distance)
    }
  }

  const noiseFloor = Math.max(2 / 255, percentile(borderDistances, 0.95) * 1.45)
  const subjectDistance = percentile(allDistances, 0.9)
  const fullDistance = Math.max(noiseFloor + 0.035, subjectDistance * 0.72)
  for (let index = 0; index < distances.length; index += 1) {
    distances[index] = smoothstep(noiseFloor, fullDistance, distances[index])
  }
  return boxBlur(distances, w, h, 1, 1)
}

export function borderDistanceField(source: LabSource, rect: FitRect): Field {
  let mask = maskCache.get(source.hash)
  if (!mask) {
    mask = buildBorderDistanceMask(source.maps)
    if (maskCache.size >= 8) maskCache.delete(maskCache.keys().next().value!)
    maskCache.set(source.hash, mask)
  }
  return fieldFromMap(mask, source.maps.w, source.maps.h, rect)
}
