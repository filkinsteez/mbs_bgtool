// Meta's company-brand page publishes Meta_Company-Lockup.zip. The Symbol
// path below is copied byte-for-byte from the archive's monochrome RGB SVG;
// public/icon-fill.svg carries that same path and its natural viewBox.
export const META_SYMBOL_SOURCE_URL =
  'https://www.meta.com/brand/resources/meta/company-brand/'
export const META_SYMBOL_SOURCE_FILE =
  'Meta_Company Lockup/3 Mono Black/RGB/Meta_lockup_mono_black_RGB.svg'
export const META_SYMBOL_PATH_SHA256 =
  'aefbd77408112a50ea8d92a123f629da0c988af3e19262cbc0d4ba2a44324f93'
export const META_SYMBOL_MIN_X = 1000
export const META_SYMBOL_MIN_Y = 1000
export const META_SYMBOL_WIDTH = 1504.8272
export const META_SYMBOL_HEIGHT = 1000
export const META_SYMBOL_ASPECT_RATIO = META_SYMBOL_WIDTH / META_SYMBOL_HEIGHT
export const META_SYMBOL_VIEW_BOX =
  `${META_SYMBOL_MIN_X} ${META_SYMBOL_MIN_Y} ${META_SYMBOL_WIDTH} ${META_SYMBOL_HEIGHT}`
export const META_SYMBOL_PATH = 'M2080,1000c-123.3911,0-219.8478,92.936-307.164,210.9931C1652.8473,1058.2153,1552.5,1000,1432.4138,1000,1187.5862,1000,1000,1318.6207,1000,1655.8621,1000,1866.8965,1102.0956,2000,1273.1035,2000c123.0805,0,211.6-58.0259,368.9655-333.1034,0,0,65.5973-115.8413,110.7249-195.6386q23.72,38.2978,49.9647,82.5351l73.7931,124.1379C2020.2989,1918.4789,2100.39,2000,2245.5172,2000c166.5959,0,259.31-134.9233,259.31-350.3448C2504.8276,1296.5517,2313.0118,1000,2080,1000ZM1522.069,1592.4138c-127.5862,200-171.7242,244.8276-242.7587,244.8276-73.1034,0-116.5517-64.1784-116.5517-178.6207,0-244.8276,122.069-495.1724,267.5862-495.1724,78.8013,0,144.6539,45.51,245.5224,189.9131C1580.088,1500.2723,1522.069,1592.4138,1522.069,1592.4138Zm481.5283-25.178-88.23-147.1481q-35.8152-58.2482-68.8384-107.23c79.52-122.7353,145.1135-183.8919,223.1261-183.8919,162.0691,0,291.7243,238.6207,291.7243,531.7241,0,111.7242-36.5935,176.5518-112.4139,176.5518C2176.2949,1837.2414,2141.5787,1789.2474,2003.5973,1567.2358Z'

export type MetaSymbolPoint = { x: number; y: number }
type Point = MetaSymbolPoint

export type MetaSymbolSample = {
  inside: boolean
  distance: number
}

const CUBIC_STEPS = 24
const QUADRATIC_STEPS = 24
const PATH_TOKEN = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?|[a-z]/gi
const PATH_COMMAND = /^[a-z]$/i

export type MetaSymbolGeometry = {
  minX: number
  minY: number
  width: number
  height: number
  path: string
  getContours: () => readonly (readonly MetaSymbolPoint[])[]
  sample: (x: number, y: number) => MetaSymbolSample
}

export function createMetaSymbolGeometry(options: {
  minX: number
  minY: number
  width: number
  height: number
  path: string
}): MetaSymbolGeometry {
  const geometryContours = flattenPath(options.path, options.minX, options.minY)
  return {
    ...options,
    getContours: () => geometryContours,
    sample: (x, y) => sampleContours(geometryContours, x, y),
  }
}

export const META_SYMBOL_GEOMETRY = createMetaSymbolGeometry({
  minX: META_SYMBOL_MIN_X,
  minY: META_SYMBOL_MIN_Y,
  width: META_SYMBOL_WIDTH,
  height: META_SYMBOL_HEIGHT,
  path: META_SYMBOL_PATH,
})

export function getMetaSymbolContours(): readonly (readonly MetaSymbolPoint[])[] {
  return META_SYMBOL_GEOMETRY.getContours()
}

export function sampleMetaSymbol(x: number, y: number): MetaSymbolSample {
  return META_SYMBOL_GEOMETRY.sample(x, y)
}

function sampleContours(
  contours: readonly (readonly MetaSymbolPoint[])[],
  x: number,
  y: number,
): MetaSymbolSample {
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

function flattenPath(path: string, minX: number, minY: number): Point[][] {
  const tokens = path.match(PATH_TOKEN)
  if (!tokens) throw new Error('Canonical Meta symbol path is empty')

  const result: Point[][] = []
  let contour: Point[] = []
  let current: Point = { x: 0, y: 0 }
  let start: Point = current
  let index = 0
  let command = ''

  const number = () => {
    const token = tokens[index]
    if (token === undefined || PATH_COMMAND.test(token)) {
      throw new Error('Invalid canonical Meta symbol path')
    }
    index += 1
    return Number(token)
  }

  const point = (relative: boolean, origin: Point): Point => {
    const x = number()
    const y = number()
    return relative
      ? { x: origin.x + x, y: origin.y + y }
      : { x, y }
  }

  const closeContour = () => {
    if (contour.length < 2) return
    const last = contour[contour.length - 1]
    if (last.x !== start.x || last.y !== start.y) contour.push({ ...start })
    result.push(contour.map(({ x, y }) => ({ x: x - minX, y: y - minY })))
    contour = []
    current = start
  }

  while (index < tokens.length) {
    if (PATH_COMMAND.test(tokens[index])) {
      command = tokens[index]
      index += 1
    }
    if (!command) throw new Error('Invalid canonical Meta symbol path')
    const relative = command === command.toLowerCase()
    const operation = command.toUpperCase()

    if (operation === 'Z') {
      closeContour()
      command = ''
      continue
    }

    if (operation === 'M') {
      if (contour.length) closeContour()
      current = point(relative, current)
      start = current
      contour = [{ ...current }]
      command = relative ? 'l' : 'L'
      continue
    }

    if (operation === 'L') {
      current = point(relative, current)
      contour.push({ ...current })
      continue
    }

    if (operation === 'C') {
      const begin = current
      const controlA = point(relative, begin)
      const controlB = point(relative, begin)
      const end = point(relative, begin)
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

    if (operation === 'Q') {
      const begin = current
      const control = point(relative, begin)
      const end = point(relative, begin)
      for (let step = 1; step <= QUADRATIC_STEPS; step += 1) {
        const t = step / QUADRATIC_STEPS
        const inverse = 1 - t
        contour.push({
          x: inverse ** 2 * begin.x
            + 2 * inverse * t * control.x
            + t ** 2 * end.x,
          y: inverse ** 2 * begin.y
            + 2 * inverse * t * control.y
            + t ** 2 * end.y,
        })
      }
      current = end
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
