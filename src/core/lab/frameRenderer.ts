import type { LookColorPlan } from './colorDirection'
import type { Field } from './field'
import {
  buildFrameTopology,
  frameCompositionAt,
  type FrameBlock,
  type FrameComposition,
  type FrameTopology,
} from './frameComposition'

export type RenderFrameLookOptions = {
  field: Field
  width: number
  height: number
  seed: number
  complexity: number
  palette: readonly string[]
  colorPlan?: LookColorPlan
  motion: {
    phase?: number
    amount: number
    speed: number
  }
  topologyKey?: string
}

const topologyCache = new Map<string, FrameTopology>()

function topologyFor(options: RenderFrameLookOptions): FrameTopology {
  if (options.topologyKey) {
    const hit = topologyCache.get(options.topologyKey)
    if (hit) return hit
  }
  const topology = buildFrameTopology({
    field: options.field,
    width: options.width,
    height: options.height,
    seed: options.seed,
    complexity: options.complexity,
    paletteSize: options.palette.length,
    colorPlan: options.colorPlan,
  })
  if (options.topologyKey) {
    if (topologyCache.size >= 8) {
      const oldest = topologyCache.keys().next().value
      if (oldest !== undefined) topologyCache.delete(oldest)
    }
    topologyCache.set(options.topologyKey, topology)
  }
  return topology
}

function paintBlock(
  context: CanvasRenderingContext2D,
  block: FrameBlock,
  palette: readonly string[],
): void {
  context.save()
  context.translate(block.x, block.y)
  context.rotate(block.rotation)
  context.globalAlpha = block.alpha
  context.fillStyle = palette[block.color] ?? palette[0] ?? '#000000'
  context.fillRect(-block.width / 2, -block.height / 2, block.width, block.height)
  context.restore()
}

export function renderFrameLook(
  context: CanvasRenderingContext2D,
  options: RenderFrameLookOptions,
): FrameComposition {
  const topology = topologyFor(options)
  const composition = frameCompositionAt(topology, options.motion)
  const blocks = composition.blocks.filter((block) => block.kind !== 'tab')
  const tabs = composition.blocks.filter((block) => block.kind === 'tab')

  context.save()
  for (const block of blocks) paintBlock(context, block, options.palette)

  context.lineJoin = 'round'
  context.lineCap = 'butt'
  const roleOrder = { fine: 0, support: 1, hero: 2 } as const
  const rails = [...composition.rails].sort(
    (a, b) => roleOrder[a.role] - roleOrder[b.role] || a.level - b.level,
  )
  for (const rail of rails) {
    if (rail.points.length < 2) continue
    context.beginPath()
    context.moveTo(rail.points[0].x, rail.points[0].y)
    for (let index = 1; index < rail.points.length; index += 1) {
      context.lineTo(rail.points[index].x, rail.points[index].y)
    }
    context.globalAlpha = rail.alpha
    context.lineWidth = rail.width
    context.strokeStyle = options.palette[rail.color] ?? options.palette[0] ?? '#000000'
    context.stroke()
  }

  for (const tab of tabs) paintBlock(context, tab, options.palette)
  context.restore()
  return composition
}
