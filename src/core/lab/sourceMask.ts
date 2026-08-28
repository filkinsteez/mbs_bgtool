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
 * The result is the PURE silhouette — ~1 inside the subject, 0 outside —
 * with no interior structure. buildShadedBorderMask layers the lit form
 * on top of it and is what the material territory reads by default.
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

// Every treatment grading "by territory" needs tonal structure, not a
// binary inside/outside step: inside the silhouette the value carries the
// subject's LIT FORM — shadow rises toward 1, lit faces settle at the
// floor — while the floor keeps the silhouette edge a hard step against
// the 0 background. Shading is normalized to the subject's own luminance
// range (robust 8%/92% percentiles), so a bright white model still spans
// the full response instead of pinning near the floor.
const SHADING_FLOOR = 0.35
const SHADING_BINS = 512

export function buildShadedBorderMask(maps: AnalysisMaps): Float32Array {
  const silhouette = buildBorderDistanceMask(maps)
  const histogram = new Uint32Array(SHADING_BINS)
  let inside = 0
  for (let index = 0; index < silhouette.length; index += 1) {
    if (silhouette[index] <= 0.5) continue
    const bin = Math.max(
      0,
      Math.min(SHADING_BINS - 1, Math.floor(maps.lum[index] * (SHADING_BINS - 1))),
    )
    histogram[bin] += 1
    inside += 1
  }
  if (!inside) return silhouette
  const quantile = (amount: number): number => {
    const target = amount * (inside - 1)
    let seen = 0
    for (let bin = 0; bin < SHADING_BINS; bin += 1) {
      seen += histogram[bin]
      if (seen > target) return bin / (SHADING_BINS - 1)
    }
    return 1
  }
  const low = quantile(0.08)
  const high = quantile(0.92)
  const range = high - low
  // a flat-toned subject carries no lit form — keep the pure silhouette
  if (range < 0.05) return silhouette
  const shaded = new Float32Array(silhouette.length)
  for (let index = 0; index < silhouette.length; index += 1) {
    if (silhouette[index] <= 0) continue
    const shading = Math.max(0, Math.min(1, (high - maps.lum[index]) / range))
    shaded[index] = silhouette[index] * (SHADING_FLOOR + (1 - SHADING_FLOOR) * shading)
  }
  return shaded
}

function cachedMask(key: string, build: () => Float32Array): Float32Array {
  let mask = maskCache.get(key)
  if (!mask) {
    mask = build()
    if (maskCache.size >= 8) maskCache.delete(maskCache.keys().next().value!)
    maskCache.set(key, mask)
  }
  return mask
}

// The default material territory: silhouette × lit-form shading. This is
// the T every material look reads unless it asks for the pure silhouette.
export function borderDistanceField(source: LabSource, rect: FitRect): Field {
  const mask = cachedMask(
    `${source.hash}|shaded`,
    () => buildShadedBorderMask(source.maps),
  )
  return fieldFromMap(mask, source.maps.w, source.maps.h, rect)
}

// The pure subject silhouette (~1 inside, 0 outside, no shading) for
// treatments that need a hard inside/outside decision.
export function borderSilhouetteField(source: LabSource, rect: FitRect): Field {
  const mask = cachedMask(
    `${source.hash}|silhouette`,
    () => buildBorderDistanceMask(source.maps),
  )
  return fieldFromMap(mask, source.maps.w, source.maps.h, rect)
}
