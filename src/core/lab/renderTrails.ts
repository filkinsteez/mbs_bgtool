import { createOrganicMotionWarp } from './motion'
import {
  buildTrailPlan,
  normalizeTrailPhase,
  resolveTrailColorIndices,
  TRAIL_GEOMETRY_REVISION,
  type TrailPath,
  type TrailPlan,
  type TrailPlanInput,
  type TrailTier,
} from './trails'
import type { LabState } from './types'

const trailPlanCache = new Map<string, TrailPlan>()
const CACHE_LIMIT = 12

function tierRank(tier: TrailTier): number {
  return tier === 'hero' ? 2 : tier === 'support' ? 1 : 0
}

function cacheKey(input: TrailPlanInput): string {
  return [
    TRAIL_GEOMETRY_REVISION,
    input.seed,
    input.width,
    input.height,
    input.complexity.toFixed(4),
    input.composition ? JSON.stringify(input.composition) : 'default',
  ].join('|')
}

export function getCachedTrailPlan(input: TrailPlanInput): TrailPlan {
  const key = cacheKey(input)
  const existing = trailPlanCache.get(key)
  if (existing) {
    trailPlanCache.delete(key)
    trailPlanCache.set(key, existing)
    return existing
  }
  const plan = buildTrailPlan(input)
  trailPlanCache.set(key, plan)
  while (trailPlanCache.size > CACHE_LIMIT) {
    trailPlanCache.delete(trailPlanCache.keys().next().value!)
  }
  return plan
}

export function clearTrailPlanCache(): void {
  trailPlanCache.clear()
}

function canvasPath(
  path: TrailPath,
  point: (x: number, y: number) => { x: number; y: number },
): Path2D {
  const output = new Path2D()
  let drawing = false
  let breakIndex = 0
  for (let index = 0; index < path.points.length / 2; index += 1) {
    while (breakIndex < path.breaks.length && index > path.breaks[breakIndex].to) {
      breakIndex += 1
    }
    const activeBreak = path.breaks[breakIndex]
    if (activeBreak && index >= activeBreak.from && index <= activeBreak.to) {
      drawing = false
      continue
    }
    const resolved = point(path.points[index * 2], path.points[index * 2 + 1])
    if (!drawing) {
      output.moveTo(resolved.x, resolved.y)
      drawing = true
    } else {
      output.lineTo(resolved.x, resolved.y)
    }
  }
  return output
}

function crossingPath(
  path: TrailPath,
  center: number,
  point: (x: number, y: number) => { x: number; y: number },
): Path2D {
  const output = new Path2D()
  const count = path.points.length / 2
  const radius = Math.max(2, Math.round(count * 0.018))
  const start = Math.max(0, center - radius)
  const end = Math.min(count - 1, center + radius)
  for (let index = start; index <= end; index += 1) {
    const resolved = point(path.points[index * 2], path.points[index * 2 + 1])
    if (index === start) output.moveTo(resolved.x, resolved.y)
    else output.lineTo(resolved.x, resolved.y)
  }
  return output
}

export function renderTrails(ctx: CanvasRenderingContext2D, lab: LabState): void {
  const width = lab.output.width
  const height = lab.output.height
  const complexity = Math.max(0, Math.min(1, lab.look?.complexity ?? 0.5))
  const plan = getCachedTrailPlan({
    seed: lab.seed,
    width,
    height,
    complexity,
    composition: lab.composition,
  })
  const palette = lab.colors.palette.length
    ? lab.colors.palette
    : [lab.colors.ink, lab.colors.paper]
  const colorIndices = resolveTrailColorIndices(
    lab.colors.plan,
    palette.length,
    plan.families,
  )
  const framePhase = lab.motion.frame?.phase
  const phase = framePhase === undefined ? undefined : normalizeTrailPhase(framePhase)
  const motion = phase === undefined
    ? lab.motion
    : { ...lab.motion, frame: { phase } }
  const warp = createOrganicMotionWarp(motion, lab.seed, width, height)
  const resolvePoint = warp.active
    ? (x: number, y: number) => warp.point(x, y)
    : (x: number, y: number) => ({ x, y })
  const orderedPaths = [...plan.paths].sort((a, b) =>
    tierRank(a.tier) - tierRank(b.tier) || a.familyId - b.familyId || a.id - b.id)
  const drawable = new Map<number, Path2D>()
  for (const path of orderedPaths) drawable.set(path.id, canvasPath(path, resolvePoint))

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalCompositeOperation = 'source-over'

  // A low-alpha edge made from the same approved swatch gives every family
  // continuity over both flat backgrounds and detailed material captures.
  for (const path of orderedPaths) {
    ctx.strokeStyle = palette[colorIndices[path.familyId] ?? 0]
    ctx.globalAlpha = path.alpha * (path.tier === 'hero' ? 0.16 : 0.1)
    ctx.lineWidth = path.width * (path.tier === 'hero' ? 2.7 : 2.25)
    ctx.stroke(drawable.get(path.id)!)
  }
  for (const path of orderedPaths) {
    ctx.strokeStyle = palette[colorIndices[path.familyId] ?? 0]
    ctx.globalAlpha = path.alpha
    ctx.lineWidth = path.width
    ctx.stroke(drawable.get(path.id)!)
  }

  // Static gaps live on under-paths. Redrawing the recorded over segment
  // makes the crossing ownership explicit without painting a paper-colored
  // knockout over source photography or a 3D material frame.
  for (const crossing of plan.crossings) {
    const path = plan.paths[crossing.overPathId]
    ctx.strokeStyle = palette[colorIndices[path.familyId] ?? 0]
    ctx.globalAlpha = path.alpha
    ctx.lineWidth = path.width
    ctx.stroke(crossingPath(path, crossing.overPointIndex, resolvePoint))
  }

  // Branch starts share their parent's exact point. A restrained node hides
  // antialiasing seams while retaining the filament rather than stamp grammar.
  for (const path of plan.paths) {
    if (path.parentId === null || !path.primary) continue
    const point = resolvePoint(path.points[0], path.points[1])
    ctx.fillStyle = palette[colorIndices[path.familyId] ?? 0]
    ctx.globalAlpha = path.alpha
    ctx.beginPath()
    ctx.arc(point.x, point.y, path.width * 0.58, 0, Math.PI * 2)
    ctx.fill()
  }

  // The network never rebuilds during motion. A shared analytic warp moves
  // the geometry, while one periodic highlight per primary family makes the
  // flow direction legible. Integer lap counts and normalized phase close
  // exactly at the loop seam.
  if (phase !== undefined && lab.motion.amount > 0) {
    const energy = Math.max(0, Math.min(1, (lab.motion.speed - 0.1) / 1.9))
    const speedBand = Math.round(energy * 2)
    for (const path of orderedPaths) {
      if (!path.primary || path.tier === 'back') continue
      const laps = 1 + speedBand + (path.id % 2)
      ctx.strokeStyle = palette[colorIndices[path.familyId] ?? 0]
      ctx.globalAlpha = path.alpha * lab.motion.amount * 0.42
      ctx.lineWidth = Math.max(0.55, path.width * 0.42)
      ctx.setLineDash([path.length * 0.105, path.length * 0.895])
      ctx.lineDashOffset = -(path.pulseOffset + phase * laps) * path.length
      ctx.stroke(drawable.get(path.id)!)
    }
    ctx.setLineDash([])
    ctx.lineDashOffset = 0
  }

  ctx.restore()
}
