import {
  META_SYMBOL_HEIGHT,
  META_SYMBOL_MIN_X,
  META_SYMBOL_MIN_Y,
  META_SYMBOL_PATH,
  META_SYMBOL_WIDTH,
} from '@/core/metaSymbol'
import { boxBlur } from '@/core/math/blur'
import type { Field } from './field'

type CachedMetaInfluence = {
  width: number
  height: number
  gridWidth: number
  gridHeight: number
  values: Float32Array
  field: Field
}

const cache = new Map<string, CachedMetaInfluence>()

export const CANONICAL_META_SAFE_AREA = {
  width: 0.86,
  height: 0.74,
} as const

export type CanonicalMetaPlacement = {
  x: number
  y: number
  width: number
  height: number
  scale: number
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function canonicalMetaPlacement(
  width: number,
  height: number,
): CanonicalMetaPlacement {
  const canvasWidth = Math.max(1, width)
  const canvasHeight = Math.max(1, height)
  const scale = Math.min(
    canvasWidth * CANONICAL_META_SAFE_AREA.width / META_SYMBOL_WIDTH,
    canvasHeight * CANONICAL_META_SAFE_AREA.height / META_SYMBOL_HEIGHT,
  )
  const symbolWidth = META_SYMBOL_WIDTH * scale
  const symbolHeight = META_SYMBOL_HEIGHT * scale
  return {
    x: (canvasWidth - symbolWidth) / 2,
    y: (canvasHeight - symbolHeight) / 2,
    width: symbolWidth,
    height: symbolHeight,
    scale,
  }
}

export function canonicalMetaInfluence(width: number, height: number): Field {
  const key = `${width}x${height}`
  const cached = cache.get(key)
  if (cached) return cached.field

  const gridScale = Math.min(1, 1024 / Math.max(width, height))
  const gridWidth = Math.max(2, Math.round(width * gridScale))
  const gridHeight = Math.max(2, Math.round(height * gridScale))
  const canvas = document.createElement('canvas')
  canvas.width = gridWidth
  canvas.height = gridHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canonical Meta influence context unavailable')

  const placement = canonicalMetaPlacement(width, height)
  context.setTransform(gridWidth / width, 0, 0, gridHeight / height, 0, 0)
  context.translate(placement.x, placement.y)
  context.scale(placement.scale, placement.scale)
  context.translate(-META_SYMBOL_MIN_X, -META_SYMBOL_MIN_Y)
  context.fillStyle = '#FFFFFF'
  context.fill(new Path2D(META_SYMBOL_PATH))

  const rgba = context.getImageData(0, 0, gridWidth, gridHeight).data
  const raw = new Float32Array(gridWidth * gridHeight)
  for (let index = 0; index < raw.length; index += 1) {
    raw[index] = rgba[index * 4 + 3] / 255
  }
  const values = boxBlur(
    raw,
    gridWidth,
    gridHeight,
    Math.max(1, Math.min(gridWidth, gridHeight) * 0.006),
  )
  const field: Field = (sampleX, sampleY) => {
    const gx = clamp01(sampleX / Math.max(1, width)) * (gridWidth - 1)
    const gy = clamp01(sampleY / Math.max(1, height)) * (gridHeight - 1)
    const left = Math.floor(gx)
    const top = Math.floor(gy)
    const right = Math.min(gridWidth - 1, left + 1)
    const bottom = Math.min(gridHeight - 1, top + 1)
    const tx = gx - left
    const ty = gy - top
    const upper = values[top * gridWidth + left] * (1 - tx)
      + values[top * gridWidth + right] * tx
    const lower = values[bottom * gridWidth + left] * (1 - tx)
      + values[bottom * gridWidth + right] * tx
    return upper * (1 - ty) + lower * ty
  }

  const entry = { width, height, gridWidth, gridHeight, values, field }
  if (cache.size >= 8) cache.delete(cache.keys().next().value!)
  cache.set(key, entry)
  return field
}
