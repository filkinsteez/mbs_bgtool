import { chan, chanGauss } from '@/core/organic/random'
import {
  sampleCompositionPlan,
  type CompositionAnchor,
  type CompositionPlan,
} from './compositionPlan'

const TAU = Math.PI * 2

export type BrushworkRole = 'hero' | 'support' | 'filler'
export type BrushworkPaletteRole = 'dominant' | 'support' | 'accent' | 'ink'

export type BrushworkPressure = {
  start: number
  peak: number
  peakAt: number
  end: number
}

export type BrushworkPoint = {
  x: number
  y: number
  edgeLeft: number
  edgeRight: number
  quiet: number
}

export type BrushworkBristle = {
  id: number
  offset: number
  widthScale: number
  alpha: number
  pigment: 'stroke' | 'ink'
  active: readonly boolean[]
  jitter: readonly number[]
}

export type BrushworkStroke = {
  id: number
  role: BrushworkRole
  anchorIndex: number
  revealAt: number
  center: { x: number; y: number }
  points: readonly BrushworkPoint[]
  baseWidth: number
  opacity: number
  pressure: BrushworkPressure
  colorRole: BrushworkPaletteRole
  supportSlot: number
  bristles: readonly BrushworkBristle[]
  motion: {
    phase: number
    harmonic: 1 | 2 | 3
    amplitude: number
  }
}

export type BrushworkScene = {
  strokes: readonly BrushworkStroke[]
  catalogSize: number
}

type BrushSpace = {
  width: number
  height: number
}

type Point = {
  x: number
  y: number
}

type StrokeSpec = {
  id: number
  index: number
  count: number
  role: BrushworkRole
  revealAt: number
}

const ROLE_ORDER: Record<BrushworkRole, number> = {
  filler: 0,
  support: 1,
  hero: 2,
}

const FALLBACK_ANCHOR: CompositionAnchor = {
  x: 0.5,
  y: 0.5,
  radius: 0.28,
  strength: 1,
  angle: 0,
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function smoothstep(value: number): number {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function brushSpace(aspect: number): BrushSpace {
  const safeAspect = clamp(aspect, 0.1, 10)
  return safeAspect >= 1
    ? { width: safeAspect, height: 1 }
    : { width: 1, height: 1 / safeAspect }
}

function toBrushPoint(point: Point, space: BrushSpace): Point {
  return { x: point.x * space.width, y: point.y * space.height }
}

function fromBrushPoint(point: Point, space: BrushSpace): Point {
  return { x: point.x / space.width, y: point.y / space.height }
}

function add(point: Point, vector: Point, scale = 1): Point {
  return {
    x: point.x + vector.x * scale,
    y: point.y + vector.y * scale,
  }
}

function cubicPoint(
  start: Point,
  controlA: Point,
  controlB: Point,
  end: Point,
  t: number,
): Point {
  const inverse = 1 - t
  const a = inverse * inverse * inverse
  const b = 3 * inverse * inverse * t
  const c = 3 * inverse * t * t
  const d = t * t * t
  return {
    x: start.x * a + controlA.x * b + controlB.x * c + end.x * d,
    y: start.y * a + controlA.y * b + controlB.y * c + end.y * d,
  }
}

export function brushworkQuietAt(
  composition: CompositionPlan,
  x: number,
  y: number,
): number {
  return sampleCompositionPlan(composition, x, y, 1, 1).quiet
}

function escapeQuietSpace(
  point: Point,
  composition: CompositionPlan,
): Point {
  let current = { ...point }
  for (const quiet of composition.quietShapes) {
    const cosine = Math.cos(quiet.rotation)
    const sine = Math.sin(quiet.rotation)
    const dx = current.x - quiet.x
    const dy = current.y - quiet.y
    let localX = (dx * cosine + dy * sine) / Math.max(0.01, quiet.radiusX)
    let localY = (-dx * sine + dy * cosine) / Math.max(0.01, quiet.radiusY)
    let distance = Math.hypot(localX, localY)
    const clearance = 1.08 + quiet.softness * 0.32
    if (distance >= clearance) continue
    if (distance < 1e-4) {
      localX = Math.cos(composition.field.angle + Math.PI / 2)
      localY = Math.sin(composition.field.angle + Math.PI / 2)
      distance = 1
    }
    const scale = clearance / distance
    localX *= scale
    localY *= scale
    current = {
      x: quiet.x
        + localX * quiet.radiusX * cosine
        - localY * quiet.radiusY * sine,
      y: quiet.y
        + localX * quiet.radiusX * sine
        + localY * quiet.radiusY * cosine,
    }
  }
  return {
    x: clamp(current.x, -0.08, 1.08),
    y: clamp(current.y, -0.08, 1.08),
  }
}

function roleLength(seed: number, spec: StrokeSpec): number {
  const roll = chan(seed, spec.id, 'lab.brushwork.length')
  if (spec.role === 'hero') {
    return [0.94, 0.72, 0.58][spec.index] * (0.9 + roll * 0.18)
  }
  if (spec.role === 'support') return 0.27 + roll * 0.25
  return 0.09 + roll * 0.15
}

function roleWidth(seed: number, spec: StrokeSpec): number {
  const roll = chan(seed, spec.id, 'lab.brushwork.width')
  if (spec.role === 'hero') {
    return [0.094, 0.066, 0.048][spec.index] * (0.88 + roll * 0.18)
  }
  if (spec.role === 'support') return 0.021 + roll * 0.026
  return 0.0065 + roll * 0.012
}

function rolePointCount(role: BrushworkRole): number {
  if (role === 'hero') return 19
  if (role === 'support') return 13
  return 9
}

function roleAngle(
  seed: number,
  spec: StrokeSpec,
  composition: CompositionPlan,
  anchor: CompositionAnchor,
): number {
  const variation = chanGauss(seed, spec.id, 'lab.brushwork.angle')
  if (spec.role === 'hero') {
    return composition.field.angle + [0, 0.72, -0.58][spec.index] + variation * 0.18
  }
  if (spec.role === 'support') {
    const cadence = ((spec.index % 3) - 1) * 0.3
    return composition.field.angle
      + cadence
      + (anchor.angle - composition.field.angle) * 0.12
      + variation * 0.34
  }
  const fan = [-0.92, -0.38, 0.18, 0.68][spec.index % 4]
  return composition.field.angle + fan + variation * 0.44
}

function roleCenter(
  seed: number,
  spec: StrokeSpec,
  composition: CompositionPlan,
  anchor: CompositionAnchor,
  space: BrushSpace,
): Point {
  if (spec.role === 'hero' && spec.index === 0) return { x: anchor.x, y: anchor.y }
  const angle = composition.field.angle
    + chan(seed, spec.id, 'lab.brushwork.center.angle') * TAU
  const radius = spec.role === 'hero'
    ? 0.035 + spec.index * 0.018
    : spec.role === 'support'
      ? 0.055 + chan(seed, spec.id, 'lab.brushwork.center.radius') * 0.14
      : 0.11 + chan(seed, spec.id, 'lab.brushwork.center.radius') * 0.27
  const center = add(
    toBrushPoint(anchor, space),
    { x: Math.cos(angle), y: Math.sin(angle) },
    radius,
  )
  return escapeQuietSpace(fromBrushPoint(center, space), composition)
}

function pressureFor(
  seed: number,
  spec: StrokeSpec,
): BrushworkPressure {
  const startRoll = chan(seed, spec.id, 'lab.brushwork.pressure.start')
  const peakRoll = chan(seed, spec.id, 'lab.brushwork.pressure.peak')
  const positionRoll = chan(seed, spec.id, 'lab.brushwork.pressure.position')
  const endRoll = chan(seed, spec.id, 'lab.brushwork.pressure.end')
  if (spec.role === 'hero') {
    return {
      start: 0.28 + startRoll * 0.18,
      peak: 0.9 + peakRoll * 0.1,
      peakAt: 0.18 + positionRoll * 0.13,
      end: 0.018 + endRoll * 0.055,
    }
  }
  if (spec.role === 'support') {
    return {
      start: 0.18 + startRoll * 0.18,
      peak: 0.79 + peakRoll * 0.2,
      peakAt: 0.22 + positionRoll * 0.17,
      end: 0.025 + endRoll * 0.09,
    }
  }
  return {
    start: 0.12 + startRoll * 0.2,
    peak: 0.66 + peakRoll * 0.29,
    peakAt: 0.16 + positionRoll * 0.24,
    end: 0.02 + endRoll * 0.11,
  }
}

export function brushworkPressureAt(
  pressure: BrushworkPressure,
  progress: number,
): number {
  const t = clamp01(progress)
  if (t <= pressure.peakAt) {
    const rise = t / Math.max(1e-6, pressure.peakAt)
    return pressure.start
      + (pressure.peak - pressure.start) * smoothstep(Math.pow(rise, 0.58))
  }
  const fall = (t - pressure.peakAt) / Math.max(1e-6, 1 - pressure.peakAt)
  return pressure.peak
    + (pressure.end - pressure.peak) * smoothstep(Math.pow(fall, 0.72))
}

function paletteRoleFor(spec: StrokeSpec): BrushworkPaletteRole {
  if (spec.role === 'hero') {
    return (['dominant', 'support', 'accent'] as const)[spec.index]
  }
  if (spec.role === 'support') {
    return spec.index % 4 === 3 ? 'ink' : spec.index % 2 === 0 ? 'support' : 'dominant'
  }
  return spec.index % 5 < 2 ? 'support' : 'dominant'
}

function bristlesFor(
  seed: number,
  spec: StrokeSpec,
  pointCount: number,
): BrushworkBristle[] {
  const count = spec.role === 'hero'
    ? 17 + Math.floor(chan(seed, spec.id, 'lab.brushwork.bristle.count') * 7)
    : spec.role === 'support'
      ? 9 + Math.floor(chan(seed, spec.id, 'lab.brushwork.bristle.count') * 5)
      : 4 + Math.floor(chan(seed, spec.id, 'lab.brushwork.bristle.count') * 3)
  const segmentCount = pointCount - 1
  return Array.from({ length: count }, (_, index) => {
    const id = spec.id * 64 + index
    const position = (
      index
      + 0.5
      + chanGauss(seed, id, 'lab.brushwork.bristle.offset') * 0.32
    ) / count
    const dry = spec.role === 'hero'
      ? 0.2 + chan(seed, id, 'lab.brushwork.bristle.dry') * 0.34
      : spec.role === 'support'
        ? 0.25 + chan(seed, id, 'lab.brushwork.bristle.dry') * 0.4
        : 0.32 + chan(seed, id, 'lab.brushwork.bristle.dry') * 0.44
    const active = Array.from({ length: segmentCount }, (_, segment) => {
      const cadence = Math.sin((segment + 1) * 2.17 + index * 0.71) * 0.12
      return chan(seed, id * 32 + segment, 'lab.brushwork.bristle.break')
        > clamp(dry + cadence, 0.08, 0.88)
    })
    if (!active.some(Boolean)) {
      active[Math.floor(chan(seed, id, 'lab.brushwork.bristle.keep') * segmentCount)] = true
    }
    const jitter = Array.from({ length: pointCount }, (_, pointIndex) =>
      chanGauss(seed, id * 32 + pointIndex, 'lab.brushwork.bristle.jitter'))
    return {
      id,
      offset: (position * 2 - 1) * 1.08,
      widthScale: spec.role === 'hero'
        ? 0.018 + chan(seed, id, 'lab.brushwork.bristle.width') * 0.045
        : spec.role === 'support'
          ? 0.026 + chan(seed, id, 'lab.brushwork.bristle.width') * 0.066
          : 0.052 + chan(seed, id, 'lab.brushwork.bristle.width') * 0.12,
      alpha: 0.24 + chan(seed, id, 'lab.brushwork.bristle.alpha') * 0.5,
      pigment: index % (spec.role === 'hero' ? 9 : 13) === 0 ? 'ink' : 'stroke',
      active,
      jitter,
    }
  })
}

function buildStroke(
  seed: number,
  spec: StrokeSpec,
  composition: CompositionPlan,
  space: BrushSpace,
): BrushworkStroke {
  const anchors = composition.anchors.length ? composition.anchors : [FALLBACK_ANCHOR]
  const anchorIndex = spec.role === 'hero'
    ? Math.min(spec.index, anchors.length - 1)
    : spec.index % anchors.length
  const anchor = anchors[anchorIndex] ?? anchors[0] ?? FALLBACK_ANCHOR
  const normalizedCenter = roleCenter(seed, spec, composition, anchor, space)
  const center = toBrushPoint(normalizedCenter, space)
  const angle = roleAngle(seed, spec, composition, anchor)
  const direction = { x: Math.cos(angle), y: Math.sin(angle) }
  const normal = { x: -direction.y, y: direction.x }
  const length = roleLength(seed, spec)
  const startReach = 0.42 + chan(seed, spec.id, 'lab.brushwork.reach.start') * 0.12
  const endReach = 0.48 + chan(seed, spec.id, 'lab.brushwork.reach.end') * 0.16
  const bendSign = chan(seed, spec.id, 'lab.brushwork.bend.sign') > 0.5 ? 1 : -1
  const bend = length
    * (spec.role === 'hero' ? 0.1 : spec.role === 'support' ? 0.08 : 0.055)
    * (0.55 + chan(seed, spec.id, 'lab.brushwork.bend') * 0.9)
    * bendSign
  const start = add(
    add(center, direction, -length * startReach),
    normal,
    length * chanGauss(seed, spec.id, 'lab.brushwork.start.cross') * 0.035,
  )
  const end = add(
    add(center, direction, length * endReach),
    normal,
    length * chanGauss(seed, spec.id, 'lab.brushwork.end.cross') * 0.065,
  )
  const controlA = add(
    add(start, direction, length * (0.27 + chan(seed, spec.id, 'lab.brushwork.control.a') * 0.09)),
    normal,
    bend,
  )
  const controlB = add(
    add(end, direction, -length * (0.24 + chan(seed, spec.id, 'lab.brushwork.control.b') * 0.12)),
    normal,
    bend * (-0.2 + chanGauss(seed, spec.id, 'lab.brushwork.bend.return') * 0.45),
  )
  const pointCount = rolePointCount(spec.role)
  const spatialPhase = chan(seed, spec.id, 'lab.brushwork.wobble.phase') * TAU
  const wobbleScale = spec.role === 'hero' ? 0.012 : spec.role === 'support' ? 0.009 : 0.005
  const points = Array.from({ length: pointCount }, (_, pointIndex): BrushworkPoint => {
    const progress = pointIndex / Math.max(1, pointCount - 1)
    const point = cubicPoint(start, controlA, controlB, end, progress)
    const envelope = Math.sin(Math.PI * progress)
    const wobble = envelope * length * wobbleScale * (
      Math.sin(progress * TAU * 1.7 + spatialPhase)
      + Math.sin(progress * TAU * 3.4 - spatialPhase * 0.63) * 0.28
    )
    const normalized = fromBrushPoint(add(point, normal, wobble), space)
    return {
      x: normalized.x,
      y: normalized.y,
      edgeLeft: 0.78 + chan(seed, spec.id * 32 + pointIndex, 'lab.brushwork.edge.left') * 0.42,
      edgeRight: 0.78 + chan(seed, spec.id * 32 + pointIndex, 'lab.brushwork.edge.right') * 0.42,
      quiet: brushworkQuietAt(composition, normalized.x, normalized.y),
    }
  })
  const harmonic = (1 + Math.floor(
    chan(seed, spec.id, 'lab.brushwork.motion.harmonic') * 3,
  )) as 1 | 2 | 3
  return {
    id: spec.id,
    role: spec.role,
    anchorIndex,
    revealAt: spec.revealAt,
    center: normalizedCenter,
    points,
    baseWidth: roleWidth(seed, spec),
    opacity: spec.role === 'hero'
      ? 0.72 + chan(seed, spec.id, 'lab.brushwork.opacity') * 0.18
      : spec.role === 'support'
        ? 0.56 + chan(seed, spec.id, 'lab.brushwork.opacity') * 0.2
        : 0.38 + chan(seed, spec.id, 'lab.brushwork.opacity') * 0.26,
    pressure: pressureFor(seed, spec),
    colorRole: paletteRoleFor(spec),
    supportSlot: spec.index % 2,
    bristles: bristlesFor(seed, spec, pointCount),
    motion: {
      phase: chan(seed, spec.id, 'lab.brushwork.motion.phase') * TAU,
      harmonic,
      amplitude: spec.role === 'hero' ? 0.016 : spec.role === 'support' ? 0.012 : 0.008,
    },
  }
}

function catalogSpecs(seed: number): StrokeSpec[] {
  const heroCount = 3
  const supportCount = 9
  const fillerCount = 32
  const heroes = Array.from({ length: heroCount }, (_, index): StrokeSpec => ({
    id: 1000 + index,
    index,
    count: heroCount,
    role: 'hero',
    revealAt: [0, 0.07, 0.58][index],
  }))
  const supports = Array.from({ length: supportCount }, (_, index): StrokeSpec => ({
    id: 2000 + index,
    index,
    count: supportCount,
    role: 'support',
    revealAt: 0.08 + (index / Math.max(1, supportCount - 1)) * 0.7,
  }))
  const fillers = Array.from({ length: fillerCount }, (_, index): StrokeSpec => ({
    id: 3000 + index,
    index,
    count: fillerCount,
    role: 'filler',
    revealAt: 0.18
      + (
        index
        + chan(seed, 3000 + index, 'lab.brushwork.reveal') * 0.35
      ) / fillerCount * 0.78,
  }))
  return [...fillers, ...supports, ...heroes]
}

export function buildBrushworkScene(options: {
  seed: number
  complexity: number
  aspect: number
  composition: CompositionPlan
}): BrushworkScene {
  const specs = catalogSpecs(options.seed)
  const space = brushSpace(options.aspect)
  const complexity = clamp01(options.complexity)
  const strokes = specs
    .filter((spec) => spec.revealAt <= complexity)
    .map((spec) => buildStroke(options.seed, spec, options.composition, space))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.id - b.id)
  return {
    strokes,
    catalogSize: specs.length,
  }
}

export function deformBrushworkStroke(
  stroke: BrushworkStroke,
  phase: number,
  amount: number,
  aspect: number,
): BrushworkPoint[] {
  const motion = clamp01(amount)
  if (motion <= 0) return stroke.points.map((point) => ({ ...point }))
  const normalizedPhase = ((phase % 1) + 1) % 1
  const theta = normalizedPhase * TAU
  const space = brushSpace(aspect)
  const points = stroke.points.map((point) => toBrushPoint(point, space))
  return stroke.points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)]
    const next = points[Math.min(points.length - 1, index + 1)]
    const dx = next.x - previous.x
    const dy = next.y - previous.y
    const length = Math.hypot(dx, dy) || 1
    const tangent = { x: dx / length, y: dy / length }
    const normal = { x: -dy / length, y: dx / length }
    const progress = index / Math.max(1, points.length - 1)
    const envelope = 0.32 + Math.sin(Math.PI * progress) * 0.68
    const shared = Math.sin(theta + stroke.motion.phase) * 0.34
    const flex = Math.sin(
      theta * stroke.motion.harmonic
      + stroke.motion.phase
      + progress * TAU * 1.15,
    )
    const counter = Math.sin(
      theta * 2
      - stroke.motion.phase * 0.7
      + progress * TAU * 2.2,
    ) * 0.24
    const normalShift = stroke.motion.amplitude
      * motion
      * (shared + (flex + counter) * envelope)
    const tangentShift = stroke.motion.amplitude
      * motion
      * 0.22
      * Math.cos(theta + stroke.motion.phase + progress * Math.PI)
    const deformed = add(
      add(points[index], normal, normalShift),
      tangent,
      tangentShift,
    )
    const normalized = fromBrushPoint(deformed, space)
    return {
      ...point,
      x: normalized.x,
      y: normalized.y,
    }
  })
}
