import { boxBlur } from '@/core/math/blur'
import { sampleMap, type AnalysisMaps } from './analysis'
import type { Field, FitRect } from './field'

const GRID_LONG_EDGE = 160
const CONTOUR_LEVEL = 0.3
const TAU = Math.PI * 2

export const TRAIL_SOURCE_CARRIER_REVISION = 1

type Point = {
  x: number
  y: number
}

type Segment = {
  a: Point
  b: Point
}

export type TrailCarrierBounds = {
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
}

export type SourceTrailCarrier = {
  kind: 'source'
  method: 'source-contour' | 'source-field-loop'
  points: Float32Array
  bounds: TrailCarrierBounds
  coverage: number
}

export type SourceTrailCarrierInput = {
  maps: AnalysisMaps
  rect: FitRect
  width: number
  height: number
  territory?: Field
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1)
  return amount * amount * (3 - 2 * amount)
}

function median(values: readonly number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5
}

function percentile(values: readonly number[], amount: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(
    (sorted.length - 1) * amount,
  )))]
}

function mapIndex(maps: AnalysisMaps, x: number, y: number): number {
  const column = clamp(Math.round(x), 0, maps.w - 1)
  const row = clamp(Math.round(y), 0, maps.h - 1)
  return row * maps.w + column
}

function borderIndices(maps: AnalysisMaps): number[] {
  const indices: number[] = []
  const stepX = Math.max(1, Math.floor(maps.w / 96))
  const stepY = Math.max(1, Math.floor(maps.h / 96))
  for (let x = 0; x < maps.w; x += stepX) {
    indices.push(x, (maps.h - 1) * maps.w + x)
  }
  for (let y = stepY; y < maps.h - stepY; y += stepY) {
    indices.push(y * maps.w, y * maps.w + maps.w - 1)
  }
  return indices
}

function sourceBackground(maps: AnalysisMaps): {
  red: number
  green: number
  blue: number
  alpha: number
  colorThreshold: number
} {
  const indices = borderIndices(maps)
  const reds = indices.map((index) => maps.rgba[index * 4] / 255)
  const greens = indices.map((index) => maps.rgba[index * 4 + 1] / 255)
  const blues = indices.map((index) => maps.rgba[index * 4 + 2] / 255)
  const alphas = indices.map((index) => maps.alpha[index])
  const red = median(reds)
  const green = median(greens)
  const blue = median(blues)
  const distances = indices.map((index) => {
    const offset = index * 4
    return Math.hypot(
      maps.rgba[offset] / 255 - red,
      maps.rgba[offset + 1] / 255 - green,
      maps.rgba[offset + 2] / 255 - blue,
    ) / Math.sqrt(3)
  })
  return {
    red,
    green,
    blue,
    alpha: median(alphas),
    colorThreshold: clamp(percentile(distances, 0.92) * 2.1 + 0.025, 0.04, 0.24),
  }
}

function outputBorderTerritory(
  territory: Field | undefined,
  width: number,
  height: number,
): number {
  if (!territory) return 0
  const values: number[] = []
  const samples = 48
  for (let index = 0; index <= samples; index += 1) {
    const amount = index / samples
    values.push(
      territory(amount * width, 0),
      territory(amount * width, height),
      territory(0, amount * height),
      territory(width, amount * height),
    )
  }
  return median(values)
}

function confidenceGrid(input: SourceTrailCarrierInput): {
  values: Float32Array
  gridWidth: number
  gridHeight: number
  coverage: number
} {
  const { maps, rect, width, height, territory } = input
  const longEdge = Math.max(width, height)
  const columns = Math.max(32, Math.round(GRID_LONG_EDGE * width / longEdge))
  const rows = Math.max(32, Math.round(GRID_LONG_EDGE * height / longEdge))
  const gridWidth = columns + 1
  const gridHeight = rows + 1
  const values = new Float32Array(gridWidth * gridHeight)
  const background = sourceBackground(maps)
  const borderTerritory = outputBorderTerritory(territory, width, height)
  let active = 0

  for (let row = 0; row < gridHeight; row += 1) {
    const y = row / rows * height
    for (let column = 0; column < gridWidth; column += 1) {
      const x = column / columns * width
      const u = (x - rect.x) / Math.max(1e-6, rect.w)
      const v = (y - rect.y) / Math.max(1e-6, rect.h)
      if (u < 0 || u > 1 || v < 0 || v > 1) continue
      const mapX = u * maps.w - 0.5
      const mapY = v * maps.h - 0.5
      const index = mapIndex(maps, mapX, mapY)
      const offset = index * 4
      const colorDistance = Math.hypot(
        maps.rgba[offset] / 255 - background.red,
        maps.rgba[offset + 1] / 255 - background.green,
        maps.rgba[offset + 2] / 255 - background.blue,
      ) / Math.sqrt(3)
      const color = smoothstep(
        background.colorThreshold,
        Math.min(0.72, background.colorThreshold + 0.18),
        colorDistance,
      )
      const alpha = smoothstep(
        0.035,
        0.3,
        Math.abs(sampleMap(maps.alpha, maps.w, maps.h, mapX, mapY) - background.alpha),
      )
      const edge = sampleMap(maps.edge, maps.w, maps.h, mapX, mapY)
      const territoryDifference = territory
        ? Math.abs(territory(x, y) - borderTerritory)
        : 0
      const territorySignal = smoothstep(0.045, 0.3, territoryDifference)
      const value = Math.max(color, alpha, edge * 0.68, territorySignal * 0.88)
      values[row * gridWidth + column] = value
      if (value >= CONTOUR_LEVEL) active += 1
    }
  }

  boxBlur(values, gridWidth, gridHeight, 1, 2)
  return {
    values,
    gridWidth,
    gridHeight,
    coverage: active / values.length,
  }
}

function interpolate(
  a: Point,
  valueA: number,
  b: Point,
  valueB: number,
  level: number,
): Point {
  const amount = Math.abs(valueB - valueA) < 1e-7
    ? 0.5
    : clamp((level - valueA) / (valueB - valueA), 0, 1)
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
  }
}

function contourSegments(
  values: Float32Array,
  gridWidth: number,
  gridHeight: number,
  width: number,
  height: number,
  level: number,
): Segment[] {
  const segments: Segment[] = []
  const at = (column: number, row: number) => values[row * gridWidth + column]
  const add = (a: Point, b: Point) => segments.push({ a, b })
  for (let row = 0; row < gridHeight - 1; row += 1) {
    const y0 = row / (gridHeight - 1) * height
    const y1 = (row + 1) / (gridHeight - 1) * height
    for (let column = 0; column < gridWidth - 1; column += 1) {
      const x0 = column / (gridWidth - 1) * width
      const x1 = (column + 1) / (gridWidth - 1) * width
      const topLeftValue = at(column, row)
      const topRightValue = at(column + 1, row)
      const bottomRightValue = at(column + 1, row + 1)
      const bottomLeftValue = at(column, row + 1)
      const state = (topLeftValue >= level ? 8 : 0)
        | (topRightValue >= level ? 4 : 0)
        | (bottomRightValue >= level ? 2 : 0)
        | (bottomLeftValue >= level ? 1 : 0)
      if (state === 0 || state === 15) continue
      const top = interpolate(
        { x: x0, y: y0 },
        topLeftValue,
        { x: x1, y: y0 },
        topRightValue,
        level,
      )
      const right = interpolate(
        { x: x1, y: y0 },
        topRightValue,
        { x: x1, y: y1 },
        bottomRightValue,
        level,
      )
      const bottom = interpolate(
        { x: x0, y: y1 },
        bottomLeftValue,
        { x: x1, y: y1 },
        bottomRightValue,
        level,
      )
      const left = interpolate(
        { x: x0, y: y0 },
        topLeftValue,
        { x: x0, y: y1 },
        bottomLeftValue,
        level,
      )
      const center = (
        topLeftValue + topRightValue + bottomRightValue + bottomLeftValue
      ) * 0.25
      switch (state) {
        case 1: add(left, bottom); break
        case 2: add(bottom, right); break
        case 3: add(left, right); break
        case 4: add(top, right); break
        case 5:
          if (center >= level) {
            add(top, left)
            add(right, bottom)
          } else {
            add(top, right)
            add(bottom, left)
          }
          break
        case 6: add(top, bottom); break
        case 7: add(top, left); break
        case 8: add(top, left); break
        case 9: add(top, bottom); break
        case 10:
          if (center >= level) {
            add(top, right)
            add(bottom, left)
          } else {
            add(top, left)
            add(right, bottom)
          }
          break
        case 11: add(top, right); break
        case 12: add(left, right); break
        case 13: add(bottom, right); break
        case 14: add(left, bottom); break
      }
    }
  }
  return segments
}

function pointKey(point: Point): string {
  return `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`
}

function segmentPolylines(segments: readonly Segment[]): Point[][] {
  const nodes = new Map<string, { point: Point; edges: number[] }>()
  const ends: [string, string][] = []
  segments.forEach((segment, index) => {
    const keys: [string, string] = [pointKey(segment.a), pointKey(segment.b)]
    ends.push(keys)
    for (const [key, point] of [[keys[0], segment.a], [keys[1], segment.b]] as const) {
      const node = nodes.get(key) ?? { point, edges: [] }
      node.edges.push(index)
      nodes.set(key, node)
    }
  })
  const visited = new Uint8Array(segments.length)
  const polylines: Point[][] = []
  for (let seedEdge = 0; seedEdge < segments.length; seedEdge += 1) {
    if (visited[seedEdge]) continue
    const seedEnds = ends[seedEdge]
    const start = seedEnds.find((key) => nodes.get(key)?.edges.length === 1) ?? seedEnds[0]
    const points: Point[] = []
    let current = start
    for (let safety = 0; safety <= segments.length; safety += 1) {
      const node = nodes.get(current)
      if (!node) break
      points.push(node.point)
      const edge = node.edges.find((index) => !visited[index])
      if (edge === undefined) break
      visited[edge] = 1
      const [a, b] = ends[edge]
      current = current === a ? b : a
      if (current === start) {
        points.push(nodes.get(start)!.point)
        break
      }
    }
    if (points.length >= 4) polylines.push(points)
  }
  return polylines
}

function polylineLength(points: readonly Point[]): number {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    )
  }
  return length
}

function polygonArea(points: readonly Point[]): number {
  let area = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    area += points[index].x * points[index + 1].y
      - points[index + 1].x * points[index].y
  }
  return area * 0.5
}

function smoothClosed(points: readonly Point[], passes = 3): Point[] {
  let output = points.slice(0, -1)
  for (let pass = 0; pass < passes; pass += 1) {
    output = output.map((point, index) => {
      const previous = output[(index - 1 + output.length) % output.length]
      const next = output[(index + 1) % output.length]
      return {
        x: previous.x * 0.2 + point.x * 0.6 + next.x * 0.2,
        y: previous.y * 0.2 + point.y * 0.6 + next.y * 0.2,
      }
    })
  }
  return [...output, { ...output[0] }]
}

function contourFromGrid(
  values: Float32Array,
  gridWidth: number,
  gridHeight: number,
  width: number,
  height: number,
): Point[] | null {
  const segments = contourSegments(
    values,
    gridWidth,
    gridHeight,
    width,
    height,
    CONTOUR_LEVEL,
  )
  const polylines = segmentPolylines(segments)
  const cellSize = Math.max(width / (gridWidth - 1), height / (gridHeight - 1))
  const ranked = polylines
    .map((points) => {
      const closed = Math.hypot(
        points[0].x - points.at(-1)!.x,
        points[0].y - points.at(-1)!.y,
      ) <= cellSize * 1.5
      const loop = closed ? points : [...points, { ...points[0] }]
      const length = polylineLength(loop)
      const area = Math.abs(polygonArea(loop))
      return { points: loop, score: area + length * cellSize * 1.5, length, area }
    })
    .filter((item) => item.length >= cellSize * 8 && item.area >= cellSize * cellSize * 4)
    .sort((a, b) => b.score - a.score)
  return ranked[0] ? smoothClosed(ranked[0].points) : null
}

function fieldLoop(
  values: Float32Array,
  gridWidth: number,
  gridHeight: number,
  width: number,
  height: number,
  rect: FitRect,
): Point[] {
  let total = 0
  let centerX = 0
  let centerY = 0
  for (let row = 0; row < gridHeight; row += 1) {
    const y = row / (gridHeight - 1) * height
    for (let column = 0; column < gridWidth; column += 1) {
      const x = column / (gridWidth - 1) * width
      const weight = Math.max(0, values[row * gridWidth + column] - 0.08) ** 1.4
      total += weight
      centerX += x * weight
      centerY += y * weight
    }
  }
  if (total < 1e-4) {
    centerX = rect.x + rect.w * 0.5
    centerY = rect.y + rect.h * 0.5
    total = 1
  } else {
    centerX /= total
    centerY /= total
  }
  let xx = 0
  let xy = 0
  let yy = 0
  for (let row = 0; row < gridHeight; row += 1) {
    const y = row / (gridHeight - 1) * height
    for (let column = 0; column < gridWidth; column += 1) {
      const x = column / (gridWidth - 1) * width
      const weight = Math.max(0, values[row * gridWidth + column] - 0.08) ** 1.4
      const dx = x - centerX
      const dy = y - centerY
      xx += dx * dx * weight
      xy += dx * dy * weight
      yy += dy * dy * weight
    }
  }
  xx /= total
  xy /= total
  yy /= total
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy)
  const trace = xx + yy
  const discriminant = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy * xy))
  const major = Math.sqrt(Math.max(1, (trace + discriminant) * 0.5))
  const minor = Math.sqrt(Math.max(1, (trace - discriminant) * 0.5))
  const radiusX = clamp(major * 2.25, Math.min(width, height) * 0.1, width * 0.46)
  const radiusY = clamp(minor * 2.25, Math.min(width, height) * 0.08, height * 0.46)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const points: Point[] = []
  for (let index = 0; index <= 256; index += 1) {
    const amount = index / 256 * TAU
    const localX = Math.cos(amount) * radiusX
    const localY = Math.sin(amount) * radiusY
    points.push({
      x: centerX + localX * cos - localY * sin,
      y: centerY + localX * sin + localY * cos,
    })
  }
  return points
}

function floatPoints(points: readonly Point[]): Float32Array {
  const output = new Float32Array(points.length * 2)
  points.forEach((point, index) => {
    output[index * 2] = point.x
    output[index * 2 + 1] = point.y
  })
  return output
}

export function trailCarrierBounds(points: Float32Array): TrailCarrierBounds {
  let minimumX = Number.POSITIVE_INFINITY
  let minimumY = Number.POSITIVE_INFINITY
  let maximumX = Number.NEGATIVE_INFINITY
  let maximumY = Number.NEGATIVE_INFINITY
  for (let index = 0; index < points.length; index += 2) {
    minimumX = Math.min(minimumX, points[index])
    minimumY = Math.min(minimumY, points[index + 1])
    maximumX = Math.max(maximumX, points[index])
    maximumY = Math.max(maximumY, points[index + 1])
  }
  if (!Number.isFinite(minimumX)) {
    minimumX = minimumY = maximumX = maximumY = 0
  }
  return {
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
    centerX: (minimumX + maximumX) * 0.5,
    centerY: (minimumY + maximumY) * 0.5,
  }
}

/**
 * Builds a persistent carrier from the actual supplied source frame. The
 * contour path is preferred; a covariance loop derived from the same source
 * field is the source-aware fallback. This function never returns Meta geometry.
 */
export function buildSourceTrailCarrier(input: SourceTrailCarrierInput): SourceTrailCarrier {
  const width = Math.max(1, input.width)
  const height = Math.max(1, input.height)
  const grid = confidenceGrid({ ...input, width, height })
  const contour = contourFromGrid(
    grid.values,
    grid.gridWidth,
    grid.gridHeight,
    width,
    height,
  )
  const method = contour ? 'source-contour' : 'source-field-loop'
  const points = floatPoints(contour ?? fieldLoop(
    grid.values,
    grid.gridWidth,
    grid.gridHeight,
    width,
    height,
    input.rect,
  ))
  return {
    kind: 'source',
    method,
    points,
    bounds: trailCarrierBounds(points),
    coverage: grid.coverage,
  }
}
