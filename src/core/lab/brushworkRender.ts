import * as brush from 'p5.brush/standalone'
import { chan } from '@/core/organic/random'
import type { LookColorPlan } from './colorDirection'
import type { Field } from './field'

export type BrushworkRenderOptions = {
  width: number
  height: number
  seed: number
  complexity: number
  palette: readonly string[]
  colorPlan?: LookColorPlan
  territory: Field
  sourceAware?: boolean
  motionPhase?: number
  motionAmount: number
}

type CanonicalMask = {
  width: number
  height: number
  gridWidth: number
  gridHeight: number
  values: Float32Array
  seed: number
  sourceAware: boolean
  source: Field
}

type BrushTarget = {
  canvas: HTMLCanvasElement
  warmed: boolean
}

const BRUSH_TARGET_CACHE_LIMIT = 8
const brushTargets = new Map<string, BrushTarget>()
let activeBrushCanvas: HTMLCanvasElement | null = null
let cachedCanonicalMask: CanonicalMask | null = null
let brushesDefined = false

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function validIndex(
  index: number | null | undefined,
  palette: readonly string[],
): index is number {
  return index != null && index >= 0 && index < palette.length
}

function colorAt(
  palette: readonly string[],
  index: number | null | undefined,
  fallback: string,
): string {
  return validIndex(index, palette) ? palette[index] : fallback
}

function swatchDistance(
  a: LookColorPlan['swatches'][number],
  b: LookColorPlan['swatches'][number],
): number {
  const ax = Math.cos(a.hue) * a.chroma
  const ay = Math.sin(a.hue) * a.chroma
  const bx = Math.cos(b.hue) * b.chroma
  const by = Math.sin(b.hue) * b.chroma
  return Math.hypot(a.lightness - b.lightness, ax - bx, ay - by)
}

function phaseColorIndexes(plan: LookColorPlan | undefined): readonly number[] {
  if (!plan?.swatches.length) return []
  const ground = plan.swatches[plan.roles.ground]
  return plan.swatches
    .map((swatch, index) => ({
      index,
      score: swatchDistance(swatch, ground),
    }))
    .filter(({ index }) => index !== plan.roles.ground)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ index }) => index)
}

function fieldColorIndex(plan: LookColorPlan | undefined): number | undefined {
  if (!plan?.swatches.length) return undefined
  if (plan.swatches.length <= 2) return plan.roles.ground
  const ground = plan.swatches[plan.roles.ground]
  return plan.swatches
    .map((swatch, index) => ({
      index,
      distance: swatchDistance(swatch, ground),
    }))
    .filter(({ index }) => index !== plan.roles.ground)
    .sort((a, b) => b.distance - a.distance || a.index - b.index)[0]?.index
}

function ensureBrushCanvas(width: number, height: number): BrushTarget | null {
  if (typeof document === 'undefined') return null
  const key = `${width}x${height}`
  let target = brushTargets.get(key)
  if (target) {
    brushTargets.delete(key)
    brushTargets.set(key, target)
  } else {
    while (brushTargets.size >= BRUSH_TARGET_CACHE_LIMIT) {
      const eviction = [...brushTargets.entries()].find(
        ([, candidate]) => candidate.canvas !== activeBrushCanvas,
      ) ?? brushTargets.entries().next().value
      if (!eviction) break
      const [evictionKey, candidate] = eviction
      const gl = candidate.canvas.getContext('webgl2')
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
      brushTargets.delete(evictionKey)
      if (candidate.canvas === activeBrushCanvas) activeBrushCanvas = null
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    target = { canvas, warmed: false }
    brushTargets.set(key, target)
  }
  if (activeBrushCanvas !== target.canvas) {
    brush.load(target.canvas)
    activeBrushCanvas = target.canvas
  }
  brush.angleMode(brush.RADIANS)
  if (!brushesDefined) {
    brush.add('mbs-wash', {
      type: 'default',
      weight: 0.8,
      scatter: 0.3,
      sharpness: 0.52,
      grain: 0.72,
      opacity: 32,
      spacing: 0.05,
      pressure: [0.68, 1.04, 0.72],
      rotate: 'natural',
      noise: 0.06,
    })
    brush.add('mbs-rake', {
      type: 'default',
      weight: 0.45,
      scatter: 0.12,
      sharpness: 0.82,
      grain: 0.68,
      opacity: 62,
      spacing: 0.05,
      pressure: [0.62, 1.08, 0.7],
      rotate: 'natural',
      markerTip: false,
      noise: 0.045,
    })
    brush.add('mbs-thread', {
      type: 'default',
      weight: 0.2,
      scatter: 0.07,
      sharpness: 0.96,
      grain: 0.76,
      opacity: 142,
      spacing: 0.055,
      pressure: [0.74, 1, 0.78],
      rotate: 'natural',
      markerTip: false,
      noise: 0.018,
    })
    brush.add('mbs-thread-faint', {
      type: 'default',
      weight: 0.18,
      scatter: 0.08,
      sharpness: 0.92,
      grain: 0.58,
      opacity: 68,
      spacing: 0.065,
      pressure: [0.76, 1, 0.8],
      rotate: 'natural',
      markerTip: false,
      noise: 0.04,
    })
    brush.add('mbs-phase', {
      type: 'default',
      weight: 0.2,
      scatter: 0.08,
      sharpness: 0.92,
      grain: 0.86,
      opacity: 148,
      spacing: 0.055,
      pressure: [0.72, 1.04, 0.76],
      rotate: 'natural',
      markerTip: false,
      noise: 0.025,
    })
    brushesDefined = true
  }
  return target
}

function canonicalMask(options: BrushworkRenderOptions): CanonicalMask {
  const { width, height, seed } = options
  const sourceAware = options.sourceAware === true
  if (
    cachedCanonicalMask
    && cachedCanonicalMask.width === width
    && cachedCanonicalMask.height === height
    && cachedCanonicalMask.seed === seed
    && cachedCanonicalMask.sourceAware === sourceAware
    && cachedCanonicalMask.source === options.territory
  ) {
    return cachedCanonicalMask
  }
  const gridScale = Math.min(1, 1024 / Math.max(width, height))
  const gridWidth = Math.max(2, Math.round(width * gridScale))
  const gridHeight = Math.max(2, Math.round(height * gridScale))
  const values = new Float32Array(gridWidth * gridHeight)
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      values[y * gridWidth + x] = clamp01(options.territory(
        (x + 0.5) / gridWidth * width,
        (y + 0.5) / gridHeight * height,
      ))
    }
  }
  cachedCanonicalMask = {
    width,
    height,
    gridWidth,
    gridHeight,
    values,
    seed,
    sourceAware,
    source: options.territory,
  }
  return cachedCanonicalMask
}

function sampleMask(mask: CanonicalMask, x: number, y: number): number {
  const gx = clamp01(x / Math.max(1, mask.width)) * (mask.gridWidth - 1)
  const gy = clamp01(y / Math.max(1, mask.height)) * (mask.gridHeight - 1)
  const left = Math.floor(gx)
  const top = Math.floor(gy)
  const right = Math.min(mask.gridWidth - 1, left + 1)
  const bottom = Math.min(mask.gridHeight - 1, top + 1)
  const tx = gx - left
  const ty = gy - top
  const upper = mask.values[top * mask.gridWidth + left] * (1 - tx)
    + mask.values[top * mask.gridWidth + right] * tx
  const lower = mask.values[bottom * mask.gridWidth + left] * (1 - tx)
    + mask.values[bottom * mask.gridWidth + right] * tx
  return upper * (1 - ty) + lower * ty
}

function sampleSoftMask(
  mask: CanonicalMask,
  x: number,
  y: number,
  radius: number,
): number {
  return sampleMask(mask, x, y) * 0.32
    + (
      sampleMask(mask, x - radius, y)
      + sampleMask(mask, x + radius, y)
      + sampleMask(mask, x, y - radius)
      + sampleMask(mask, x, y + radius)
    ) * 0.17
}

type BrushColors = {
  ground: string
  field: string
  support: string
  accent: string
  ink: string
}

type StrokeTier = 'hero' | 'support' | 'filament'

type AuthoredStroke = {
  id: number
  tier: StrokeTier
}

type BrushPoint = {
  x: number
  y: number
}

function seededArchetype(seed: number): 0 | 1 | 2 {
  return (Math.imul((seed | 0) ^ 0xcbbb9d5d, 0x9e3779b1) >>> 0) % 3 as 0 | 1 | 2
}

function layoutPoint(
  options: BrushworkRenderOptions,
  u: number,
  v: number,
): BrushPoint {
  const archetype = seededArchetype(options.seed)
  const portrait = options.height > options.width * 1.08
  const square = !portrait && options.width < options.height * 1.22
  const mirror = chan(options.seed, 0, 'lab.brush.layout-mirror') < 0.5
  const cross = mirror ? 1 - v : v
  if (portrait) {
    return {
      x: options.width * cross,
      y: options.height * u,
    }
  }
  return {
    x: options.width * u,
    y: options.height * (
      cross
      + (square ? (u - 0.5) * (archetype === 1 ? -0.1 : archetype === 2 ? 0.12 : 0.05) : 0)
    ),
  }
}

function cubicValue(
  start: number,
  controlA: number,
  controlB: number,
  end: number,
  value: number,
): number {
  const t = clamp01(value)
  const inverse = 1 - t
  return inverse ** 3 * start
    + 3 * inverse ** 2 * t * controlA
    + 3 * inverse * t ** 2 * controlB
    + t ** 3 * end
}

function easedComplexity(value: number): number {
  const c = clamp01(value)
  return c * c * (3 - 2 * c)
}

function reverseBits(value: number, bits: number): number {
  let result = 0
  for (let bit = 0; bit < bits; bit += 1) {
    result = (result << 1) | ((value >> bit) & 1)
  }
  return result
}

function distributedIds(maximum: number): number[] {
  const bits = Math.ceil(Math.log2(maximum))
  const size = 2 ** bits
  return Array.from({ length: size }, (_, index) => reverseBits(index, bits))
    .filter((index) => index < maximum)
}

function drawPhaseRakes(
  options: BrushworkRenderOptions,
  colors: BrushColors,
  alternate: boolean,
  mask: CanonicalMask,
): void {
  const size = Math.min(options.width, options.height)
  const archetype = seededArchetype(options.seed)
  const loop = (options.motionPhase ?? 0) * Math.PI * 2
  const q = easedComplexity(options.complexity)
  const complexityTier = q < 0.26 ? 0 : q < 0.74 ? 1 : 2
  const understructure: readonly (readonly (readonly [number, number])[])[][] = [
    [
      [[-0.12, 0.16], [0.08, 0.1], [0.28, 0.18], [0.43, 0.12]],
      [[0.58, 0.88], [0.74, 0.78], [0.9, 0.9], [1.12, 0.82]],
      [[0.08, -0.1], [0.04, 0.2], [0.1, 0.52], [0.02, 1.1]],
      [[0.7, -0.1], [0.78, 0.2], [0.9, 0.48], [1.06, 0.62]],
    ],
    [
      [[-0.12, 0.78], [0.22, 0.68], [0.58, 0.38], [1.12, 0.14]],
      [[0.14, -0.12], [0.28, 0.24], [0.58, 0.62], [0.82, 1.12]],
      [[-0.1, 0.34], [0.28, 0.42], [0.7, 0.56], [1.1, 0.48]],
      [[0.82, -0.1], [0.72, 0.3], [0.62, 0.68], [0.48, 1.1]],
    ],
    [
      [[-0.12, 0.2], [0.14, 0.16], [0.34, 0.3], [0.51, 0.24]],
      [[0.46, 0.7], [0.62, 0.62], [0.84, 0.78], [1.12, 0.66]],
      [[0.16, 1.1], [0.2, 0.82], [0.34, 0.58], [0.43, 0.42]],
      [[0.72, -0.1], [0.68, 0.2], [0.76, 0.42], [1.08, 0.5]],
    ],
  ]
  const templates = understructure[archetype]
  for (let family = 0; family < 2; family += 1) {
    const maximum = alternate
      ? family === 0 ? 18 : 8
      : family === 0 ? 12 : 6
    const active = alternate
      ? family === 0 ? [7, 12, 18][complexityTier] : [2, 5, 8][complexityTier]
      : family === 0 ? [3, 7, 12][complexityTier] : [1, 3, 6][complexityTier]
    const ids = distributedIds(maximum).slice(0, active)
    for (const id of ids) {
      const template = templates[
        (id + Math.floor(id / 4) + family) % templates.length
      ]
      const offset = (id - (maximum - 1) / 2) / maximum
        * (family === 0 ? 0.12 : 0.07)
      const strokePhase = chan(
        options.seed,
        id + family * 1000,
        'lab.brush.rake-wave',
      ) * Math.PI * 2
      const points: [number, number, number][] = []
      const pointCount = 42
      for (let point = 0; point < pointCount; point += 1) {
        const t = point / (pointCount - 1)
        const u = cubicValue(template[0][0], template[1][0], template[2][0], template[3][0], t)
        const v = cubicValue(template[0][1], template[1][1], template[2][1], template[3][1], t)
        const before = layoutPoint(
          options,
          cubicValue(
            template[0][0],
            template[1][0],
            template[2][0],
            template[3][0],
            Math.max(0, t - 0.01),
          ),
          cubicValue(
            template[0][1],
            template[1][1],
            template[2][1],
            template[3][1],
            Math.max(0, t - 0.01),
          ),
        )
        const after = layoutPoint(
          options,
          cubicValue(
            template[0][0],
            template[1][0],
            template[2][0],
            template[3][0],
            Math.min(1, t + 0.01),
          ),
          cubicValue(
            template[0][1],
            template[1][1],
            template[2][1],
            template[3][1],
            Math.min(1, t + 0.01),
          ),
        )
        const tangentLength = Math.hypot(after.x - before.x, after.y - before.y) || 1
        const normalX = -(after.y - before.y) / tangentLength
        const normalY = (after.x - before.x) / tangentLength
        const base = layoutPoint(options, u, v)
        const globalWave = Math.sin(t * Math.PI * 2.1 + strokePhase)
          * size * (family === 0 ? 0.012 : 0.008)
        const motion = Math.sin(loop + strokePhase)
          * options.motionAmount
          * size
          * 0.004
        const probeX = base.x + normalX * (offset * size + globalWave + motion)
        const probeY = base.y + normalY * (offset * size + globalWave + motion)
        const amount = sampleSoftMask(mask, probeX, probeY, size * 0.026)
        const displacement = amount
          * size
          * (family === 0 ? 0.065 : -0.048)
          * (0.36 + Math.sin(t * Math.PI * 4.2 + strokePhase * 1.7) * 0.64)
        points.push([
          probeX + normalX * displacement,
          probeY + normalY * displacement,
          (family === 0 ? 0.38 : 0.32) + amount * (alternate ? 0.3 : 0.4),
        ])
      }
      const color = alternate
        ? family === 0
          ? id % 4 === 0
            ? colors.ground
            : id % 2 === 0 ? colors.ink : colors.accent
          : id % 3 === 0 ? colors.ground : colors.ink
        : family === 0
          ? id % 7 === 0 ? colors.support : colors.field
          : colors.field
      const strokeSeed = (
        options.seed
        ^ id * 0x9e3779b1
        ^ family * 0x85ebca6b
      ) >>> 0
      brush.seed(strokeSeed)
      brush.noiseSeed(strokeSeed)
      brush.set(
        alternate ? 'mbs-thread' : 'mbs-rake',
        color,
        Math.max(
          0.55,
          size * (
            alternate
              ? family === 0 ? 0.0032 : 0.0022
              : family === 0 ? 0.0052 : 0.0028
          )
            / (alternate ? 0.2 : 0.45),
        ),
      )
      brush.spline(points, 0.78)
    }
  }
}

function strokeCatalog(): AuthoredStroke[] {
  const heroCount = 3
  const supportCount = 10
  const filamentCount = 30
  return [
    ...Array.from({ length: heroCount }, (_, id) => ({ id, tier: 'hero' as const })),
    ...Array.from({ length: supportCount }, (_, id) => ({ id, tier: 'support' as const })),
    ...Array.from({ length: filamentCount }, (_, id) => ({ id, tier: 'filament' as const })),
  ]
}

function roleColor(
  stroke: AuthoredStroke,
  colors: BrushColors,
  alternate: boolean,
): string {
  if (stroke.tier === 'hero') {
    const roles = alternate
      ? [colors.accent, colors.support, colors.accent, colors.field]
      : [
          colors.field,
          colors.support,
          colors.ink,
        ]
    return roles[stroke.id % roles.length]
  }
  if (stroke.tier === 'support') {
    const roles = alternate
      ? [colors.support, colors.accent, colors.field]
      : [colors.field, colors.ink, colors.support]
    return roles[stroke.id % roles.length]
  }
  if (stroke.id % 17 === 0) return colors.accent
  return alternate
    ? stroke.id % 3 === 0 ? colors.support : colors.accent
    : stroke.id % 4 === 0 ? colors.support : colors.field
}

function drawCatalog(
  options: BrushworkRenderOptions,
  colors: BrushColors,
  catalog: readonly AuthoredStroke[],
  alternate: boolean,
  mask: CanonicalMask,
): void {
  const size = Math.min(options.width, options.height)
  const archetype = seededArchetype(options.seed)
  const motion = (options.motionPhase ?? 0) * Math.PI * 2
  const heroTemplates: readonly (readonly (readonly [number, number])[])[][] = [
    [
      [[-0.12, 0.2], [0.08, 0.16], [0.28, 0.3], [0.42, 0.21]],
      [[1.12, 0.8], [0.91, 0.72], [0.77, 0.88], [0.62, 0.7]],
      [[-0.08, 0.82], [0.1, 0.76], [0.22, 0.62], [0.34, 0.69]],
    ],
    [
      [[-0.12, 0.76], [0.2, 0.66], [0.56, 0.4], [1.12, 0.16]],
      [[0.15, -0.12], [0.3, 0.2], [0.56, 0.6], [0.82, 1.12]],
      [[1.08, 0.72], [0.87, 0.61], [0.68, 0.49], [0.52, 0.43]],
    ],
    [
      [[-0.12, 0.24], [0.14, 0.18], [0.34, 0.35], [0.5, 0.27]],
      [[0.4, 0.72], [0.58, 0.62], [0.82, 0.79], [1.12, 0.66]],
      [[0.12, 1.1], [0.18, 0.82], [0.31, 0.58], [0.41, 0.45]],
    ],
  ]
  const zoneSpecs = [
    [
      { u: 0.12, v: 0.18, angle: 0.12, scale: 1.1 },
      { u: 0.82, v: 0.78, angle: -0.32, scale: 1.05 },
      { u: 0.16, v: 0.72, angle: -0.62, scale: 0.8 },
    ],
    [
      { u: 0.12, v: 0.2, angle: -0.36, scale: 1.08 },
      { u: 0.84, v: 0.76, angle: 0.7, scale: 1 },
      { u: 0.84, v: 0.2, angle: -0.18, scale: 0.78 },
    ],
    [
      { u: 0.22, v: 0.25, angle: 0.18, scale: 0.88 },
      { u: 0.72, v: 0.7, angle: 0.08, scale: 1.1 },
      { u: 0.29, v: 0.64, angle: -0.82, scale: 0.76 },
    ],
  ][archetype]
  for (const stroke of catalog) {
    const brushName = stroke.tier === 'hero'
      ? 'mbs-wash'
      : stroke.tier === 'support'
        ? 'mbs-rake'
        : 'mbs-thread'
    const baseWeight = stroke.tier === 'hero'
      ? 0.8
      : stroke.tier === 'support'
        ? 0.45
        : 0.2
    const targetWidth = size * (
      stroke.tier === 'hero'
        ? [0.105, 0.065, 0.04][stroke.id] ?? 0.04
        : stroke.tier === 'support'
          ? 0.015
          : 0.0025
    )
    const strokeSeed = (
      options.seed
      ^ stroke.id * 0x9e3779b1
      ^ (stroke.tier === 'hero' ? 0x85ebca6b : stroke.tier === 'support' ? 0xc2b2ae35 : 0x27d4eb2d)
      ^ (alternate ? 0x165667b1 : 0)
    ) >>> 0
    brush.seed(strokeSeed)
    brush.noiseSeed(strokeSeed)
    brush.set(
      brushName,
      roleColor(stroke, colors, alternate),
      Math.max(0.6, targetWidth / baseWeight),
    )
    const pointCount = stroke.tier === 'hero' ? 44 : 28
    const points: [number, number, number][] = []
    for (let point = 0; point < pointCount; point += 1) {
      const progress = point / (pointCount - 1)
      let u = 0
      let v = 0
      if (stroke.tier === 'hero') {
        const template = heroTemplates[archetype][stroke.id]
        u = cubicValue(template[0][0], template[1][0], template[2][0], template[3][0], progress)
        v = cubicValue(template[0][1], template[1][1], template[2][1], template[3][1], progress)
      } else {
        const zone = zoneSpecs[stroke.id % zoneSpecs.length]
        const jitterU = (chan(options.seed, stroke.id, `lab.brush.${stroke.tier}.x`) - 0.5)
          * (stroke.tier === 'support' ? 0.28 : 0.2)
        const jitterV = (chan(options.seed, stroke.id, `lab.brush.${stroke.tier}.y`) - 0.5)
          * (stroke.tier === 'support' ? 0.24 : 0.18)
        const angle = zone.angle
          + (chan(options.seed, stroke.id, `lab.brush.${stroke.tier}.angle`) - 0.5)
            * (stroke.tier === 'support' ? 0.9 : 1.3)
        const length = (
          stroke.tier === 'support'
            ? 0.2 + chan(options.seed, stroke.id, 'lab.brush.support.length') * 0.26
            : 0.08 + chan(options.seed, stroke.id, 'lab.brush.filament.length') * 0.17
        ) * zone.scale
        const bend = (chan(options.seed, stroke.id, `lab.brush.${stroke.tier}.bend`) - 0.5)
          * (stroke.tier === 'support' ? 0.12 : 0.06)
        u = zone.u + jitterU + Math.cos(angle) * (progress - 0.5) * length
          - Math.sin(angle) * Math.sin(progress * Math.PI) * bend
        v = zone.v + jitterV + Math.sin(angle) * (progress - 0.5) * length
          + Math.cos(angle) * Math.sin(progress * Math.PI) * bend
      }
      const base = layoutPoint(options, u, v)
      const before = layoutPoint(options, u - 0.002, v)
      const after = layoutPoint(options, u + 0.002, v)
      let tangentX = after.x - before.x
      let tangentY = after.y - before.y
      if (stroke.tier !== 'hero') {
        const previous = points.at(-1)
        if (previous) {
          tangentX = base.x - previous[0]
          tangentY = base.y - previous[1]
        }
      }
      const tangentLength = Math.hypot(tangentX, tangentY) || 1
      const normalX = -tangentY / tangentLength
      const normalY = tangentX / tangentLength
      const baseX = base.x
      const baseY = base.y
      const amount = sampleSoftMask(mask, baseX, baseY, size * 0.035)
      const wave = Math.sin(
        progress * Math.PI * (stroke.tier === 'hero' ? 1.2 + stroke.id * 0.38 : 2.1)
        + stroke.id * 1.37
        + motion,
      ) * size * (
        stroke.tier === 'hero' ? 0.025 : stroke.tier === 'support' ? 0.019 : 0.009
      )
      const steering = (amount - 0.16) * size * (
        stroke.tier === 'hero' ? 0.085 : stroke.tier === 'support' ? -0.052 : 0.034
      )
      const x = baseX + normalX * (wave + steering)
      const y = baseY + normalY * (wave + steering)
      const pressure = stroke.tier === 'hero'
        ? 0.48 + Math.sin(progress * Math.PI) * 0.48 + amount * 0.12
        : 0.54 + Math.sin(progress * Math.PI) * 0.34 + amount * 0.18
      points.push([x, y, pressure])
    }
    brush.spline(points, stroke.tier === 'hero' ? 0.62 : 0.7)
  }
}

function renderPhase(
  options: BrushworkRenderOptions,
  colors: BrushColors,
  catalog: readonly AuthoredStroke[],
  alternate: boolean,
  mask: CanonicalMask,
  neutral = colors.ground,
): void {
  const phaseSeed = options.seed ^ 0x1bd11bda
  brush.seed(phaseSeed)
  brush.noiseSeed(phaseSeed)
  brush.clear(neutral)
  brush.noStroke()
  brush.noFill()
  brush.noHatch()
  brush.push()
  brush.translate(-options.width / 2, -options.height / 2)
  if (!alternate) {
    const q = easedComplexity(options.complexity)
    const complexityTier = q < 0.26 ? 0 : q < 0.74 ? 1 : 2
    const supportLimit = [1, 6, 10][complexityTier]
    const filamentLimit = [0, 7, 30][complexityTier]
    drawCatalog(
      options,
      colors,
      catalog.filter((stroke) =>
        stroke.tier === 'hero'
        || (
          stroke.tier === 'support'
          && stroke.id < supportLimit
        )
        || (
          stroke.tier === 'filament'
          && stroke.id < filamentLimit
        )),
      false,
      mask,
    )
  }
  drawPhaseRakes(options, colors, alternate, mask)
  brush.pop()
  brush.render()
}

export function renderBrushwork(
  context: CanvasRenderingContext2D,
  options: BrushworkRenderOptions,
): void {
  const {
    width,
    height,
    palette,
    colorPlan,
  } = options
  if (width <= 0 || height <= 0 || !palette.length) return
  const target = ensureBrushCanvas(width, height)
  if (!target) return
  const { canvas } = target
  const fallback = palette[0] ?? '#0064E0'
  const groundIndex = colorPlan?.roles.ground
  const ground = colorAt(palette, groundIndex, palette.at(-1) ?? fallback)
  const dominant = colorAt(palette, colorPlan?.roles.dominant, fallback)
  const field = colorAt(palette, fieldColorIndex(colorPlan), dominant)
  const phaseIndexes = phaseColorIndexes(colorPlan)
  const paintIndexes = [
    ...phaseIndexes,
    colorPlan?.roles.accent,
    ...(colorPlan?.roles.support ?? []),
    colorPlan?.roles.dominant,
    colorPlan?.roles.ink,
  ]
    .filter((index): index is number =>
      validIndex(index, palette) && index !== groundIndex)
    .filter((index, position, indexes) => indexes.indexOf(index) === position)
  const accent = colorAt(palette, paintIndexes[0], palette[1] ?? dominant)
  const support = colorAt(palette, paintIndexes[1], dominant)
  const ink = colorAt(palette, colorPlan?.roles.ink, dominant)
  const colors = {
    ground,
    field,
    support,
    accent,
    ink,
  }
  const mask = canonicalMask(options)
  const catalog = strokeCatalog()
  if (!target.warmed) {
    // p5.brush lazily initializes its pigment pass. Prime it twice so the
    // first visible preview has the same pixels as a repeat render or export.
    for (let pass = 0; pass < 2; pass += 1) {
      renderPhase(options, colors, catalog, false, mask)
    }
    target.warmed = true
  }
  renderPhase(options, colors, catalog, false, mask)
  context.save()
  context.drawImage(canvas, 0, 0)
  context.restore()
}
