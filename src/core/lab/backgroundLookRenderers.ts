import { contourAtLevel } from '@/core/cloner/contours'
import { chan } from '@/core/organic/random'
import type { LookColorPlan } from './colorDirection'
import type { Field } from './field'
import { regionValue } from './fills'
import { territoryGrid } from './territory'

type BackgroundLookOptions = {
  id: string
  width: number
  height: number
  seed: number
  complexity: number
  palette: readonly string[]
  colorPlan?: LookColorPlan
  influence: Field
  sourceSample?: (x: number, y: number) => readonly [number, number, number] | null
  motionPhase: number
  motionAmount: number
  motionEnergy: number
}

type DirectedColors = {
  ground: string
  dominant: string
  support: string
  accent: string
  ink: string
  light: string
  dark: string
  active: readonly string[]
}

type Point = { x: number; y: number }
type InfluencedPoint = Point & { influence: number }

const TAU = Math.PI * 2

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function tier(value: number): 0 | 1 | 2 {
  return value < 0.34 ? 0 : value < 0.67 ? 1 : 2
}

function seededArchetype(seed: number, salt: number): 0 | 1 | 2 {
  return (Math.imul((seed | 0) ^ salt, 0x9e3779b1) >>> 0) % 3 as 0 | 1 | 2
}

function seededVariant(seed: number, salt: number, count: number): number {
  return (Math.imul((seed | 0) ^ salt, 0x9e3779b1) >>> 0) % Math.max(1, count)
}

function parseColor(color: string): [number, number, number] | null {
  const value = color.trim().replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(value)) {
    return [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ]
  }
  const rgb = color.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[/,]\s*[^)]*)?\s*\)$/i,
  )
  return rgb
    ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    : null
}

function mixColor(a: string, b: string, amount: number): string {
  const left = parseColor(a)
  const right = parseColor(b)
  if (!left || !right) return a
  const t = clamp01(amount)
  return `rgb(${left.map((channel, index) =>
    Math.round(channel + (right[index] - channel) * t)).join(' ')})`
}

function alpha(color: string, amount: number): string {
  const value = parseColor(color)
  if (!value) return color
  return `rgb(${value.join(' ')} / ${clamp01(amount)})`
}

function luma(color: string): number {
  const value = parseColor(color)
  if (!value) return 0.5
  return (
    value[0] * 0.2126
    + value[1] * 0.7152
    + value[2] * 0.0722
  ) / 255
}

function directedColors(options: BackgroundLookOptions): DirectedColors {
  const { palette, colorPlan } = options
  const fallback = palette[0] ?? '#0064E0'
  const at = (index: number | null | undefined, defaultColor: string) =>
    index != null && palette[index] ? palette[index] : defaultColor
  const groundIndex = colorPlan?.roles.ground ?? palette.length - 1
  const ground = at(groundIndex, palette.at(-1) ?? '#0B1538')
  const visibleIndexes = colorPlan?.depthOrder.filter((index) => index !== groundIndex)
    ?? palette.map((_, index) => index).filter((index) => index !== groundIndex)
  const active = visibleIndexes.map((index) => palette[index]).filter(Boolean)
  const dominant = at(
    colorPlan?.roles.dominant === groundIndex
      ? visibleIndexes[0]
      : colorPlan?.roles.dominant,
    active[0] ?? fallback,
  )
  const support = at(
    colorPlan?.roles.support.find((index) => index !== groundIndex)
      ?? visibleIndexes[1],
    active[1] ?? dominant,
  )
  const accent = at(
    colorPlan?.roles.accent === groundIndex
      ? visibleIndexes.at(-1)
      : colorPlan?.roles.accent,
    active.at(-1) ?? support,
  )
  const ink = at(colorPlan?.roles.ink, dominant)
  const orderedByLight = [...palette].sort((a, b) => luma(a) - luma(b))
  return {
    ground,
    dominant,
    support,
    accent,
    ink,
    dark: orderedByLight[0] ?? mixColor(ground, '#000000', 0.7),
    light: orderedByLight.at(-1) ?? mixColor(ground, '#FFFFFF', 0.7),
    active: active.length ? active : [dominant, support, accent],
  }
}

function structuralColor(
  options: BackgroundLookOptions,
  colors: DirectedColors,
  sample: number,
): string {
  const plan = options.colorPlan
  if (!plan?.swatches.length) {
    const index = Math.min(
      colors.active.length - 1,
      Math.floor(clamp01(sample) * colors.active.length),
    )
    return colors.active[index] ?? colors.dominant
  }
  const candidates = plan.swatches
    .map((swatch, index) => ({ index, weight: swatch.weight }))
    .filter(({ index }) => index !== plan.roles.ground)
  if (!candidates.length) return colors.dominant
  const total = candidates.reduce((sum, item) => sum + item.weight, 0) || 1
  let cursor = clamp01(sample) * total
  for (const candidate of candidates) {
    cursor -= candidate.weight
    if (cursor <= 0) return options.palette[candidate.index] ?? colors.dominant
  }
  return options.palette[candidates.at(-1)!.index] ?? colors.dominant
}

function sourceDirectedColor(
  options: BackgroundLookOptions,
  x: number,
  y: number,
  color: string,
  amount: number,
): string {
  const source = options.sourceSample?.(x, y)
  if (!source) return color
  return mixColor(
    color,
    `rgb(${source[0]} ${source[1]} ${source[2]})`,
    clamp01(amount) * 0.28,
  )
}

function loopAngle(phase: number): number {
  const wrapped = ((phase % 1) + 1) % 1
  return (wrapped < 1e-9 || 1 - wrapped < 1e-9 ? 0 : wrapped) * TAU
}

function harmonicMotion(
  options: BackgroundLookOptions,
  id: number,
  channel: string,
  phaseOffset = 0,
): number {
  const theta = loopAngle(options.motionPhase)
  const energy = clamp01(options.motionEnergy)
  const primaryPhase = phaseOffset + chan(options.seed, id, `${channel}.primary`) * TAU
  const secondaryPhase = phaseOffset * 0.61
    + chan(options.seed, id, `${channel}.secondary`) * TAU
  const tertiaryPhase = -phaseOffset * 0.43
    + chan(options.seed, id, `${channel}.tertiary`) * TAU
  const closed = (harmonic: number, offset: number) =>
    Math.sin(theta * harmonic + offset) - Math.sin(offset)
  const signal = (
    closed(1, primaryPhase)
    + energy * (
      closed(2, secondaryPhase) * 0.42
      + closed(3, tertiaryPhase) * 0.22
    )
  ) / (2 * (1 + energy * 0.64))
  return signal * (0.72 + energy * 0.9)
}

function harmonicVector(
  options: BackgroundLookOptions,
  id: number,
  channel: string,
): Point {
  return {
    x: harmonicMotion(options, id, `${channel}.x`),
    y: harmonicMotion(options, id, `${channel}.y`, Math.PI * 0.5),
  }
}

function softInfluence(
  options: BackgroundLookOptions,
  x: number,
  y: number,
  radius: number,
): number {
  if (radius <= 0) return clamp01(options.influence(x, y))
  const diagonal = radius * 0.7
  return clamp01((
    options.influence(x, y) * 4
    + options.influence(x - radius, y) * 2
    + options.influence(x + radius, y) * 2
    + options.influence(x, y - radius) * 2
    + options.influence(x, y + radius) * 2
    + options.influence(x - diagonal, y - diagonal)
    + options.influence(x + diagonal, y - diagonal)
    + options.influence(x - diagonal, y + diagonal)
    + options.influence(x + diagonal, y + diagonal)
  ) / 16)
}

function influenceVector(
  options: BackgroundLookOptions,
  x: number,
  y: number,
  epsilon: number,
): { x: number; y: number; edge: number } {
  const dx = options.influence(x + epsilon, y) - options.influence(x - epsilon, y)
  const dy = options.influence(x, y + epsilon) - options.influence(x, y - epsilon)
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return { x: 0, y: 0, edge: 0 }
  return {
    x: dx / length,
    y: dy / length,
    edge: clamp01(length * 3.4),
  }
}

function pathFrom(points: readonly Point[]): Path2D {
  const path = new Path2D()
  if (!points.length) return path
  path.moveTo(points[0].x, points[0].y)
  for (let index = 1; index < points.length; index += 1) {
    path.lineTo(points[index].x, points[index].y)
  }
  return path
}

function polygonPath(points: readonly Point[]): Path2D {
  const path = pathFrom(points)
  path.closePath()
  return path
}

function cubicPoint(
  start: Point,
  controlA: Point,
  controlB: Point,
  end: Point,
  value: number,
): Point {
  const t = clamp01(value)
  const inverse = 1 - t
  return {
    x: inverse ** 3 * start.x
      + 3 * inverse ** 2 * t * controlA.x
      + 3 * inverse * t ** 2 * controlB.x
      + t ** 3 * end.x,
    y: inverse ** 3 * start.y
      + 3 * inverse ** 2 * t * controlA.y
      + 3 * inverse * t ** 2 * controlB.y
      + t ** 3 * end.y,
  }
}

function influencedCubic(
  options: BackgroundLookOptions,
  controls: readonly [Point, Point, Point, Point],
  id: number,
  channel: string,
  normalAmount = 0.035,
  count = 112,
): InfluencedPoint[] {
  const size = Math.min(options.width, options.height)
  const phase = loopAngle(options.motionPhase)
  const motion = clamp01(options.motionAmount)
  const points: InfluencedPoint[] = []
  for (let index = 0; index <= count; index += 1) {
    const progress = index / count
    const base = cubicPoint(controls[0], controls[1], controls[2], controls[3], progress)
    const ahead = cubicPoint(
      controls[0],
      controls[1],
      controls[2],
      controls[3],
      Math.min(1, progress + 1 / count),
    )
    const tangentX = ahead.x - base.x
    const tangentY = ahead.y - base.y
    const tangentLength = Math.hypot(tangentX, tangentY) || 1
    const normalX = -tangentY / tangentLength
    const normalY = tangentX / tangentLength
    const influence = softInfluence(options, base.x, base.y, size * 0.045)
    const field = influenceVector(options, base.x, base.y, size * 0.022)
    const grain = regionValue(options.seed, base.x, base.y, size * 0.22, channel) - 0.5
    const offset = (
      (influence - 0.2) * normalAmount
      + grain * normalAmount * 0.35
      + Math.sin(progress * TAU * 1.3 + id + phase) * motion * normalAmount * 0.12
    ) * size
    points.push({
      x: base.x + normalX * offset + field.x * field.edge * size * normalAmount * 0.28,
      y: base.y + normalY * offset + field.y * field.edge * size * normalAmount * 0.28,
      influence,
    })
  }
  return points
}

function pathFrame(
  points: readonly Point[],
  index: number,
): { tangentX: number; tangentY: number; normalX: number; normalY: number } {
  const previous = points[Math.max(0, index - 1)] ?? points[index]
  const next = points[Math.min(points.length - 1, index + 1)] ?? points[index]
  const tangentX = next.x - previous.x
  const tangentY = next.y - previous.y
  const length = Math.hypot(tangentX, tangentY) || 1
  return {
    tangentX: tangentX / length,
    tangentY: tangentY / length,
    normalX: -tangentY / length,
    normalY: tangentX / length,
  }
}

function variableRibbonPath(
  points: readonly InfluencedPoint[],
  widthAt: (point: InfluencedPoint, progress: number, index: number) => number,
): Path2D {
  if (points.length < 2) return pathFrom(points)
  const left: Point[] = []
  const right: Point[] = []
  points.forEach((point, index) => {
    const progress = index / Math.max(1, points.length - 1)
    const frame = pathFrame(points, index)
    const halfWidth = Math.max(0.1, widthAt(point, progress, index)) / 2
    left.push({
      x: point.x + frame.normalX * halfWidth,
      y: point.y + frame.normalY * halfWidth,
    })
    right.push({
      x: point.x - frame.normalX * halfWidth,
      y: point.y - frame.normalY * halfWidth,
    })
  })
  return polygonPath([...left, ...right.reverse()])
}

function offsetInfluencedPath(
  points: readonly InfluencedPoint[],
  offsetAt: (point: InfluencedPoint, progress: number, index: number) => number,
): InfluencedPoint[] {
  return points.map((point, index) => {
    const progress = index / Math.max(1, points.length - 1)
    const frame = pathFrame(points, index)
    const offset = offsetAt(point, progress, index)
    return {
      x: point.x + frame.normalX * offset,
      y: point.y + frame.normalY * offset,
      influence: point.influence,
    }
  })
}

function smoothInfluencedPath(
  points: readonly InfluencedPoint[],
  radius = 3,
): InfluencedPoint[] {
  if (points.length < 3 || radius < 1) return [...points]
  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point
    let x = 0
    let y = 0
    let influence = 0
    let totalWeight = 0
    for (
      let neighbor = Math.max(0, index - radius);
      neighbor <= Math.min(points.length - 1, index + radius);
      neighbor += 1
    ) {
      const weight = radius + 1 - Math.abs(index - neighbor)
      x += points[neighbor].x * weight
      y += points[neighbor].y * weight
      influence += points[neighbor].influence * weight
      totalWeight += weight
    }
    return {
      x: x / totalWeight,
      y: y / totalWeight,
      influence: influence / totalWeight,
    }
  })
}

function pathCurvature(points: readonly Point[], index: number): number {
  const previous = points[Math.max(0, index - 2)] ?? points[index]
  const current = points[index]
  const next = points[Math.min(points.length - 1, index + 2)] ?? points[index]
  const firstX = current.x - previous.x
  const firstY = current.y - previous.y
  const secondX = next.x - current.x
  const secondY = next.y - current.y
  const denominator = Math.hypot(firstX, firstY) * Math.hypot(secondX, secondY)
  if (denominator < 1e-6) return 0
  const cosine = Math.max(-1, Math.min(
    1,
    (firstX * secondX + firstY * secondY) / denominator,
  ))
  return Math.acos(cosine) / Math.PI
}

function curvatureEvents(
  points: readonly Point[],
  count: number,
  minimumGap = 0.1,
): number[] {
  const candidates = Array.from(
    { length: Math.max(0, points.length - 8) },
    (_, offset) => offset + 4,
  ).sort((left, right) => pathCurvature(points, right) - pathCurvature(points, left))
  const selected: number[] = []
  const gap = points.length * minimumGap
  for (const index of candidates) {
    if (selected.every((value) => Math.abs(value - index) >= gap)) {
      selected.push(index)
      if (selected.length === count) break
    }
  }
  return selected.sort((left, right) => left - right)
}

function drawFrame(
  context: CanvasRenderingContext2D,
  options: BackgroundLookOptions,
  colors: DirectedColors,
): void {
  const { width, height, seed } = options
  const size = Math.min(width, height)
  const level = tier(options.complexity)
  const motion = clamp01(options.motionAmount)
  const energy = clamp01(options.motionEnergy)
  const archetype = seededArchetype(seed, 0x3c6ef372)
  const portrait = height > width * 1.08
  const square = !portrait && width < height * 1.22
  const mirror = chan(seed, 0, 'look.frame.mirror') < 0.5
  const squareSkew = archetype === 2 ? 0.14 : archetype === 1 ? -0.08 : 0.06
  const point = (u: number, v: number): Point => {
    const cross = mirror ? 1 - v : v
    if (portrait) {
      return { x: width * cross, y: height * u }
    }
    if (square) {
      return {
        x: width * u,
        y: height * (cross + (u - 0.5) * squareSkew),
      }
    }
    return { x: width * u, y: height * cross }
  }
  const authored = (x: number, y: number): Point => {
    if (portrait) {
      return {
        x: y / Math.max(1, height),
        y: mirror ? 1 - x / Math.max(1, width) : x / Math.max(1, width),
      }
    }
    const u = x / Math.max(1, width)
    const cross = y / Math.max(1, height) - (square ? (u - 0.5) * squareSkew : 0)
    return { x: u, y: mirror ? 1 - cross : cross }
  }

  const ground = context.createLinearGradient(
    portrait ? width : 0,
    portrait ? 0 : height,
    portrait ? 0 : width,
    portrait ? height : 0,
  )
  ground.addColorStop(0, mixColor(colors.ground, colors.dark, 0.32))
  ground.addColorStop(0.38, colors.ground)
  ground.addColorStop(0.72, mixColor(colors.ground, colors.support, 0.16))
  ground.addColorStop(1, mixColor(colors.ground, colors.dark, 0.2))
  context.fillStyle = ground
  context.fillRect(0, 0, width, height)

  const territorySpecs: readonly (readonly (readonly [number, number])[])[][] = [
    [
      [
        [-0.08, 0.12], [0.28, 0.04], [0.58, 0.2], [0.7, 0.44],
        [0.52, 0.62], [0.34, 0.96], [-0.08, 1.08],
      ],
    ],
    [
      [
        [-0.08, 0.76], [0.14, 0.48], [0.36, 0.39], [0.58, 0.5],
        [0.8, 0.16], [1.08, 0.22], [1.08, 0.58], [0.8, 0.56],
        [0.63, 0.82], [0.27, 0.7], [-0.08, 1.02],
      ],
    ],
    [
      [
        [-0.08, 0.16], [0.28, 0.1], [0.46, 0.28], [0.72, 0.18],
        [1.08, 0.37], [1.08, 0.61], [0.66, 0.47], [0.39, 0.6],
        [-0.08, 0.48],
      ],
      [
        [-0.08, 0.82], [0.2, 0.73], [0.47, 0.84], [0.67, 0.72],
        [1.08, 0.88], [1.08, 1.08], [-0.08, 1.08],
      ],
    ],
  ]
  const territoryPaths = territorySpecs[archetype].map((polygon) =>
    polygonPath(polygon.map(([u, v]) => point(u, v))))
  territoryPaths.forEach((path, index) => {
    const probe = archetype === 0
      ? point(0.28, 0.56)
      : archetype === 1 ? point(0.62, 0.48) : point(index ? 0.5 : 0.42, index ? 0.84 : 0.34)
    const influence = softInfluence(options, probe.x, probe.y, size * 0.08)
    const fill = sourceDirectedColor(
      options,
      probe.x,
      probe.y,
      index === 0 ? colors.dominant : colors.support,
      0.42 + influence * 0.58,
    )
    context.fillStyle = alpha(fill, index === 0 ? 0.34 : 0.24)
    context.fill(path)
  })

  const scalar: Field = (x, y) => {
    const scene = authored(x, y)
    const u = scene.x
    const v = scene.y
    const plate = regionValue(seed, x, y, size * 0.48, 'look.frame.plate') - 0.5
    const erosion = regionValue(seed, x, y, size * 0.17, 'look.frame.erosion') - 0.5
    const influence = softInfluence(options, x, y, size * 0.075)
    let macro = 0.5
    if (archetype === 0) {
      const dx = (u - 0.08) / 0.72
      const dy = (v - 0.66) / 0.62
      const basin = 1 - Math.hypot(dx, dy)
      macro = 0.24
        + basin * 0.64
        + plate * 0.22
        + Math.sin((u * 0.7 + v) * TAU * 1.35 + plate * 2.4) * 0.07
    } else if (archetype === 1) {
      const ridge = 0.48 + Math.sin(v * TAU * 1.1 + plate * 2.1) * 0.13
      macro = 0.5
        + (u - ridge) * 0.82
        + plate * 0.2
        + Math.sin((u - v * 0.45) * TAU * 1.3) * 0.055
    } else {
      const strata = v + Math.sin(u * TAU * 1.25 + plate * 2.6) * 0.09
      const interruption = Math.exp(
        -(((u - 0.55) / 0.18) ** 2) - (((v - 0.52) / 0.28) ** 2),
      )
      macro = 0.47
        + (strata - 0.5) * 0.64
        + Math.sin(strata * TAU * 2.05) * 0.12
        + plate * 0.16
        - interruption * 0.2
    }
    return clamp01(
      macro
      + erosion * 0.07
      + (influence - 0.18) * (0.11 + Math.abs(plate) * 0.08),
    )
  }
  const grid = territoryGrid(scalar, width, height, 154)
  const heroLevels = archetype === 0
    ? [0.25, 0.41, 0.57, 0.72]
    : archetype === 1 ? [0.24, 0.4, 0.59, 0.76] : [0.22, 0.38, 0.56, 0.73]
  const secondaryLevels = archetype === 2
    ? [0.3, 0.47, 0.64]
    : [0.33, 0.49, 0.66]

  let sourceEvent = { x: width * 0.62, y: height * 0.42, score: -1 }
  for (let row = 1; row < 6; row += 1) {
    for (let column = 1; column < 8; column += 1) {
      const probe = point(column / 8, row / 6)
      const vector = influenceVector(options, probe.x, probe.y, size * 0.028)
      const influence = softInfluence(options, probe.x, probe.y, size * 0.05)
      const score = vector.edge * 0.74 + influence * 0.26
      if (score > sourceEvent.score) sourceEvent = { ...probe, score }
    }
  }

  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  const clipPath = new Path2D()
  territoryPaths.forEach((path) => clipPath.addPath(path))
  context.clip(clipPath)
  heroLevels.forEach((contourLevel, index) => {
    const data = contourAtLevel(grid, contourLevel)
    if (!data) return
    const path = new Path2D(data)
    const drift = harmonicVector(options, index, 'look.frame.contour')
    const driftAmount = size * (0.009 + energy * 0.007) * motion
    context.save()
    context.translate(drift.x * driftAmount, drift.y * driftAmount)
    const color = structuralColor(options, colors, chan(seed, index, 'look.frame.hero.color'))
    context.setLineDash(index % 2 === 0
      ? []
      : [size * (0.12 + index * 0.015), size * (0.025 + index * 0.009)])
    context.lineDashOffset = -size * chan(seed, index, 'look.frame.hero.break')
    context.strokeStyle = alpha(colors.dark, 0.24)
    context.lineWidth = Math.max(2, size * (index === 0 ? 0.018 : 0.011))
    context.stroke(path)
    context.strokeStyle = color
    context.globalAlpha = index === 0 ? 0.9 : 0.64 + index * 0.06
    context.lineWidth = Math.max(1, size * (index === 0 ? 0.008 : 0.0042))
    context.stroke(path)
    context.restore()
  })
  context.setLineDash([])
  if (level >= 1) {
    context.save()
    context.beginPath()
    context.ellipse(
      sourceEvent.x,
      sourceEvent.y,
      portrait ? width * 0.42 : width * 0.24,
      portrait ? height * 0.2 : height * 0.3,
      archetype === 1 ? -0.32 : 0.18,
      0,
      TAU,
    )
    context.clip()
    secondaryLevels.forEach((contourLevel, index) => {
      const data = contourAtLevel(grid, contourLevel)
      if (!data) return
      context.setLineDash([
        size * (0.045 + index * 0.012),
        size * (0.014 + (2 - index) * 0.005),
      ])
      context.lineDashOffset = harmonicMotion(
        options,
        40 + index,
        'look.frame.secondary-dash',
      ) * size * (0.035 + energy * 0.018) * motion + index * size * 0.021
      context.strokeStyle = index === 1 ? colors.accent : colors.ink
      context.globalAlpha = index === 1 ? 0.78 : 0.55
      context.lineWidth = Math.max(0.9, size * (index === 1 ? 0.0035 : 0.0026))
      context.stroke(new Path2D(data))
    })
    context.restore()
    context.setLineDash([])
  }
  if (level >= 2) {
    context.save()
    context.beginPath()
    context.ellipse(
      sourceEvent.x,
      sourceEvent.y,
      portrait ? width * 0.34 : width * 0.2,
      portrait ? height * 0.18 : height * 0.26,
      archetype === 1 ? -0.28 : 0.16,
      0,
      TAU,
    )
    context.clip()
    const microLevels = [0.27, 0.35, 0.44, 0.53, 0.62, 0.71, 0.79]
    microLevels.forEach((contourLevel, index) => {
      const data = contourAtLevel(grid, contourLevel)
      if (!data) return
      context.setLineDash([
        size * (0.022 + index % 3 * 0.009),
        size * (0.01 + (index + 1) % 3 * 0.005),
      ])
      context.lineDashOffset = index * size * 0.012 + harmonicMotion(
        options,
        70 + index,
        'look.frame.micro-dash',
      ) * size * (0.024 + energy * 0.014) * motion
      context.strokeStyle = index % 3 === 0 ? colors.accent : colors.light
      context.globalAlpha = index % 3 === 0 ? 0.78 : 0.58
      context.lineWidth = Math.max(0.7, size * (index % 3 === 0 ? 0.0026 : 0.0019))
      context.stroke(new Path2D(data))
    })
    context.restore()
    context.setLineDash([])

    const vector = influenceVector(options, sourceEvent.x, sourceEvent.y, size * 0.024)
    const tangent = vector.edge > 0.01
      ? { x: -vector.y, y: vector.x }
      : { x: Math.cos(-0.38), y: Math.sin(-0.38) }
    const normal = { x: -tangent.y, y: tangent.x }
    for (let note = -6; note <= 6; note += 1) {
      if (note === 0 || note === 3) continue
      const along = note * size * 0.025
      const away = (chan(seed, note + 10, 'look.frame.note.away') - 0.5) * size * 0.055
      const center = {
        x: sourceEvent.x + tangent.x * along + normal.x * away,
        y: sourceEvent.y + tangent.y * along + normal.y * away,
      }
      const length = size * (0.018 + chan(seed, note + 10, 'look.frame.note.length') * 0.032)
      context.strokeStyle = note % 5 === 0 ? colors.accent : colors.light
      context.globalAlpha = note % 5 === 0 ? 0.82 : 0.5
      context.lineWidth = Math.max(0.75, size * (note % 4 === 0 ? 0.003 : 0.0018))
      context.beginPath()
      context.moveTo(center.x - normal.x * length * 0.5, center.y - normal.y * length * 0.5)
      context.lineTo(center.x + normal.x * length * 0.5, center.y + normal.y * length * 0.5)
      context.stroke()
    }
  }
  context.restore()

  // A few broken sectional carriers touch the crop without restoring the old
  // all-over contour density.
  const cropCarriers = archetype === 0
    ? [
        [[-0.08, 0.08], [0.22, 0.12], [0.52, 0.07]],
        [[0.6, 0.95], [0.82, 0.88], [1.08, 0.92]],
        [[0.96, -0.08], [0.9, 0.18], [0.97, 0.38]],
      ]
    : archetype === 1
      ? [
          [[-0.08, 0.2], [0.22, 0.14], [0.42, 0.2]],
          [[0.7, 0.9], [0.9, 0.82], [1.08, 0.86]],
          [[0.04, 0.62], [-0.02, 0.82], [0.06, 1.08]],
        ]
      : [
          [[-0.08, 0.08], [0.3, 0.03], [0.56, 0.1]],
          [[0.52, 0.96], [0.8, 0.9], [1.08, 0.98]],
          [[0.95, 0.52], [1.01, 0.74], [0.94, 1.08]],
        ]
  context.save()
  context.lineCap = 'round'
  cropCarriers.forEach((carrier, index) => {
    const path = pathFrom(carrier.map(([u, v]) => point(u, v)))
    context.strokeStyle = alpha(index === 1 ? colors.support : colors.ink, 0.42)
    context.lineWidth = Math.max(1, size * (index === 1 ? 0.0048 : 0.0032))
    context.setLineDash([size * (0.09 + index * 0.025), size * (0.025 + index * 0.008)])
    context.stroke(path)
  })
  context.restore()
}

function drawPixels(
  context: CanvasRenderingContext2D,
  options: BackgroundLookOptions,
  colors: DirectedColors,
): void {
  const { width, height, seed } = options
  const size = Math.min(width, height)
  const level = tier(options.complexity)
  const motion = clamp01(options.motionAmount)
  const energy = clamp01(options.motionEnergy)
  const archetype = seededArchetype(seed, 0x9e3779b9)
  const portrait = height > width * 1.08
  const square = !portrait && width < height * 1.22
  const cell = Math.max(7, Math.round(size * (portrait ? 0.046 : 0.05)))
  const columns = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)

  const pixelGround = mixColor(colors.dark, colors.dominant, 0.16)
  const ground = context.createLinearGradient(
    archetype === 1 ? width : 0,
    portrait ? 0 : height,
    archetype === 1 ? 0 : width,
    portrait ? height : 0,
  )
  ground.addColorStop(0, mixColor(pixelGround, colors.ink, 0.24))
  ground.addColorStop(0.54, pixelGround)
  ground.addColorStop(1, mixColor(pixelGround, colors.support, 0.36))
  context.fillStyle = ground
  context.fillRect(0, 0, width, height)

  const sceneAt = (x: number, y: number) => {
    const u = x / Math.max(1, width)
    const v = y / Math.max(1, height)
    if (portrait) {
      return {
        along: v,
        cross: archetype === 1 ? u : 1 - u,
      }
    }
    if (square) {
      return {
        along: clamp01(u * 0.9 + v * (archetype === 2 ? 0.16 : 0.08)),
        cross: clamp01(v * 0.92 + (1 - u) * (archetype === 0 ? 0.12 : 0.04)),
      }
    }
    return { along: u, cross: v }
  }
  const pointAt = (along: number, cross: number): Point => {
    if (portrait) {
      return {
        x: width * (archetype === 1 ? cross : 1 - cross),
        y: height * along,
      }
    }
    if (square) {
      return {
        x: width * clamp01((along - cross * (archetype === 2 ? 0.16 : 0.08)) / 0.9),
        y: height * clamp01((cross - (1 - along) * (archetype === 0 ? 0.12 : 0.04)) / 0.92),
      }
    }
    return { x: width * along, y: height * cross }
  }

  type PixelCell = {
    column: number
    row: number
    x: number
    y: number
    centerX: number
    centerY: number
    mass: number
    influence: number
    sourceEdge: number
    zone: number
    motionX: number
    motionY: number
  }
  const occupied: PixelCell[] = []
  const macroAt = (centerX: number, centerY: number) => {
    const { along, cross } = sceneAt(centerX, centerY)
    const influence = softInfluence(options, centerX, centerY, cell * 0.85)
    const steering = influenceVector(options, centerX, centerY, cell * 0.75)
    const warpedAlong = along
      + (portrait ? steering.y : steering.x) * steering.edge * 0.025
    const warpedCross = cross
      + (portrait ? steering.x : steering.y) * steering.edge * 0.035
    const weather = regionValue(seed, centerX, centerY, size * 0.42, 'look.pixels.weather')
    const sourcePerforation = regionValue(
      seed,
      centerX,
      centerY,
      size * 0.19,
      'look.pixels.source-perforation',
    )
    const sourceBridge = steering.edge * (
      sourcePerforation > 0.58 ? 0.11 : sourcePerforation < 0.28 ? -0.07 : 0
    )
    let mass = 0
    let voidValue = 0
    let zone = 0
    if (archetype === 0) {
      const escarpment = 0.79
        - warpedAlong * 0.56
        + Math.sin(warpedAlong * TAU * 1.4 + 0.4) * 0.055
      const band = Math.exp(-(((warpedCross - escarpment) / 0.17) ** 2))
      const croppedShelf = warpedAlong < 0.34 && warpedCross > 0.55
        ? clamp01((0.34 - warpedAlong) * 3.8) * clamp01((warpedCross - 0.52) * 3.4)
        : 0
      mass = Math.max(band, croppedShelf * 0.92)
      voidValue = Math.exp(
        -(((warpedAlong - 0.72) / 0.19) ** 2 + ((warpedCross - 0.2) / 0.14) ** 2),
      )
      zone = warpedCross > escarpment ? 1 : 0
    } else if (archetype === 1) {
      const upperShelf = Math.exp(
        -(((warpedAlong - 0.13) / 0.34) ** 2 + ((warpedCross - 0.23) / 0.25) ** 2),
      )
      const lowerShelf = Math.exp(
        -(((warpedAlong - 0.88) / 0.35) ** 2 + ((warpedCross - 0.77) / 0.27) ** 2),
      )
      const hinge = Math.exp(
        -(((warpedCross - (0.18 + warpedAlong * 0.62)) / 0.11) ** 2),
      ) * Math.exp(-(((warpedAlong - 0.52) / 0.34) ** 2))
      mass = Math.max(upperShelf, lowerShelf, hinge * 0.88)
      voidValue = Math.exp(
        -(((warpedAlong - 0.52) / 0.16) ** 2 + ((warpedCross - 0.42) / 0.17) ** 2),
      )
      zone = lowerShelf > upperShelf ? 2 : hinge > 0.55 ? 1 : 0
    } else {
      const leftBank = Math.exp(
        -(((warpedCross - (0.2 + Math.sin(warpedAlong * TAU) * 0.07)) / 0.2) ** 2),
      )
      const rightBank = Math.exp(
        -(((warpedCross - (0.83 - Math.cos(warpedAlong * TAU * 0.8) * 0.08)) / 0.16) ** 2),
      )
      const cap = warpedAlong < 0.28
        ? clamp01((0.3 - warpedAlong) * 3.6) * clamp01(1 - Math.abs(warpedCross - 0.52) * 2)
        : 0
      mass = Math.max(leftBank * 0.94, rightBank * 0.9, cap * 0.86)
      voidValue = Math.exp(
        -(((warpedAlong - 0.68) / 0.24) ** 2 + ((warpedCross - 0.53) / 0.18) ** 2),
      )
      zone = rightBank > leftBank ? 2 : cap > 0.5 ? 1 : 0
    }
    return {
      influence,
      mass: clamp01(mass + (weather - 0.5) * 0.16 + sourceBridge - voidValue * 0.86),
      sourceEdge: steering.edge,
      zone,
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const id = row * columns + column
      const x = column * cell
      const y = row * cell
      const centerX = x + cell / 2
      const centerY = y + cell / 2
      const macro = macroAt(centerX, centerY)
      const parentColumn = Math.floor(column / 2)
      const parentRow = Math.floor(row / 2)
      const parentId = parentRow * Math.ceil(columns / 2) + parentColumn
      const threshold = 0.46 + (chan(seed, parentId, 'look.pixels.erosion') - 0.5) * 0.14
      if (macro.mass < threshold) continue
      const erodedEdge = macro.mass < 0.62
        && chan(seed, id, 'look.pixels.edge-chip') < 0.16
      if (erodedEdge) continue
      const perforated = macro.mass > 0.69
        && chan(seed, parentId, 'look.pixels.perforation') < 0.055
        && (column + row * 2 + archetype) % 5 === 1
      if (perforated) continue
      const role = macro.zone === 0
        ? colors.dominant
        : macro.zone === 1
          ? colors.support
          : colors.light
      const local = sourceDirectedColor(options, centerX, centerY, role, macro.influence)
      const fill = macro.mass > 0.76
        ? local
        : mixColor(pixelGround, local, 0.76)
      const superColumn = Math.floor(column / 3)
      const superRow = Math.floor(row / 3)
      const superId = superRow * Math.ceil(columns / 3) + superColumn
      const drift = harmonicVector(options, superId, 'look.pixels.supercell')
      const amplitude = size * (0.0125 + energy * 0.0075) * motion
      const motionX = drift.x * amplitude
      const motionY = drift.y * amplitude
      context.fillStyle = fill
      context.globalAlpha = 0.94
      context.fillRect(
        x + motionX,
        y + motionY,
        Math.min(cell + 0.75, width - x),
        Math.min(cell + 0.75, height - y),
      )
      occupied.push({
        column,
        row,
        x,
        y,
        centerX,
        centerY,
        mass: macro.mass,
        influence: macro.influence,
        sourceEdge: macro.sourceEdge,
        zone: macro.zone,
        motionX,
        motionY,
      })
    }
  }

  // A few anisotropic runs bind the supercells into one directional mass.
  const runCrossAt = (progress: number, lane: number) => {
    if (archetype === 0) {
      return 0.8 - progress * 0.58 + lane * 0.055
        + Math.sin(progress * TAU * 1.35 + lane) * 0.035
    }
    if (archetype === 1) {
      return (progress < 0.46
        ? 0.16 + progress * 0.35
        : 0.76 - (progress - 0.46) * 0.42)
        + lane * 0.06
    }
    return (lane === 0 ? 0.22 : 0.81)
      + Math.sin(progress * TAU * (lane === 0 ? 1 : 0.75) + lane) * 0.065
  }
  const runCount = archetype === 2 ? 2 : 3
  for (let lane = 0; lane < runCount; lane += 1) {
    const steps = portrait ? rows + 3 : columns + 3
    for (let step = -1; step <= steps; step += 1) {
      if ((step + lane * 5) % (archetype === 1 ? 13 : 17) === 8) continue
      const progress = step / Math.max(1, steps - 2)
      const cross = runCrossAt(progress, lane - (runCount - 1) / 2)
      const base = pointAt(progress, cross)
      const influence = softInfluence(options, base.x, base.y, cell)
      const vector = influenceVector(options, base.x, base.y, cell * 0.8)
      const bridgeDrift = harmonicVector(options, 800 + lane, 'look.pixels.bridge')
      const bridgeAmplitude = size * (0.0125 + energy * 0.0075) * motion
      const x = Math.round((
        base.x + vector.x * vector.edge * cell * 0.7
      ) / cell) * cell
      const y = Math.round((
        base.y + vector.y * vector.edge * cell * 0.7
      ) / cell) * cell
      context.fillStyle = sourceDirectedColor(
        options,
        base.x,
        base.y,
        vector.edge > 0.22 && (step + lane * 7) % 19 === 5
          ? colors.accent
          : lane === 0 ? colors.light : colors.dominant,
        influence,
      )
      context.globalAlpha = lane === 0 ? 0.84 : 0.7
      context.fillRect(
        x - (portrait ? cell : 0) + bridgeDrift.x * bridgeAmplitude,
        y - (portrait ? 0 : cell) + bridgeDrift.y * bridgeAmplitude,
        portrait ? cell * 2 + 0.5 : cell + 0.5,
        portrait ? cell + 0.5 : cell * 2 + 0.5,
      )
    }
  }

  if (level >= 1) {
    // Mid adds a stable second scale inside the existing packed regions.
    const midWindows = archetype === 0
      ? [[0.22, 0.67], [0.6, 0.42]]
      : archetype === 1
        ? [[0.18, 0.24], [0.78, 0.72]]
        : [[0.28, 0.2], [0.76, 0.8]]
    for (const item of occupied) {
      if ((item.column * 2 + item.row + archetype) % 7 !== 0) continue
      const scene = sceneAt(item.centerX, item.centerY)
      const nearWindow = midWindows.some(([along, cross]) =>
        ((scene.along - along) / 0.24) ** 2 + ((scene.cross - cross) / 0.22) ** 2 < 1)
      if (
        !nearWindow
        || item.mass < 0.58
        || (item.mass > 0.72 && item.sourceEdge < 0.16)
      ) continue
      const role = item.zone === 1 ? colors.ink : colors.support
      context.fillStyle = alpha(sourceDirectedColor(
        options,
        item.centerX,
        item.centerY,
        role,
        item.influence,
      ), 0.82)
      const horizontal = (item.column + item.row + archetype) % 2 === 0
      context.fillRect(
        item.x + item.motionX + (horizontal ? cell * 0.18 : cell * 0.54),
        item.y + item.motionY + (horizontal ? cell * 0.54 : cell * 0.18),
        horizontal ? cell * 1.22 : cell * 0.28,
        horizontal ? cell * 0.28 : cell * 1.22,
      )
    }
  }

  if (level >= 2) {
    // High only subdivides two localized parts of the established masses.
    const windows = archetype === 0
      ? [[0.18, 0.7], [0.62, 0.39]]
      : archetype === 1
        ? [[0.16, 0.22], [0.82, 0.74]]
        : [[0.32, 0.22], [0.74, 0.79]]
    const child = cell / 2
    for (const item of occupied) {
      const scene = sceneAt(item.centerX, item.centerY)
      const nearWindow = windows.some(([along, cross]) =>
        ((scene.along - along) / 0.22) ** 2 + ((scene.cross - cross) / 0.2) ** 2 < 1)
      const selectedEdge = item.mass < 0.69 || item.sourceEdge > 0.18
      if (!nearWindow || !selectedEdge || (item.column + item.row) % 2 !== archetype % 2) continue
      for (let childY = 0; childY < 2; childY += 1) {
        for (let childX = 0; childX < 2; childX += 1) {
          const childId = (item.row * columns + item.column) * 4 + childY * 2 + childX
          if ((childX + childY + childId) % 3 === 0) continue
          const base = childId % 5 === 0 ? colors.light : colors.support
          context.fillStyle = alpha(sourceDirectedColor(
            options,
            item.x + (childX + 0.5) * child,
            item.y + (childY + 0.5) * child,
            base,
            item.influence,
          ), childId % 5 === 0 ? 0.78 : 0.46)
          context.fillRect(
            item.x + item.motionX + childX * child,
            item.y + item.motionY + childY * child,
            child + 0.3,
            child + 0.3,
          )
        }
      }
    }
  }
  context.globalAlpha = 1
}

function drawScanlines(
  context: CanvasRenderingContext2D,
  options: BackgroundLookOptions,
  colors: DirectedColors,
): void {
  const { width, height, seed } = options
  const size = Math.min(width, height)
  const level = tier(options.complexity)
  const motion = clamp01(options.motionAmount)
  const energy = clamp01(options.motionEnergy)
  const archetype = seededArchetype(seed, 0xa54ff53a)
  const portrait = height > width * 1.08
  const square = !portrait && width < height * 1.22
  const mirror = chan(seed, 0, 'look.scan.mirror') < 0.5
  const lineCount = 44
  const physicalSpacing = (portrait ? width : height) / lineCount
  const focal = [
    { u: 0.72, v: 0.3 },
    { u: 0.3, v: 0.66 },
    { u: 0.58, v: 0.46 },
  ][archetype]
  const quiet = [
    { u: 0.18, v: 0.72, radiusU: 0.22, radiusV: 0.22 },
    { u: 0.76, v: 0.24, radiusU: 0.2, radiusV: 0.24 },
    { u: 0.2, v: 0.24, radiusU: 0.2, radiusV: 0.2 },
  ][archetype]
  const point = (along: number, cross: number): Point => {
    const directedCross = mirror ? 1 - cross : cross
    if (portrait) {
      return { x: width * directedCross, y: height * along }
    }
    const diagonal = square && archetype === 2 ? (along - 0.5) * 0.16 : 0
    return {
      x: width * along,
      y: height * (directedCross + diagonal),
    }
  }

  const focalPoint = point(focal.u, focal.v)
  const focalVector = influenceVector(options, focalPoint.x, focalPoint.y, size * 0.03)
  focalPoint.x += focalVector.x * focalVector.edge * size * 0.075
  focalPoint.y += focalVector.y * focalVector.edge * size * 0.075
  const ground = context.createLinearGradient(
    portrait ? width : 0,
    portrait ? 0 : height,
    portrait ? 0 : width,
    portrait ? height : 0,
  )
  ground.addColorStop(0, mixColor(colors.ground, colors.dark, 0.34))
  ground.addColorStop(archetype === 1 ? 0.32 : 0.46, colors.ground)
  ground.addColorStop(archetype === 0 ? 0.7 : 0.78, mixColor(colors.ground, colors.support, 0.1))
  ground.addColorStop(1, mixColor(colors.ground, colors.dark, 0.24))
  context.fillStyle = ground
  context.fillRect(0, 0, width, height)
  const signalTerritories: readonly (readonly (readonly [number, number])[])[] = [
    [[0.44, 0.05], [1.08, 0.1], [1.08, 0.58], [0.62, 0.53]],
    [[-0.08, 0.43], [0.48, 0.34], [0.54, 0.94], [-0.08, 1.04]],
    [[0.24, 0.24], [1.08, 0.36], [1.08, 0.9], [0.46, 0.72]],
  ]
  const focalInfluence = softInfluence(options, focalPoint.x, focalPoint.y, size * 0.08)
  context.fillStyle = alpha(sourceDirectedColor(
    options,
    focalPoint.x,
    focalPoint.y,
    archetype === 1 ? colors.ink : colors.support,
    0.42 + focalInfluence * 0.58,
  ), archetype === 1 ? 0.12 : 0.16)
  context.fill(polygonPath(
    signalTerritories[archetype].map(([along, cross]) => point(along, cross)),
  ))
  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'

  const signalSegments = (
    baseCross: number,
    line: number,
    retrace = 0,
    start = 0,
    end = 1,
    keepQuiet = false,
  ): InfluencedPoint[][] => {
    const segments: InfluencedPoint[][] = []
    let segment: InfluencedPoint[] = []
    const samples = Math.max(12, Math.round(148 * (end - start)))
    for (let sample = 0; sample <= samples; sample += 1) {
      const along = start + sample / samples * (end - start)
      const base = point(along, baseCross)
      const influence = softInfluence(options, base.x, base.y, physicalSpacing * 2.1)
      const dx = (along - focal.u) / 0.24
      const dy = (baseCross - focal.v) / 0.3
      const pocket = Math.exp(-(dx * dx * 1.7 + dy * dy * 1.2))
      const drift = regionValue(seed, base.x, base.y, size * 0.2, 'look.scan.drift') - 0.5
      let displacedCross = baseCross + drift / lineCount * 0.42
      if (archetype === 0) {
        displacedCross = focal.v
          + (displacedCross - focal.v) * (1 - pocket * 0.34)
          + Math.sin(
            dx * 7.6
            + line * 0.43
            + harmonicMotion(options, line, 'look.scan.pocket') * motion * 1.8,
          ) * pocket / lineCount * 2.4
      } else if (archetype === 1) {
        displacedCross += Math.sign(dy || 1) * pocket / lineCount * 1.8
        displacedCross += Math.sin(dx * 4.2 + line * 0.29) * pocket / lineCount * 0.65
      } else {
        const fold = Math.tanh(dx * 3.2) * pocket
        displacedCross += fold / lineCount * (line % 4 < 2 ? 2.6 : -1.7)
        displacedCross += Math.sin(
          dx * 5.4
          + line * 0.31
          + harmonicMotion(options, line, 'look.scan.fold') * motion * 1.6,
        ) * pocket / lineCount * 0.9
      }
      displacedCross += retrace * pocket / lineCount
      displacedCross += (influence - 0.2)
        * Math.sin(along * TAU * 1.2 + line * 0.37)
        / lineCount
        * 0.9
      displacedCross += harmonicMotion(
        options,
        Math.floor((line + 2) / 5),
        'look.scan.carrier',
      ) * motion * (0.009 + energy * 0.009)
      const quietDistance = (
        ((along - quiet.u) / quiet.radiusU) ** 2
        + ((baseCross - quiet.v) / quiet.radiusV) ** 2
      )
      const dropoutDistance = dx * dx + dy * dy
      const authoredDropout = archetype === 1
        && dropoutDistance < 0.72
        && (line % 6 === 1 || line % 6 === 2 || line % 11 === 0)
      const quietBreak = !keepQuiet
        && quietDistance < 1
        && (line % 4 !== 0 || quietDistance < 0.42)
      const phaseBreak = archetype === 2
        && along > focal.u - 0.17
        && along < focal.u - 0.07
        && line % 9 === 4
      if (authoredDropout || quietBreak || phaseBreak) {
        if (segment.length > 1) segments.push(segment)
        segment = []
        continue
      }
      const mapped = point(along, displacedCross)
      segment.push({ ...mapped, influence })
    }
    if (segment.length > 1) segments.push(segment)
    return segments
  }

  // Fine carriers retain the signal across the full crop, but their weight,
  // phase and authored dropouts prevent a global ruled-paper texture.
  for (let line = -1; line <= lineCount; line += 1) {
    const baseCross = (line + 0.5) / lineCount
      + (chan(seed, line + 2, 'look.scan.spacing') - 0.5) / lineCount * 0.38
    const medium = line % 7 === 0
    context.strokeStyle = medium
      ? (line % 14 === 0 ? colors.ink : colors.support)
      : colors.dominant
    context.globalAlpha = medium ? 0.58 : 0.24 + chan(seed, line + 2, 'look.scan.fade') * 0.2
    context.lineWidth = Math.max(
      0.7,
      physicalSpacing
        * (medium ? 0.34 : 0.12)
        * (0.72 + chan(seed, line + 2, 'look.scan.thickness') * 0.55),
    )
    signalSegments(baseCross, line).forEach((segment) => context.stroke(pathFrom(segment)))
  }

  const broadBands = archetype === 0
    ? [0.1, 0.27, 0.48, 0.73, 0.88]
    : archetype === 1 ? [0.08, 0.34, 0.55, 0.71, 0.92] : [0.14, 0.29, 0.5, 0.66, 0.86]
  broadBands.forEach((position, index) => {
    const layouts = index % 2 === 0
      ? [[-0.04, 0.2, 0], [0.34, 0.66, 1.1], [0.77, 1.04, -0.7]]
      : [[-0.04, 0.13, 0], [0.25, 0.52, -1], [0.63, 0.88, 1.3], [0.95, 1.04, 0]]
    layouts.forEach(([start, end, retrace], segmentIndex) => {
      const segments = signalSegments(
        position,
        70 + index,
        retrace,
        start,
        end,
        segmentIndex === 0 && index % 3 === 0,
      )
      context.strokeStyle = alpha(colors.dark, 0.32)
      context.globalAlpha = 1
      context.lineWidth = physicalSpacing * (1.5 + index % 3 * 0.3)
      segments.forEach((segment) => context.stroke(pathFrom(segment)))
      context.strokeStyle = index % 2 === 0 ? colors.ink : colors.support
      context.globalAlpha = 0.9
      context.lineWidth = physicalSpacing * (0.72 + index % 3 * 0.18)
      segments.forEach((segment) => context.stroke(pathFrom(segment)))
    })
  })

  if (level >= 1) {
    // Mid adds a second signal scale only inside the focal system.
    for (let index = -5; index <= 5; index += 1) {
      const cross = focal.v + index / lineCount * 0.52
      const segments = signalSegments(
        cross,
        120 + index,
        index % 2 === 0 ? 1.7 : -1.25,
        focal.u - (archetype === 1 ? 0.3 : 0.24),
        focal.u + (archetype === 0 ? 0.3 : 0.24),
      )
      context.strokeStyle = index % 4 === 0 ? colors.light : colors.ink
      context.globalAlpha = index % 4 === 0 ? 0.66 : 0.44
      context.lineWidth = Math.max(0.75, physicalSpacing * (index % 3 === 0 ? 0.24 : 0.13))
      segments.forEach((segment) => context.stroke(pathFrom(segment)))
    }

    // The only accent is located by the exact source-field boundary.
    let sourceEvent = { x: focalPoint.x, y: focalPoint.y, score: -1 }
    for (let row = 1; row < 6; row += 1) {
      for (let column = 1; column < 8; column += 1) {
        const probe = point(column / 8, row / 6)
        const vector = influenceVector(options, probe.x, probe.y, size * 0.025)
        const score = vector.edge + softInfluence(options, probe.x, probe.y, size * 0.045) * 0.18
        if (score > sourceEvent.score) sourceEvent = { ...probe, score }
      }
    }
    const sourceVector = influenceVector(options, sourceEvent.x, sourceEvent.y, size * 0.025)
    const tangent = sourceVector.edge > 0.01
      ? { x: -sourceVector.y, y: sourceVector.x }
      : portrait ? { x: 0, y: 1 } : { x: 1, y: 0 }
    const normal = { x: -tangent.y, y: tangent.x }
    for (let crossing = -2; crossing <= 2; crossing += 1) {
      const offset = crossing * physicalSpacing * 0.9
      const center = {
        x: sourceEvent.x + normal.x * offset,
        y: sourceEvent.y + normal.y * offset,
      }
      const length = size * (0.035 + Math.abs(crossing) * 0.009)
      context.strokeStyle = crossing === 0 ? colors.accent : alpha(colors.accent, 0.58)
      context.globalAlpha = 1
      context.lineWidth = Math.max(0.9, physicalSpacing * (crossing === 0 ? 0.42 : 0.2))
      context.beginPath()
      context.moveTo(center.x - tangent.x * length, center.y - tangent.y * length)
      context.lineTo(center.x + tangent.x * length, center.y + tangent.y * length)
      context.stroke()
    }
  }

  if (level >= 2) {
    // High resolves localized retraces and fine sub-bands without increasing
    // line density outside the focal pocket.
    for (let index = -9; index <= 9; index += 1) {
      if (index % 5 === 0) continue
      const cross = focal.v + index / lineCount * 0.34
      const segments = signalSegments(
        cross,
        200 + index,
        (index % 2 === 0 ? 1 : -1) * (2.6 + Math.abs(index) * 0.08),
        focal.u - 0.2,
        focal.u + 0.2,
        true,
      )
      context.strokeStyle = index % 4 === 0 ? colors.light : colors.dominant
      context.globalAlpha = index % 4 === 0 ? 0.5 : 0.28
      context.lineWidth = Math.max(0.7, physicalSpacing * 0.1)
      segments.forEach((segment) => context.stroke(pathFrom(segment)))
    }
  }
  context.globalAlpha = 1
  context.setLineDash([])
  context.restore()
}

function drawStreams(
  context: CanvasRenderingContext2D,
  options: BackgroundLookOptions,
  colors: DirectedColors,
): void {
  const { width, height, seed } = options
  const size = Math.min(width, height)
  const level = tier(options.complexity)
  const mode = seededVariant(seed, 0x6a09e667, 5)
  const portrait = height > width * 1.08
  const square = !portrait && width < height * 1.22
  const mirror = chan(seed, 1, 'look.stream.mirror') < 0.5
  const point = (u: number, v: number): Point => {
    const cross = mirror ? 1 - v : v
    if (portrait) {
      return {
        x: width * (1 - cross),
        y: height * u,
      }
    }
    if (square) {
      return {
        x: width * (u * 0.92 + 0.04),
        y: height * (
          cross * 0.88
          + (1 - u) * (mode === 2 ? -0.07 : mode === 3 ? 0.12 : 0.05)
          + 0.04
        ),
      }
    }
    return { x: width * u, y: height * cross }
  }

  const streamGround = mixColor(colors.support, colors.ground, 0.38)
  const ground = context.createLinearGradient(
    portrait ? 0 : width,
    portrait ? height : 0,
    portrait ? width : 0,
    portrait ? 0 : height,
  )
  ground.addColorStop(0, mixColor(streamGround, colors.dark, 0.28))
  ground.addColorStop(mode === 3 ? 0.36 : 0.5, streamGround)
  ground.addColorStop(1, mixColor(streamGround, colors.light, 0.22))
  context.fillStyle = ground
  context.fillRect(0, 0, width, height)

  const quietAnchors = [
    point(0.58, 0.88),
    point(0.12, 0.84),
    point(0.48, 0.08),
    point(0.16, 0.18),
    point(0.82, 0.84),
  ] as const
  const quiet = quietAnchors[mode]
  const calm = context.createRadialGradient(
    quiet.x,
    quiet.y,
    size * 0.02,
    quiet.x,
    quiet.y,
    size * (portrait ? 0.48 : 0.58),
  )
  calm.addColorStop(0, alpha(mixColor(streamGround, colors.dark, 0.08), 0.96))
  calm.addColorStop(0.54, alpha(streamGround, 0.68))
  calm.addColorStop(1, alpha(streamGround, 0))
  context.fillStyle = calm
  context.fillRect(0, 0, width, height)

  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'

  const animateCurrent = (
    points: readonly InfluencedPoint[],
    id: number,
    amplitudeScale = 1,
  ): InfluencedPoint[] => {
    const amplitude = size
      * (0.013 + clamp01(options.motionEnergy) * 0.007)
      * clamp01(options.motionAmount)
      * amplitudeScale
    return points.map((current, index) => {
      const frame = pathFrame(points, index)
      const section = Math.floor(index / 12)
      const normalSignal = harmonicMotion(
        options,
        id * 31 + section,
        'look.stream.normal',
      )
      const advectSignal = harmonicMotion(
        options,
        id * 37 + section,
        'look.stream.advection',
        Math.PI * 0.5,
      )
      const sourceGain = 0.72 + current.influence * 0.28
      return {
        ...current,
        x: current.x
          + frame.normalX * normalSignal * amplitude * sourceGain
          + frame.tangentX * advectSignal * amplitude * 0.52,
        y: current.y
          + frame.normalY * normalSignal * amplitude * sourceGain
          + frame.tangentY * advectSignal * amplitude * 0.52,
      }
    })
  }

  const paintCurrent = (
    points: readonly InfluencedPoint[],
    currentWidth: number,
    color: string,
    id: number,
    opacity = 0.88,
  ) => {
    const middle = points[Math.floor(points.length / 2)]
    const local = middle
      ? sourceDirectedColor(options, middle.x, middle.y, color, middle.influence)
      : color
    const widthAt = (current: InfluencedPoint, progress: number) => currentWidth * (
      0.72
      + Math.sin(progress * Math.PI) * 0.32
      + current.influence * 0.16
      + Math.sin(progress * TAU * 1.7 + id) * 0.045
    )
    context.fillStyle = alpha(colors.dark, 0.34)
    context.globalAlpha = 1
    context.fill(variableRibbonPath(points, (current, progress) => widthAt(current, progress) * 1.3))
    context.fillStyle = alpha(local, opacity)
    context.fill(variableRibbonPath(points, widthAt))
    const undertow = offsetInfluencedPath(
      points,
      (_current, progress) =>
        Math.sin(progress * Math.PI) * Math.sin(progress * TAU * 1.15 + id) * currentWidth * 0.2,
    )
    context.strokeStyle = alpha(id % 3 === 0 ? colors.light : colors.dark, 0.42)
    context.lineWidth = Math.max(1, currentWidth * 0.065)
    context.stroke(pathFrom(undertow))
  }

  type StreamSpec = {
    controls: readonly [Point, Point, Point, Point]
    width: number
    color: string
  }
  const baseSpecs: readonly StreamSpec[][] = [
    [
      {
        controls: [point(-0.08, 0.16), point(0.24, 0.1), point(0.68, 0.24), point(1.08, 0.18)],
        width: size * 0.105,
        color: colors.dominant,
      },
      {
        controls: [point(-0.08, 0.38), point(0.3, 0.48), point(0.7, 0.28), point(1.08, 0.42)],
        width: size * 0.072,
        color: colors.support,
      },
      {
        controls: [point(-0.08, 0.68), point(0.22, 0.58), point(0.72, 0.78), point(1.08, 0.64)],
        width: size * 0.086,
        color: colors.ink,
      },
      {
        controls: [point(-0.08, 0.88), point(0.28, 0.94), point(0.7, 0.78), point(1.08, 0.86)],
        width: size * 0.052,
        color: colors.light,
      },
    ],
    [
      {
        controls: [point(-0.08, 0.63), point(0.12, 0.6), point(0.3, 0.52), point(0.43, 0.48)],
        width: size * 0.17,
        color: colors.dominant,
      },
      {
        controls: [point(0.4, 0.49), point(0.58, 0.44), point(0.72, 0.18), point(1.08, 0.04)],
        width: size * 0.09,
        color: colors.support,
      },
      {
        controls: [point(0.4, 0.49), point(0.62, 0.5), point(0.8, 0.48), point(1.08, 0.58)],
        width: size * 0.075,
        color: colors.ink,
      },
      {
        controls: [point(0.4, 0.49), point(0.58, 0.58), point(0.78, 0.82), point(1.08, 0.94)],
        width: size * 0.06,
        color: colors.light,
      },
    ],
    [
      {
        controls: [point(-0.08, 0.22), point(0.28, 0.18), point(0.5, 0.78), point(1.08, 0.7)],
        width: size * 0.105,
        color: colors.dominant,
      },
      {
        controls: [point(-0.08, 0.5), point(0.24, 0.66), point(0.64, 0.08), point(1.08, 0.34)],
        width: size * 0.085,
        color: colors.support,
      },
      {
        controls: [point(-0.08, 0.8), point(0.34, 0.88), point(0.58, 0.3), point(1.08, 0.56)],
        width: size * 0.068,
        color: colors.ink,
      },
    ],
    [
      {
        controls: [point(-0.08, 0.26), point(0.28, 0.16), point(0.58, 0.36), point(1.08, 0.22)],
        width: size * 0.115,
        color: colors.support,
      },
      {
        controls: [point(0.48, 0.76), point(0.28, 0.48), point(0.7, 0.36), point(0.84, 0.7)],
        width: size * 0.09,
        color: colors.dominant,
      },
      {
        controls: [point(0.83, 0.7), point(0.96, 0.96), point(0.48, 1.02), point(0.4, 0.72)],
        width: size * 0.056,
        color: colors.ink,
      },
    ],
    [
      {
        controls: [point(-0.08, 0.7), point(0.22, 0.66), point(0.68, 0.3), point(1.08, 0.38)],
        width: size * 0.17,
        color: colors.dominant,
      },
      {
        controls: [point(0.18, 0.66), point(0.34, 0.4), point(0.62, 0.18), point(0.84, 0.34)],
        width: size * 0.07,
        color: colors.support,
      },
      {
        controls: [point(0.18, 0.68), point(0.38, 0.84), point(0.66, 0.68), point(0.84, 0.36)],
        width: size * 0.062,
        color: colors.ink,
      },
    ],
  ]
  const currents = baseSpecs[mode].map((spec, index) => {
    const staticPoints = influencedCubic(
      options,
      spec.controls,
      index,
      `look.stream.mode.${mode}.current.${index}`,
      index === 0 ? 0.06 : 0.045,
    )
    const points = animateCurrent(staticPoints, index)
    paintCurrent(points, spec.width, spec.color, index)
    return points
  })

  // The source controls one long, in-current event rather than a bridge or
  // crossbar laid over the water.
  let sourceEvent: { path: InfluencedPoint[]; index: number; score: number } | null = null
  currents.forEach((current) => {
    current.forEach((currentPoint, index) => {
      if (index < 5 || index > current.length - 6) return
      const field = influenceVector(options, currentPoint.x, currentPoint.y, size * 0.024)
      const score = field.edge + currentPoint.influence * 0.12
      if (!sourceEvent || score > sourceEvent.score) {
        sourceEvent = { path: current, index, score }
      }
    })
  })
  if (sourceEvent) {
    const event = sourceEvent as { path: InfluencedPoint[]; index: number; score: number }
    const eventPath = event.path.slice(
      Math.max(0, event.index - 5),
      Math.min(event.path.length, event.index + 6),
    )
    context.strokeStyle = alpha(colors.accent, 0.92)
    context.lineWidth = Math.max(1.4, size * 0.009)
    context.stroke(pathFrom(eventPath))
  }

  if (level >= 1) {
    const tributarySets: readonly StreamSpec[][] = [
      [
        { controls: [point(-0.08, 0.52), point(0.24, 0.42), point(0.64, 0.54), point(1.08, 0.5)], width: size * 0.045, color: colors.light },
        { controls: [point(-0.08, 0.94), point(0.32, 0.9), point(0.72, 1.02), point(1.08, 0.92)], width: size * 0.034, color: colors.support },
      ],
      [
        { controls: [point(0.08, -0.08), point(0.14, 0.22), point(0.28, 0.4), point(0.42, 0.48)], width: size * 0.045, color: colors.ink },
        { controls: [point(0.18, 1.08), point(0.24, 0.84), point(0.32, 0.66), point(0.43, 0.5)], width: size * 0.038, color: colors.support },
      ],
      [
        { controls: [point(0.12, -0.08), point(0.18, 0.24), point(0.38, 0.48), point(0.58, 0.52)], width: size * 0.045, color: colors.light },
        { controls: [point(0.82, 1.08), point(0.74, 0.84), point(0.7, 0.66), point(0.78, 0.5)], width: size * 0.034, color: colors.support },
      ],
      [
        { controls: [point(0.32, 1.08), point(0.26, 0.86), point(0.38, 0.7), point(0.52, 0.7)], width: size * 0.046, color: colors.light },
        { controls: [point(1.08, 0.9), point(0.9, 0.82), point(0.76, 0.76), point(0.83, 0.7)], width: size * 0.032, color: colors.ink },
      ],
      [
        { controls: [point(0.06, -0.08), point(0.12, 0.26), point(0.22, 0.48), point(0.3, 0.58)], width: size * 0.042, color: colors.light },
        { controls: [point(0.64, 1.08), point(0.68, 0.82), point(0.76, 0.58), point(0.84, 0.36)], width: size * 0.035, color: colors.support },
      ],
    ]
    tributarySets[mode].forEach((spec, index) => {
      const staticPoints = influencedCubic(
        options,
        spec.controls,
        index + 20,
        `look.stream.mode.${mode}.tributary.${index}`,
        0.052,
      )
      const points = animateCurrent(staticPoints, index + 20, 0.86)
      paintCurrent(points, spec.width, spec.color, index + 20, 0.8)
    })
  }

  if (level >= 2) {
    const patches = [
      {
        path: currents[0],
        progress: [0.74, 0.3, 0.62, 0.24, 0.68][mode],
      },
      {
        path: currents[Math.min(2, currents.length - 1)],
        progress: [0.26, 0.72, 0.28, 0.76, 0.38][mode],
      },
    ]
    patches.forEach((patch, patchIndex) => {
      const center = Math.floor(patch.path.length * patch.progress)
      const section = patch.path.slice(
        Math.max(0, center - 15),
        Math.min(patch.path.length, center + 16),
      )
      for (let band = -3; band <= 3; band += 1) {
        if (band === 0) continue
        const wake = offsetInfluencedPath(
          section,
          (_current, progress) =>
            Math.sin(progress * Math.PI) * band * size * 0.0065,
        )
        context.strokeStyle = alpha(
          band % 2 === 0 ? colors.light : patchIndex === 0 ? colors.ink : colors.support,
          0.28 + (3 - Math.abs(band)) * 0.08,
        )
        context.globalAlpha = 1
        context.lineWidth = Math.max(0.8, size * (Math.abs(band) === 1 ? 0.003 : 0.0017))
        context.stroke(pathFrom(wake))
      }
    })
  }
  context.globalAlpha = 1
  context.setLineDash([])
  context.restore()
}

function drawBead(
  context: CanvasRenderingContext2D,
  options: BackgroundLookOptions,
  colors: DirectedColors,
  point: InfluencedPoint,
  radius: number,
  id: number,
  detail: boolean,
  baseColor?: string,
): void {
  const base = baseColor
    ?? structuralColor(options, colors, chan(options.seed, id, 'look.bead.color'))
  const color = sourceDirectedColor(options, point.x, point.y, base, point.influence)
  const shape = Math.abs(id) % (detail ? 9 : 7)
  const rotation = (chan(options.seed, id, 'look.bead.rotation') - 0.5) * 1.2
  const appendShape = (offsetX: number, offsetY: number, scale = 1) => {
    if (shape <= 3) {
      context.arc(point.x + offsetX, point.y + offsetY, radius * scale, 0, TAU)
      return
    }
    if (shape === 4 || shape === 5) {
      context.ellipse(
        point.x + offsetX,
        point.y + offsetY,
        radius * (shape === 4 ? 1.48 : 1.9) * scale,
        radius * (shape === 4 ? 0.76 : 0.62) * scale,
        rotation,
        0,
        TAU,
      )
      return
    }
    const dx = Math.cos(rotation) * radius * 0.48
    const dy = Math.sin(rotation) * radius * 0.48
    context.arc(point.x + offsetX - dx, point.y + offsetY - dy, radius * 0.86 * scale, 0, TAU)
    context.arc(point.x + offsetX + dx, point.y + offsetY + dy, radius * 0.86 * scale, 0, TAU)
  }
  context.fillStyle = alpha(colors.dark, detail ? 0.18 : 0.28)
  context.beginPath()
  appendShape(radius * 0.15, radius * 0.22, 1.04)
  context.fill()
  context.fillStyle = color
  context.globalAlpha = detail ? 0.72 : 0.96
  context.beginPath()
  appendShape(0, 0)
  context.fill()
  context.fillStyle = alpha(colors.light, 0.74)
  context.globalAlpha = 1
  context.beginPath()
  context.arc(point.x - radius * 0.28, point.y - radius * 0.31, Math.max(0.55, radius * 0.14), 0, TAU)
  context.fill()
}

type BeadChainStyle = {
  detail: boolean
  scale: number
  gapModulo: number
  gapLength: number
  heroEvery: number
  color: string
  cord: string
}

function beadChain(
  context: CanvasRenderingContext2D,
  options: BackgroundLookOptions,
  colors: DirectedColors,
  controls: readonly [Point, Point, Point, Point],
  idOffset: number,
  style: BeadChainStyle,
): InfluencedPoint[] {
  const size = Math.min(options.width, options.height)
  const motion = clamp01(options.motionAmount)
  const energy = clamp01(options.motionEnergy)
  const spacing = size * (style.detail ? 0.04 : 0.052)
  const estimate = Math.hypot(
    controls[3].x - controls[0].x,
    controls[3].y - controls[0].y,
  ) * 1.25
  const count = Math.max(8, Math.ceil(estimate / spacing))
  const points: InfluencedPoint[] = []
  for (let index = 0; index <= count; index += 1) {
    const progress = index / count
    const migration = (index + idOffset) % 5 === 1 || (index + idOffset) % 11 === 4
      ? harmonicMotion(options, idOffset + index, 'look.bead.migration')
        * motion
        * (0.018 + energy * 0.008)
      : 0
    const clusteredProgress = clamp01(
      progress
      + Math.sin(progress * TAU * 2.15 + idOffset * 0.0017) * 0.022
      + migration
    )
    const base = cubicPoint(
      controls[0],
      controls[1],
      controls[2],
      controls[3],
      clusteredProgress,
    )
    const influence = softInfluence(options, base.x, base.y, spacing * 0.75)
    const field = influenceVector(options, base.x, base.y, spacing * 0.65)
    const point = {
      x: base.x + field.x * field.edge * size * (style.detail ? 0.014 : 0.026),
      y: base.y
        + field.y * field.edge * size * (style.detail ? 0.014 : 0.026)
        + (influence - 0.22) * size * (style.detail ? 0.012 : 0.024),
      influence,
    }
    points.push(point)
  }
  const normalAmplitude = size * (0.018 + energy * 0.008) * motion
  points.forEach((current, index) => {
    const frame = pathFrame(points, index)
    const section = Math.floor(index / 8)
    const shift = harmonicMotion(
      options,
      idOffset + section,
      'look.bead.chain-normal',
    ) * normalAmplitude
    current.x += frame.normalX * shift
    current.y += frame.normalY * shift
  })
  if (!style.detail) {
    context.fillStyle = alpha(style.color, 0.27)
    context.globalAlpha = 1
    context.fill(variableRibbonPath(points, (current, progress) => {
      const firstClump = Math.exp(-(((progress - 0.28) / 0.18) ** 2))
      const secondClump = Math.exp(-(((progress - 0.72) / 0.14) ** 2))
      return size
        * style.scale
        * (0.022 + firstClump * 0.072 + secondClump * 0.052 + current.influence * 0.026)
    }))
  }
  context.strokeStyle = alpha(colors.dark, style.detail ? 0.34 : 0.5)
  context.lineWidth = Math.max(1, size * (style.detail ? 0.004 : 0.0065) * style.scale)
  context.stroke(pathFrom(points))
  context.strokeStyle = alpha(style.cord, style.detail ? 0.52 : 0.78)
  context.lineWidth = Math.max(0.7, size * (style.detail ? 0.0014 : 0.0025) * style.scale)
  context.stroke(pathFrom(points))
  for (let index = 0; index <= count; index += 1) {
    const point = points[index]
    const gapPosition = (index + idOffset) % style.gapModulo
    if (gapPosition >= style.gapModulo - style.gapLength) continue
    const edgeScale = (
      point.x < options.width * 0.2
      || point.x > options.width * 0.8
      || point.y < options.height * 0.14
      || point.y > options.height * 0.86
    ) ? 1.48 : 1
    const clumpScale = 1
      + Math.exp(-(((index / count - 0.28) / 0.17) ** 2)) * 0.58
      + Math.exp(-(((index / count - 0.72) / 0.12) ** 2)) * 0.38
    const heroScale = index % style.heroEvery === 0 ? 1.34 : 1
    const radius = size
      * (style.detail ? 0.008 : 0.014)
      * (0.82 + chan(options.seed, idOffset + index, 'look.bead.size') * 0.34)
      * (1 + point.influence * 0.28)
      * edgeScale
      * clumpScale
      * heroScale
      * style.scale
    drawBead(
      context,
      options,
      colors,
      point,
      radius,
      idOffset + index,
      style.detail,
      style.color,
    )
  }
  return points
}

function drawBeads(
  context: CanvasRenderingContext2D,
  options: BackgroundLookOptions,
  colors: DirectedColors,
): void {
  const { width, height, seed } = options
  const size = Math.min(width, height)
  const level = tier(options.complexity)
  const archetype = seededArchetype(seed, 0xb7e15162)
  const portrait = height > width * 1.08
  const square = !portrait && width < height * 1.22
  const mirror = chan(seed, 1, 'look.bead.mirror') < 0.5
  const point = (u: number, v: number): Point => {
    const cross = mirror ? 1 - v : v
    if (portrait) return { x: width * cross, y: height * u }
    if (square) {
      return {
        x: width * (u * 0.92 + 0.04),
        y: height * (cross * 0.9 + (u - 0.5) * 0.08 + 0.05),
      }
    }
    return { x: width * u, y: height * cross }
  }
  const lightAnchor = [
    point(0.82, 0.18),
    point(0.18, 0.76),
    point(0.72, 0.78),
  ][archetype]
  const beadGround = mixColor(colors.ground, colors.accent, 0.34)
  const ground = context.createRadialGradient(
    lightAnchor.x,
    lightAnchor.y,
    size * 0.03,
    lightAnchor.x,
    lightAnchor.y,
    Math.max(width, height) * 0.82,
  )
  ground.addColorStop(0, mixColor(beadGround, colors.light, 0.22))
  ground.addColorStop(0.46, beadGround)
  ground.addColorStop(1, mixColor(beadGround, colors.dark, 0.32))
  context.fillStyle = ground
  context.fillRect(0, 0, width, height)
  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'

  type ChainSpec = {
    controls: readonly [Point, Point, Point, Point]
    scale: number
    gapModulo: number
    gapLength: number
    heroEvery: number
    color: string
  }
  const chainSets: readonly ChainSpec[][] = [
    [
      { controls: [point(-0.1, 0.72), point(0.18, 0.48), point(0.46, 0.82), point(0.9, 0.58)], scale: 1.24, gapModulo: 17, gapLength: 3, heroEvery: 7, color: colors.dominant },
      { controls: [point(-0.1, 0.84), point(0.2, 0.58), point(0.5, 0.9), point(0.76, 0.64)], scale: 0.98, gapModulo: 13, gapLength: 3, heroEvery: 9, color: colors.support },
      { controls: [point(0.08, 1.08), point(0.14, 0.76), point(0.48, 0.56), point(0.72, 0.34)], scale: 0.78, gapModulo: 11, gapLength: 4, heroEvery: 11, color: colors.ink },
    ],
    [
      { controls: [point(-0.08, 0.22), point(0.34, 0.08), point(0.62, 0.38), point(1.1, 0.26)], scale: 1.18, gapModulo: 18, gapLength: 3, heroEvery: 7, color: colors.support },
      { controls: [point(0.08, -0.08), point(0.32, 0.16), point(0.66, 0.46), point(1.1, 0.4)], scale: 1.02, gapModulo: 14, gapLength: 3, heroEvery: 8, color: colors.dominant },
      { controls: [point(0.42, -0.08), point(0.46, 0.24), point(0.76, 0.32), point(1.1, 0.18)], scale: 0.72, gapModulo: 10, gapLength: 4, heroEvery: 11, color: colors.ink },
    ],
    [
      { controls: [point(-0.08, 0.1), point(0.3, 0.22), point(0.48, 0.66), point(0.72, 1.08)], scale: 1.22, gapModulo: 16, gapLength: 3, heroEvery: 7, color: colors.dominant },
      { controls: [point(-0.08, 0.34), point(0.28, 0.3), point(0.52, 0.72), point(0.92, 1.08)], scale: 0.96, gapModulo: 13, gapLength: 4, heroEvery: 9, color: colors.ink },
      { controls: [point(0.24, -0.08), point(0.2, 0.34), point(0.4, 0.54), point(0.72, 0.82)], scale: 0.76, gapModulo: 11, gapLength: 3, heroEvery: 10, color: colors.support },
    ],
  ]
  const chains = chainSets[archetype].map((spec, index) => beadChain(
    context,
    options,
    colors,
    spec.controls,
    index * 4000,
    {
      detail: false,
      scale: spec.scale,
      gapModulo: spec.gapModulo,
      gapLength: spec.gapLength,
      heroEvery: spec.heroEvery,
      color: spec.color,
      cord: index === 0 ? colors.light : index === 1 ? colors.dark : colors.support,
    },
  ))

  const drawKnot = (
    points: readonly InfluencedPoint[],
    progress: number,
    idOffset: number,
    count: number,
    scale: number,
    accentEvent = false,
  ) => {
    const pointIndex = Math.max(1, Math.min(
      points.length - 2,
      Math.floor(points.length * progress),
    ))
    const anchor = points[pointIndex]
    if (!anchor) return
    const frame = pathFrame(points, pointIndex)
    for (let index = 0; index < count; index += 1) {
      const along = (chan(seed, idOffset + index, 'look.bead.knot.along') - 0.5)
        * size
        * 0.2
        * scale
      const across = (chan(seed, idOffset + index, 'look.bead.knot.across') - 0.5)
        * size
        * 0.11
        * scale
      drawBead(
        context,
        options,
        colors,
        {
          x: anchor.x + frame.tangentX * along + frame.normalX * across,
          y: anchor.y + frame.tangentY * along + frame.normalY * across,
          influence: anchor.influence,
        },
        size * (0.009 + (index % 6 === 0 ? 0.007 : 0)) * scale,
        idOffset + index,
        index % 4 !== 0,
        accentEvent && index < 2
          ? colors.accent
          : index % 4 === 0 ? colors.support : colors.dominant,
      )
    }
  }

  const knotProgress = archetype === 0 ? 0.12 : archetype === 1 ? 0.88 : 0.86
  drawKnot(chains[0], knotProgress, 12_000, level >= 1 ? 30 : 24, 1.26, true)

  if (level >= 1) {
    const secondaryControls: readonly (readonly [Point, Point, Point, Point])[] = archetype === 0
      ? [
          [point(0.18, 0.58), point(0.38, 0.5), point(0.6, 0.76), point(0.82, 0.68)],
          [point(-0.04, 0.9), point(0.16, 0.72), point(0.34, 0.8), point(0.46, 0.66)],
        ]
      : archetype === 1
        ? [
            [point(0.2, 0.06), point(0.42, 0.18), point(0.68, 0.32), point(0.92, 0.28)],
            [point(0.58, -0.06), point(0.62, 0.18), point(0.84, 0.24), point(1.04, 0.14)],
          ]
        : [
            [point(0.08, 0.18), point(0.3, 0.3), point(0.42, 0.6), point(0.62, 0.88)],
            [point(-0.05, 0.42), point(0.22, 0.36), point(0.46, 0.7), point(0.74, 1.02)],
          ]
    secondaryControls.forEach((controls, index) => beadChain(
      context,
      options,
      colors,
      controls,
      20_000 + index * 3000,
      {
        detail: false,
        scale: index === 0 ? 0.72 : 0.6,
        gapModulo: 13 + index * 3,
        gapLength: 3,
        heroEvery: 10,
        color: index === 0 ? colors.support : colors.ink,
        cord: index === 0 ? colors.light : colors.dark,
      },
    ))
    drawKnot(chains[1], archetype === 2 ? 0.24 : 0.68, 31_000, 12, 0.72)
  }

  if (level >= 2) {
    const detailAnchor = chains[0]
    const start = archetype === 1 ? 0.12 : 0.55
    const first = detailAnchor[Math.floor(detailAnchor.length * start)]
    const last = detailAnchor[Math.floor(detailAnchor.length * Math.min(0.94, start + 0.28))]
    if (first && last) beadChain(context, options, colors, [
      first,
      {
        x: first.x + (last.x - first.x) * 0.28 + size * 0.06,
        y: first.y + (last.y - first.y) * 0.24 - size * 0.08,
      },
      {
        x: first.x + (last.x - first.x) * 0.72 - size * 0.04,
        y: first.y + (last.y - first.y) * 0.76 + size * 0.07,
      },
      last,
    ], 40_000, {
      detail: true,
      scale: 0.72,
      gapModulo: 10,
      gapLength: 3,
      heroEvery: 8,
      color: colors.light,
      cord: colors.ink,
    })
    const knotPath = chains[0]
    const knotIndex = Math.floor(knotPath.length * knotProgress)
    const knot = knotPath[knotIndex]
    const frame = knot ? pathFrame(knotPath, knotIndex) : null
    if (knot && frame) {
      for (let tail = 0; tail < 3; tail += 1) {
        const spread = (tail - 1) * size * 0.022
        beadChain(context, options, colors, [
          knot,
          {
            x: knot.x + frame.tangentX * size * 0.05 + frame.normalX * spread,
            y: knot.y + frame.tangentY * size * 0.05 + frame.normalY * spread,
          },
          {
            x: knot.x + frame.tangentX * size * 0.13 + frame.normalX * spread * 1.5,
            y: knot.y + frame.tangentY * size * 0.13 + frame.normalY * spread * 1.5,
          },
          {
            x: knot.x + frame.tangentX * size * 0.2 + frame.normalX * spread * 2,
            y: knot.y + frame.tangentY * size * 0.2 + frame.normalY * spread * 2,
          },
        ], 50_000 + tail * 1000, {
          detail: true,
          scale: 0.46,
          gapModulo: 9,
          gapLength: 2,
          heroEvery: 8,
          color: tail === 1 ? colors.support : colors.light,
          cord: colors.support,
        })
      }
    }
  }
  context.globalAlpha = 1
  context.restore()
}

function drawQuilt(
  context: CanvasRenderingContext2D,
  options: BackgroundLookOptions,
  colors: DirectedColors,
): void {
  const { width, height, seed } = options
  const size = Math.min(width, height)
  const level = tier(options.complexity)
  const motion = clamp01(options.motionAmount)
  const energy = clamp01(options.motionEnergy)
  const archetype = seededArchetype(seed, 0x3c6ef372)
  const portrait = height > width * 1.08
  const square = !portrait && width < height * 1.22
  const mirror = chan(seed, 1, 'look.quilt.mirror') < 0.5
  const point = (u: number, v: number): Point => {
    const cross = mirror ? 1 - v : v
    if (portrait) {
      return {
        x: width * cross,
        y: height * u,
      }
    }
    if (square) {
      return {
        x: width * (u * 0.94 + 0.03),
        y: height * (cross * 0.92 + (u - 0.5) * 0.06 + 0.04),
      }
    }
    return { x: width * u, y: height * cross }
  }
  const vertexCache = new Map<string, Point>()
  const warpPoint = (base: Point, _id: number): Point => {
    void _id
    const key = `${base.x.toFixed(3)}:${base.y.toFixed(3)}`
    const cached = vertexCache.get(key)
    if (cached) return cached
    const influence = softInfluence(options, base.x, base.y, size * 0.075)
    const field = influenceVector(options, base.x, base.y, size * 0.03)
    const grainX = regionValue(seed, base.x, base.y, size * 0.26, 'look.quilt.vertex.x') - 0.5
    const grainY = regionValue(seed, base.x + size * 0.19, base.y, size * 0.3, 'look.quilt.vertex.y') - 0.5
    const u = base.x / Math.max(1, width)
    const v = base.y / Math.max(1, height)
    const clothA = harmonicMotion(options, 0, 'look.quilt.cloth')
    const clothB = harmonicMotion(options, 1, 'look.quilt.cloth', Math.PI * 0.5)
    const amplitude = size * (0.01 + energy * 0.006) * motion
    const warped = {
      x: base.x
        + field.x * field.edge * size * 0.038
        + (influence - 0.2) * size * 0.006
        + grainX * size * 0.018
        + (Math.sin(v * Math.PI) * clothA + Math.cos(u * Math.PI) * clothB * 0.42) * amplitude,
      y: base.y
        + field.y * field.edge * size * 0.038
        - (influence - 0.2) * size * 0.004
        + grainY * size * 0.018
        + (Math.sin(u * Math.PI) * clothB - Math.cos(v * Math.PI) * clothA * 0.38) * amplitude,
    }
    vertexCache.set(key, warped)
    return warped
  }

  const quiltGround = mixColor(colors.dominant, colors.ground, 0.46)
  const ground = context.createLinearGradient(
    archetype === 1 ? width : 0,
    portrait ? 0 : height,
    archetype === 1 ? 0 : width,
    portrait ? height : 0,
  )
  ground.addColorStop(0, mixColor(quiltGround, colors.dark, 0.24))
  ground.addColorStop(0.58, quiltGround)
  ground.addColorStop(1, mixColor(quiltGround, colors.support, 0.32))
  context.fillStyle = ground
  context.fillRect(0, 0, width, height)
  context.save()
  context.lineJoin = 'round'

  type PatchSpec = {
    points: readonly [number, number][]
    role: 'dominant' | 'support' | 'ink' | 'ground' | 'accent'
  }
  const patchSets: readonly PatchSpec[][] = [
    [
      { points: [[-0.08, -0.08], [0.42, -0.08], [0.28, 0.36], [-0.08, 0.54]], role: 'dominant' },
      { points: [[0.4, -0.08], [1.08, -0.08], [1.08, 0.2], [0.62, 0.43], [0.27, 0.36]], role: 'support' },
      { points: [[-0.08, 0.52], [0.28, 0.35], [0.53, 0.62], [0.18, 0.84], [-0.08, 0.76]], role: 'ink' },
      { points: [[0.28, 0.35], [0.62, 0.42], [0.75, 0.72], [0.52, 0.63]], role: 'ground' },
      { points: [[0.62, 0.42], [1.08, 0.2], [1.08, 0.67], [0.74, 0.73]], role: 'dominant' },
      { points: [[-0.08, 0.74], [0.18, 0.83], [0.36, 1.08], [-0.08, 1.08]], role: 'support' },
      { points: [[0.18, 0.83], [0.52, 0.62], [0.76, 0.72], [0.65, 1.08], [0.36, 1.08]], role: 'dominant' },
      { points: [[0.75, 0.71], [1.08, 0.66], [1.08, 1.08], [0.64, 1.08]], role: 'ink' },
    ],
    [
      { points: [[-0.08, -0.08], [0.58, -0.08], [0.49, 0.28], [-0.08, 0.36]], role: 'support' },
      { points: [[0.56, -0.08], [1.08, -0.08], [1.08, 0.46], [0.75, 0.39], [0.48, 0.28]], role: 'dominant' },
      { points: [[-0.08, 0.34], [0.5, 0.27], [0.64, 0.57], [0.2, 0.68], [-0.08, 0.6]], role: 'ink' },
      { points: [[0.49, 0.27], [0.75, 0.39], [0.64, 0.57]], role: 'ground' },
      { points: [[0.75, 0.39], [1.08, 0.45], [1.08, 0.77], [0.62, 0.72], [0.64, 0.57]], role: 'support' },
      { points: [[-0.08, 0.59], [0.2, 0.67], [0.36, 1.08], [-0.08, 1.08]], role: 'dominant' },
      { points: [[0.2, 0.67], [0.63, 0.56], [0.61, 0.73], [0.82, 1.08], [0.35, 1.08]], role: 'support' },
      { points: [[0.61, 0.72], [1.08, 0.76], [1.08, 1.08], [0.81, 1.08]], role: 'ink' },
    ],
    [
      { points: [[-0.08, -0.08], [0.34, -0.08], [0.43, 0.34], [-0.08, 0.22]], role: 'ink' },
      { points: [[0.33, -0.08], [0.8, -0.08], [0.68, 0.34], [0.43, 0.34]], role: 'dominant' },
      { points: [[0.79, -0.08], [1.08, -0.08], [1.08, 0.54], [0.68, 0.34]], role: 'support' },
      { points: [[-0.08, 0.21], [0.43, 0.33], [0.31, 0.72], [-0.08, 0.82]], role: 'support' },
      { points: [[0.43, 0.33], [0.68, 0.33], [0.82, 0.68], [0.54, 0.81], [0.31, 0.72]], role: 'ground' },
      { points: [[0.68, 0.33], [1.08, 0.53], [1.08, 0.9], [0.82, 0.68]], role: 'dominant' },
      { points: [[-0.08, 0.81], [0.31, 0.71], [0.54, 0.8], [0.46, 1.08], [-0.08, 1.08]], role: 'dominant' },
      { points: [[0.54, 0.8], [0.82, 0.67], [1.08, 0.89], [1.08, 1.08], [0.45, 1.08]], role: 'support' },
    ],
  ]
  const roleColor = (role: PatchSpec['role']) => {
    if (role === 'dominant') return colors.dominant
    if (role === 'support') return colors.support
    if (role === 'ink') return colors.ink
    if (role === 'accent') return colors.accent
    return mixColor(quiltGround, colors.dark, 0.34)
  }
  patchSets[archetype].forEach((spec, patchIndex) => {
    const points = spec.points.map(([u, v], vertexIndex) =>
      warpPoint(point(u, v), patchIndex * 16 + vertexIndex))
    const center = {
      x: points.reduce((sum, current) => sum + current.x, 0) / points.length,
      y: points.reduce((sum, current) => sum + current.y, 0) / points.length,
    }
    const influence = softInfluence(options, center.x, center.y, size * 0.09)
    const color = sourceDirectedColor(
      options,
      center.x,
      center.y,
      roleColor(spec.role),
      influence,
    )
    context.fillStyle = color
    context.fill(polygonPath(points))
    const wash = patchIndex % 3 === 0 ? colors.light : colors.dark
    context.fillStyle = alpha(wash, patchIndex % 3 === 0 ? 0.09 : 0.07)
    context.fill(polygonPath([
      points[0],
      points[Math.floor(points.length / 2)],
      points.at(-1)!,
    ]))
  })

  const foldControlSets: readonly (readonly [Point, Point, Point, Point])[] = [
    [point(-0.08, 0.56), point(0.3, 0.32), point(0.66, 0.7), point(1.08, 0.42)],
    [point(0.18, -0.08), point(0.34, 0.3), point(0.7, 0.54), point(0.82, 1.08)],
    [point(-0.08, 0.28), point(0.34, 0.5), point(0.66, 0.34), point(1.08, 0.72)],
  ]
  const foldControls = foldControlSets[archetype]
  const foldBase = influencedCubic(
    options,
    foldControls,
    830,
    `look.quilt.fold.${archetype}`,
    0.12,
    144,
  )
  const foldPath = foldBase.map((current, index) => ({
    ...warpPoint(current, 1_300 + index),
    influence: current.influence,
  }))
  const foldMiddle = foldPath[Math.floor(foldPath.length / 2)]
  const foldColor = sourceDirectedColor(
    options,
    foldMiddle.x,
    foldMiddle.y,
    archetype === 1 ? colors.ink : colors.support,
    foldMiddle.influence,
  )
  context.fillStyle = alpha(colors.dark, 0.48)
  context.fill(variableRibbonPath(
    foldPath,
    (current) => size * (0.062 + current.influence * 0.03),
  ))
  context.fillStyle = alpha(foldColor, 0.8)
  context.fill(variableRibbonPath(
    foldPath,
    (current) => size * (0.038 + current.influence * 0.02),
  ))
  for (const side of [-1, 1]) {
    const ridge = offsetInfluencedPath(
      foldPath,
      (current, progress) =>
        side * size * (0.02 + current.influence * 0.008) * Math.sin(progress * Math.PI),
    )
    context.strokeStyle = alpha(side < 0 ? colors.light : colors.dark, side < 0 ? 0.54 : 0.42)
    context.lineWidth = Math.max(0.8, size * (side < 0 ? 0.0024 : 0.0036))
    context.stroke(pathFrom(ridge))
  }
  for (let fiber = 1; fiber < 18; fiber += 1) {
    const centerIndex = Math.floor(fiber / 18 * (foldPath.length - 1))
    const startIndex = Math.max(0, centerIndex - 2 - fiber % 3)
    const endIndex = Math.min(foldPath.length, centerIndex + 3 + fiber % 4)
    const grain = offsetInfluencedPath(
      foldPath.slice(startIndex, endIndex),
      () => (fiber % 2 === 0 ? -1 : 1) * size * (0.004 + fiber % 4 * 0.0015),
    )
    context.strokeStyle = alpha(fiber % 4 === 0 ? colors.ink : colors.light, 0.38)
    context.lineWidth = Math.max(0.6, size * 0.0014)
    context.stroke(pathFrom(grain))
  }

  const driftPatchSets: readonly (readonly [number, number][])[][] = [
    [
      [[-0.04, 0.57], [0.23, 0.45], [0.39, 0.55], [0.14, 0.7]],
      [[0.36, 0.08], [0.77, -0.03], [0.66, 0.18], [0.31, 0.27]],
      [[0.52, 0.75], [0.82, 0.68], [1.04, 0.82], [0.7, 0.9]],
      [[0.05, 0.88], [0.3, 0.79], [0.44, 1.04], [0.18, 1.04]],
    ],
    [
      [[-0.04, 0.12], [0.35, 0.02], [0.28, 0.2], [-0.04, 0.28]],
      [[0.2, 0.48], [0.52, 0.38], [0.59, 0.53], [0.28, 0.62]],
      [[0.66, 0.46], [1.04, 0.53], [1.04, 0.67], [0.62, 0.61]],
      [[0.34, 0.78], [0.67, 0.71], [0.77, 0.94], [0.45, 1.04]],
    ],
    [
      [[0.02, 0.28], [0.32, 0.34], [0.25, 0.5], [-0.04, 0.45]],
      [[0.35, -0.03], [0.62, -0.03], [0.57, 0.23], [0.39, 0.26]],
      [[0.66, 0.42], [1.04, 0.58], [0.94, 0.71], [0.7, 0.6]],
      [[0.12, 0.78], [0.45, 0.72], [0.56, 0.87], [0.27, 0.98]],
    ],
  ]
  driftPatchSets[archetype].forEach((patch, index) => {
    const points = patch.map(([u, v], vertexIndex) =>
      warpPoint(point(u, v), 300 + index * 10 + vertexIndex))
    context.fillStyle = alpha(
      index === 1 ? colors.light : index === 2 ? colors.ink : colors.support,
      index === 1 ? 0.19 : 0.3,
    )
    context.fill(polygonPath(points))
  })

  const seamSets: readonly (readonly [number, number][])[][] = [
    [
      [[-0.05, 0.53], [0.28, 0.36], [0.62, 0.42], [1.05, 0.2]],
      [[0.18, 0.83], [0.52, 0.62], [0.75, 0.72], [1.05, 0.66]],
      [[0.4, -0.05], [0.28, 0.36], [0.52, 0.62], [0.65, 1.05]],
    ],
    [
      [[-0.05, 0.35], [0.5, 0.28], [0.75, 0.4], [1.05, 0.46]],
      [[-0.05, 0.6], [0.2, 0.68], [0.63, 0.57], [1.05, 0.77]],
      [[0.57, -0.05], [0.49, 0.28], [0.64, 0.57], [0.61, 0.73], [0.82, 1.05]],
    ],
    [
      [[-0.05, 0.22], [0.43, 0.34], [0.68, 0.34], [1.05, 0.54]],
      [[-0.05, 0.82], [0.31, 0.72], [0.54, 0.81], [0.82, 0.68], [1.05, 0.9]],
      [[0.34, -0.05], [0.43, 0.34], [0.31, 0.72], [0.46, 1.05]],
    ],
  ]
  seamSets[archetype].forEach((seam, seamIndex) => {
    const points = seam.map(([u, v], index) =>
      warpPoint(point(u, v), 500 + seamIndex * 12 + index))
    const gapStart = Math.floor(points.length * (seamIndex === 1 ? 0.45 : 0.25))
    const segments = [points.slice(0, gapStart + 1), points.slice(gapStart + 1)]
    segments.forEach((segment, segmentIndex) => {
      if (segment.length < 2 || (seamIndex === 2 && segmentIndex === 1)) return
      context.strokeStyle = alpha(colors.dark, 0.64)
      context.lineWidth = Math.max(2, size * 0.009)
      context.stroke(pathFrom(segment))
      context.strokeStyle = alpha(seamIndex === 0 ? colors.light : colors.ground, 0.62)
      context.lineWidth = Math.max(0.8, size * 0.0022)
      context.stroke(pathFrom(segment))
    })
  })

  // Broken seam exposures keep the macro plane active at every crop edge
  // without turning it into a closed frame.
  const edgeSeams: readonly (readonly [number, number][])[] = [
    [[-0.04, 0.08], [0.18, 0.035], [0.42, 0.075]],
    [[0.7, 0.045], [0.88, 0.09], [1.04, 0.055]],
    [[0.96, 0.12], [0.92, 0.3], [0.97, 0.46]],
    [[0.95, 0.7], [0.9, 0.86], [0.97, 1.04]],
    [[0.62, 0.95], [0.42, 0.91], [0.24, 0.97]],
    [[0.14, 0.94], [-0.04, 0.88]],
    [[0.04, 0.72], [0.09, 0.56], [0.035, 0.42]],
    [[0.06, 0.3], [-0.04, 0.18]],
  ]
  edgeSeams.forEach((seam, seamIndex) => {
    const points = seam.map(([u, v], index) =>
      warpPoint(point(u, v), 900 + seamIndex * 8 + index))
    context.strokeStyle = alpha(colors.dark, 0.38)
    context.lineWidth = Math.max(1.4, size * 0.006)
    context.stroke(pathFrom(points))
    context.strokeStyle = alpha(
      seamIndex % 3 === 0 ? colors.accent : colors.light,
      0.5,
    )
    context.lineWidth = Math.max(0.75, size * 0.0022)
    context.stroke(pathFrom(points))
  })

  if (level >= 1) {
    const repairSets: readonly (readonly [number, number][])[][] = [
      [
        [[0.1, 0.43], [0.34, 0.35], [0.36, 0.4], [0.12, 0.49]],
        [[0.64, 0.7], [0.92, 0.66], [0.93, 0.7], [0.66, 0.75]],
        [[0.36, 0.8], [0.55, 0.68], [0.59, 0.73], [0.4, 0.86]],
      ],
      [
        [[0.04, 0.61], [0.31, 0.65], [0.3, 0.7], [0.03, 0.67]],
        [[0.57, 0.32], [0.81, 0.39], [0.79, 0.44], [0.56, 0.38]],
        [[0.4, 0.73], [0.68, 0.69], [0.69, 0.74], [0.42, 0.8]],
      ],
      [
        [[0.18, 0.72], [0.45, 0.75], [0.44, 0.8], [0.17, 0.78]],
        [[0.62, 0.3], [0.88, 0.41], [0.86, 0.46], [0.6, 0.36]],
        [[0.3, 0.26], [0.58, 0.31], [0.57, 0.36], [0.29, 0.32]],
      ],
    ]
    repairSets[archetype].forEach((repair, index) => {
      const points = repair.map(([u, v], vertexIndex) =>
        warpPoint(point(u, v), 700 + index * 10 + vertexIndex))
      const center = points[Math.floor(points.length / 2)]
      const influence = softInfluence(options, center.x, center.y, size * 0.06)
      context.fillStyle = sourceDirectedColor(
        options,
        center.x,
        center.y,
        index === 0 ? colors.accent : index === 1 ? colors.ink : colors.light,
        influence,
      )
      context.globalAlpha = index === 0 ? 0.84 : 0.68
      context.fill(polygonPath(points))
      context.globalAlpha = 1
    })
  }
  if (level >= 2) {
    const wearCenters = [
      [0.18, 0.7],
      [0.3, 0.78],
      [0.24, 0.62],
    ][archetype]
    for (let index = 0; index < 56; index += 1) {
      const center = wearCenters[index % wearCenters.length]
      const progress = clamp01(
        center + (chan(seed, index, 'look.quilt.wear.progress') - 0.5) * 0.2,
      )
      const pointIndex = Math.max(1, Math.min(
        foldPath.length - 2,
        Math.round(progress * (foldPath.length - 1)),
      ))
      const current = foldPath[pointIndex]
      const frame = pathFrame(foldPath, pointIndex)
      const side = index % 2 === 0 ? -1 : 1
      const across = side * size * (
        0.008 + chan(seed, index, 'look.quilt.wear.across') * 0.018
      )
      const start = {
        x: current.x + frame.normalX * across,
        y: current.y + frame.normalY * across,
      }
      const length = size * (0.018 + chan(seed, index, 'look.quilt.wear.length') * 0.055)
      const curl = (chan(seed, index, 'look.quilt.wear.curl') - 0.5) * length * 0.5
      context.beginPath()
      context.moveTo(start.x, start.y)
      context.quadraticCurveTo(
        start.x + frame.tangentX * length * 0.5 + frame.normalX * curl,
        start.y + frame.tangentY * length * 0.5 + frame.normalY * curl,
        start.x + frame.tangentX * length + frame.normalX * curl * 0.35,
        start.y + frame.tangentY * length + frame.normalY * curl * 0.35,
      )
      context.strokeStyle = alpha(sourceDirectedColor(
        options,
        start.x,
        start.y,
        index % 4 === 0 ? colors.ink : colors.light,
        current.influence,
      ), index % 4 === 0 ? 0.62 : 0.46)
      context.lineWidth = Math.max(0.65, size * (index % 5 === 0 ? 0.0028 : 0.0014))
      context.stroke()
    }
  }
  context.globalAlpha = 1
  context.restore()
}

function drawWeave(
  context: CanvasRenderingContext2D,
  options: BackgroundLookOptions,
  colors: DirectedColors,
): void {
  const { width, height, seed } = options
  const size = Math.min(width, height)
  const level = tier(options.complexity)
  const motion = clamp01(options.motionAmount)
  const energy = clamp01(options.motionEnergy)
  const archetype = seededArchetype(seed, 0x510e527f)
  const portrait = height > width * 1.08
  const square = !portrait && width < height * 1.22
  const mirror = chan(seed, 1, 'look.weave.mirror') < 0.5
  const point = (u: number, v: number): Point => {
    const cross = mirror ? 1 - v : v
    if (portrait) return { x: width * cross, y: height * u }
    if (square) {
      return {
        x: width * (u * 0.92 + 0.04),
        y: height * (cross * 0.9 + (u - 0.5) * 0.08 + 0.05),
      }
    }
    return { x: width * u, y: height * cross }
  }
  const clothPoint = (along: number, across: number): Point => {
    let u = along
    let v = across
    if (archetype === 0) {
      u = -0.1 + along * 1.2
      v = 0.76 - along * 0.5 + (across - 0.5) * 0.5
        + Math.sin(along * Math.PI) * (across - 0.5) * 0.12
        + Math.sin(along * TAU * 1.25 + across * 4.2) * 0.035
    } else if (archetype === 1) {
      u = -0.08 + across * 0.72
        + Math.sin(along * Math.PI) * (0.08 + across * 0.05)
        + Math.sin(along * TAU * 1.2 + across * 4.8) * 0.045
      v = -0.1 + along * 1.2
        + Math.sin(across * TAU * 0.85 + along * 2.1) * 0.022
    } else {
      u = -0.1 + along * 1.2
      v = 0.14 + across * 0.5 + along * 0.18
        + Math.sin(along * TAU) * 0.055 * (0.3 + across)
        + Math.sin(along * TAU * 1.45 + across * 3.8) * 0.032
    }
    return point(u, v)
  }
  const steeredClothPoint = (
    along: number,
    across: number,
    _id: number,
  ): InfluencedPoint => {
    void _id
    const base = clothPoint(along, across)
    const influence = softInfluence(options, base.x, base.y, size * 0.045)
    const field = influenceVector(options, base.x, base.y, size * 0.022)
    const clothA = harmonicMotion(
      options,
      Math.round(across * 4),
      'look.weave.cloth-tension',
    )
    const clothB = harmonicMotion(
      options,
      Math.round(along * 4),
      'look.weave.cloth-advection',
      Math.PI * 0.5,
    )
    const amplitude = size * (0.015 + energy * 0.009) * motion
    const tensionX = (
      Math.sin(along * Math.PI) * clothA
      + Math.sin(across * TAU) * clothB * 0.3
    ) * amplitude
    const tensionY = (
      Math.sin(across * Math.PI) * clothB
      - Math.sin(along * TAU) * clothA * 0.28
    ) * amplitude
    return {
      x: base.x
        + field.x * field.edge * size * 0.034
        + tensionX,
      y: base.y
        + field.y * field.edge * size * 0.034
        + tensionY,
      influence,
    }
  }

  const weaveGround = mixColor(colors.light, colors.support, 0.32)
  const ground = context.createLinearGradient(
    portrait ? width : 0,
    portrait ? 0 : height,
    portrait ? 0 : width,
    portrait ? height : 0,
  )
  ground.addColorStop(0, mixColor(weaveGround, colors.ground, 0.24))
  ground.addColorStop(0.58, weaveGround)
  ground.addColorStop(1, mixColor(weaveGround, colors.dark, 0.22))
  context.fillStyle = ground
  context.fillRect(0, 0, width, height)
  const warpPositions = [
    [0.06, 0.14, 0.31, 0.49, 0.57, 0.79, 0.92],
    [0.08, 0.27, 0.35, 0.43, 0.68, 0.86],
    [0.05, 0.12, 0.2, 0.46, 0.69, 0.77, 0.9],
  ][archetype]
  const weftPositions = [
    [0.09, 0.28, 0.36, 0.63, 0.84],
    [0.08, 0.2, 0.47, 0.72, 0.82, 0.93],
    [0.12, 0.34, 0.56, 0.65, 0.88],
  ][archetype]
  const warpCount = warpPositions.length
  const weftCount = weftPositions.length
  const ribbon = size * (portrait ? 0.032 : 0.036)
  const warpThreads = warpPositions.map((across, column) => {
    return Array.from({ length: 81 }, (_unused, index) =>
      steeredClothPoint(index / 80, across, column))
  })
  const weftThreads = weftPositions.map((along, row) => {
    return Array.from({ length: 81 }, (_unused, index) =>
      steeredClothPoint(along, index / 80, 20 + row))
  })
  const paintRibbon = (
    points: readonly InfluencedPoint[],
    color: string,
    widthScale = 1,
    opacity = 0.88,
  ) => {
    const middle = points[Math.floor(points.length / 2)]
    const local = middle
      ? sourceDirectedColor(options, middle.x, middle.y, color, middle.influence)
      : color
    context.strokeStyle = alpha(colors.dark, 0.18)
    context.lineWidth = ribbon * 1.04 * widthScale
    context.stroke(pathFrom(points))
    context.strokeStyle = alpha(local, opacity)
    context.lineWidth = ribbon * 0.9 * widthScale
    context.stroke(pathFrom(points))
    for (const side of [-0.32, -0.16, 0, 0.16, 0.32]) {
      const fiber = offsetInfluencedPath(
        points,
        () => side * ribbon * widthScale,
      )
      context.strokeStyle = alpha(
        side === 0 ? colors.light : side < 0 ? colors.dark : colors.light,
        side === 0 ? 0.34 : 0.24,
      )
      context.lineWidth = Math.max(
        0.5,
        ribbon * (side === 0 ? 0.038 : 0.024) * widthScale,
      )
      context.stroke(pathFrom(fiber))
    }
  }

  context.save()
  context.lineCap = 'butt'
  context.lineJoin = 'round'
  const regionOutline = [
    clothPoint(-0.03, -0.04),
    clothPoint(1.03, -0.04),
    clothPoint(1.03, 1.04),
    clothPoint(-0.03, 1.04),
  ]
  context.save()
  context.clip(polygonPath(regionOutline))
  const droppedWarp = (archetype + 2) % warpCount
  const droppedWeft = (archetype + 1) % weftCount
  const brokenWarp = (archetype + 4) % warpCount
  const brokenWeft = (archetype + 3) % weftCount
  const warpBreak = [0.62, 0.38, 0.54][archetype]
  const weftBreak = [0.34, 0.66, 0.44][archetype]
  const threadSegments = (
    points: readonly InfluencedPoint[],
    broken: boolean,
    center: number,
  ): readonly (readonly InfluencedPoint[])[] => {
    if (!broken) return [points]
    const first = Math.max(4, Math.floor((center - 0.1) * 80))
    const second = Math.min(76, Math.ceil((center + 0.1) * 80))
    return [points.slice(0, first), points.slice(second)]
  }
  for (let column = 0; column < warpCount; column += 1) {
    if (column === droppedWarp) continue
    const neighborGap = column > 0 ? warpPositions[column] - warpPositions[column - 1] : 1
    const scale = neighborGap < 0.11 ? 0.72 : column === brokenWarp ? 1.38 : 1
    threadSegments(warpThreads[column], column === brokenWarp, warpBreak).forEach((segment) =>
      paintRibbon(
        segment,
        column % 3 === archetype % 3 ? colors.ink : colors.dominant,
        scale,
      ))
  }
  for (let row = 0; row < weftCount; row += 1) {
    if (row === droppedWeft) continue
    const neighborGap = row > 0 ? weftPositions[row] - weftPositions[row - 1] : 1
    const scale = neighborGap < 0.12 ? 0.68 : row === brokenWeft ? 1.24 : 0.94
    threadSegments(weftThreads[row], row === brokenWeft, weftBreak).forEach((segment) =>
      paintRibbon(
        segment,
        row % 3 === 1 ? colors.light : colors.support,
        scale,
      ))
  }

  // Alternating short redraws make the over/under order explicit.
  for (let row = 0; row < weftCount; row += 1) {
    for (let column = 0; column < warpCount; column += 1) {
      if ((row + column) % 2 === 0) {
        if (column === droppedWarp) continue
        if (column === brokenWarp && Math.abs(weftPositions[row] - warpBreak) < 0.11) continue
        const centerIndex = Math.round(weftPositions[row] * 80)
        const segment = warpThreads[column].slice(
          Math.max(0, centerIndex - 4),
          Math.min(81, centerIndex + 5),
        )
        paintRibbon(
          segment,
          column % 3 === 0 ? colors.light : colors.dominant,
          1.08,
        )
      } else {
        if (row === droppedWeft) continue
        if (row === brokenWeft && Math.abs(warpPositions[column] - weftBreak) < 0.11) continue
        const centerIndex = Math.round(warpPositions[column] * 80)
        const segment = weftThreads[row].slice(
          Math.max(0, centerIndex - 4),
          Math.min(81, centerIndex + 5),
        )
        paintRibbon(
          segment,
          row % 3 === 1 ? colors.ink : colors.support,
          1.08,
        )
      }
    }
  }
  context.restore()

  // Loose tails escape the clipped cloth and make its torn edge legible.
  for (let tail = 0; tail < 5; tail += 1) {
    const across = (tail + 0.65) / 5
    const fromStart = (tail + archetype) % 2 === 0
    const points: InfluencedPoint[] = []
    for (let index = 0; index <= 30; index += 1) {
      const progress = index / 30
      const along = fromStart ? -0.16 + progress * 0.2 : 0.96 + progress * 0.22
      const wanderingAcross = across
        + Math.sin(progress * Math.PI * 1.5 + tail) * (0.03 + tail * 0.006)
      points.push(steeredClothPoint(along, wanderingAcross, 80 + tail))
    }
    paintRibbon(
      points,
      tail === archetype ? colors.ink : colors.dominant,
      0.34 + tail % 2 * 0.12,
      0.7,
    )
  }

  if (level >= 1) {
    // Mid adds a secondary bundle that changes tension and crosses the cloth.
    for (let bundle = -1; bundle <= 1; bundle += 1) {
      const points: InfluencedPoint[] = []
      for (let index = 0; index <= 80; index += 1) {
        const progress = index / 80
        const across = archetype === 1
          ? 1.02 + bundle * 0.045
          : -0.06 + bundle * 0.045
        const current = steeredClothPoint(
          progress,
          across + Math.sin(progress * TAU * 0.75 + bundle) * 0.06,
          120 + bundle,
        )
        points.push(current)
      }
      paintRibbon(
        points,
        bundle === 0 ? colors.support : colors.ink,
        bundle === 0 ? 0.78 : 0.42,
        bundle === 0 ? 0.86 : 0.64,
      )
    }
  }
  if (level >= 2) {
    for (let index = 0; index < 38; index += 1) {
      const column = (index * 3 + archetype) % warpCount
      const row = (index * 2 + Math.floor(index / 5)) % weftCount
      if (column === droppedWarp || row === droppedWeft) continue
      const pointIndex = Math.max(
        2,
        Math.min(78, Math.round(weftPositions[row] * 80)),
      )
      const crossing = warpThreads[column][pointIndex]
      const frame = pathFrame(warpThreads[column], pointIndex)
      const field = influenceVector(options, crossing.x, crossing.y, size * 0.018)
      const side = index % 2 === 0 ? -1 : 1
      const start = {
        x: crossing.x + frame.normalX * side * ribbon * 0.24,
        y: crossing.y + frame.normalY * side * ribbon * 0.24,
      }
      const length = size * (
        0.018
        + chan(seed, index, 'look.weave.fiber.length') * 0.055
        + field.edge * 0.025
      )
      const curl = side * length * (0.12 + field.edge * 0.24)
      context.strokeStyle = alpha(sourceDirectedColor(
        options,
        start.x,
        start.y,
        index % 3 === 0 ? colors.ink : colors.light,
        crossing.influence,
      ), index % 3 === 0 ? 0.72 : 0.54)
      context.lineWidth = Math.max(0.65, ribbon * (index % 7 === 0 ? 0.12 : 0.055))
      context.beginPath()
      context.moveTo(start.x, start.y)
      context.quadraticCurveTo(
        start.x + frame.tangentX * length * 0.52 + frame.normalX * curl,
        start.y + frame.tangentY * length * 0.52 + frame.normalY * curl,
        start.x + frame.tangentX * length + frame.normalX * curl * 0.35,
        start.y + frame.tangentY * length + frame.normalY * curl * 0.35,
      )
      context.stroke()
    }
    const repairAlong = archetype === 0 ? 0.7 : archetype === 1 ? 0.38 : 0.58
    const repairAcross = archetype === 0 ? 0.24 : archetype === 1 ? 0.72 : 0.42
    for (let wrap = -7; wrap <= 7; wrap += 1) {
      const center = steeredClothPoint(
        repairAlong + wrap * 0.007,
        repairAcross,
        240 + wrap,
      )
      const frameA = steeredClothPoint(
        repairAlong + wrap * 0.007,
        repairAcross - 0.055,
        260 + wrap,
      )
      const frameB = steeredClothPoint(
        repairAlong + wrap * 0.007,
        repairAcross + 0.055,
        280 + wrap,
      )
      context.beginPath()
      context.moveTo(frameA.x, frameA.y)
      context.quadraticCurveTo(
        center.x + Math.sin(wrap) * ribbon * 0.18,
        center.y + Math.cos(wrap) * ribbon * 0.18,
        frameB.x,
        frameB.y,
      )
      context.strokeStyle = alpha(wrap % 4 === 0 ? colors.accent : colors.light, 0.74)
      context.lineWidth = Math.max(0.8, ribbon * 0.06)
      context.stroke()
    }
  }
  context.globalAlpha = 1
  context.setLineDash([])
  context.restore()
}

function drawMarks(
  context: CanvasRenderingContext2D,
  options: BackgroundLookOptions,
  colors: DirectedColors,
): void {
  const { width, height, seed } = options
  const size = Math.min(width, height)
  const level = tier(options.complexity)
  const motion = clamp01(options.motionAmount)
  const energy = clamp01(options.motionEnergy)
  const archetype = seededArchetype(seed, 0x510e527f)
  const portrait = height > width * 1.08
  const square = !portrait && width < height * 1.22
  const mirror = chan(seed, 0, 'look.mark.mirror') < 0.5
  const point = (u: number, v: number): Point => {
    const cross = mirror ? 1 - v : v
    if (portrait) {
      return { x: width * cross, y: height * u }
    }
    return {
      x: width * u,
      y: height * (
        cross
        + (square ? (u - 0.5) * (archetype === 1 ? -0.1 : archetype === 2 ? 0.1 : 0.04) : 0)
      ),
    }
  }
  const controls = (
    values: readonly (readonly [number, number])[],
  ): [Point, Point, Point, Point] => [
    point(values[0][0], values[0][1]),
    point(values[1][0], values[1][1]),
    point(values[2][0], values[2][1]),
    point(values[3][0], values[3][1]),
  ]
  const contrastInk = Math.abs(luma(colors.light) - luma(colors.ground))
    >= Math.abs(luma(colors.dark) - luma(colors.ground))
    ? colors.light
    : colors.dark
  const groundStart = point(0, 0.92)
  const groundEnd = point(1, 0.08)
  const ground = context.createLinearGradient(
    groundStart.x,
    groundStart.y,
    groundEnd.x,
    groundEnd.y,
  )
  ground.addColorStop(0, mixColor(colors.ground, colors.support, 0.34))
  ground.addColorStop(0.34, mixColor(colors.ground, colors.dark, 0.08))
  ground.addColorStop(0.68, mixColor(colors.ground, colors.dominant, 0.12))
  ground.addColorStop(1, mixColor(colors.ground, colors.dark, 0.38))
  context.fillStyle = ground
  context.fillRect(0, 0, width, height)

  // Broad pressure beds keep the ground generated rather than flat. Their
  // positions are deliberately asymmetric and the source field changes their
  // drift, color, radius, and strength without ever being drawn as a mask.
  const pressureBeds = [
    [
      { u: 0.08, v: 0.2, radius: 0.46, color: colors.support, opacity: 0.24 },
      { u: 0.66, v: 0.16, radius: 0.38, color: colors.accent, opacity: 0.18 },
      { u: 0.28, v: 0.82, radius: 0.48, color: colors.dominant, opacity: 0.2 },
      { u: 0.94, v: 0.68, radius: 0.36, color: colors.ink, opacity: 0.16 },
    ],
    [
      { u: 0.14, v: 0.08, radius: 0.42, color: colors.ink, opacity: 0.19 },
      { u: 0.78, v: 0.24, radius: 0.48, color: colors.support, opacity: 0.23 },
      { u: 0.62, v: 0.82, radius: 0.46, color: colors.dominant, opacity: 0.19 },
      { u: 0.96, v: 0.94, radius: 0.34, color: colors.accent, opacity: 0.16 },
    ],
    [
      { u: 0.06, v: 0.12, radius: 0.43, color: colors.support, opacity: 0.22 },
      { u: 0.5, v: 0.05, radius: 0.38, color: colors.ink, opacity: 0.17 },
      { u: 0.9, v: 0.52, radius: 0.48, color: colors.dominant, opacity: 0.21 },
      { u: 0.34, v: 0.96, radius: 0.4, color: colors.accent, opacity: 0.16 },
    ],
  ][archetype]
  pressureBeds.forEach((bed, index) => {
    const base = point(bed.u, bed.v)
    const baseX = base.x
    const baseY = base.y
    const influence = softInfluence(options, baseX, baseY, size * 0.09)
    const field = influenceVector(options, baseX, baseY, size * 0.035)
    const drift = harmonicMotion(options, index, 'look.mark.pressure.x')
      * motion
      * size
      * (0.018 + energy * 0.009)
    const x = baseX + field.x * field.edge * size * 0.11 + drift
    const y = baseY + field.y * field.edge * size * 0.11
      + harmonicMotion(options, index, 'look.mark.pressure.y', Math.PI * 0.5)
        * motion
        * size
        * (0.014 + energy * 0.008)
    const radius = Math.max(width, height) * bed.radius
      * (0.78 + influence * 0.24)
    const local = sourceDirectedColor(options, x, y, bed.color, 0.55 + influence * 0.45)
    const wash = context.createRadialGradient(x, y, 0, x, y, radius)
    wash.addColorStop(0, alpha(local, bed.opacity * (0.72 + influence * 0.42)))
    wash.addColorStop(0.48, alpha(local, bed.opacity * 0.45))
    wash.addColorStop(1, alpha(local, 0))
    context.fillStyle = wash
    context.fillRect(0, 0, width, height)
  })

  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  const alignGesture = (
    points: InfluencedPoint[],
    joint: InfluencedPoint,
  ): InfluencedPoint[] => {
    const offsetX = joint.x - points[0].x
    const offsetY = joint.y - points[0].y
    return points.map((point) => ({
      ...point,
      x: point.x + offsetX,
      y: point.y + offsetY,
    }))
  }
  const heroSpecs: readonly (readonly (readonly [number, number])[])[][] = [
    [
      [[-0.1, 0.76], [0.08, 0.92], [0.2, 0.16], [0.38, 0.29]],
      [[0.38, 0.29], [0.5, 0.18], [0.53, 0.75], [0.68, 0.58]],
      [[0.68, 0.58], [0.78, 0.64], [0.88, 0.11], [1.1, 0.2]],
    ],
    [
      [[0.12, -0.1], [0.06, 0.22], [0.46, 0.2], [0.42, 0.42]],
      [[0.42, 0.42], [0.35, 0.62], [0.8, 0.58], [0.68, 0.76]],
      [[0.68, 0.76], [0.76, 0.9], [0.52, 0.96], [0.46, 1.1]],
    ],
    [
      [[-0.1, 0.22], [0.18, 0.04], [0.54, 0.18], [0.72, 0.31]],
      [[0.72, 0.31], [0.96, 0.39], [0.91, 0.7], [0.74, 0.72]],
      [[0.74, 0.72], [0.53, 0.73], [0.46, 0.96], [0.22, 1.1]],
    ],
  ]
  const firstControls = controls(heroSpecs[archetype][0])
  const secondControls = controls(heroSpecs[archetype][1])
  const thirdControls = controls(heroSpecs[archetype][2])
  const firstGesture = influencedCubic(
    options,
    firstControls,
    0,
    'look.mark.gesture.first',
    0.026,
    72,
  )
  const firstJoint = firstGesture.at(-1) ?? { ...firstControls[3], influence: 0 }
  const secondGesture = alignGesture(influencedCubic(
    options,
    secondControls,
    1,
    'look.mark.gesture.second',
    0.024,
    64,
  ), firstJoint)
  const secondJoint = secondGesture.at(-1) ?? { ...secondControls[3], influence: 0 }
  const thirdGesture = alignGesture(influencedCubic(
    options,
    thirdControls,
    2,
    'look.mark.gesture.third',
    0.024,
    72,
  ), secondJoint)
  const gesture = smoothInfluencedPath([
    ...firstGesture,
    ...secondGesture.slice(1),
    ...thirdGesture.slice(1),
  ], 4)
  const pressureAt = (point: InfluencedPoint, progress: number, index: number) => {
    const envelope = Math.sin(progress * Math.PI) ** 0.48
    const firstPressure = Math.exp(-(((progress - 0.28) / 0.17) ** 2)) * 0.054
    const secondPressure = Math.exp(-(((progress - 0.64) / 0.16) ** 2)) * 0.032
    const sourcePressure = point.influence * 0.024
    const curvaturePressure = Math.min(0.009, pathCurvature(gesture, index) * 0.028)
    return size * (
      0.0028
      + envelope * (
        0.013
        + firstPressure
        + secondPressure
        + sourcePressure
        + curvaturePressure
      )
    )
  }

  // A field of independently authored gestures replaces the former stack of
  // contour echoes. Each cluster has its own cadence and orientation, while
  // the exact influence gradient steers every local stroke.
  const fieldGesturePaths: InfluencedPoint[][] = []
  const clusterSpecs = [
    [
      { u: 0.1, v: 0.17, angle: 0.08, scale: 1.1 },
      { u: 0.24, v: 0.7, angle: -0.72, scale: 1.25 },
      { u: 0.5, v: 0.2, angle: 0.58, scale: 0.92 },
      { u: 0.72, v: 0.73, angle: -0.24, scale: 1.18 },
      { u: 0.91, v: 0.42, angle: 1.04, scale: 0.86 },
    ],
    [
      { u: 0.12, v: 0.08, angle: 0.8, scale: 0.96 },
      { u: 0.18, v: 0.78, angle: -0.34, scale: 1.15 },
      { u: 0.5, v: 0.42, angle: 0.22, scale: 1.2 },
      { u: 0.76, v: 0.18, angle: -0.8, scale: 1.08 },
      { u: 0.86, v: 0.82, angle: 0.64, scale: 0.9 },
    ],
    [
      { u: 0.08, v: 0.2, angle: -0.12, scale: 1.08 },
      { u: 0.34, v: 0.08, angle: 0.54, scale: 0.88 },
      { u: 0.72, v: 0.22, angle: -0.42, scale: 1.18 },
      { u: 0.88, v: 0.62, angle: 0.9, scale: 1.12 },
      { u: 0.32, v: 0.9, angle: -0.74, scale: 0.94 },
    ],
  ][archetype]
  const visibleClusters = level === 0 ? clusterSpecs.slice(0, 4) : clusterSpecs
  visibleClusters.forEach((cluster, clusterIndex) => {
    const anchor = point(cluster.u, cluster.v)
    const anchorX = anchor.x
    const anchorY = anchor.y
    const field = influenceVector(options, anchorX, anchorY, size * 0.03)
    const fieldAngle = field.edge > 0.01 ? Math.atan2(field.y, field.x) : 0
    const count = 4 + level * 2
    for (let mark = 0; mark < count; mark += 1) {
      const id = clusterIndex * 100 + mark
      const localX = anchorX
        + (chan(seed, id, 'look.mark.field.x') - 0.5) * size * 0.22
      const localY = anchorY
        + (chan(seed, id, 'look.mark.field.y') - 0.5) * size * 0.2
      const angle = cluster.angle
        + fieldAngle * 0.34
        + (chan(seed, id, 'look.mark.field.angle') - 0.5) * 1.18
        + harmonicMotion(options, id, 'look.mark.field.angle')
          * motion
          * (0.055 + energy * 0.055)
      const tangent = { x: Math.cos(angle), y: Math.sin(angle) }
      const normal = { x: -tangent.y, y: tangent.x }
      const length = size
        * (0.09 + chan(seed, id, 'look.mark.field.length') * 0.2)
        * cluster.scale
        * (mark === 0 ? 1.75 : 1)
      const bend = (chan(seed, id, 'look.mark.field.bend') - 0.5)
        * size
        * (mark === 0 ? 0.14 : 0.09)
      const start = {
        x: localX - tangent.x * length * 0.5,
        y: localY - tangent.y * length * 0.5,
      }
      const end = {
        x: localX + tangent.x * length * 0.5,
        y: localY + tangent.y * length * 0.5,
      }
      const points = smoothInfluencedPath(influencedCubic(options, [
        start,
        {
          x: start.x + tangent.x * length * 0.34 + normal.x * bend,
          y: start.y + tangent.y * length * 0.34 + normal.y * bend,
        },
        {
          x: end.x - tangent.x * length * 0.28 - normal.x * bend * 0.64,
          y: end.y - tangent.y * length * 0.28 - normal.y * bend * 0.64,
        },
        end,
      ], id + 40, 'look.mark.field.gesture', 0.014, 28), 2)
      fieldGesturePaths.push(points)
      const center = points[Math.floor(points.length / 2)]
      const chosen = structuralColor(
        options,
        colors,
        chan(seed, id, 'look.mark.field.color'),
      )
      const localColor = sourceDirectedColor(
        options,
        center.x,
        center.y,
        chosen,
        0.42 + center.influence * 0.58,
      )
      const baseWidth = size
        * (0.008 + chan(seed, id, 'look.mark.field.width') * 0.022)
        * (mark === 0 ? 1.6 : 1)
      const markWidth = (
        point: InfluencedPoint,
        progress: number,
        pointIndex: number,
      ) => baseWidth * (
        0.12
        + Math.sin(progress * Math.PI) ** 0.58
        * (
          0.76
          + point.influence * 0.36
          + Math.min(0.18, pathCurvature(points, pointIndex) * 0.7)
        )
      )

      context.fillStyle = alpha(mixColor(localColor, colors.ground, 0.58), 0.42)
      context.globalAlpha = 1
      context.fill(variableRibbonPath(
        points,
        (point, progress, pointIndex) => markWidth(point, progress, pointIndex) * 1.9,
      ))

      const interrupted = mark % 3 === 1 && points.length > 12
      const slices = interrupted
        ? [
            points.slice(0, Math.floor(points.length * 0.44)),
            points.slice(Math.floor(points.length * 0.58)),
          ]
        : [points]
      slices.forEach((slice) => {
        if (slice.length < 3) return
        context.fillStyle = localColor
        context.globalAlpha = 0.6
          + chan(seed, id, 'look.mark.field.opacity') * 0.34
        context.fill(variableRibbonPath(slice, (point, progress, pointIndex) => {
          const fullIndex = points.indexOf(point)
          return markWidth(
            point,
            fullIndex >= 0 ? fullIndex / Math.max(1, points.length - 1) : progress,
            fullIndex >= 0 ? fullIndex : pointIndex,
          )
        }))
      })
      if (mark === 0 || mark % 4 === 2) {
        context.strokeStyle = alpha(
          mark % 2 === 0 ? contrastInk : colors.accent,
          0.46,
        )
        context.globalAlpha = 0.72
        context.lineWidth = Math.max(0.8, baseWidth * 0.14)
        context.stroke(pathFrom(points.slice(
          Math.floor(points.length * 0.16),
          Math.floor(points.length * 0.8),
        )))
      }
    }
  })

  {
    const secondarySpecs: readonly (readonly (readonly [number, number])[])[][] = [
      [
        [[-0.08, 0.92], [0.2, 0.62], [0.7, 0.12], [1.08, 0.46]],
        [[0.2, -0.08], [0.14, 0.34], [0.78, 0.68], [0.86, 1.08]],
      ],
      [
        [[-0.08, 0.32], [0.22, 0.2], [0.68, 0.72], [1.08, 0.62]],
        [[0.78, -0.08], [0.58, 0.28], [0.3, 0.68], [0.12, 1.08]],
      ],
      [
        [[-0.08, 0.48], [0.28, 0.34], [0.7, 0.5], [1.08, 0.92]],
        [[0.92, -0.08], [0.72, 0.22], [0.44, 0.7], [0.16, 1.08]],
      ],
    ]
    const secondaryGestures = [
      {
        controls: controls(secondarySpecs[archetype][0]),
        color: colors.ink,
        width: 0.034,
        id: 80,
        minimumLevel: 0,
      },
      {
        controls: controls(secondarySpecs[archetype][1]),
        color: colors.light,
        width: 0.018,
        id: 81,
        minimumLevel: 1,
      },
    ]
    secondaryGestures.filter((spec) => level >= spec.minimumLevel).forEach((spec) => {
      const points = smoothInfluencedPath(influencedCubic(
        options,
        spec.controls,
        spec.id,
        'look.mark.secondary.gesture',
        0.022,
        86,
      ), 3)
      fieldGesturePaths.push(points)
      const center = points[Math.floor(points.length / 2)]
      context.fillStyle = sourceDirectedColor(
        options,
        center.x,
        center.y,
        spec.color,
        0.5 + center.influence * 0.5,
      )
      context.globalAlpha = spec.minimumLevel === 0 ? 0.58 : 0.68
      const cuts = spec.minimumLevel === 0
        ? [
            points.slice(0, Math.floor(points.length * 0.43)),
            points.slice(Math.floor(points.length * 0.54)),
          ]
        : [points]
      cuts.forEach((slice) => {
        if (slice.length < 3) return
        context.fill(variableRibbonPath(slice, (point, sliceProgress) => {
          const pointIndex = points.indexOf(point)
          const progress = pointIndex / Math.max(1, points.length - 1)
          const cutEnvelope = 0.04 + Math.sin(sliceProgress * Math.PI) ** 0.42 * 0.96
          return size * spec.width * (
            0.08
            + Math.sin(progress * Math.PI) ** 0.7
            * (
              0.82
              + point.influence * 0.34
              + Math.min(0.16, pathCurvature(points, pointIndex) * 0.5)
            )
          ) * cutEnvelope
        }))
      })
    })
  }

  // The persistent hero is a pressure-shaped ribbon, not a stroked contour.
  const heroSegments = [
    gesture.slice(0, Math.floor(gesture.length * 0.34)),
    gesture.slice(
      Math.floor(gesture.length * 0.4),
      Math.floor(gesture.length * 0.69),
    ),
    gesture.slice(Math.floor(gesture.length * 0.75)),
  ]
  context.fillStyle = alpha(colors.dark, 0.28)
  context.globalAlpha = 1
  heroSegments.forEach((segment) => {
    context.fill(variableRibbonPath(segment, (point, segmentProgress) => {
      const pointIndex = gesture.indexOf(point)
      return pressureAt(
        point,
        pointIndex / Math.max(1, gesture.length - 1),
        pointIndex,
      ) * 1.34 * (
        0.04 + Math.sin(segmentProgress * Math.PI) ** 0.42 * 0.96
      )
    }))
  })
  const gestureStart = gesture[0]
  const gestureEnd = gesture.at(-1) ?? gestureStart
  const gestureFill = context.createLinearGradient(
    gestureStart.x,
    gestureStart.y,
    gestureEnd.x,
    gestureEnd.y,
  )
  gestureFill.addColorStop(0, colors.support)
  gestureFill.addColorStop(0.38, colors.dominant)
  gestureFill.addColorStop(0.7, colors.ink)
  gestureFill.addColorStop(1, colors.accent)
  context.fillStyle = gestureFill
  context.globalAlpha = 0.9
  heroSegments.forEach((segment) => {
    context.fill(variableRibbonPath(segment, (point, segmentProgress) => {
      const pointIndex = gesture.indexOf(point)
      return pressureAt(
        point,
        pointIndex / Math.max(1, gesture.length - 1),
        pointIndex,
      ) * (
        0.03 + Math.sin(segmentProgress * Math.PI) ** 0.4 * 0.97
      )
    }))
  })

  // Source-driven material patches change the gesture without outlining the
  // canonical field.
  for (let patch = 0; patch < 5; patch += 1) {
    const first = Math.floor(gesture.length * (0.09 + patch * 0.17))
    const last = Math.min(gesture.length, first + Math.floor(gesture.length * 0.13))
    const segment = gesture.slice(first, last)
    const middle = segment[Math.floor(segment.length / 2)]
    if (!middle) continue
    const local = sourceDirectedColor(
      options,
      middle.x,
      middle.y,
      patch % 2 === 0 ? colors.accent : colors.light,
      middle.influence,
    )
    context.fillStyle = local
    context.strokeStyle = local
    context.globalAlpha = 0.18 + middle.influence * 0.28
    context.lineWidth = pressureAt(
      middle,
      (first + Math.floor(segment.length / 2)) / gesture.length,
      first + Math.floor(segment.length / 2),
    ) * 0.28
    context.stroke(pathFrom(segment))
  }
  context.strokeStyle = alpha(colors.light, 0.56)
  context.globalAlpha = 1
  context.lineWidth = Math.max(1.1, size * 0.0026)
  heroSegments.forEach((segment) => {
    context.stroke(pathFrom(segment.slice(
      Math.floor(segment.length * 0.12),
      Math.floor(segment.length * 0.84),
    )))
  })

  if (level >= 2) {
    const events = curvatureEvents(gesture, 5, 0.13)
    events.forEach((eventIndex, event) => {
      const anchor = gesture[eventIndex]
      const frame = pathFrame(gesture, eventIndex)
      const side = event % 2 === 0 ? -1 : 1
      const pressure = pressureAt(anchor, eventIndex / gesture.length, eventIndex)
      const origin = {
        x: anchor.x + frame.normalX * side * (pressure * 0.72 + size * 0.026),
        y: anchor.y + frame.normalY * side * (pressure * 0.72 + size * 0.026),
      }
      const noteCount = 11 + event % 3 * 2
      for (let note = 0; note < noteCount; note += 1) {
        const id = event * 100 + note
        const along = (note - (noteCount - 1) / 2) * size * 0.011
          + (chan(seed, id, 'look.mark.note.along') - 0.5) * size * 0.012
        const away = side * size * (
          0.008 + chan(seed, id, 'look.mark.note.away') * 0.04
        )
        const x = origin.x + frame.tangentX * along + frame.normalX * away
        const y = origin.y + frame.tangentY * along + frame.normalY * away
        const noteLength = size * (
          0.018 + chan(seed, id, 'look.mark.note.length') * 0.034
        )
        context.strokeStyle = note % 5 === 0
          ? colors.light
          : note % 3 === 0 ? colors.accent : colors.ink
        context.globalAlpha = 0.8 + chan(seed, id, 'look.mark.note.alpha') * 0.18
        context.lineWidth = Math.max(1, size * (note % 4 === 0 ? 0.004 : 0.0023))
        context.beginPath()
        context.moveTo(x, y)
        context.lineTo(
          x + frame.tangentX * noteLength + frame.normalX * side * noteLength * 0.2,
          y + frame.tangentY * noteLength + frame.normalY * side * noteLength * 0.2,
        )
        context.stroke()
        if (note % 4 === 1) {
          const block = Math.max(1.5, size * 0.0045)
          context.fillStyle = colors.ink
          context.fillRect(x - block / 2, y - block / 2, block, block)
        }
      }
    })
    fieldGesturePaths
      .filter((_points, index) => index % 4 === 0)
      .slice(0, 6)
      .forEach((points, carrierIndex) => {
        const eventIndex = curvatureEvents(points, 1, 0.2)[0]
          ?? Math.floor(points.length * 0.5)
        const anchor = points[eventIndex]
        const frame = pathFrame(points, eventIndex)
        for (let tick = 0; tick < 5; tick += 1) {
          const id = carrierIndex * 20 + tick
          const along = (tick - 2) * size * 0.012
          const away = (chan(seed, id, 'look.mark.field.note.away') - 0.5)
            * size
            * 0.035
          const x = anchor.x + frame.tangentX * along + frame.normalX * away
          const y = anchor.y + frame.tangentY * along + frame.normalY * away
          const length = size * (
            0.014 + chan(seed, id, 'look.mark.field.note.length') * 0.025
          )
          context.strokeStyle = tick % 3 === 0 ? colors.light : colors.accent
          context.globalAlpha = 0.56
            + chan(seed, id, 'look.mark.field.note.alpha') * 0.32
          context.lineWidth = Math.max(0.8, size * 0.0019)
          context.beginPath()
          context.moveTo(x, y)
          context.lineTo(
            x + frame.normalX * length + frame.tangentX * length * 0.28,
            y + frame.normalY * length + frame.tangentY * length * 0.28,
          )
          context.stroke()
        }
      })
  }
  context.globalAlpha = 1
  context.setLineDash([])
  context.restore()
}

function drawTrails(
  context: CanvasRenderingContext2D,
  options: BackgroundLookOptions,
  colors: DirectedColors,
): void {
  const { width, height, seed } = options
  const size = Math.min(width, height)
  const level = tier(options.complexity)
  const motion = clamp01(options.motionAmount)
  const energy = clamp01(options.motionEnergy)
  const archetype = seededArchetype(seed, 0xa54ff53a)
  const portrait = height > width * 1.08
  const square = !portrait && width < height * 1.22
  const mirror = chan(seed, 0, 'look.trail.mirror') < 0.5
  const point = (u: number, v: number): Point => {
    const cross = mirror ? 1 - v : v
    if (portrait) {
      return { x: width * cross, y: height * u }
    }
    return {
      x: width * u,
      y: height * (
        cross
        + (square ? (u - 0.5) * (archetype === 1 ? 0.11 : archetype === 2 ? -0.1 : 0.04) : 0)
      ),
    }
  }
  const controls = (
    values: readonly (readonly [number, number])[],
  ): [Point, Point, Point, Point] => [
    point(values[0][0], values[0][1]),
    point(values[1][0], values[1][1]),
    point(values[2][0], values[2][1]),
    point(values[3][0], values[3][1]),
  ]
  const contrastInk = Math.abs(luma(colors.light) - luma(colors.ground))
    >= Math.abs(luma(colors.dark) - luma(colors.ground))
    ? colors.light
    : colors.dark
  const groundStart = point(0, 0.92)
  const groundEnd = point(1, 0.08)
  const ground = context.createLinearGradient(
    groundStart.x,
    groundStart.y,
    groundEnd.x,
    groundEnd.y,
  )
  ground.addColorStop(0, mixColor(colors.ground, colors.support, 0.4))
  ground.addColorStop(0.34, mixColor(colors.ground, colors.dominant, 0.09))
  ground.addColorStop(0.62, mixColor(colors.ground, colors.dark, 0.06))
  ground.addColorStop(1, mixColor(colors.ground, colors.dark, 0.4))
  context.fillStyle = ground
  context.fillRect(0, 0, width, height)

  // Slow current pools make the field itself participate in the composition.
  // The source gradient displaces each pool, but no source contour is painted.
  const currentPools = [
    [
      { u: 0.12, v: 0.16, radius: 0.48, color: colors.support, opacity: 0.18 },
      { u: 0.7, v: 0.18, radius: 0.42, color: colors.dominant, opacity: 0.15 },
      { u: 0.26, v: 0.8, radius: 0.46, color: colors.accent, opacity: 0.17 },
      { u: 0.86, v: 0.72, radius: 0.4, color: colors.ink, opacity: 0.14 },
    ],
    [
      { u: 0.08, v: 0.28, radius: 0.4, color: colors.ink, opacity: 0.15 },
      { u: 0.42, v: 0.08, radius: 0.48, color: colors.support, opacity: 0.18 },
      { u: 0.82, v: 0.42, radius: 0.44, color: colors.dominant, opacity: 0.17 },
      { u: 0.56, v: 0.94, radius: 0.38, color: colors.accent, opacity: 0.14 },
    ],
    [
      { u: 0.08, v: 0.76, radius: 0.45, color: colors.support, opacity: 0.18 },
      { u: 0.36, v: 0.18, radius: 0.4, color: colors.dominant, opacity: 0.15 },
      { u: 0.78, v: 0.18, radius: 0.46, color: colors.accent, opacity: 0.16 },
      { u: 0.92, v: 0.82, radius: 0.42, color: colors.ink, opacity: 0.14 },
    ],
  ][archetype]
  currentPools.forEach((pool, index) => {
    const base = point(pool.u, pool.v)
    const baseX = base.x
    const baseY = base.y
    const influence = softInfluence(options, baseX, baseY, size * 0.1)
    const field = influenceVector(options, baseX, baseY, size * 0.035)
    const x = baseX
      + field.x * field.edge * size * 0.14
      + harmonicMotion(options, index, 'look.trail.pool.x')
        * motion
        * size
        * (0.015 + energy * 0.01)
    const y = baseY
      + field.y * field.edge * size * 0.14
      + harmonicMotion(options, index, 'look.trail.pool.y', Math.PI * 0.5)
        * motion
        * size
        * (0.012 + energy * 0.009)
    const radius = Math.max(width, height) * pool.radius
      * (0.8 + influence * 0.2)
    const local = sourceDirectedColor(options, x, y, pool.color, 0.5 + influence * 0.5)
    const wash = context.createRadialGradient(x, y, 0, x, y, radius)
    wash.addColorStop(0, alpha(local, pool.opacity * (0.72 + influence * 0.42)))
    wash.addColorStop(0.52, alpha(local, pool.opacity * 0.42))
    wash.addColorStop(1, alpha(local, 0))
    context.fillStyle = wash
    context.fillRect(0, 0, width, height)
  })

  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'

  // Each seed chooses a different route ecology before aspect mapping.
  const heroSpecs: readonly (readonly (readonly [number, number])[])[][] = [
    [
      [[-0.1, 0.74], [0.1, 0.88], [0.27, 0.7], [0.4, 0.54]],
      [[0.4, 0.54], [0.5, 0.42], [0.54, 0.68], [0.67, 0.44]],
      [[0.67, 0.44], [0.76, 0.25], [0.8, 0.04], [0.88, -0.1]],
    ],
    [
      [[-0.1, 0.16], [0.18, 0.04], [0.5, 0.12], [0.62, 0.3]],
      [[0.62, 0.3], [0.78, 0.4], [0.9, 0.52], [0.82, 0.68]],
      [[0.82, 0.68], [0.74, 0.82], [0.96, 0.92], [1.1, 0.96]],
    ],
    [
      [[0.18, 1.1], [0.12, 0.84], [0.24, 0.62], [0.42, 0.58]],
      [[0.42, 0.58], [0.58, 0.55], [0.5, 0.28], [0.68, 0.25]],
      [[0.68, 0.25], [0.8, 0.18], [0.88, 0.42], [1.1, 0.34]],
    ],
  ]
  const firstControls = controls(heroSpecs[archetype][0])
  const middleControls = controls(heroSpecs[archetype][1])
  const finalControls = controls(heroSpecs[archetype][2])
  const firstRoute = influencedCubic(
    options,
    firstControls,
    0,
    'look.trail.route.first',
    0.03,
    72,
  )
  const alignRoute = (
    points: InfluencedPoint[],
    joint: InfluencedPoint,
  ): InfluencedPoint[] => {
    const offset = {
      x: joint.x - points[0].x,
      y: joint.y - points[0].y,
    }
    return points.map((point) => ({
      ...point,
      x: point.x + offset.x,
      y: point.y + offset.y,
    }))
  }
  const firstJoint = firstRoute.at(-1) ?? { ...firstControls[3], influence: 0 }
  const middleRoute = alignRoute(influencedCubic(
    options,
    middleControls,
    1,
    'look.trail.route.middle',
    0.034,
    68,
  ), firstJoint)
  const secondJoint = middleRoute.at(-1) ?? { ...middleControls[3], influence: 0 }
  const finalRoute = alignRoute(influencedCubic(
    options,
    finalControls,
    2,
    'look.trail.route.final',
    0.026,
    52,
  ), secondJoint)
  const route = smoothInfluencedPath([
    ...firstRoute,
    ...middleRoute.slice(1),
    ...finalRoute.slice(1),
  ], 3)
  const routePressure = (point: InfluencedPoint, progress: number, index: number) => {
    const history = 0.16 + progress ** 0.72 * 0.84
    const head = Math.exp(-(((progress - 0.68) / 0.17) ** 2))
    const exitTaper = progress < 0.8
      ? 1
      : 1 - (progress - 0.8) / 0.2 * 0.64
    return size * (
      0.003
      + history * exitTaper * (
        0.014
        + head * 0.038
        + point.influence * 0.016
        + Math.min(0.008, pathCurvature(route, index) * 0.024)
      )
    )
  }

  type EcologyRoute = {
    points: InfluencedPoint[]
    color: string
    width: number
    opacity: number
    id: number
    branch: boolean
  }
  const ecologyControlSpecs: readonly (readonly (readonly (readonly [number, number])[])[])[] = [
    [
      [[0.12, -0.06], [0.3, 0.08], [0.72, 0.02], [1.08, 0.11]],
      [[-0.08, 0.94], [0.24, 0.82], [0.62, 1], [1.08, 0.86]],
      [[-0.08, 0.3], [0.2, 0.44], [0.62, 0.12], [1.08, 0.48]],
      [[0.9, -0.08], [0.7, 0.2], [0.88, 0.68], [0.6, 1.08]],
    ],
    [
      [[-0.08, 0.7], [0.2, 0.56], [0.54, 0.72], [1.08, 0.62]],
      [[0.08, -0.08], [0.18, 0.28], [0.08, 0.7], [0.2, 1.08]],
      [[0.92, -0.08], [0.74, 0.24], [0.94, 0.62], [0.8, 1.08]],
      [[-0.08, 0.38], [0.34, 0.26], [0.68, 0.46], [1.08, 0.32]],
    ],
    [
      [[-0.08, 0.18], [0.2, 0.32], [0.58, 0.06], [1.08, 0.2]],
      [[-0.08, 0.86], [0.3, 0.72], [0.62, 0.94], [1.08, 0.78]],
      [[0.22, -0.08], [0.42, 0.26], [0.3, 0.72], [0.48, 1.08]],
      [[0.9, -0.08], [0.72, 0.28], [0.9, 0.7], [0.66, 1.08]],
    ],
  ]
  const ecologySpecs = [
    {
      controls: controls(ecologyControlSpecs[archetype][0]),
      color: colors.support,
      width: 0.044,
      opacity: 0.84,
      id: 10,
      minimumLevel: 0,
    },
    {
      controls: controls(ecologyControlSpecs[archetype][1]),
      color: colors.accent,
      width: 0.037,
      opacity: 0.8,
      id: 11,
      minimumLevel: 0,
    },
    {
      controls: controls(ecologyControlSpecs[archetype][2]),
      color: colors.ink,
      width: 0.023,
      opacity: 0.7,
      id: 12,
      minimumLevel: 1,
    },
    {
      controls: controls(ecologyControlSpecs[archetype][3]),
      color: contrastInk,
      width: 0.019,
      opacity: 0.62,
      id: 13,
      minimumLevel: 1,
    },
  ] as const
  const ecologyRoutes: EcologyRoute[] = ecologySpecs
    .filter((spec) => level >= spec.minimumLevel)
    .map((spec) => ({
      points: smoothInfluencedPath(influencedCubic(
        options,
        spec.controls,
        spec.id,
        'look.trail.ecology.route',
        0.026,
        90,
      ), 3),
      color: spec.color,
      width: spec.width,
      opacity: spec.opacity,
      id: spec.id,
      branch: false,
    }))

  const connectPaths = (
    from: readonly InfluencedPoint[],
    fromProgress: number,
    to: readonly InfluencedPoint[],
    toProgress: number,
    id: number,
    color: string,
    widthScale: number,
  ): EcologyRoute => {
    const fromIndex = Math.floor((from.length - 1) * fromProgress)
    const toIndex = Math.floor((to.length - 1) * toProgress)
    const start = from[fromIndex]
    const end = to[toIndex]
    const startFrame = pathFrame(from, fromIndex)
    const endFrame = pathFrame(to, toIndex)
    const distance = Math.hypot(end.x - start.x, end.y - start.y)
    const raw = influencedCubic(options, [
      start,
      {
        x: start.x + startFrame.tangentX * distance * 0.3
          + startFrame.normalX * size * 0.08,
        y: start.y + startFrame.tangentY * distance * 0.3
          + startFrame.normalY * size * 0.08,
      },
      {
        x: end.x - endFrame.tangentX * distance * 0.24
          - endFrame.normalX * size * 0.05,
        y: end.y - endFrame.tangentY * distance * 0.24
          - endFrame.normalY * size * 0.05,
      },
      end,
    ], id, 'look.trail.ecology.branch', 0.018, 54)
    const rawStart = raw[0]
    const rawEnd = raw.at(-1) ?? rawStart
    const points = smoothInfluencedPath(raw.map((point, index) => {
      const progress = index / Math.max(1, raw.length - 1)
      return {
        ...point,
        x: point.x
          + (start.x - rawStart.x) * (1 - progress)
          + (end.x - rawEnd.x) * progress,
        y: point.y
          + (start.y - rawStart.y) * (1 - progress)
          + (end.y - rawEnd.y) * progress,
      }
    }), 2)
    return {
      points,
      color,
      width: widthScale,
      opacity: 0.68,
      id,
      branch: true,
    }
  }

  if (ecologyRoutes.length >= 2) {
    ecologyRoutes.push(
      connectPaths(ecologyRoutes[0].points, 0.36, route, 0.42, 20, colors.support, 0.018),
      connectPaths(ecologyRoutes[1].points, 0.48, route, 0.7, 21, colors.accent, 0.016),
    )
  }
  if (level >= 1 && ecologyRoutes.length >= 4) {
    ecologyRoutes.push(
      connectPaths(
        ecologyRoutes[2].points,
        0.42,
        ecologyRoutes[0].points,
        0.68,
        22,
        colors.ink,
        0.013,
      ),
    )
  }

  const ecologyPressure = (
    ecologyRoute: EcologyRoute,
    point: InfluencedPoint,
    progress: number,
    pointIndex: number,
  ) => {
    const envelope = 0.16 + Math.sin(progress * Math.PI) ** 0.58 * 0.84
    const pulse = 1 + Math.sin(
      progress * TAU * (1.25 + ecologyRoute.id * 0.017)
      + harmonicMotion(
        options,
        ecologyRoute.id,
        'look.trail.pressure',
      ) * motion * (1.1 + energy * 0.8)
      + ecologyRoute.id,
    ) * motion * 0.07
    return size * ecologyRoute.width * pulse * (
      0.14
      + envelope * (
        0.74
        + point.influence * 0.38
        + Math.min(0.18, pathCurvature(ecologyRoute.points, pointIndex) * 0.58)
      )
    )
  }

  // Every low-complexity route carries its own wakes. Since the routes have
  // independent topology, these read as a moving ecology rather than echoes
  // of one carrier.
  ecologyRoutes.forEach((ecologyRoute, routeIndex) => {
    const wakeCount = ecologyRoute.branch ? 1 : 2
    for (let wake = wakeCount; wake >= 1; wake -= 1) {
      const side = (routeIndex + wake) % 2 === 0 ? -1 : 1
      const displaced = smoothInfluencedPath(offsetInfluencedPath(
        ecologyRoute.points,
        (_point, progress) =>
          side
          * size
          * (0.012 + wake * 0.012)
          * (0.34 + Math.sin(progress * Math.PI) ** 0.65 * 0.66),
      ), 2)
      context.strokeStyle = alpha(ecologyRoute.color, 0.26 + (wakeCount - wake) * 0.09)
      context.globalAlpha = ecologyRoute.opacity
      context.lineWidth = size * ecologyRoute.width * (0.16 + wake * 0.09)
      context.setLineDash([
        size * (0.05 + wake * 0.016),
        size * (0.018 + routeIndex % 3 * 0.008),
      ])
      context.lineDashOffset = -harmonicMotion(
        options,
        routeIndex,
        'look.trail.wake-dash',
      ) * motion * size * (0.035 + energy * 0.018) * (routeIndex % 2 === 0 ? 1 : -1)
      context.stroke(pathFrom(displaced))
    }
  })
  context.setLineDash([])

  ecologyRoutes.forEach((ecologyRoute) => {
    const middle = ecologyRoute.points[Math.floor(ecologyRoute.points.length / 2)]
    const localColor = sourceDirectedColor(
      options,
      middle.x,
      middle.y,
      ecologyRoute.color,
      0.44 + middle.influence * 0.56,
    )
    context.fillStyle = alpha(colors.dark, 0.3)
    context.globalAlpha = 1
    context.fill(variableRibbonPath(
      ecologyRoute.points,
      (point, progress, pointIndex) =>
        ecologyPressure(ecologyRoute, point, progress, pointIndex) * 1.48,
    ))
    context.fillStyle = localColor
    context.globalAlpha = ecologyRoute.opacity
    context.fill(variableRibbonPath(
      ecologyRoute.points,
      (point, progress, pointIndex) =>
        ecologyPressure(ecologyRoute, point, progress, pointIndex),
    ))
    context.strokeStyle = alpha(contrastInk, ecologyRoute.branch ? 0.4 : 0.5)
    context.globalAlpha = ecologyRoute.opacity
    context.lineWidth = Math.max(0.8, size * ecologyRoute.width * 0.1)
    context.setLineDash([
      size * (ecologyRoute.branch ? 0.032 : 0.064),
      size * (ecologyRoute.branch ? 0.024 : 0.04),
    ])
    context.lineDashOffset = harmonicMotion(
      options,
      ecologyRoute.id,
      'look.trail.route-dash',
    ) * motion * size * (0.04 + energy * 0.02)
    context.stroke(pathFrom(ecologyRoute.points))
  })
  context.setLineDash([])

  // A restrained amount of shedding is present at Low so the system already
  // reads as temporal. Mid inherits these events through unchanged routes.
  ecologyRoutes.forEach((ecologyRoute, routeIndex) => {
    const eventIndex = curvatureEvents(ecologyRoute.points, 1, 0.2)[0]
      ?? Math.floor(ecologyRoute.points.length * 0.5)
    const anchor = ecologyRoute.points[eventIndex]
    const frame = pathFrame(ecologyRoute.points, eventIndex)
    for (let fragment = 0; fragment < 4; fragment += 1) {
      const id = routeIndex * 20 + fragment
      const lag = size * (
        0.018 + chan(seed, id, 'look.trail.ecology.fragment.lag') * 0.07
      )
      const spread = (chan(seed, id, 'look.trail.ecology.fragment.spread') - 0.5)
        * size
        * 0.07
      const drift = harmonicMotion(options, id, 'look.trail.fragment')
        * motion
        * size
        * (0.007 + energy * 0.005)
      const x = anchor.x - frame.tangentX * lag + frame.normalX * (spread + drift)
      const y = anchor.y - frame.tangentY * lag + frame.normalY * (spread + drift)
      const length = size * (
        0.012 + chan(seed, id, 'look.trail.ecology.fragment.length') * 0.025
      )
      context.strokeStyle = fragment === 0 ? contrastInk : ecologyRoute.color
      context.globalAlpha = 0.36
        + chan(seed, id, 'look.trail.ecology.fragment.alpha') * 0.34
      context.lineWidth = Math.max(0.8, size * 0.0018)
      context.beginPath()
      context.moveTo(x, y)
      context.lineTo(
        x - frame.tangentX * length,
        y - frame.tangentY * length,
      )
      context.stroke()
    }
  })

  context.fillStyle = alpha(colors.dark, 0.32)
  context.globalAlpha = 1
  context.fill(variableRibbonPath(
    route,
    (point, progress, index) => routePressure(point, progress, index) * 1.28,
  ))
  const routeStart = route[0]
  const routeEnd = route.at(-1) ?? routeStart
  const routeFill = context.createLinearGradient(
    routeStart.x,
    routeStart.y,
    routeEnd.x,
    routeEnd.y,
  )
  routeFill.addColorStop(0, colors.support)
  routeFill.addColorStop(0.46, colors.dominant)
  routeFill.addColorStop(0.8, colors.accent)
  routeFill.addColorStop(1, colors.light)
  context.fillStyle = routeFill
  context.globalAlpha = 0.94
  context.fill(variableRibbonPath(route, routePressure))
  context.strokeStyle = alpha(colors.light, 0.72)
  context.globalAlpha = 1
  context.lineWidth = Math.max(1.1, size * 0.0032)
  context.stroke(pathFrom(route.slice(
    Math.floor(route.length * 0.28),
    Math.floor(route.length * 0.95),
  )))

  // Two open, asymmetric splices make a source-driven knot. Neither branch
  // closes, so the event cannot read as a coil or target.
  const knotIndex = Math.floor(route.length * [0.62, 0.74, 0.44][archetype])
  const knotAnchor = route[knotIndex]
  const knotFrame = pathFrame(route, knotIndex)
  const local = (along: number, normal: number): Point => ({
    x: knotAnchor.x
      + knotFrame.tangentX * along * size
      + knotFrame.normalX * normal * size,
    y: knotAnchor.y
      + knotFrame.tangentY * along * size
      + knotFrame.normalY * normal * size,
  })
  const eventSpecs: readonly (readonly (readonly (readonly [number, number])[])[])[] = [
    [
      [[-0.15, -0.02], [-0.08, 0.15], [0.04, -0.15], [0.15, 0.035]],
      [[-0.11, 0.11], [-0.045, 0.035], [0.035, -0.105], [0.12, -0.06]],
    ],
    [
      [[-0.16, -0.01], [-0.06, 0.015], [0.06, 0.1], [0.17, 0.16]],
      [[-0.12, 0.02], [-0.02, -0.015], [0.07, -0.11], [0.15, -0.14]],
    ],
    [
      [[-0.13, 0.08], [-0.05, -0.04], [0.02, 0.055], [0.12, -0.02]],
      [[-0.09, -0.08], [-0.015, 0.02], [0.045, 0.025], [0.1, 0.09]],
    ],
  ]
  const knotFirst = smoothInfluencedPath(influencedCubic(
    options,
    eventSpecs[archetype][0].map(([along, normal]) => local(along, normal)) as [
      Point,
      Point,
      Point,
      Point,
    ],
    30,
    'look.trail.knot.first',
    archetype === 1 ? 0.012 : 0.018,
    60,
  ), 3)
  const knotSecond = smoothInfluencedPath(influencedCubic(
    options,
    eventSpecs[archetype][1].map(([along, normal]) => local(along, normal)) as [
      Point,
      Point,
      Point,
      Point,
    ],
    31,
    'look.trail.knot.second',
    archetype === 1 ? 0.012 : 0.016,
    52,
  ), 3)
  const knotPressure = (point: InfluencedPoint, progress: number) =>
    size * (
      0.003
      + Math.sin(progress * Math.PI) ** 0.62 * (
        [0.021, 0.015, 0.018][archetype] + point.influence * 0.011
      )
    )
  context.fillStyle = alpha(colors.dark, 0.34)
  context.globalAlpha = 1
  context.fill(variableRibbonPath(
    knotSecond,
    (point, progress) => knotPressure(point, progress) * 1.45,
  ))
  context.fillStyle = colors.support
  context.globalAlpha = 0.76
  context.fill(variableRibbonPath(
    knotSecond,
    (point, progress) => knotPressure(point, progress) * 0.88,
  ))
  context.fillStyle = alpha(colors.dark, 0.34)
  context.globalAlpha = 1
  context.fill(variableRibbonPath(
    knotFirst,
    (point, progress) => knotPressure(point, progress) * 1.38,
  ))
  context.fillStyle = contrastInk
  context.globalAlpha = 0.92
  context.fill(variableRibbonPath(knotFirst, knotPressure))
  context.strokeStyle = alpha(colors.accent, 0.72)
  context.lineWidth = Math.max(1, size * 0.0024)
  context.stroke(pathFrom(knotFirst))

  if (level >= 2) {
    const edgeEvents = [
      [Math.floor(route.length * 0.03), Math.floor(route.length * 0.24)],
      [Math.floor(route.length * 0.8), Math.floor(route.length * 0.98)],
    ].map(([first, last]) => {
      let best = first
      for (let index = first + 1; index <= last; index += 1) {
        if (pathCurvature(route, index) > pathCurvature(route, best)) best = index
      }
      return best
    })
    const sources = [
      ...edgeEvents.map((index) => ({ points: route, index })),
      ...curvatureEvents(route, 3, 0.16).map((index) => ({ points: route, index })),
      ...ecologyRoutes.flatMap((ecologyRoute) =>
        curvatureEvents(ecologyRoute.points, ecologyRoute.branch ? 1 : 2, 0.18)
          .map((index) => ({ points: ecologyRoute.points, index }))),
      ...curvatureEvents(knotFirst, 2, 0.22).map((index) => ({
        points: knotFirst,
        index,
      })),
      ...curvatureEvents(knotSecond, 1, 0.22).map((index) => ({
        points: knotSecond,
        index,
      })),
    ]
    sources.forEach((source, sourceIndex) => {
      const anchor = source.points[source.index]
      const frame = pathFrame(source.points, source.index)
      for (let particle = 0; particle < 14; particle += 1) {
        const id = sourceIndex * 100 + particle
        const history = size * (
          0.018 + chan(seed, id, 'look.trail.particle.history') * 0.11
        )
        const spread = (chan(seed, id, 'look.trail.particle.spread') - 0.5)
          * size
          * 0.11
        const x = anchor.x - frame.tangentX * history + frame.normalX * spread
        const y = anchor.y - frame.tangentY * history + frame.normalY * spread
        const length = size * (
          0.009 + chan(seed, id, 'look.trail.particle.length') * 0.04
        )
        context.strokeStyle = sourceIndex < 2
          ? contrastInk
          : particle % 6 === 0 ? colors.light : colors.accent
        context.globalAlpha = 0.48
          + chan(seed, id, 'look.trail.particle.alpha') * 0.44
        context.lineWidth = Math.max(0.8, size * (particle % 7 === 0 ? 0.0035 : 0.0017))
        context.beginPath()
        context.moveTo(x, y)
        context.lineTo(
          x - frame.tangentX * length + frame.normalX * spread * 0.08,
          y - frame.tangentY * length + frame.normalY * spread * 0.08,
        )
        context.stroke()
        if (particle % 5 === 2) {
          const block = Math.max(1.2, size * 0.0038)
          context.fillStyle = colors.ink
          context.fillRect(x - block / 2, y - block / 2, block, block)
        }
      }
    })
  }
  context.globalAlpha = 1
  context.setLineDash([])
  context.restore()
}

export function renderBackgroundLook(
  context: CanvasRenderingContext2D,
  options: BackgroundLookOptions,
): boolean {
  if (options.width <= 0 || options.height <= 0 || !options.palette.length) return false
  const colors = directedColors(options)
  switch (options.id) {
    case 'frame':
      drawFrame(context, options, colors)
      return true
    case 'pixels':
      drawPixels(context, options, colors)
      return true
    case 'scanlines':
      drawScanlines(context, options, colors)
      return true
    case 'streams':
      drawStreams(context, options, colors)
      return true
    case 'beads':
      drawBeads(context, options, colors)
      return true
    case 'quilt':
      drawQuilt(context, options, colors)
      return true
    case 'weave':
      drawWeave(context, options, colors)
      return true
    case 'marks':
      drawMarks(context, options, colors)
      return true
    case 'trails':
      drawTrails(context, options, colors)
      return true
    case 'brushwork':
      return false
    default:
      return false
  }
}
