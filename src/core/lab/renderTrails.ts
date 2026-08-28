import type { LabState } from './types'
import type { LabSource } from './sourceCache'

export function renderTrails(
  context: CanvasRenderingContext2D,
  lab: LabState,
  sourceAware: { source: LabSource; rect?: unknown; territory?: unknown } | null,
): void {
  const width = lab.output.width
  const height = lab.output.height
  context.clearRect(0, 0, width, height)
  context.globalAlpha = 1
  context.strokeStyle = '#ffffff'
  context.lineWidth = Math.max(2, Math.min(width, height) * 0.022)
  context.lineCap = 'round'
  context.beginPath()
  const anchorX = sourceAware ? width * 0.76 : width * 0.42
  context.moveTo(anchorX - width * 0.2, height * 0.2)
  context.bezierCurveTo(
    anchorX - width * 0.08,
    height * 0.34,
    anchorX + width * 0.04,
    height * 0.62,
    anchorX + width * 0.18,
    height * 0.78,
  )
  context.stroke()
}
