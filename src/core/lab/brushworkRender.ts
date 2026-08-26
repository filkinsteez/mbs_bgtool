import type { LookColorPlan } from './colorDirection'
import { resolveCompositionPlan, type CompositionPlan } from './compositionPlan'
import type { Field } from './field'
import {
  brushworkPressureAt,
  buildBrushworkScene,
  deformBrushworkStroke,
  type BrushworkPaletteRole,
  type BrushworkPoint,
  type BrushworkRole,
  type BrushworkStroke,
} from './brushworkScene'

type PixelPoint = {
  x: number
  y: number
}

type StrokeGeometry = {
  centers: readonly PixelPoint[]
  normals: readonly PixelPoint[]
  halfWidths: readonly number[]
  ribbon: Path2D
}

export type BrushworkRenderOptions = {
  width: number
  height: number
  seed: number
  complexity: number
  composition?: CompositionPlan
  palette: readonly string[]
  colorPlan?: LookColorPlan
  territory: Field
  motionPhase?: number
  motionAmount: number
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function quietWidth(role: BrushworkRole, quiet: number): number {
  const carve = role === 'hero' ? 0.78 : role === 'support' ? 0.92 : 0.97
  return Math.max(0.045, 1 - clamp01(quiet) * carve)
}

function validIndex(index: number | null | undefined, palette: readonly string[]): index is number {
  return index != null && index >= 0 && index < palette.length
}

export function resolveBrushworkColorIndex(
  stroke: BrushworkStroke,
  palette: readonly string[],
  plan?: LookColorPlan,
): number {
  if (!palette.length) return 0
  if (!plan) {
    if (stroke.colorRole === 'support') return Math.min(palette.length - 1, 1 + stroke.supportSlot)
    if (stroke.colorRole === 'accent') return Math.min(palette.length - 1, 2)
    return 0
  }
  const targetByRole: Record<BrushworkPaletteRole, number | null | undefined> = {
    dominant: plan.roles.dominant,
    support: plan.roles.support[stroke.supportSlot % Math.max(1, plan.roles.support.length)],
    accent: plan.roles.accent,
    ink: plan.roles.ink,
  }
  const candidates = [
    targetByRole[stroke.colorRole],
    ...plan.roles.support,
    plan.roles.dominant,
    plan.roles.accent,
    plan.roles.ink,
  ]
  const visible = candidates.find(
    (index) => validIndex(index, palette) && index !== plan.roles.ground,
  )
  if (visible != null) return visible
  const fallback = candidates.find((index) => validIndex(index, palette))
  return fallback ?? 0
}

function inkIndexFor(palette: readonly string[], plan?: LookColorPlan): number {
  if (!palette.length) return 0
  if (plan && validIndex(plan.roles.ink, palette)) return plan.roles.ink
  return 0
}

function strokeCoverage(
  stroke: BrushworkStroke,
  territory: Field,
  width: number,
  height: number,
): number {
  const points = stroke.points
  const sampleIndices = [0.2, 0.5, 0.8].map((progress) =>
    Math.min(points.length - 1, Math.round((points.length - 1) * progress)))
  const average = sampleIndices.reduce((sum, index) => {
    const point = points[index]
    return sum + clamp01(territory(point.x * width, point.y * height))
  }, 0) / sampleIndices.length
  return 0.48 + Math.pow(average, 0.72) * 0.52
}

function pixelPoints(
  points: readonly BrushworkPoint[],
  width: number,
  height: number,
): PixelPoint[] {
  return points.map((point) => ({
    x: point.x * width,
    y: point.y * height,
  }))
}

function normalsFor(points: readonly PixelPoint[]): PixelPoint[] {
  return points.map((_, index) => {
    const previous = points[Math.max(0, index - 1)]
    const next = points[Math.min(points.length - 1, index + 1)]
    const dx = next.x - previous.x
    const dy = next.y - previous.y
    const length = Math.hypot(dx, dy) || 1
    return { x: -dy / length, y: dx / length }
  })
}

function appendSmoothSide(
  path: Path2D,
  points: readonly PixelPoint[],
  move: boolean,
): void {
  if (!points.length) return
  if (move) path.moveTo(points[0].x, points[0].y)
  else path.lineTo(points[0].x, points[0].y)
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]
    const next = points[index + 1]
    path.quadraticCurveTo(
      point.x,
      point.y,
      (point.x + next.x) / 2,
      (point.y + next.y) / 2,
    )
  }
  const last = points.at(-1)
  if (last) path.lineTo(last.x, last.y)
}

function buildRibbon(
  stroke: BrushworkStroke,
  points: readonly BrushworkPoint[],
  width: number,
  height: number,
  widthScale = 1,
): StrokeGeometry {
  const centers = pixelPoints(points, width, height)
  const normals = normalsFor(centers)
  const minDimension = Math.min(width, height)
  const halfWidths = centers.map((_, index) => {
    const progress = index / Math.max(1, centers.length - 1)
    return stroke.baseWidth
      * minDimension
      * 0.5
      * brushworkPressureAt(stroke.pressure, progress)
      * quietWidth(stroke.role, points[index].quiet)
      * widthScale
  })
  const left = centers.map((point, index) => ({
    x: point.x + normals[index].x * halfWidths[index] * points[index].edgeLeft,
    y: point.y + normals[index].y * halfWidths[index] * points[index].edgeLeft,
  }))
  const right = centers.map((point, index) => ({
    x: point.x - normals[index].x * halfWidths[index] * points[index].edgeRight,
    y: point.y - normals[index].y * halfWidths[index] * points[index].edgeRight,
  })).reverse()
  const ribbon = new Path2D()
  appendSmoothSide(ribbon, left, true)
  appendSmoothSide(ribbon, right, false)
  ribbon.closePath()
  return { centers, normals, halfWidths, ribbon }
}

function renderBristles(
  ctx: CanvasRenderingContext2D,
  stroke: BrushworkStroke,
  geometry: StrokeGeometry,
  strokeColor: string,
  inkColor: string,
  coverage: number,
): void {
  const baseWidth = stroke.baseWidth * Math.min(ctx.canvas.width, ctx.canvas.height)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const bristle of stroke.bristles) {
    const points = geometry.centers.map((center, index) => {
      const normal = geometry.normals[index]
      const jitter = bristle.jitter[index] * baseWidth * 0.035
      const offset = geometry.halfWidths[index] * bristle.offset + jitter
      return {
        x: center.x + normal.x * offset,
        y: center.y + normal.y * offset,
      }
    })
    let segment = 0
    while (segment < bristle.active.length) {
      while (segment < bristle.active.length && !bristle.active[segment]) segment += 1
      if (segment >= bristle.active.length) break
      const start = segment
      while (segment < bristle.active.length && bristle.active[segment]) segment += 1
      const end = segment
      const path = new Path2D()
      path.moveTo(points[start].x, points[start].y)
      for (let pointIndex = start + 1; pointIndex <= end; pointIndex += 1) {
        path.lineTo(points[pointIndex].x, points[pointIndex].y)
      }
      const progress = (start + end) / (2 * Math.max(1, bristle.active.length))
      const pressure = brushworkPressureAt(stroke.pressure, progress)
      ctx.lineWidth = Math.max(0.35, baseWidth * bristle.widthScale * pressure)
      ctx.strokeStyle = bristle.pigment === 'ink' ? inkColor : strokeColor
      ctx.globalAlpha = stroke.opacity
        * coverage
        * bristle.alpha
        * (bristle.pigment === 'ink' ? 0.34 : 0.74)
      ctx.stroke(path)
    }
  }
}

export function renderBrushwork(
  ctx: CanvasRenderingContext2D,
  options: BrushworkRenderOptions,
): void {
  const {
    width,
    height,
    seed,
    complexity,
    palette,
    colorPlan,
    territory,
    motionPhase = 0,
    motionAmount,
  } = options
  if (width <= 0 || height <= 0 || !palette.length) return
  const composition = options.composition ?? resolveCompositionPlan({
    seed,
    lookId: 'brushwork',
    complexity,
    aspect: width / Math.max(1, height),
  })
  const scene = buildBrushworkScene({
    seed,
    complexity,
    aspect: width / Math.max(1, height),
    composition,
  })
  const inkColor = palette[inkIndexFor(palette, colorPlan)] ?? palette[0]

  ctx.save()
  for (const stroke of scene.strokes) {
    const color = palette[resolveBrushworkColorIndex(stroke, palette, colorPlan)] ?? palette[0]
    const points = deformBrushworkStroke(
      stroke,
      motionPhase,
      motionAmount,
      width / Math.max(1, height),
    )
    const coverage = strokeCoverage(stroke, territory, width, height)
    const geometry = buildRibbon(stroke, points, width, height)
    ctx.fillStyle = color
    ctx.globalAlpha = stroke.opacity * coverage * 0.68
    ctx.fill(geometry.ribbon)

    const loadedCenter = buildRibbon(stroke, points, width, height, 0.5)
    ctx.globalAlpha = stroke.opacity * coverage * 0.24
    ctx.fill(loadedCenter.ribbon)

    renderBristles(ctx, stroke, geometry, color, inkColor, coverage)
  }
  ctx.restore()
}
