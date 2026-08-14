// Canonical Meta symbol geometry. Keep this path byte-for-byte aligned with
// public/icon-fill.svg; both 2D rendering and 3D export consume this source.
export const META_SYMBOL_WIDTH = 20
export const META_SYMBOL_HEIGHT = 14
export const META_SYMBOL_PATH = 'M14.353 0C12.713 0 11.432 1.3 10.27 2.954C8.676 0.814 7.343 0 5.747 0C2.493 0 0 4.46 0 9.183C0 12.137 1.357 14 3.63 14C5.265 14 6.442 13.188 8.534 9.337L10.004 6.598C10.214 6.95533 10.4357 7.34033 10.669 7.753L11.649 9.491C13.56 12.858 14.625 14 16.555 14C18.768 14 20 12.111 20 9.096C19.999 4.152 17.45 0 14.353 0ZM6.94 8.294C5.244 11.094 4.658 11.721 3.713 11.721C2.741 11.721 2.163 10.822 2.163 9.221C2.163 5.793 3.786 2.288 5.72 2.288C6.767 2.288 7.643 2.925 8.982 4.946C7.71 7.004 6.94 8.294 6.94 8.294ZM13.339 7.941L12.167 5.881C11.8718 5.37509 11.5667 4.875 11.252 4.381C12.308 2.661 13.179 1.806 14.217 1.806C16.371 1.806 18.094 5.146 18.094 9.25C18.094 10.814 17.608 11.722 16.6 11.722C15.634 11.721 15.173 11.049 13.339 7.941Z'

type Point = { x: number; y: number }

export type MetaSymbolSample = {
  inside: boolean
  distance: number
}

const CUBIC_STEPS = 24
const PATH_TOKEN = /[MLCZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi
const contours = flattenPath(META_SYMBOL_PATH)

export function sampleMetaSymbol(x: number, y: number): MetaSymbolSample {
  let winding = 0
  let distanceSquared = Number.POSITIVE_INFINITY

  for (const contour of contours) {
    for (let index = 1; index < contour.length; index += 1) {
      const start = contour[index - 1]
      const end = contour[index]
      const side = cross(start, end, x, y)

      if (start.y <= y) {
        if (end.y > y && side > 0) winding += 1
      } else if (end.y <= y && side < 0) {
        winding -= 1
      }

      distanceSquared = Math.min(
        distanceSquared,
        segmentDistanceSquared(x, y, start, end),
      )
    }
  }

  const distance = Math.sqrt(distanceSquared)
  return {
    inside: distance <= 1e-7 || winding !== 0,
    distance,
  }
}

export function metaSymbolContains(x: number, y: number): boolean {
  return sampleMetaSymbol(x, y).inside
}

export function metaSymbolDistance(x: number, y: number): number {
  return sampleMetaSymbol(x, y).distance
}

function flattenPath(path: string): Point[][] {
  const tokens = path.match(PATH_TOKEN)
  if (!tokens) throw new Error('Canonical Meta symbol path is empty')

  const result: Point[][] = []
  let contour: Point[] = []
  let current: Point = { x: 0, y: 0 }
  let start: Point = current
  let index = 0

  const number = () => {
    const token = tokens[index]
    if (token === undefined || /^[MLCZ]$/i.test(token)) {
      throw new Error('Invalid canonical Meta symbol path')
    }
    index += 1
    return Number(token)
  }

  const closeContour = () => {
    if (contour.length < 2) return
    const last = contour[contour.length - 1]
    if (last.x !== start.x || last.y !== start.y) contour.push({ ...start })
    result.push(contour)
    contour = []
    current = start
  }

  while (index < tokens.length) {
    const command = tokens[index]
    index += 1

    if (command === 'M') {
      if (contour.length) closeContour()
      current = { x: number(), y: number() }
      start = current
      contour = [{ ...current }]
      continue
    }

    if (command === 'L') {
      current = { x: number(), y: number() }
      contour.push({ ...current })
      continue
    }

    if (command === 'C') {
      const controlA = { x: number(), y: number() }
      const controlB = { x: number(), y: number() }
      const end = { x: number(), y: number() }
      const begin = current
      for (let step = 1; step <= CUBIC_STEPS; step += 1) {
        const t = step / CUBIC_STEPS
        const inverse = 1 - t
        contour.push({
          x: inverse ** 3 * begin.x
            + 3 * inverse ** 2 * t * controlA.x
            + 3 * inverse * t ** 2 * controlB.x
            + t ** 3 * end.x,
          y: inverse ** 3 * begin.y
            + 3 * inverse ** 2 * t * controlA.y
            + 3 * inverse * t ** 2 * controlB.y
            + t ** 3 * end.y,
        })
      }
      current = end
      continue
    }

    if (command === 'Z') {
      closeContour()
      continue
    }

    throw new Error(`Unsupported canonical Meta symbol command: ${command}`)
  }

  if (contour.length) closeContour()
  return result
}

function cross(start: Point, end: Point, x: number, y: number): number {
  return (end.x - start.x) * (y - start.y) - (x - start.x) * (end.y - start.y)
}

function segmentDistanceSquared(
  x: number,
  y: number,
  start: Point,
  end: Point,
): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const denominator = dx * dx + dy * dy
  const amount = denominator > 0
    ? Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / denominator))
    : 0
  const offsetX = x - (start.x + dx * amount)
  const offsetY = y - (start.y + dy * amount)
  return offsetX * offsetX + offsetY * offsetY
}
