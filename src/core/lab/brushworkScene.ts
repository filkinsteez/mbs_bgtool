import { chan, chanGauss } from '@/core/organic/random'
import { META_PHASE, unitPos, unitVel } from '@/core/lissajous/equation'
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

type FlowTransform = {
  center: Point
  cosine: number
  sine: number
  longScale: number
  crossScale: number
}

type FlowPoint = {
  point: Point
  tangent: Point
  normal: Point
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

const META_FLOW = {
  a: 1,
  b: 2,
  phase: META_PHASE,
  kind: 'meta' as const,
}

const CROSSING_A = Math.PI - META_PHASE
const CROSSING_B = TAU - META_PHASE
const HERO_FLOW_POSITIONS = [2.2, 5.34, CROSSING_A] as const
const SUPPORT_FLOW_POSITIONS = [
  CROSSING_A,
  CROSSING_B,
  2.22,
  5.36,
  3.72,
  0.66,
  2.86,
  4.82,
  1.72,
] as const
const EARLY_FILLER_POSITIONS = [1.06, 4.2, 2.52, 5.58] as const

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

function foldAroundAxis(angle: number, axis: number): number {
  let delta = angle - axis
  while (delta > Math.PI / 2) delta -= Math.PI
  while (delta < -Math.PI / 2) delta += Math.PI
  return delta
}

function buildFlowTransform(
  composition: CompositionPlan,
  space: BrushSpace,
): FlowTransform {
  const primary = composition.anchors[0] ?? FALLBACK_ANCHOR
  const normalizedCenter = {
    x: 0.5 + (primary.x - 0.5) * 0.14,
    y: 0.5 + (primary.y - 0.5) * 0.14,
  }
  const center = toBrushPoint(normalizedCenter, space)
  const longAxis = space.width >= space.height ? 0 : Math.PI / 2
  const directionalLean = clamp(
    foldAroundAxis(composition.field.angle, longAxis),
    -0.62,
    0.62,
  )
  const angle = longAxis + directionalLean * 0.48
  return {
    center,
    cosine: Math.cos(angle),
    sine: Math.sin(angle),
    longScale: clamp(Math.max(space.width, space.height) * 0.4, 0.58, 0.67),
    crossScale: 0.5,
  }
}

function sampleFlow(transform: FlowTransform, time: number): FlowPoint {
  const [unitX, unitY] = unitPos(META_FLOW, time)
  const [velocityX, velocityY] = unitVel(META_FLOW, time)
  const localX = unitX * transform.longScale
  const localY = unitY * transform.crossScale
  const localVelocityX = velocityX * transform.longScale
  const localVelocityY = velocityY * transform.crossScale
  const point = {
    x: transform.center.x
      + localX * transform.cosine
      - localY * transform.sine,
    y: transform.center.y
      + localX * transform.sine
      + localY * transform.cosine,
  }
  const rotatedVelocity = {
    x: localVelocityX * transform.cosine
      - localVelocityY * transform.sine,
    y: localVelocityX * transform.sine
      + localVelocityY * transform.cosine,
  }
  const length = Math.hypot(rotatedVelocity.x, rotatedVelocity.y) || 1
  const tangent = {
    x: rotatedVelocity.x / length,
    y: rotatedVelocity.y / length,
  }
  return {
    point,
    tangent,
    normal: { x: -tangent.y, y: tangent.x },
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

function roleWidth(seed: number, spec: StrokeSpec): number {
  const roll = chan(seed, spec.id, 'lab.brushwork.width')
  if (spec.role === 'hero') {
    return [0.135, 0.11, 0.078][spec.index] * (0.9 + roll * 0.16)
  }
  if (spec.role === 'support') return 0.06 + roll * 0.07
  return 0.018 + roll * 0.022
}

function rolePointCount(role: BrushworkRole): number {
  if (role === 'hero') return 25
  if (role === 'support') return 15
  return 9
}

function flowPosition(
  seed: number,
  spec: StrokeSpec,
): number {
  if (spec.role === 'hero') {
    return HERO_FLOW_POSITIONS[spec.index]
  }
  if (spec.role === 'support') {
    return SUPPORT_FLOW_POSITIONS[spec.index]
  }
  if (spec.index < EARLY_FILLER_POSITIONS.length) {
    return EARLY_FILLER_POSITIONS[spec.index]
  }
  const goldenTurn = 0.6180339887498948
  const turn = (
    (spec.index - EARLY_FILLER_POSITIONS.length) * goldenTurn
    + chan(seed, spec.id, 'lab.brushwork.flow.position') * 0.11
  ) % 1
  return turn * TAU
}

function flowSpan(seed: number, spec: StrokeSpec): number {
  const roll = chan(seed, spec.id, 'lab.brushwork.flow.span')
  if (spec.role === 'hero') return [2.14, 2.08, 1.22][spec.index] * (0.94 + roll * 0.1)
  if (spec.role === 'support') return 0.65 + roll * 0.4
  return 0.24 + roll * 0.31
}

function flowOffset(seed: number, spec: StrokeSpec): number {
  const offset = chanGauss(seed, spec.id, 'lab.brushwork.flow.offset')
  if (spec.role === 'hero') return [0.02, -0.026, 0.012][spec.index] + offset * 0.022
  if (spec.role === 'support') {
    const lane = [-0.13, 0.13, -0.08, 0.08, -0.18, 0.18, -0.04, 0.04, 0.21][spec.index]
    return lane + offset * 0.028
  }
  const lane = ((spec.index % 5) - 2) * 0.062
  return lane + offset * 0.035
}

function anchoredCenter(
  seed: number,
  spec: StrokeSpec,
  composition: CompositionPlan,
  anchor: CompositionAnchor,
  space: BrushSpace,
  flow: FlowTransform,
): Point {
  const sample = sampleFlow(flow, flowPosition(seed, spec))
  const flowCenter = fromBrushPoint(sample.point, space)
  const anchorPull = (
    spec.role === 'hero' ? 0.08 : spec.role === 'support' ? 0.11 : 0.07
  ) * anchor.strength
  return escapeQuietSpace({
    x: flowCenter.x + (anchor.x - flowCenter.x) * anchorPull,
    y: flowCenter.y + (anchor.y - flowCenter.y) * anchorPull,
  }, composition)
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
    return (['support', 'dominant', 'accent'] as const)[spec.index]
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
  const flow = buildFlowTransform(composition, space)
  const position = flowPosition(seed, spec)
  const span = flowSpan(seed, spec)
  const normalizedCenter = anchoredCenter(
    seed,
    spec,
    composition,
    anchor,
    space,
    flow,
  )
  const rawCenter = sampleFlow(flow, position).point
  const desiredCenter = toBrushPoint(normalizedCenter, space)
  const centerShift = {
    x: desiredCenter.x - rawCenter.x,
    y: desiredCenter.y - rawCenter.y,
  }
  const centerFlowPoint = sampleFlow(flow, position)
  const baseOffset = flowOffset(seed, spec)
  const pointCount = rolePointCount(spec.role)
  const spatialPhase = chan(seed, spec.id, 'lab.brushwork.wobble.phase') * TAU
  const wobbleScale = spec.role === 'hero' ? 0.026 : spec.role === 'support' ? 0.018 : 0.009
  const points = Array.from({ length: pointCount }, (_, pointIndex): BrushworkPoint => {
    const progress = pointIndex / Math.max(1, pointCount - 1)
    const flowPoint = spec.role === 'hero'
      ? sampleFlow(flow, position + (progress - 0.5) * span)
      : {
          point: add(
            centerFlowPoint.point,
            centerFlowPoint.tangent,
            (progress - 0.5) * span,
          ),
          tangent: centerFlowPoint.tangent,
          normal: centerFlowPoint.normal,
        }
    const envelope = Math.sin(Math.PI * progress)
    const wobble = envelope * wobbleScale * (
      Math.sin(progress * TAU * 1.25 + spatialPhase)
      + Math.sin(progress * TAU * 2.7 - spatialPhase * 0.63) * 0.34
    )
    const along = envelope * wobbleScale * 0.24
      * Math.sin(progress * TAU * 1.8 - spatialPhase)
    const point = add(
      add(
        add(flowPoint.point, centerShift),
        flowPoint.normal,
        baseOffset + wobble,
      ),
      flowPoint.tangent,
      along,
    )
    const normalized = fromBrushPoint(point, space)
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
      ? 0.76 + chan(seed, spec.id, 'lab.brushwork.opacity') * 0.18
      : spec.role === 'support'
        ? 0.64 + chan(seed, spec.id, 'lab.brushwork.opacity') * 0.2
        : 0.5 + chan(seed, spec.id, 'lab.brushwork.opacity') * 0.22,
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
  const supportReveal = [0.015, 0.04, 0.075, 0.115, 0.24, 0.36, 0.48, 0.64, 0.76]
  const earlyFillerReveal = [0.04, 0.075, 0.11, 0.14]
  const heroes = Array.from({ length: heroCount }, (_, index): StrokeSpec => ({
    id: 1000 + index,
    index,
    count: heroCount,
    role: 'hero',
    revealAt: [0, 0.055, 0.56][index],
  }))
  const supports = Array.from({ length: supportCount }, (_, index): StrokeSpec => ({
    id: 2000 + index,
    index,
    count: supportCount,
    role: 'support',
    revealAt: supportReveal[index],
  }))
  const fillers = Array.from({ length: fillerCount }, (_, index): StrokeSpec => ({
    id: 3000 + index,
    index,
    count: fillerCount,
    role: 'filler',
    revealAt: index < earlyFillerReveal.length
      ? earlyFillerReveal[index]
      : 0.18
        + (
          index - earlyFillerReveal.length
          + chan(seed, 3000 + index, 'lab.brushwork.reveal') * 0.35
        ) / (fillerCount - earlyFillerReveal.length) * 0.76,
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
