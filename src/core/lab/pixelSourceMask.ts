import type { AnalysisMaps } from './analysis'
import { sampleMap } from './analysis'
import type { FitRect } from './field'

const SOURCE_MASK_LONG_EDGE = 128

export type PixelProtectedSample = (u: number, v: number) => number

export type PixelSourceMask = {
  key: string
  columns: number
  rows: number
  values: Uint8Array
  coverage: number
  sample: PixelProtectedSample
}

export type PixelSourceMaskInput = {
  maps: AnalysisMaps
  sourceHash: string
  rect: FitRect
  outputWidth: number
  outputHeight: number
}

type RGB = readonly [number, number, number]

const cache = new Map<string, PixelSourceMask>()

function rgbAt(maps: AnalysisMaps, x: number, y: number): RGB {
  const column = Math.max(0, Math.min(maps.w - 1, Math.round(x)))
  const row = Math.max(0, Math.min(maps.h - 1, Math.round(y)))
  const offset = (row * maps.w + column) * 4
  return [
    maps.rgba[offset],
    maps.rgba[offset + 1],
    maps.rgba[offset + 2],
  ]
}

function patchMean(
  maps: AnalysisMaps,
  startX: number,
  startY: number,
  size: number,
): RGB {
  let red = 0
  let green = 0
  let blue = 0
  let count = 0
  for (let y = startY; y < Math.min(maps.h, startY + size); y += 1) {
    for (let x = startX; x < Math.min(maps.w, startX + size); x += 1) {
      const color = rgbAt(maps, x, y)
      red += color[0]
      green += color[1]
      blue += color[2]
      count += 1
    }
  }
  return count
    ? [red / count, green / count, blue / count]
    : [255, 255, 255]
}

function channelMedian(colors: readonly RGB[], channel: 0 | 1 | 2): number {
  const values = colors.map((color) => color[channel]).sort((a, b) => a - b)
  return (values[1] + values[2]) / 2
}

function colorDistance(a: RGB, b: RGB): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 441.67295593
}

function backgroundEstimate(maps: AnalysisMaps): { color: RGB; spread: number } {
  const size = Math.max(2, Math.round(Math.min(maps.w, maps.h) * 0.045))
  const corners = [
    patchMean(maps, 0, 0, size),
    patchMean(maps, maps.w - size, 0, size),
    patchMean(maps, 0, maps.h - size, size),
    patchMean(maps, maps.w - size, maps.h - size, size),
  ]
  const color: RGB = [
    channelMedian(corners, 0),
    channelMedian(corners, 1),
    channelMedian(corners, 2),
  ]
  return {
    color,
    spread: Math.max(...corners.map((corner) => colorDistance(corner, color))),
  }
}

function alphaCarriesShape(maps: AnalysisMaps): boolean {
  let transparent = 0
  let opaque = 0
  const stride = Math.max(1, Math.floor(maps.alpha.length / 4096))
  for (let index = 0; index < maps.alpha.length; index += stride) {
    if (maps.alpha[index] < 0.92) transparent += 1
    if (maps.alpha[index] > 0.12) opaque += 1
  }
  return transparent > 2 && opaque > 2
}

function sourceGrid(maps: AnalysisMaps): { columns: number; rows: number } {
  if (maps.w >= maps.h) {
    return {
      columns: SOURCE_MASK_LONG_EDGE,
      rows: Math.max(16, Math.round(SOURCE_MASK_LONG_EDGE * maps.h / maps.w)),
    }
  }
  return {
    columns: Math.max(16, Math.round(SOURCE_MASK_LONG_EDGE * maps.w / maps.h)),
    rows: SOURCE_MASK_LONG_EDGE,
  }
}

function largestComponent(mask: Uint8Array, columns: number, rows: number): Uint8Array {
  const visited = new Uint8Array(mask.length)
  let largest: number[] = []
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue
    const component = [start]
    visited[start] = 1
    for (let read = 0; read < component.length; read += 1) {
      const index = component[read]
      const column = index % columns
      const row = Math.floor(index / columns)
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue
          const x = column + offsetX
          const y = row + offsetY
          if (x < 0 || x >= columns || y < 0 || y >= rows) continue
          const neighbor = y * columns + x
          if (!mask[neighbor] || visited[neighbor]) continue
          visited[neighbor] = 1
          component.push(neighbor)
        }
      }
    }
    if (component.length > largest.length) largest = component
  }
  const result = new Uint8Array(mask.length)
  for (const index of largest) result[index] = 1
  return result
}

function closeMask(mask: Uint8Array, columns: number, rows: number): Uint8Array {
  const dilated = new Uint8Array(mask.length)
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let active = false
      for (let offsetY = -1; offsetY <= 1 && !active; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const x = column + offsetX
          const y = row + offsetY
          if (
            x >= 0
            && x < columns
            && y >= 0
            && y < rows
            && mask[y * columns + x]
          ) {
            active = true
            break
          }
        }
      }
      if (active) dilated[row * columns + column] = 1
    }
  }
  const closed = new Uint8Array(mask.length)
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let active = true
      for (let offsetY = -1; offsetY <= 1 && active; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const x = column + offsetX
          const y = row + offsetY
          if (
            x < 0
            || x >= columns
            || y < 0
            || y >= rows
            || !dilated[y * columns + x]
          ) {
            active = false
            break
          }
        }
      }
      if (active) closed[row * columns + column] = 1
    }
  }
  return closed
}

function buildSourceValues(
  maps: AnalysisMaps,
  columns: number,
  rows: number,
): Uint8Array {
  const alphaShape = alphaCarriesShape(maps)
  const background = backgroundEstimate(maps)
  const threshold = Math.max(0.055, Math.min(0.2, 0.045 + background.spread * 1.8))
  const values = new Uint8Array(columns * rows)
  for (let row = 0; row < rows; row += 1) {
    const sourceY = (row + 0.5) * maps.h / rows - 0.5
    for (let column = 0; column < columns; column += 1) {
      const sourceX = (column + 0.5) * maps.w / columns - 0.5
      const mapX = Math.max(0, Math.min(maps.w - 1, Math.round(sourceX)))
      const mapY = Math.max(0, Math.min(maps.h - 1, Math.round(sourceY)))
      const mapIndex = mapY * maps.w + mapX
      const alpha = maps.alpha[mapIndex]
      const distance = colorDistance(rgbAt(maps, sourceX, sourceY), background.color)
      const edge = sampleMap(maps.edge, maps.w, maps.h, sourceX, sourceY)
      const detail = sampleMap(maps.detailCoarse, maps.w, maps.h, sourceX, sourceY)
      const foreground = alphaShape
        ? alpha >= 0.18
        : distance >= threshold
          || edge >= 0.22
          || (distance >= threshold * 0.45 && detail >= 0.18)
      if (foreground) values[row * columns + column] = 1
    }
  }
  const coverage = values.reduce((sum, value) => sum + value, 0) / values.length
  if (coverage > 0.9) return values
  return largestComponent(closeMask(values, columns, rows), columns, rows)
}

function cacheKey(input: PixelSourceMaskInput): string {
  const { rect, outputWidth, outputHeight } = input
  return [
    input.sourceHash,
    input.maps.w,
    input.maps.h,
    Math.round(rect.x / Math.max(1, outputWidth) * 10000),
    Math.round(rect.y / Math.max(1, outputHeight) * 10000),
    Math.round(rect.w / Math.max(1, outputWidth) * 10000),
    Math.round(rect.h / Math.max(1, outputHeight) * 10000),
  ].join(':')
}

export function createPixelSourceMask(input: PixelSourceMaskInput): PixelSourceMask {
  const key = cacheKey(input)
  const cached = cache.get(key)
  if (cached) return cached
  const { columns, rows } = sourceGrid(input.maps)
  const values = buildSourceValues(input.maps, columns, rows)
  const sample: PixelProtectedSample = (u, v) => {
    const x = (u * input.outputWidth - input.rect.x) / input.rect.w
    const y = (v * input.outputHeight - input.rect.y) / input.rect.h
    if (x < 0 || x > 1 || y < 0 || y > 1) return 0
    const column = Math.max(0, Math.min(columns - 1, Math.floor(x * columns)))
    const row = Math.max(0, Math.min(rows - 1, Math.floor(y * rows)))
    return values[row * columns + column]
  }
  const mask: PixelSourceMask = {
    key,
    columns,
    rows,
    values,
    coverage: values.reduce((sum, value) => sum + value, 0) / values.length,
    sample,
  }
  if (cache.size >= 8) cache.delete(cache.keys().next().value!)
  cache.set(key, mask)
  return mask
}
