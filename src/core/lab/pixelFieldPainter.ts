import type { LookColorPlan } from './colorDirection'
import type { CompositionPlan } from './compositionPlan'
import {
  planPixelField,
  resolvePixelGlitchFrame,
  type PixelFieldPlan,
  type PixelFieldTile,
} from './pixelField'

const planCache = new Map<string, PixelFieldPlan>()

export type PixelSourceSample = (u: number, v: number) =>
  readonly [number, number, number] | null

export type PaintPixelFieldOptions = {
  width: number
  height: number
  seed: number
  complexity: number
  palette: readonly string[]
  colorPlan?: LookColorPlan
  composition?: CompositionPlan
  motionPhase: number
  motionAmount: number
  motionSpeed: number
  sourceSample?: PixelSourceSample
}

type PixelRect = {
  left: number
  top: number
  right: number
  bottom: number
}

function planKey(options: PaintPixelFieldOptions): string {
  return JSON.stringify({
    revision: 1,
    seed: options.seed,
    complexity: Math.round(options.complexity * 10000) / 10000,
    aspect: Math.round((options.width / Math.max(1, options.height)) * 100000) / 100000,
    paletteSize: options.palette.length,
    colorPlan: options.colorPlan
      ? {
          roles: options.colorPlan.roles,
          depthOrder: options.colorPlan.depthOrder,
          localColorLimit: options.colorPlan.localColorLimit,
          accentAreaLimit: options.colorPlan.accentAreaLimit,
        }
      : null,
    composition: options.composition ?? null,
  })
}

function cachedPlan(options: PaintPixelFieldOptions): PixelFieldPlan {
  const key = planKey(options)
  const hit = planCache.get(key)
  if (hit) return hit
  const plan = planPixelField({
    seed: options.seed,
    complexity: options.complexity,
    aspect: options.width / Math.max(1, options.height),
    paletteSize: options.palette.length,
    colorPlan: options.colorPlan,
    composition: options.composition,
  })
  if (planCache.size >= 12) planCache.delete(planCache.keys().next().value!)
  planCache.set(key, plan)
  return plan
}

function pixelRect(
  tile: PixelFieldTile,
  width: number,
  height: number,
): PixelRect {
  return {
    left: Math.round(tile.x * width),
    top: Math.round(tile.y * height),
    right: Math.round((tile.x + tile.width) * width),
    bottom: Math.round((tile.y + tile.height) * height),
  }
}

function sourceColorIndex(
  plan: PixelFieldPlan,
  tile: PixelFieldTile,
  sourceSample?: PixelSourceSample,
): number {
  if (!sourceSample || tile.role === 'accent') return tile.colorIndex
  const sample = sourceSample(
    tile.x + tile.width / 2,
    tile.y + tile.height / 2,
  )
  if (!sample) return tile.colorIndex
  const luminance = (
    sample[0] * 0.2126
    + sample[1] * 0.7152
    + sample[2] * 0.0722
  ) / 255
  const visible = plan.colorHierarchy.visible
  const index = Math.min(
    visible.length - 1,
    Math.floor((1 - luminance) * visible.length),
  )
  const sourceIndex = visible[Math.max(0, index)]
  return tile.protected && tile.colorIndex !== plan.colorHierarchy.dominant
    ? tile.colorIndex
    : sourceIndex
}

function fillTile(
  context: CanvasRenderingContext2D,
  rect: PixelRect,
  color: string,
): void {
  const width = Math.max(1, rect.right - rect.left)
  const height = Math.max(1, rect.bottom - rect.top)
  context.fillStyle = color
  context.fillRect(rect.left, rect.top, width, height)
}

function paintGlitch(
  context: CanvasRenderingContext2D,
  tile: PixelFieldTile,
  rect: PixelRect,
  palette: readonly string[],
  options: PaintPixelFieldOptions,
): void {
  const glitch = tile.glitch
  if (!glitch) return
  const frame = resolvePixelGlitchFrame(
    glitch,
    options.motionPhase,
    options.motionAmount,
    options.motionSpeed,
  )
  const width = Math.max(1, rect.right - rect.left)
  const height = Math.max(1, rect.bottom - rect.top)
  const bandStart = Math.max(0, Math.min(
    1 - glitch.bandSize,
    glitch.bandStart + frame.bandShift,
  ))
  context.fillStyle = palette[glitch.colorIndex] ?? palette[tile.colorIndex] ?? '#000000'

  if (glitch.axis === 'x') {
    const top = Math.round(rect.top + height * bandStart)
    const bottom = Math.round(rect.top + height * (bandStart + glitch.bandSize))
    context.fillRect(
      rect.left + Math.round(frame.offset * options.width),
      top,
      width,
      Math.max(1, bottom - top),
    )
    return
  }
  const left = Math.round(rect.left + width * bandStart)
  const right = Math.round(rect.left + width * (bandStart + glitch.bandSize))
  context.fillRect(
    left,
    rect.top + Math.round(frame.offset * options.height),
    Math.max(1, right - left),
    height,
  )
}

export function paintPixelField(
  context: CanvasRenderingContext2D,
  options: PaintPixelFieldOptions,
): PixelFieldPlan {
  const plan = cachedPlan(options)
  context.save()
  context.imageSmoothingEnabled = false
  for (const tile of plan.tiles) {
    const rect = pixelRect(tile, options.width, options.height)
    const colorIndex = sourceColorIndex(plan, tile, options.sourceSample)
    fillTile(
      context,
      rect,
      options.palette[colorIndex] ?? options.palette[0] ?? '#000000',
    )
  }
  for (const tile of plan.tiles) {
    if (!tile.glitch) continue
    paintGlitch(
      context,
      tile,
      pixelRect(tile, options.width, options.height),
      options.palette,
      options,
    )
  }
  context.restore()
  return plan
}
