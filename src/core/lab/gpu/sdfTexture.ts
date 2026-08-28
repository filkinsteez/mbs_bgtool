import {
  META_SYMBOL_HEIGHT,
  META_SYMBOL_WIDTH,
  sampleMetaSymbol,
} from '@/core/metaSymbol'

const cache = new Map<string, Uint8Array>()

export type BakedMetaSdf = {
  width: number
  height: number
  data: Uint8Array
}

export function bakeMetaSdf(width: number, height: number): BakedMetaSdf {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const key = `${w}x${h}`
  const existing = cache.get(key)
  if (existing) return { width: w, height: h, data: existing }

  const data = new Uint8Array(w * h * 4)
  const symbolAspect = META_SYMBOL_WIDTH / META_SYMBOL_HEIGHT
  const safeWidth = w * 0.86
  const safeHeight = h * 0.74
  const metaWidth = Math.min(safeWidth, safeHeight * symbolAspect)
  const metaHeight = metaWidth / symbolAspect
  const offsetX = (w - metaWidth) / 2
  const offsetY = (h - metaHeight) / 2
  const span = Math.max(w, h)

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const index = (y * w + x) * 4
      const mx = ((x + 0.5 - offsetX) / metaWidth) * META_SYMBOL_WIDTH
      const my = ((y + 0.5 - offsetY) / metaHeight) * META_SYMBOL_HEIGHT
      const sample = sampleMetaSymbol(mx, my)
      const signed = sample.inside ? 1 : 0
      const distance = Math.min(1, sample.distance / span * 18)
      data[index] = Math.round(signed * 255)
      data[index + 1] = Math.round(distance * 255)
      data[index + 2] = 0
      data[index + 3] = 255
    }
  }

  if (cache.size > 8) cache.clear()
  cache.set(key, data)
  return { width: w, height: h, data }
}
