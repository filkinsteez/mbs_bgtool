import { chan } from '@/core/organic/random'
import type { LookColorPlan } from './colorDirection'
import type { Field } from './field'

type WeaveRenderOptions = {
  width: number
  height: number
  seed: number
  complexity: number
  palette: readonly string[]
  colorPlan?: LookColorPlan
  influence: Field
  motionPhase: number
  motionAmount: number
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function colorAt(
  palette: readonly string[],
  index: number | null | undefined,
  fallback: string,
): string {
  return index != null && palette[index] ? palette[index] : fallback
}

function rgba(color: string, alpha: number): string {
  const value = color.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(value)) return color
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgb(${red} ${green} ${blue} / ${clamp01(alpha)})`
}

function softInfluence(
  influence: Field,
  x: number,
  y: number,
  radius: number,
): number {
  const diagonal = radius * 0.7
  return clamp01((
    influence(x, y) * 4
    + influence(x - radius, y) * 2
    + influence(x + radius, y) * 2
    + influence(x, y - radius) * 2
    + influence(x, y + radius) * 2
    + influence(x - diagonal, y - diagonal)
    + influence(x + diagonal, y - diagonal)
    + influence(x - diagonal, y + diagonal)
    + influence(x + diagonal, y + diagonal)
  ) / 16)
}

function progressiveLaneIds(maximum: number, count: number): number[] {
  const bits = Math.ceil(Math.log2(maximum))
  const size = 2 ** bits
  const ids: number[] = []
  for (let value = 0; value < size && ids.length < count; value += 1) {
    let source = value
    let reversed = 0
    for (let bit = 0; bit < bits; bit += 1) {
      reversed = (reversed << 1) | (source & 1)
      source >>= 1
    }
    if (reversed < maximum) ids.push(reversed)
  }
  return ids
}

export function renderWeaveField(
  context: CanvasRenderingContext2D,
  options: WeaveRenderOptions,
): void {
  const {
    width,
    height,
    seed,
    palette,
    colorPlan,
    influence,
  } = options
  const size = Math.min(width, height)
  const complexity = clamp01(options.complexity)
  const q = complexity * complexity * (3 - 2 * complexity)
  const phase = (((options.motionPhase % 1) + 1) % 1) * Math.PI * 2
  const motion = clamp01(options.motionAmount)
  const groundIndex = colorPlan?.roles.ground ?? palette.length - 1
  const ground = colorAt(palette, groundIndex, palette.at(-1) ?? '#FFFFFF')
  const visible = colorPlan?.depthOrder.filter((index) => index !== groundIndex) ?? []
  const warp = colorAt(
    palette,
    visible.at(-1) ?? colorPlan?.roles.dominant,
    palette[0] ?? '#0064E0',
  )
  const weft = colorAt(
    palette,
    visible[Math.max(0, visible.length - 2)] ?? colorPlan?.roles.support[0],
    palette[1] ?? warp,
  )
  const accent = colorAt(
    palette,
    colorPlan?.roles.accent ?? visible.at(-1),
    palette[2] ?? weft,
  )

  context.save()
  context.fillStyle = ground
  context.fillRect(0, 0, width, height)
  const wash = context.createLinearGradient(0, height, width, 0)
  wash.addColorStop(0, rgba(warp, 0.34))
  wash.addColorStop(0.46, rgba(ground, 0.06))
  wash.addColorStop(1, rgba(weft, 0.3))
  context.fillStyle = wash
  context.fillRect(0, 0, width, height)

  const spacing = Math.max(12, size * 0.052)
  const detailMaximum = 28
  const detailIds = progressiveLaneIds(detailMaximum, Math.round(q * detailMaximum))
  const direction = chan(seed, 0, 'lab.weave.direction') < 0.5 ? -1 : 1
  const baseAngle = direction * (0.13 + chan(seed, 0, 'lab.weave.angle') * 0.12)

  for (let family = 0; family < 2; family += 1) {
    const angle = baseAngle + (family === 0 ? 0 : Math.PI / 2)
    const alongX = Math.cos(angle)
    const alongY = Math.sin(angle)
    const normalX = -alongY
    const normalY = alongX
    const alongExtent = Math.abs(width * alongX) / 2
      + Math.abs(height * alongY) / 2
      + size * 0.12
    const normalExtent = Math.abs(width * normalX) / 2
      + Math.abs(height * normalY) / 2
      + size * 0.08
    const laneCount = Math.ceil(normalExtent * 2 / spacing) + 1
    const pointCount = Math.max(48, Math.ceil(alongExtent * 2 / Math.max(7, size / 96)))
    const renderLane = (lane: number, laneTotal: number, detail: boolean) => {
      const offset = -normalExtent + (lane + 0.5) / laneTotal * normalExtent * 2
      const lanePhase = chan(seed, lane + family * 4099, 'lab.weave.lane') * Math.PI * 2
      const points: { x: number; y: number; influence: number }[] = []
      const path = new Path2D()
      const sourcePath = new Path2D()
      let sourceOpen = false
      for (let point = 0; point < pointCount; point += 1) {
        const progress = point / (pointCount - 1)
        const along = -alongExtent + progress * alongExtent * 2
        const wave = Math.sin(progress * Math.PI * (3.2 + family) + lanePhase + phase * motion)
          * spacing
          * (detail ? 0.08 : 0.13)
        const baseX = width / 2 + alongX * along + normalX * (offset + wave)
        const baseY = height / 2 + alongY * along + normalY * (offset + wave)
        const amount = softInfluence(influence, baseX, baseY, spacing * 0.52)
        const phaseSlip = amount
          * spacing
          * (family === 0 ? 1.36 : -1.08)
        const x = baseX + normalX * phaseSlip
        const y = baseY + normalY * phaseSlip
        points.push({ x, y, influence: amount })
        if (point === 0) path.moveTo(x, y)
        else path.lineTo(x, y)
        if (point > 0 && (points[point - 1].influence + amount) / 2 > 0.34) {
          if (!sourceOpen) sourcePath.moveTo(points[point - 1].x, points[point - 1].y)
          sourcePath.lineTo(x, y)
          sourceOpen = true
        } else {
          sourceOpen = false
        }
      }

      const familyColor = family === 0 ? warp : weft
      const twill = lane % 4 === (family === 0 ? 0 : 2)
      context.strokeStyle = rgba(ground, detail ? 0.24 : 0.46)
      context.globalAlpha = 1
      context.lineWidth = Math.max(1, spacing * (detail ? 0.12 : twill ? 0.58 : 0.38))
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.setLineDash([])
      context.stroke(path)

      context.strokeStyle = familyColor
      context.globalAlpha = detail ? 0.3 + q * 0.22 : twill ? 0.86 : 0.62
      context.lineWidth = Math.max(0.75, spacing * (detail ? 0.055 : twill ? 0.31 : 0.18))
      context.setLineDash(twill
        ? [spacing * 1.35, spacing * 0.42]
        : [spacing * 0.72, spacing * 0.28])
      context.lineDashOffset = (
        lane * spacing * 0.47
        + family * spacing * 0.73
        + phase * motion * spacing
      )
      context.stroke(path)

      context.setLineDash([])
      context.strokeStyle = accent
      context.globalAlpha = detail ? 0.42 : 0.9
      context.lineWidth = Math.max(0.7, spacing * (detail ? 0.045 : twill ? 0.17 : 0.11))
      context.stroke(sourcePath)

      if (!detail && q > 0.36) {
        const knotStep = Math.max(5, Math.round(13 - q * 5))
        for (let point = lane % knotStep; point < points.length; point += knotStep) {
          const knot = points[point]
          if (knot.influence < 0.16 && chan(seed, lane * 1000 + point, 'lab.weave.knot') > q) {
            continue
          }
          const radius = Math.max(0.7, spacing * (twill ? 0.075 : 0.052))
          context.fillStyle = knot.influence > 0.28 ? accent : familyColor
          context.globalAlpha = 0.44 + q * 0.32
          context.beginPath()
          context.arc(knot.x, knot.y, radius, 0, Math.PI * 2)
          context.fill()
        }
      }
    }

    for (let lane = 0; lane < laneCount; lane += 1) {
      renderLane(lane, laneCount, false)
    }
    for (const lane of detailIds) {
      renderLane(lane, detailMaximum, true)
    }
  }
  context.globalAlpha = 1
  context.setLineDash([])
  context.restore()
}
