export type PlannedSwatch = {
  hex: string
  weight: number
  lightness: number
  chroma: number
  hue: number
}

export type LookColorPlan = {
  swatches: readonly PlannedSwatch[]
  roles: {
    dominant: number
    support: readonly number[]
    accent: number | null
    ground: number
    ink: number
  }
  depthOrder: readonly number[]
  allowedNeighbors: readonly (readonly number[])[]
  localColorLimit: number
  accentAreaLimit: number
}

type MixInput = {
  color: string
  weight?: number
  ratio?: number
  enabled: boolean
}

const LOOK_COLOR_LIMITS: Record<string, readonly [number, number, number]> = {
  frame: [3, 4, 4],
  pixels: [2, 3, 4],
  scanlines: [2, 2, 3],
  streams: [2, 2, 3],
  brushwork: [2, 2, 3],
  beads: [2, 3, 3],
  quilt: [3, 4, 5],
  weave: [2, 3, 3],
  marks: [2, 2, 3],
  trails: [2, 2, 3],
}

function normalizeHex(value: string): string {
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i)
  return match ? `#${match[1].toUpperCase()}` : '#000000'
}

function srgbToLinear(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function oklab(hex: string): [number, number, number] {
  const value = Number.parseInt(normalizeHex(hex).slice(1), 16)
  const r = srgbToLinear((value >> 16) & 255)
  const g = srgbToLinear((value >> 8) & 255)
  const b = srgbToLinear(value & 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function colorDistance(a: PlannedSwatch, b: PlannedSwatch): number {
  const hueA = a.hue
  const hueB = b.hue
  const ax = Math.cos(hueA) * a.chroma
  const ay = Math.sin(hueA) * a.chroma
  const bx = Math.cos(hueB) * b.chroma
  const by = Math.sin(hueB) * b.chroma
  return Math.hypot(a.lightness - b.lightness, ax - bx, ay - by)
}

function closestIndex(swatches: readonly PlannedSwatch[], color: string): number {
  const normalized = normalizeHex(color)
  const exact = swatches.findIndex((swatch) => swatch.hex === normalized)
  if (exact >= 0) return exact
  const [lightness, a, b] = oklab(normalized)
  let closest = 0
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < swatches.length; index += 1) {
    const swatch = swatches[index]
    const sx = Math.cos(swatch.hue) * swatch.chroma
    const sy = Math.sin(swatch.hue) * swatch.chroma
    const distance = Math.hypot(lightness - swatch.lightness, a - sx, b - sy)
    if (distance < best) {
      best = distance
      closest = index
    }
  }
  return closest
}

export function resolveLookColorPlan(input: {
  mix: readonly MixInput[]
  ground: string
  ink: string
  lookId: string
  complexity: number
}): LookColorPlan {
  const unique = new Map<string, number>()
  for (const item of input.mix) {
    const weight = item.weight ?? item.ratio ?? 0
    if (!item.enabled || weight <= 0) continue
    const color = normalizeHex(item.color)
    unique.set(color, (unique.get(color) ?? 0) + weight)
  }
  if (!unique.size) unique.set(normalizeHex(input.ink), 1)
  const total = Array.from(unique.values()).reduce((sum, weight) => sum + weight, 0) || 1
  const swatches: PlannedSwatch[] = Array.from(unique, ([hex, weight]) => {
    const [lightness, a, b] = oklab(hex)
    return {
      hex,
      weight: weight / total,
      lightness,
      chroma: Math.hypot(a, b),
      hue: Math.atan2(b, a),
    }
  })
  const dominant = swatches.reduce(
    (best, swatch, index) => swatch.weight > swatches[best].weight ? index : best,
    0,
  )
  const support = swatches
    .map((swatch, index) => ({ index, distance: colorDistance(swatches[dominant], swatch) }))
    .filter(({ index }) => index !== dominant)
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, 2)
    .map(({ index }) => index)
  const accent = swatches.length > 1
    ? swatches
      .map((swatch, index) => ({ index, distance: colorDistance(swatches[dominant], swatch) }))
      .filter(({ index }) => index !== dominant)
      .sort((a, b) => b.distance - a.distance || a.index - b.index)[0].index
    : null
  const ground = closestIndex(swatches, input.ground)
  const ink = closestIndex(swatches, input.ink)
  const depthOrder = swatches
    .map((swatch, index) => ({
      index,
      contrast: Math.abs(swatch.lightness - swatches[ground].lightness),
    }))
    .sort((a, b) => a.contrast - b.contrast || a.index - b.index)
    .map(({ index }) => index)
  const allowedNeighbors = swatches.map((swatch, index) => [
    index,
    ...swatches
      .map((candidate, candidateIndex) => ({
        index: candidateIndex,
        distance: colorDistance(swatch, candidate),
      }))
      .filter((candidate) => candidate.index !== index)
      .sort((a, b) => a.distance - b.distance || a.index - b.index)
      .slice(0, Math.min(2, swatches.length - 1))
      .map((candidate) => candidate.index),
  ])
  const profile = LOOK_COLOR_LIMITS[input.lookId] ?? [2, 3, 4]
  const complexityIndex = input.complexity < 0.34 ? 0 : input.complexity < 0.67 ? 1 : 2
  const sparse = ['scanlines', 'streams', 'brushwork', 'marks', 'trails'].includes(input.lookId)

  return {
    swatches,
    roles: { dominant, support, accent, ground, ink },
    depthOrder,
    allowedNeighbors,
    localColorLimit: Math.min(swatches.length, profile[complexityIndex]),
    accentAreaLimit: sparse ? 0.055 : 0.09,
  }
}

export function weightedColorIndex(plan: LookColorPlan, sample: number): number {
  const value = Math.max(0, Math.min(0.999999, sample))
  let accumulated = 0
  for (let index = 0; index < plan.swatches.length; index += 1) {
    accumulated += plan.swatches[index].weight
    if (value < accumulated) return index
  }
  return plan.swatches.length - 1
}

export function distinctColorIndex(
  plan: LookColorPlan,
  baseIndex: number,
  sample: number,
): number {
  if (plan.swatches.length < 2) return baseIndex
  const neighbors = plan.allowedNeighbors[baseIndex].filter((index) => index !== baseIndex)
  if (neighbors.length) {
    return neighbors[Math.min(neighbors.length - 1, Math.floor(sample * neighbors.length))]
  }
  return (baseIndex + 1) % plan.swatches.length
}
