import { sampleCurve } from '@/core/lissajous/sampler'
import { META_PHASE } from '@/core/lissajous/equation'
import { SpatialHash } from '@/core/math/spatialHash'
import { chan } from '@/core/organic/random'
import type { LookColorPlan } from './colorDirection'
import {
  resolveCompositionPlan,
  sampleCompositionPlan,
  type CompositionPlan,
} from './compositionPlan'
import { createOrganicMotionWarp } from './motion'
import { trailCarrierBounds, type TrailCarrierBounds } from './trailSourceCarrier'
import type { MotionState } from './types'

const TAU = Math.PI * 2
const GUIDE_SAMPLES = 384

export const TRAIL_GEOMETRY_REVISION = 3

export type TrailTier = 'back' | 'support' | 'hero'

export type TrailBreak = {
  from: number
  to: number
}

export type TrailPath = {
  id: number
  familyId: number
  parentId: number | null
  tier: TrailTier
  primary: boolean
  width: number
  alpha: number
  length: number
  points: Float32Array
  breaks: readonly TrailBreak[]
  pulseOffset: number
}

export type TrailFamily = {
  id: number
  parentFamilyId: number | null
  tier: TrailTier
  colorSlot: number
  pathIds: readonly number[]
}

export type TrailCrossing = {
  x: number
  y: number
  underPathId: number
  overPathId: number
  underPointIndex: number
  overPointIndex: number
}

export type TrailPlan = {
  revision: typeof TRAIL_GEOMETRY_REVISION
  seed: number
  width: number
  height: number
  complexity: number
  carrierKind: 'canonical' | 'source'
  carrierBounds: TrailCarrierBounds
  families: readonly TrailFamily[]
  paths: readonly TrailPath[]
  crossings: readonly TrailCrossing[]
}

export type TrailPlanCarrierInput = {
  kind: 'source'
  key: string
  points: Float32Array
}

export type TrailPlanInput = {
  seed: number
  width: number
  height: number
  complexity: number
  composition?: CompositionPlan
  carrier?: TrailPlanCarrierInput
}

type Point = {
  x: number
  y: number
}

type GuidePoint = Point & {
  tx: number
  ty: number
}

type Carrier = {
  familyId: number
  centerPathId: number
  start: number
  span: number
  direction: 1 | -1
}

type SegmentRef = {
  pathId: number
  pointIndex: number
  ax: number
  ay: number
  bx: number
  by: number
}

type CrossingCandidate = {
  key: string
  a: SegmentRef
  b: SegmentRef
  x: number
  y: number
  score: number
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function mod1(value: number): number {
  const wrapped = value - Math.floor(value)
  return Object.is(wrapped, -0) ? 0 : wrapped
}

function tierRank(tier: TrailTier): number {
  return tier === 'hero' ? 2 : tier === 'support' ? 1 : 0
}

function pointCount(points: Float32Array): number {
  return points.length / 2
}

function pathPoint(points: Float32Array, index: number): Point {
  const clamped = Math.max(0, Math.min(pointCount(points) - 1, index))
  return { x: points[clamped * 2], y: points[clamped * 2 + 1] }
}

function pathTangent(points: Float32Array, index: number): Point {
  const before = pathPoint(points, index - 1)
  const after = pathPoint(points, index + 1)
  const dx = after.x - before.x
  const dy = after.y - before.y
  const length = Math.hypot(dx, dy) || 1
  return { x: dx / length, y: dy / length }
}

function polylineLength(points: Float32Array): number {
  let length = 0
  for (let index = 2; index < points.length; index += 2) {
    length += Math.hypot(
      points[index] - points[index - 2],
      points[index + 1] - points[index - 1],
    )
  }
  return length
}

function resampleClosed(points: readonly Point[], count: number): GuidePoint[] {
  const cumulative = new Float64Array(points.length)
  for (let index = 1; index < points.length; index += 1) {
    cumulative[index] = cumulative[index - 1] + Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    )
  }
  const total = cumulative[cumulative.length - 1] || 1
  const sampled: Point[] = []
  let segment = 1
  for (let index = 0; index <= count; index += 1) {
    const target = total * index / count
    while (segment < cumulative.length - 1 && cumulative[segment] < target) {
      segment += 1
    }
    const start = points[segment - 1]
    const end = points[segment]
    const span = cumulative[segment] - cumulative[segment - 1] || 1
    const amount = (target - cumulative[segment - 1]) / span
    sampled.push({
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount,
    })
  }
  sampled[count] = { ...sampled[0] }
  return sampled.map((point, index) => {
    const before = sampled[(index - 1 + count) % count]
    const after = sampled[(index + 1) % count]
    const dx = after.x - before.x
    const dy = after.y - before.y
    const length = Math.hypot(dx, dy) || 1
    return { ...point, tx: dx / length, ty: dy / length }
  })
}

function guideAt(guide: readonly GuidePoint[], amount: number): GuidePoint {
  const count = guide.length - 1
  const position = mod1(amount) * count
  const index = Math.floor(position)
  const next = (index + 1) % count
  const fraction = position - index
  let tx = guide[index].tx + (guide[next].tx - guide[index].tx) * fraction
  let ty = guide[index].ty + (guide[next].ty - guide[index].ty) * fraction
  const tangentLength = Math.hypot(tx, ty) || 1
  tx /= tangentLength
  ty /= tangentLength
  return {
    x: guide[index].x + (guide[next].x - guide[index].x) * fraction,
    y: guide[index].y + (guide[next].y - guide[index].y) * fraction,
    tx,
    ty,
  }
}

function buildGuide(
  seed: number,
  width: number,
  height: number,
  composition: CompositionPlan,
): GuidePoint[] {
  const raw = sampleCurve({
    frequencyX: 1,
    frequencyY: 2,
    phase: META_PHASE,
    amplitudeX: 1,
    amplitudeY: 1,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    sampleDensity: GUIDE_SAMPLES,
    curve: 'meta',
  }, 2, 2, GUIDE_SAMPLES)
  const portraitRotation = height > width * 1.14 ? Math.PI / 2 : 0
  const tilt = (chan(seed, 0, 'lab.trails.guide.tilt') - 0.5) * 0.16
    + Math.sin(composition.field.angle) * 0.055
  const rotation = portraitRotation + tilt
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const rotated = raw.map((point) => {
    const x = point.x - 1
    const y = point.y - 1
    return {
      x: x * cos - y * sin,
      y: x * sin + y * cos,
    }
  })
  const minX = Math.min(...rotated.map((point) => point.x))
  const maxX = Math.max(...rotated.map((point) => point.x))
  const minY = Math.min(...rotated.map((point) => point.y))
  const maxY = Math.max(...rotated.map((point) => point.y))
  const edgeScale = composition.edgePolicy === 'bleed' ? 1.08 : 1
  const maxWidth = width * 0.84 * edgeScale
  const maxHeight = height * 0.78 * edgeScale
  const scale = Math.min(
    maxWidth / Math.max(0.001, maxX - minX),
    maxHeight / Math.max(0.001, maxY - minY),
  )
  const anchor = composition.anchors[0]
  const centerX = width * (0.5 + ((anchor?.x ?? 0.5) - 0.5) * 0.18)
  const centerY = height * (0.5 + ((anchor?.y ?? 0.5) - 0.5) * 0.18)
  const rawCenterX = (minX + maxX) / 2
  const rawCenterY = (minY + maxY) / 2
  const fitted = rotated.map((point) => ({
    x: centerX + (point.x - rawCenterX) * scale,
    y: centerY + (point.y - rawCenterY) * scale,
  }))
  const minDimension = Math.min(width, height)
  const normalAmplitude = minDimension
    * (0.012 + composition.latents.mutation * 0.024)
  const directionalAmplitude = minDimension
    * (0.004 + composition.latents.directionality * 0.009)
  const phaseA = chan(seed, 0, 'lab.trails.guide.phase.a') * TAU
  const phaseB = chan(seed, 0, 'lab.trails.guide.phase.b') * TAU
  const flowX = Math.cos(composition.field.angle)
  const flowY = Math.sin(composition.field.angle)
  const warped = fitted.map((point, index) => {
    const previous = fitted[(index - 1 + GUIDE_SAMPLES) % GUIDE_SAMPLES]
    const next = fitted[(index + 1) % GUIDE_SAMPLES]
    const dx = next.x - previous.x
    const dy = next.y - previous.y
    const length = Math.hypot(dx, dy) || 1
    const normalX = -dy / length
    const normalY = dx / length
    const amount = index / GUIDE_SAMPLES
    const sample = sampleCompositionPlan(composition, point.x, point.y, width, height)
    const quietAttenuation = 1 - sample.quiet * 0.44
    const normalWave = (
      Math.sin(TAU * amount + phaseA)
      + Math.sin(TAU * amount * 3 - phaseA * 0.7) * 0.28
    ) * normalAmplitude * quietAttenuation
    const directionalWave = Math.sin(TAU * amount * 2 + phaseB)
      * directionalAmplitude
      * (0.72 + sample.focus * 0.28)
    return {
      x: point.x + normalX * normalWave + flowX * directionalWave,
      y: point.y + normalY * normalWave + flowY * directionalWave,
    }
  })
  warped[warped.length - 1] = { ...warped[0] }
  return resampleClosed(warped, GUIDE_SAMPLES)
}

function buildSourceGuide(carrier: TrailPlanCarrierInput): GuidePoint[] {
  if (carrier.points.length < 8 || carrier.points.length % 2 !== 0) {
    throw new Error('Source Trails carrier requires at least four points.')
  }
  const points: Point[] = []
  for (let index = 0; index < carrier.points.length; index += 2) {
    const x = carrier.points[index]
    const y = carrier.points[index + 1]
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Source Trails carrier contains a non-finite point.')
    }
    points.push({ x, y })
  }
  const first = points[0]
  const last = points.at(-1)!
  if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-4) {
    points.push({ ...first })
  }
  return resampleClosed(points, GUIDE_SAMPLES)
}

function familyTier(index: number): TrailTier {
  if (index < 2) return 'hero'
  if (index < 4) return 'support'
  return 'back'
}

function familyLaneCount(tier: TrailTier, complexity: number): number {
  if (tier === 'hero') return 3 + Math.floor(complexity * 3)
  if (tier === 'support') return 2 + Math.floor(complexity * 2)
  return 1 + Math.floor(complexity * 2)
}

function familyWidth(tier: TrailTier, minDimension: number): number {
  const fraction = tier === 'hero' ? 0.0042 : tier === 'support' ? 0.00235 : 0.00125
  return Math.max(0.72, minDimension * fraction)
}

function familyAlpha(tier: TrailTier): number {
  return tier === 'hero' ? 0.9 : tier === 'support' ? 0.62 : 0.36
}

function buildFamilyPath(options: {
  guide: readonly GuidePoint[]
  seed: number
  familyIndex: number
  laneIndex: number
  laneCenter: number
  start: number
  span: number
  direction: 1 | -1
  offset: number
  complexity: number
  minDimension: number
}): Float32Array {
  const {
    guide,
    seed,
    familyIndex,
    laneIndex,
    laneCenter,
    start,
    span,
    direction,
    offset,
    complexity,
    minDimension,
  } = options
  const samples = 96 + Math.round(span * 72)
  const points = new Float32Array((samples + 1) * 2)
  const phase = chan(seed, familyIndex * 31 + laneIndex, 'lab.trails.family.wave.phase') * TAU
  const frequency = 1 + Math.floor(
    chan(seed, familyIndex * 31 + laneIndex, 'lab.trails.family.wave.frequency') * 2,
  )
  const centerHero = familyIndex === 0 && laneIndex === laneCenter
  const waveAmplitude = centerHero
    ? 0
    : minDimension
      * (0.0035 + complexity * 0.0045)
      * (0.65 + chan(seed, familyIndex * 31 + laneIndex, 'lab.trails.family.wave.amount') * 0.5)
  for (let index = 0; index <= samples; index += 1) {
    const progress = index / samples
    const point = guideAt(guide, start + direction * span * progress)
    const envelope = Math.sin(Math.PI * progress) ** 0.68
    const wave = Math.sin(TAU * frequency * progress + phase) * waveAmplitude * envelope
    const normalOffset = offset + wave
    points[index * 2] = point.x - point.ty * normalOffset
    points[index * 2 + 1] = point.y + point.tx * normalOffset
  }
  return points
}

function cubicPoint(
  start: Point,
  controlA: Point,
  controlB: Point,
  end: Point,
  amount: number,
): Point {
  const inverse = 1 - amount
  return {
    x: inverse ** 3 * start.x
      + 3 * inverse ** 2 * amount * controlA.x
      + 3 * inverse * amount ** 2 * controlB.x
      + amount ** 3 * end.x,
    y: inverse ** 3 * start.y
      + 3 * inverse ** 2 * amount * controlA.y
      + 3 * inverse * amount ** 2 * controlB.y
      + amount ** 3 * end.y,
  }
}

function buildBranchPath(options: {
  seed: number
  branchIndex: number
  parent: TrailPath
  attachProgress: number
  target: GuidePoint
  minDimension: number
}): Float32Array {
  const { seed, branchIndex, parent, attachProgress, target, minDimension } = options
  const parentPoints = pointCount(parent.points)
  const attachIndex = Math.max(
    2,
    Math.min(parentPoints - 3, Math.round((parentPoints - 1) * attachProgress)),
  )
  const start = pathPoint(parent.points, attachIndex)
  const startTangent = pathTangent(parent.points, attachIndex)
  const direction = chan(seed, branchIndex, 'lab.trails.branch.side') > 0.5 ? 1 : -1
  const reach = minDimension
    * (0.2 + chan(seed, branchIndex, 'lab.trails.branch.reach') * 0.07)
  const controlA = {
    x: start.x + startTangent.x * reach
      - startTangent.y * direction * minDimension * 0.045,
    y: start.y + startTangent.y * reach
      + startTangent.x * direction * minDimension * 0.045,
  }
  const controlB = {
    x: target.x - target.tx * reach * 0.82
      + target.ty * direction * minDimension * 0.06,
    y: target.y - target.ty * reach * 0.82
      - target.tx * direction * minDimension * 0.06,
  }
  const samples = 72
  const points = new Float32Array((samples + 1) * 2)
  for (let index = 0; index <= samples; index += 1) {
    const point = cubicPoint(start, controlA, controlB, target, index / samples)
    points[index * 2] = point.x
    points[index * 2 + 1] = point.y
  }
  points[0] = start.x
  points[1] = start.y
  return points
}

function offsetOpenPath(points: Float32Array, distance: number): Float32Array {
  if (distance === 0) return points
  const output = new Float32Array(points.length)
  const count = pointCount(points)
  for (let index = 0; index < count; index += 1) {
    const tangent = pathTangent(points, index)
    const envelope = Math.sin(Math.PI * index / Math.max(1, count - 1)) ** 0.72
    const amount = distance * envelope
    output[index * 2] = points[index * 2] - tangent.y * amount
    output[index * 2 + 1] = points[index * 2 + 1] + tangent.x * amount
  }
  output[0] = points[0]
  output[1] = points[1]
  output[output.length - 2] = points[points.length - 2]
  output[output.length - 1] = points[points.length - 1]
  return output
}

function segmentIntersection(a: SegmentRef, b: SegmentRef): Point | null {
  const adx = a.bx - a.ax
  const ady = a.by - a.ay
  const bdx = b.bx - b.ax
  const bdy = b.by - b.ay
  const denominator = adx * bdy - ady * bdx
  if (Math.abs(denominator) < 1e-7) return null
  const dx = b.ax - a.ax
  const dy = b.ay - a.ay
  const amountA = (dx * bdy - dy * bdx) / denominator
  const amountB = (dx * ady - dy * adx) / denominator
  if (amountA <= 0.08 || amountA >= 0.92 || amountB <= 0.08 || amountB >= 0.92) {
    return null
  }
  return {
    x: a.ax + adx * amountA,
    y: a.ay + ady * amountA,
  }
}

function crossingAngle(a: SegmentRef, b: SegmentRef): number {
  const adx = a.bx - a.ax
  const ady = a.by - a.ay
  const bdx = b.bx - b.ax
  const bdy = b.by - b.ay
  return Math.abs(adx * bdy - ady * bdx)
    / Math.max(1e-6, Math.hypot(adx, ady) * Math.hypot(bdx, bdy))
}

function mergeBreaks(breaks: TrailBreak[]): TrailBreak[] {
  const sorted = [...breaks].sort((a, b) => a.from - b.from || a.to - b.to)
  const merged: TrailBreak[] = []
  for (const item of sorted) {
    const previous = merged.at(-1)
    if (previous && item.from <= previous.to + 1) {
      previous.to = Math.max(previous.to, item.to)
    } else {
      merged.push({ ...item })
    }
  }
  return merged
}

function resolveCrossings(
  paths: TrailPath[],
  seed: number,
  minDimension: number,
  complexity: number,
): TrailCrossing[] {
  const hash = new SpatialHash<SegmentRef>(Math.max(8, minDimension * 0.055))
  for (const path of paths) {
    for (let index = 0; index < pointCount(path.points) - 1; index += 1) {
      const segment: SegmentRef = {
        pathId: path.id,
        pointIndex: index,
        ax: path.points[index * 2],
        ay: path.points[index * 2 + 1],
        bx: path.points[index * 2 + 2],
        by: path.points[index * 2 + 3],
      }
      hash.insertRect(
        Math.min(segment.ax, segment.bx),
        Math.min(segment.ay, segment.by),
        Math.max(segment.ax, segment.bx),
        Math.max(segment.ay, segment.by),
        segment,
      )
    }
  }
  const seen = new Set<string>()
  const candidates: CrossingCandidate[] = []
  hash.forEachBucket((segments) => {
    for (let aIndex = 0; aIndex < segments.length; aIndex += 1) {
      for (let bIndex = aIndex + 1; bIndex < segments.length; bIndex += 1) {
        const a = segments[aIndex]
        const b = segments[bIndex]
        if (a.pathId === b.pathId && Math.abs(a.pointIndex - b.pointIndex) < 10) continue
        const aPath = paths[a.pathId]
        const bPath = paths[b.pathId]
        const nearEndpoint = (path: TrailPath, index: number) =>
          index < 8 || index > pointCount(path.points) - 10
        if (nearEndpoint(aPath, a.pointIndex) || nearEndpoint(bPath, b.pointIndex)) continue
        if (aPath.familyId === bPath.familyId && a.pathId !== b.pathId) continue
        if (aPath.parentId === b.pathId && a.pointIndex < 6) continue
        if (bPath.parentId === a.pathId && b.pointIndex < 6) continue
        const first = a.pathId < b.pathId
          || (a.pathId === b.pathId && a.pointIndex < b.pointIndex)
          ? a
          : b
        const second = first === a ? b : a
        const key = `${first.pathId}:${first.pointIndex}|${second.pathId}:${second.pointIndex}`
        if (seen.has(key)) continue
        seen.add(key)
        if (crossingAngle(a, b) < Math.sin(Math.PI / 9)) continue
        const point = segmentIntersection(a, b)
        if (!point) continue
        const hierarchy = tierRank(aPath.tier) + tierRank(bPath.tier)
        const self = a.pathId === b.pathId ? 4 : 0
        const branch = aPath.parentId === b.pathId || bPath.parentId === a.pathId ? 1.5 : 0
        candidates.push({
          key,
          a,
          b,
          x: point.x,
          y: point.y,
          score: self + branch + hierarchy,
        })
      }
    }
  })
  candidates.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))

  const target = 2 + Math.floor(complexity * 5)
  const clearance = minDimension * 0.042
  const selected: TrailCrossing[] = []
  const breaksByPath = new Map<number, TrailBreak[]>()
  for (const candidate of candidates) {
    if (selected.length >= target) break
    if (selected.some((crossing) =>
      Math.hypot(crossing.x - candidate.x, crossing.y - candidate.y) < clearance)) {
      continue
    }
    const aPath = paths[candidate.a.pathId]
    const bPath = paths[candidate.b.pathId]
    let over = candidate.a
    let under = candidate.b
    const aRank = tierRank(aPath.tier)
    const bRank = tierRank(bPath.tier)
    if (aRank < bRank) {
      over = candidate.b
      under = candidate.a
    } else if (aRank === bRank) {
      const roll = chan(
        seed,
        candidate.a.pathId * 4099 + candidate.b.pathId * 131
          + candidate.a.pointIndex + candidate.b.pointIndex,
        'lab.trails.crossing.over',
      )
      if (roll > 0.5) {
        over = candidate.b
        under = candidate.a
      }
    }
    if (over.pathId === under.pathId) {
      const roll = chan(seed, over.pathId * 4099 + over.pointIndex, 'lab.trails.crossing.self')
      if (roll > 0.5) {
        const swap = over
        over = under
        under = swap
      }
    }
    const underPath = paths[under.pathId]
    const overPath = paths[over.pathId]
    const averageStep = underPath.length / Math.max(1, pointCount(underPath.points) - 1)
    const radius = Math.max(
      0,
      Math.ceil((overPath.width * 1.45 + underPath.width * 0.45)
        / Math.max(0.5, averageStep)) - 1,
    )
    const item = {
      from: Math.max(1, under.pointIndex - radius),
      to: Math.min(pointCount(underPath.points) - 2, under.pointIndex + radius + 1),
    }
    breaksByPath.set(under.pathId, [...(breaksByPath.get(under.pathId) ?? []), item])
    selected.push({
      x: candidate.x,
      y: candidate.y,
      underPathId: under.pathId,
      overPathId: over.pathId,
      underPointIndex: under.pointIndex,
      overPointIndex: over.pointIndex,
    })
  }
  for (const path of paths) {
    path.breaks = mergeBreaks(breaksByPath.get(path.id) ?? [])
  }
  return selected
}

export function buildTrailPlan(input: TrailPlanInput): TrailPlan {
  const width = Math.max(1, input.width)
  const height = Math.max(1, input.height)
  const complexity = clamp01(input.complexity)
  const composition = input.composition ?? resolveCompositionPlan({
    seed: input.seed,
    lookId: 'trails',
    complexity,
    aspect: width / height,
  })
  const guide = input.carrier
    ? buildSourceGuide(input.carrier)
    : buildGuide(input.seed, width, height, composition)
  const guidePoints = new Float32Array(guide.length * 2)
  guide.forEach((point, index) => {
    guidePoints[index * 2] = point.x
    guidePoints[index * 2 + 1] = point.y
  })
  const carrierBounds = trailCarrierBounds(guidePoints)
  const minDimension = Math.min(width, height)
  const carrierDimension = input.carrier
    ? Math.max(
        minDimension * 0.35,
        Math.min(minDimension, Math.max(carrierBounds.width, carrierBounds.height)),
      )
    : minDimension
  const mainFamilyCount = 4 + Math.round(complexity * 4)
  const paths: TrailPath[] = []
  const families: TrailFamily[] = []
  const carriers: Carrier[] = []
  const offsetOrder = [0, -1, 1, -2, 2, -3, 3, 4]
  const startOrder = [0.015, 0.39, 0.68, 0.18, 0.79, 0.52, 0.29, 0.9]
  const spanOrder = [0.97, 0.76, 0.67, 0.61, 0.72, 0.58, 0.64, 0.55]
  const laneGap = carrierDimension * (0.0082 - complexity * 0.0013)
  const familyGap = carrierDimension * (0.016 + complexity * 0.004)

  for (let familyIndex = 0; familyIndex < mainFamilyCount; familyIndex += 1) {
    const tier = familyTier(familyIndex)
    const laneCount = familyLaneCount(tier, complexity)
    const laneCenter = Math.floor(laneCount / 2)
    const start = familyIndex === 0
      ? startOrder[0]
      : mod1(
          startOrder[familyIndex % startOrder.length]
          + (chan(input.seed, familyIndex, 'lab.trails.family.start') - 0.5) * 0.07,
        )
    const span = Math.min(
      0.98,
      spanOrder[familyIndex % spanOrder.length] + complexity * (familyIndex === 0 ? 0 : 0.055),
    )
    const direction: 1 | -1 = familyIndex === 0
      ? 1
      : chan(input.seed, familyIndex, 'lab.trails.family.direction') > 0.5 ? 1 : -1
    const familyOffset = offsetOrder[familyIndex % offsetOrder.length] * familyGap
    const familyId = families.length
    const pathIds: number[] = []
    let centerPathId = -1
    for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
      const primary = laneIndex === laneCenter
      const laneOffset = (laneIndex - laneCenter) * laneGap
      const points = buildFamilyPath({
        guide,
        seed: input.seed,
        familyIndex,
        laneIndex,
        laneCenter,
        start,
        span,
        direction,
        offset: familyOffset + laneOffset,
        complexity,
        minDimension,
      })
      const widthScale = primary ? 1.08 : 0.76 + Math.abs(laneIndex - laneCenter) * 0.04
      const path: TrailPath = {
        id: paths.length,
        familyId,
        parentId: null,
        tier,
        primary,
        width: familyWidth(tier, minDimension) * widthScale,
        alpha: familyAlpha(tier) * (primary ? 1 : 0.76),
        length: polylineLength(points),
        points,
        breaks: [],
        pulseOffset: chan(input.seed, familyIndex * 31 + laneIndex, 'lab.trails.pulse'),
      }
      if (primary) centerPathId = path.id
      paths.push(path)
      pathIds.push(path.id)
    }
    families.push({
      id: familyId,
      parentFamilyId: null,
      tier,
      colorSlot: familyIndex < 2 ? familyIndex : familyIndex + 1,
      pathIds,
    })
    carriers.push({ familyId, centerPathId, start, span, direction })
  }

  const branchCount = 1 + Math.floor(complexity * 4)
  const attachOrder = [0.24, 0.61, 0.42, 0.72, 0.34]
  const targetDelta = [0.5, -0.34, 0.39, -0.46, 0.3]
  for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
    const parentCarrier = carriers[branchIndex % Math.min(4, carriers.length)]
    const parent = paths[parentCarrier.centerPathId]
    const attachProgress = Math.max(
      0.18,
      Math.min(
        0.8,
        attachOrder[branchIndex % attachOrder.length]
          + (chan(input.seed, branchIndex, 'lab.trails.branch.attach') - 0.5) * 0.06,
      ),
    )
    const attachGuide = parentCarrier.start
      + parentCarrier.direction * parentCarrier.span * attachProgress
    const target = guideAt(
      guide,
      attachGuide
        + targetDelta[branchIndex % targetDelta.length]
        + (chan(input.seed, branchIndex, 'lab.trails.branch.target') - 0.5) * 0.055,
    )
    const centerPoints = buildBranchPath({
      seed: input.seed,
      branchIndex,
      parent,
      attachProgress,
      target,
      minDimension,
    })
    const parentFamily = families[parent.familyId]
    const tier: TrailTier = parent.tier === 'back' ? 'back' : 'support'
    const familyId = families.length
    const pathIds: number[] = []
    const branchLaneCount = complexity > 0.82 ? 3 : 2
    for (let laneIndex = 0; laneIndex < branchLaneCount; laneIndex += 1) {
      const offset = (laneIndex - (branchLaneCount - 1) / 2) * laneGap * 0.72
      const points = offsetOpenPath(centerPoints, offset)
      const path: TrailPath = {
        id: paths.length,
        familyId,
        parentId: parent.id,
        tier,
        primary: laneIndex === 0,
        width: Math.max(0.64, parent.width * (laneIndex === 0 ? 0.54 : 0.46)),
        alpha: Math.min(0.7, parent.alpha * (laneIndex === 0 ? 0.78 : 0.62)),
        length: polylineLength(points),
        points,
        breaks: [],
        pulseOffset: chan(
          input.seed,
          branchIndex * 7 + laneIndex,
          'lab.trails.branch.pulse',
        ),
      }
      paths.push(path)
      pathIds.push(path.id)
    }
    families.push({
      id: familyId,
      parentFamilyId: parentFamily.id,
      tier,
      colorSlot: parentFamily.colorSlot,
      pathIds,
    })
  }

  const crossings = resolveCrossings(paths, input.seed, minDimension, complexity)
  return {
    revision: TRAIL_GEOMETRY_REVISION,
    seed: input.seed,
    width,
    height,
    complexity,
    carrierKind: input.carrier ? 'source' : 'canonical',
    carrierBounds,
    families,
    paths,
    crossings,
  }
}

export function normalizeTrailPhase(phase: number): number {
  return mod1(phase)
}

export function animatedTrailPathPoints(
  plan: TrailPlan,
  path: TrailPath,
  motion: MotionState,
): Float32Array {
  if (motion.frame?.phase === undefined || motion.amount <= 0) return path.points
  const phase = normalizeTrailPhase(motion.frame.phase)
  const warp = createOrganicMotionWarp(
    { ...motion, frame: { phase } },
    plan.seed,
    plan.width,
    plan.height,
  )
  if (!warp.active) return path.points
  const points = new Float32Array(path.points.length)
  for (let index = 0; index < path.points.length; index += 2) {
    const point = warp.point(path.points[index], path.points[index + 1])
    points[index] = point.x
    points[index + 1] = point.y
  }
  return points
}

export function resolveTrailColorIndices(
  plan: LookColorPlan | undefined,
  paletteSize: number,
  families: readonly TrailFamily[],
): number[] {
  const size = Math.max(1, paletteSize)
  const candidates: number[] = []
  const add = (index: number | null | undefined) => {
    if (index == null || index < 0 || index >= size || candidates.includes(index)) return
    candidates.push(index)
  }
  if (plan) {
    add(plan.roles.dominant)
    for (const index of plan.roles.support) add(index)
    add(plan.roles.ink)
    for (const index of [...plan.depthOrder].reverse()) add(index)
    add(plan.roles.accent)
    const withoutGround = candidates.filter((index) => index !== plan.roles.ground)
    if (withoutGround.length) {
      candidates.length = 0
      candidates.push(...withoutGround)
    }
    candidates.splice(Math.max(1, plan.localColorLimit))
  } else {
    for (let index = 0; index < Math.min(3, size); index += 1) add(index)
  }
  if (!candidates.length) candidates.push(0)

  const result: number[] = []
  for (const family of families) {
    if (family.parentFamilyId !== null) {
      result[family.id] = result[family.parentFamilyId] ?? candidates[0]
    } else {
      result[family.id] = candidates[family.colorSlot % candidates.length]
    }
  }
  return result
}

export function trailQuietFraction(
  plan: TrailPlan,
  columns = 32,
  rows = 18,
): number {
  const occupied = new Uint8Array(columns * rows)
  for (const path of plan.paths) {
    const radius = path.tier === 'hero' ? 1 : 0
    for (let index = 0; index < path.points.length; index += 2) {
      const column = Math.max(
        0,
        Math.min(columns - 1, Math.floor(path.points[index] / plan.width * columns)),
      )
      const row = Math.max(
        0,
        Math.min(rows - 1, Math.floor(path.points[index + 1] / plan.height * rows)),
      )
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const x = column + offsetX
          const y = row + offsetY
          if (x >= 0 && x < columns && y >= 0 && y < rows) {
            occupied[y * columns + x] = 1
          }
        }
      }
    }
  }
  let used = 0
  for (const value of occupied) used += value
  return 1 - used / occupied.length
}
