import {
  META_SYMBOL_HEIGHT,
  META_SYMBOL_MIN_X,
  META_SYMBOL_MIN_Y,
  META_SYMBOL_PATH,
  META_SYMBOL_WIDTH,
} from '@/core/metaSymbol'
import {
  createLabSourceFromCanvas,
  type LabSource,
} from '@/core/lab/sourceCache'

const SOURCE_LONG_EDGE = 1024
const SYMBOL_FIT = 0.72
const sourceCache = new Map<string, LabSource>()

function symbolPlacement(width: number, height: number) {
  const scale = Math.min(
    (width * SYMBOL_FIT) / META_SYMBOL_WIDTH,
    (height * SYMBOL_FIT) / META_SYMBOL_HEIGHT,
  )
  return {
    scale,
    left: (width - META_SYMBOL_WIDTH * scale) / 2,
    top: (height - META_SYMBOL_HEIGHT * scale) / 2,
    width: META_SYMBOL_WIDTH * scale,
    height: META_SYMBOL_HEIGHT * scale,
  }
}

function fillMetaSymbol(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const { scale, left, top } = symbolPlacement(width, height)
  context.save()
  context.translate(
    left - META_SYMBOL_MIN_X * scale,
    top - META_SYMBOL_MIN_Y * scale,
  )
  context.scale(scale, scale)
  context.fill(new Path2D(META_SYMBOL_PATH))
  context.restore()
}

export function createMetaSymbolSource(
  outputWidth: number,
  outputHeight: number,
): LabSource {
  const ratio = Math.max(0.01, outputWidth / Math.max(1, outputHeight))
  const width = ratio >= 1
    ? SOURCE_LONG_EDGE
    : Math.max(8, Math.round(SOURCE_LONG_EDGE * ratio))
  const height = ratio >= 1
    ? Math.max(8, Math.round(SOURCE_LONG_EDGE / ratio))
    : SOURCE_LONG_EDGE
  const key = `${width}x${height}`
  const cached = sourceCache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D Meta symbol source unavailable')

  context.fillStyle = '#303030'
  context.fillRect(0, 0, width, height)

  const placement = symbolPlacement(width, height)
  context.save()
  context.translate(width * 0.018, height * 0.025)
  context.filter = `blur(${Math.max(4, Math.min(width, height) * 0.028)}px)`
  context.fillStyle = '#080808'
  context.globalAlpha = 0.78
  fillMetaSymbol(context, width, height)
  context.restore()

  context.save()
  context.filter = `blur(${Math.max(2, Math.min(width, height) * 0.014)}px)`
  context.fillStyle = '#B8B8B8'
  context.globalAlpha = 0.52
  fillMetaSymbol(context, width, height)
  context.restore()

  const light = context.createLinearGradient(
    placement.left,
    placement.top,
    placement.left + placement.width,
    placement.top + placement.height,
  )
  light.addColorStop(0, '#F2F2F2')
  light.addColorStop(0.38, '#8A8A8A')
  light.addColorStop(0.68, '#DADADA')
  light.addColorStop(1, '#454545')
  context.fillStyle = light
  fillMetaSymbol(context, width, height)

  const source = createLabSourceFromCanvas(canvas, {
    filename: `canonical-meta-symbol-${key}.rgba`,
  })
  sourceCache.set(key, source)
  return source
}
