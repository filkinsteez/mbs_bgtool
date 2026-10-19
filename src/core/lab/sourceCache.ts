import type { AnalysisMaps } from './analysis'
import { analyzeRGBA } from './analysis'

const ANALYSIS_MAX = 1024

export type LabSource = {
  image: CanvasImageSource
  fullW: number
  fullH: number
  maps: AnalysisMaps
  hash: string
  filename: string
}

export type LabSourceOptions = {
  filename?: string
}

function contentHash(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): string {
  let hash = 0x811c9dc5
  const stride = Math.max(4, (Math.floor((width * height) / 4096) >> 2) << 2)
  for (let index = 0; index < rgba.length; index += stride * 4) {
    hash ^= rgba[index]
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  for (const value of [width, height]) {
    hash ^= value & 0xff
    hash = Math.imul(hash, 0x01000193) >>> 0
    hash ^= (value >> 8) & 0xff
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function createLabSourceFromImage(
  image: CanvasImageSource,
  fullW: number,
  fullH: number,
  options: LabSourceOptions = {},
): LabSource {
  if (!fullW || !fullH) throw new Error('Source decoded to zero size.')
  const scale = Math.min(1, ANALYSIS_MAX / Math.max(fullW, fullH))
  const width = Math.max(8, Math.round(fullW * scale))
  const height = Math.max(8, Math.round(fullH * scale))
  const scratch = document.createElement('canvas')
  scratch.width = width
  scratch.height = height
  const context = scratch.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('2D analysis context unavailable.')
  context.drawImage(image, 0, 0, width, height)
  const data = context.getImageData(0, 0, width, height)
  return {
    image,
    fullW,
    fullH,
    maps: analyzeRGBA(data.data, width, height),
    hash: contentHash(data.data, width, height),
    filename: options.filename ?? 'rgba-source',
  }
}

// Freeze the WebGL frame so preview and export analyze immutable pixels.
export function createLabSourceFromCanvas(
  canvas: HTMLCanvasElement,
  options: LabSourceOptions = {},
): LabSource {
  const snapshot = document.createElement('canvas')
  snapshot.width = canvas.width
  snapshot.height = canvas.height
  const context = snapshot.getContext('2d')
  if (!context) throw new Error('2D snapshot context unavailable.')
  context.drawImage(canvas, 0, 0)
  return createLabSourceFromImage(
    snapshot,
    snapshot.width,
    snapshot.height,
    { filename: options.filename ?? 'canvas-frame.rgba' },
  )
}
