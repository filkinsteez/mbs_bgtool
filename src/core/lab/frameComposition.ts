import { chan } from '@/core/organic/random'
import type { LookColorPlan } from './colorDirection'
import type { Field } from './field'

const TAU = Math.PI * 2

export type FrameAspect = 'landscape' | 'square' | 'portrait'
export type FrameRailRole = 'hero' | 'support' | 'fine'
export type FrameBlockKind = 'coarse' | 'fine' | 'tab'

export type FramePoint = {
  x: number
  y: number
}

type FrameTopologyPoint = FramePoint & {
  normalX: number
  normalY: number
  progress: number
}

export type FrameQuietZone = {
  x: number
  y: number
  radiusAlong: number
  radiusAcross: number
  rotation: number
}

export type FrameTopologyRail = {
  id: string
  role: FrameRailRole
  level: number
  color: number
  alpha: number
  width: number
  motionOffset: number
  points: readonly FrameTopologyPoint[]
}

export type FrameTopologyBlock = {
  id: string
  kind: FrameBlockKind
  x: number
  y: number
  width: number
  height: number
  rotation: number
  color: number
  alpha: number
  motionOffset: number
}

export type FrameTopology = {
  width: number
  height: number
  aspect: FrameAspect
  portraitCoverage: number
  quietZone: FrameQuietZone
  paletteIndices: readonly number[]
  accentAreaFraction: number
  rails: readonly FrameTopologyRail[]
  blocks: readonly FrameTopologyBlock[]
}

export type FrameRail = Omit<FrameTopologyRail, 'motionOffset' | 'points'> & {
  points: readonly FramePoint[]
}

export type FrameBlock = Omit<FrameTopologyBlock, 'motionOffset'>

export type FrameComposition = Omit<FrameTopology, 'rails' | 'blocks'> & {
  rails: readonly FrameRail[]
  blocks: readonly FrameBlock[]
}

export type FrameTopologyInput = {
  field: Field
  width: number
  height: number
  seed: number
  complexity: number
  paletteSize: number
  colorPlan?: LookColorPlan
}

export type FrameMotionInput = {
  phase?: number
  amount: number
  speed: number
}

type Grid = {
  cols: number
  rows: number
  cellW: number
  cellH: number
  values: Float32Array
}

type EdgePoint = FramePoint & { key: number }
type Segment = { a: EdgePoint; b: EdgePoint }
type AnnotatedPath = {
  points: FrameTopologyPoint[]
  length: number
}
type PathRecord = {
  levelIndex: number
  pathIndex: number
  role: FrameRailRole
  path: AnnotatedPath
  gaps: readonly Gap[]
  motionOffset: number
}
type Gap = { center: number; halfWidth: number }

type FrameColors = {
  active: number[]
  structural: number[]
  hero: number
  accent: number | null
  accentAreaLimit: number
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1
}

function classifyAspect(width: number, height: number): FrameAspect {
  const ratio = width / Math.max(1, height)
  if (ratio < 0.92) return 'portrait'
  if (ratio > 1.12) return 'landscape'
  return 'square'
}

function roleForLevel(index: number, count: number, complexity: number): FrameRailRole {
  const heroA = Math.round((count - 1) * 0.24)
  const heroB = Math.round((count - 1) * 0.72)
  if (index === heroA || index === heroB) return 'hero'
  if (complexity > 0.56 && index % 3 === 0) return 'fine'
  return 'support'
}

function roleWidth(role: FrameRailRole, minDimension: number): number {
  if (role === 'hero') return Math.max(1.8, minDimension * 0.0052)
  if (role === 'support') return Math.max(0.85, minDimension * 0.00215)
  return Math.max(0.55, minDimension * 0.00105)
}

function frameColors(
  paletteSize: number,
  complexity: number,
  plan?: LookColorPlan,
): FrameColors {
  const size = Math.max(1, paletteSize)
  if (!plan) {
    const limit = Math.min(size, complexity < 0.34 ? 3 : 4)
    const active = Array.from({ length: limit }, (_, index) => index)
    return {
      active,
      structural: active,
      hero: active[0] ?? 0,
      accent: active.at(-1) ?? null,
      accentAreaLimit: 0.09,
    }
  }

  const requestedLimit = complexity < 0.34 ? 3 : 4
  const limit = Math.max(1, Math.min(size, requestedLimit, plan.localColorLimit))
  const candidates = [
    plan.roles.ink,
    plan.roles.dominant,
    ...plan.roles.support,
    plan.roles.accent,
    ...[...plan.depthOrder].reverse(),
  ]
  const active: number[] = []
  for (const index of candidates) {
    if (index === null || index < 0 || index >= size || index === plan.roles.ground) continue
    if (!active.includes(index)) active.push(index)
    if (active.length >= limit) break
  }
  if (!active.length) active.push(Math.max(0, Math.min(size - 1, plan.roles.ground)))

  const accent = plan.roles.accent !== null && active.includes(plan.roles.accent)
    ? plan.roles.accent
    : null
  const structural = active.filter((index) => index !== accent)
  if (!structural.length) structural.push(active[0])
  return {
    active,
    structural,
    hero: active.includes(plan.roles.ink) && plan.roles.ink !== accent
      ? plan.roles.ink
      : structural[0],
    accent,
    accentAreaLimit: plan.accentAreaLimit,
  }
}

function buildGrid(input: FrameTopologyInput, complexity: number): {
  grid: Grid
  aspect: FrameAspect
  portraitCoverage: number
} {
  const { field, width, height, seed } = input
  const aspect = classifyAspect(width, height)
  const ratio = width / Math.max(1, height)
  const portraitScale = aspect === 'portrait'
    ? Math.max(0.48, Math.min(0.9, ratio))
    : 1
  const targetCenterY = height * (
    aspect === 'portrait'
      ? 0.5 + (chan(seed, 0, 'lab.frame.portrait.center') - 0.5) * 0.055
      : 0.5
  )
  const budget = 144 + Math.round(complexity * 48)
  const longest = Math.max(width, height, 1)
  const cols = Math.max(18, Math.round((budget * width) / longest))
  const rows = Math.max(18, Math.round((budget * height) / longest))
  const cellW = width / cols
  const cellH = height / rows
  const values = new Float32Array((cols + 1) * (rows + 1))

  for (let row = 0; row <= rows; row += 1) {
    const y = row * cellH
    const sampleY = height / 2 + (y - targetCenterY) * portraitScale
    for (let column = 0; column <= cols; column += 1) {
      const x = column * cellW
      values[row * (cols + 1) + column] = field(x, sampleY)
    }
  }

  return {
    grid: { cols, rows, cellW, cellH, values },
    aspect,
    portraitCoverage: portraitScale,
  }
}

function interpolate(amountA: number, amountB: number): number {
  const denominator = amountA - amountB
  if (Math.abs(denominator) < 1e-9) return 0.5
  return Math.max(0, Math.min(1, amountA / denominator))
}

function segmentsAtLevel(grid: Grid, level: number): Segment[] {
  const { cols, rows, cellW, cellH, values } = grid
  const vertexWidth = cols + 1
  const horizontalCount = (rows + 1) * cols
  const at = (column: number, row: number) => values[row * vertexWidth + column]
  const horizontalKey = (column: number, row: number) => row * cols + column
  const verticalKey = (column: number, row: number) =>
    horizontalCount + row * (cols + 1) + column
  const output: Segment[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      const v0 = at(column, row) - level
      const v1 = at(column + 1, row) - level
      const v2 = at(column + 1, row + 1) - level
      const v3 = at(column, row + 1) - level
      let mask = 0
      if (v0 < 0) mask |= 1
      if (v1 < 0) mask |= 2
      if (v2 < 0) mask |= 4
      if (v3 < 0) mask |= 8
      if (mask === 0 || mask === 15) continue

      const x = column * cellW
      const y = row * cellH
      const top = (): EdgePoint => ({
        x: x + interpolate(v0, v1) * cellW,
        y,
        key: horizontalKey(column, row),
      })
      const right = (): EdgePoint => ({
        x: x + cellW,
        y: y + interpolate(v1, v2) * cellH,
        key: verticalKey(column + 1, row),
      })
      const bottom = (): EdgePoint => ({
        x: x + interpolate(v3, v2) * cellW,
        y: y + cellH,
        key: horizontalKey(column, row + 1),
      })
      const left = (): EdgePoint => ({
        x,
        y: y + interpolate(v0, v3) * cellH,
        key: verticalKey(column, row),
      })
      const add = (a: EdgePoint, b: EdgePoint) => output.push({ a, b })

      switch (mask) {
        case 1: case 14: add(left(), top()); break
        case 2: case 13: add(top(), right()); break
        case 3: case 12: add(left(), right()); break
        case 4: case 11: add(right(), bottom()); break
        case 6: case 9: add(top(), bottom()); break
        case 7: case 8: add(left(), bottom()); break
        case 5: add(left(), top()); add(right(), bottom()); break
        case 10: add(top(), right()); add(left(), bottom()); break
      }
    }
  }
  return output
}

function traceSegments(segments: readonly Segment[]): FramePoint[][] {
  type Connection = { segment: number; end: 0 | 1 }
  const adjacency = new Map<number, Connection[]>()
  const visited = new Uint8Array(segments.length)
  const connect = (key: number, connection: Connection) => {
    const connections = adjacency.get(key)
    if (connections) connections.push(connection)
    else adjacency.set(key, [connection])
  }
  segments.forEach((segment, index) => {
    connect(segment.a.key, { segment: index, end: 0 })
    connect(segment.b.key, { segment: index, end: 1 })
  })

  const paths: FramePoint[][] = []
  const trace = (firstSegment: number, firstEnd: 0 | 1) => {
    const points: FramePoint[] = []
    let segmentIndex = firstSegment
    let entryEnd = firstEnd
    while (!visited[segmentIndex]) {
      const segment = segments[segmentIndex]
      const entry = entryEnd === 0 ? segment.a : segment.b
      const exit = entryEnd === 0 ? segment.b : segment.a
      if (!points.length) points.push({ x: entry.x, y: entry.y })
      points.push({ x: exit.x, y: exit.y })
      visited[segmentIndex] = 1
      const next = adjacency.get(exit.key)?.find((candidate) => !visited[candidate.segment])
      if (!next) break
      segmentIndex = next.segment
      entryEnd = next.end
    }
    if (points.length > 1) paths.push(points)
  }

  segments.forEach((segment, index) => {
    if (visited[index]) return
    const degreeA = adjacency.get(segment.a.key)?.length ?? 0
    const degreeB = adjacency.get(segment.b.key)?.length ?? 0
    if (degreeA === 1 || degreeB === 1) trace(index, degreeA === 1 ? 0 : 1)
  })
  segments.forEach((_, index) => {
    if (!visited[index]) trace(index, 0)
  })
  return paths
}

function annotatePath(points: readonly FramePoint[]): AnnotatedPath {
  const cumulative = new Float64Array(points.length)
  for (let index = 1; index < points.length; index += 1) {
    cumulative[index] = cumulative[index - 1] + Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    )
  }
  const length = cumulative.at(-1) ?? 0
  const annotated = points.map((point, index): FrameTopologyPoint => {
    const previous = points[Math.max(0, index - 1)]
    const next = points[Math.min(points.length - 1, index + 1)]
    const dx = next.x - previous.x
    const dy = next.y - previous.y
    const magnitude = Math.hypot(dx, dy) || 1
    return {
      ...point,
      normalX: -dy / magnitude,
      normalY: dx / magnitude,
      progress: length > 0 ? cumulative[index] / length : 0,
    }
  })
  return { points: annotated, length }
}

function pointAtProgress(path: AnnotatedPath, progress: number): FrameTopologyPoint {
  const target = clamp01(progress)
  const points = path.points
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].progress < target) continue
    const start = points[index - 1]
    const end = points[index]
    const span = Math.max(1e-6, end.progress - start.progress)
    const amount = (target - start.progress) / span
    const normalX = start.normalX + (end.normalX - start.normalX) * amount
    const normalY = start.normalY + (end.normalY - start.normalY) * amount
    const normalLength = Math.hypot(normalX, normalY) || 1
    return {
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount,
      normalX: normalX / normalLength,
      normalY: normalY / normalLength,
      progress: target,
    }
  }
  return points.at(-1) ?? { x: 0, y: 0, normalX: 0, normalY: 1, progress: 1 }
}

function gapsForPath(
  seed: number,
  levelIndex: number,
  pathIndex: number,
  role: FrameRailRole,
  complexity: number,
): Gap[] {
  const count = role === 'hero'
    ? 2
    : role === 'support'
      ? 2 + Math.round(complexity)
      : 3 + Math.round(complexity)
  const baseWidth = role === 'hero' ? 0.065 : role === 'support' ? 0.047 : 0.034
  const address = levelIndex * 31 + pathIndex
  const offset = chan(seed, address, 'lab.frame.gap.offset') / count
  return Array.from({ length: count }, (_, index) => {
    const jitter = (chan(seed, address * 7 + index, 'lab.frame.gap.jitter') - 0.5) * 0.34
    const widthScale = 0.78 + chan(seed, address * 11 + index, 'lab.frame.gap.width') * 0.56
    return {
      center: wrap01(offset + (index + 0.5 + jitter) / count),
      halfWidth: baseWidth * widthScale * 0.5,
    }
  })
}

function inGap(progress: number, gaps: readonly Gap[]): boolean {
  return gaps.some((gap) => {
    const distance = Math.abs(progress - gap.center)
    return Math.min(distance, 1 - distance) < gap.halfWidth
  })
}

export function pointInFrameQuietZone(
  point: FramePoint,
  quietZone: FrameQuietZone,
  scale = 1,
): boolean {
  const cos = Math.cos(quietZone.rotation)
  const sin = Math.sin(quietZone.rotation)
  const dx = point.x - quietZone.x
  const dy = point.y - quietZone.y
  const along = dx * cos + dy * sin
  const across = -dx * sin + dy * cos
  return (
    (along / Math.max(1, quietZone.radiusAlong * scale)) ** 2
    + (across / Math.max(1, quietZone.radiusAcross * scale)) ** 2
  ) < 1
}

function quietZoneFor(
  seed: number,
  minDimension: number,
  records: readonly PathRecord[],
): FrameQuietZone {
  const source = [...records]
    .filter((record) => record.role === 'hero')
    .sort((a, b) => b.path.length - a.path.length)[0]
    ?? [...records].sort((a, b) => b.path.length - a.path.length)[0]
  const anchor = source
    ? pointAtProgress(
        source.path,
        0.12 + chan(seed, 0, 'lab.frame.quiet.anchor') * 0.76,
      )
    : { x: minDimension / 2, y: minDimension / 2, normalX: 0, normalY: 1, progress: 0 }
  const tangentAngle = Math.atan2(-anchor.normalX, anchor.normalY)
  return {
    x: anchor.x,
    y: anchor.y,
    radiusAlong: minDimension * (
      0.13 + chan(seed, 0, 'lab.frame.quiet.along') * 0.045
    ),
    radiusAcross: minDimension * (
      0.068 + chan(seed, 0, 'lab.frame.quiet.across') * 0.027
    ),
    rotation: tangentAngle,
  }
}

function railColor(
  colors: FrameColors,
  role: FrameRailRole,
  levelIndex: number,
  pathIndex: number,
): number {
  if (role === 'hero') {
    return levelIndex % 2 === 0
      ? colors.hero
      : colors.structural[(levelIndex + pathIndex) % colors.structural.length]
  }
  const offset = role === 'fine' ? 1 : 0
  return colors.structural[(levelIndex + pathIndex + offset) % colors.structural.length]
}

function buildRailRuns(
  input: FrameTopologyInput,
  records: readonly PathRecord[],
  quietZone: FrameQuietZone,
  colors: FrameColors,
): FrameTopologyRail[] {
  const minDimension = Math.min(input.width, input.height)
  const runs: FrameTopologyRail[] = []

  for (const record of records) {
    const { levelIndex, pathIndex, role, path, gaps, motionOffset } = record
    const baseWidth = roleWidth(role, minDimension)
    const styleOffset = chan(
      input.seed,
      levelIndex * 37 + pathIndex,
      'lab.frame.width.offset',
    )
    const styleSlots = role === 'hero' ? 7 : role === 'support' ? 9 : 11
    let activeKey = ''
    let activePoints: FrameTopologyPoint[] = []
    let activeWidth = baseWidth
    let activeColor = railColor(colors, role, levelIndex, pathIndex)
    let runIndex = 0

    const flush = () => {
      if (activePoints.length < 2) {
        activePoints = []
        activeKey = ''
        return
      }
      runs.push({
        id: `rail-${levelIndex}-${pathIndex}-${runIndex}`,
        role,
        level: levelIndex,
        color: activeColor,
        alpha: role === 'hero' ? 0.98 : role === 'support' ? 0.72 : 0.46,
        width: activeWidth,
        motionOffset,
        points: activePoints,
      })
      runIndex += 1
      activePoints = []
      activeKey = ''
    }

    for (let index = 1; index < path.points.length; index += 1) {
      const start = path.points[index - 1]
      const end = path.points[index]
      const progress = (start.progress + end.progress) / 2
      const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
      const quietScale = role === 'hero' ? 1.08 : role === 'support' ? 1 : 0.92
      if (inGap(progress, gaps) || pointInFrameQuietZone(midpoint, quietZone, quietScale)) {
        flush()
        continue
      }

      const slot = Math.floor(wrap01(progress + styleOffset) * styleSlots)
      const widthPattern = role === 'hero'
        ? [1.22, 0.78, 1, 1.42, 0.9]
        : role === 'support'
          ? [1, 0.72, 1.18, 0.86]
          : [0.76, 1, 0.64, 1.12]
      const width = baseWidth * widthPattern[slot % widthPattern.length]
      const color = railColor(
        colors,
        role,
        levelIndex + (slot % (role === 'hero' ? 4 : 2) === 0 ? 1 : 0),
        pathIndex,
      )
      const styleKey = `${slot % widthPattern.length}:${color}`
      if (styleKey !== activeKey) {
        flush()
        activeKey = styleKey
        activeWidth = width
        activeColor = color
        activePoints = [start, end]
      } else {
        activePoints.push(end)
      }
    }
    flush()
  }
  return runs
}

function clampBlock(block: FrameTopologyBlock, width: number, height: number): FrameTopologyBlock {
  const radius = Math.hypot(block.width, block.height) * 0.5
  return {
    ...block,
    x: Math.max(-radius * 0.35, Math.min(width + radius * 0.35, block.x)),
    y: Math.max(-radius * 0.35, Math.min(height + radius * 0.35, block.y)),
  }
}

function buildBlocks(
  input: FrameTopologyInput,
  aspect: FrameAspect,
  records: readonly PathRecord[],
  quietZone: FrameQuietZone,
  colors: FrameColors,
): { blocks: FrameTopologyBlock[]; accentAreaFraction: number } {
  const complexity = clamp01(input.complexity)
  const minDimension = Math.min(input.width, input.height)
  const heroRecords = [...records]
    .filter((record) => record.role === 'hero')
    .sort((a, b) => b.path.length - a.path.length)
  const sources = heroRecords.length
    ? heroRecords
    : [...records].sort((a, b) => b.path.length - a.path.length)
  if (!sources.length) return { blocks: [], accentAreaFraction: 0 }

  const unit = minDimension * (0.034 - complexity * 0.008)
  const clusterCount = 4 + Math.round(complexity * 4) + (aspect === 'portrait' ? 1 : 0)
  const blocks: FrameTopologyBlock[] = []
  let accentArea = 0
  let accentUsed = false

  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const source = sources[cluster % Math.min(2, sources.length)]
    const jitter = (chan(input.seed, cluster, 'lab.frame.block.anchor') - 0.5) * 0.08
    let progress = wrap01((cluster + 0.35) / clusterCount + jitter)
    let anchor = pointAtProgress(source.path, progress)
    if (pointInFrameQuietZone(anchor, quietZone, 1.32)) {
      progress = wrap01(progress + 0.15)
      anchor = pointAtProgress(source.path, progress)
    }
    const tangentX = anchor.normalY
    const tangentY = -anchor.normalX
    const tangentAngle = Math.atan2(tangentY, tangentX)
    const rotation = Math.round(tangentAngle / (Math.PI / 2)) * (Math.PI / 2)
    const side = chan(input.seed, cluster, 'lab.frame.block.side') > 0.5 ? 1 : -1
    const offset = unit * (1.15 + chan(input.seed, cluster, 'lab.frame.block.offset') * 1.25)
    const centerX = anchor.x + anchor.normalX * offset * side
    const centerY = anchor.y + anchor.normalY * offset * side
    const major = unit * (2.5 + chan(input.seed, cluster, 'lab.frame.block.major') * 2.2)
    const minor = unit * (1.05 + chan(input.seed, cluster, 'lab.frame.block.minor') * 0.85)
    const clusterColor = colors.structural[cluster % colors.structural.length]
    blocks.push(clampBlock({
      id: `block-${cluster}-coarse`,
      kind: 'coarse',
      x: centerX,
      y: centerY,
      width: major,
      height: minor,
      rotation,
      color: clusterColor,
      alpha: 0.9,
      motionOffset: chan(input.seed, cluster, 'lab.frame.block.motion') * TAU,
    }, input.width, input.height))

    const fineCount = 3 + Math.round(complexity * 4)
    const step = unit * 0.94
    for (let fine = 0; fine < fineCount; fine += 1) {
      const along = (fine - (fineCount - 1) / 2) * step
      const across = minor * (
        0.85 + (fine % 2) * 0.38
      ) * (side > 0 ? -1 : 1)
      const fineX = centerX + tangentX * along + anchor.normalX * across
      const fineY = centerY + tangentY * along + anchor.normalY * across
      if (pointInFrameQuietZone({ x: fineX, y: fineY }, quietZone, 1.08)) continue
      blocks.push(clampBlock({
        id: `block-${cluster}-fine-${fine}`,
        kind: 'fine',
        x: fineX,
        y: fineY,
        width: unit * (0.58 + (fine % 3) * 0.2),
        height: unit * (0.52 + ((fine + cluster) % 2) * 0.24),
        rotation,
        color: colors.structural[(cluster + fine + 1) % colors.structural.length],
        alpha: 0.86,
        motionOffset: chan(
          input.seed,
          cluster * 17 + fine,
          'lab.frame.block.fine.motion',
        ) * TAU,
      }, input.width, input.height))
    }
  }

  const primaryHeroByLevel = new Map<number, PathRecord>()
  for (const record of heroRecords) {
    if (!primaryHeroByLevel.has(record.levelIndex)) {
      primaryHeroByLevel.set(record.levelIndex, record)
    }
  }
  for (const record of [...primaryHeroByLevel.values()].slice(0, 2)) {
    for (let gapIndex = 0; gapIndex < Math.min(2, record.gaps.length); gapIndex += 1) {
      const gap = record.gaps[gapIndex]
      const anchor = pointAtProgress(record.path, wrap01(gap.center + gap.halfWidth))
      if (pointInFrameQuietZone(anchor, quietZone, 0.88)) continue
      const tabWidth = roleWidth('hero', minDimension) * (
        5.5 + chan(input.seed, record.levelIndex * 5 + gapIndex, 'lab.frame.tab.width') * 2.8
      )
      const tabHeight = roleWidth('hero', minDimension) * 2.1
      const useAccent = !accentUsed
        && colors.accent !== null
        && (accentArea + tabWidth * tabHeight) / (input.width * input.height)
          <= colors.accentAreaLimit
      const color = useAccent ? colors.accent! : colors.hero
      if (useAccent) {
        accentUsed = true
        accentArea += tabWidth * tabHeight
      }
      blocks.push(clampBlock({
        id: `tab-${record.levelIndex}-${gapIndex}`,
        kind: 'tab',
        x: anchor.x,
        y: anchor.y,
        width: tabWidth,
        height: tabHeight,
        rotation: Math.atan2(-anchor.normalX, anchor.normalY),
        color,
        alpha: 1,
        motionOffset: record.motionOffset,
      }, input.width, input.height))
    }
  }

  return {
    blocks,
    accentAreaFraction: accentArea / Math.max(1, input.width * input.height),
  }
}

export function buildFrameTopology(input: FrameTopologyInput): FrameTopology {
  const width = Math.max(1, input.width)
  const height = Math.max(1, input.height)
  const complexity = clamp01(input.complexity)
  const normalizedInput = { ...input, width, height, complexity }
  const minDimension = Math.min(width, height)
  const colors = frameColors(input.paletteSize, complexity, input.colorPlan)
  const { grid, aspect, portraitCoverage } = buildGrid(normalizedInput, complexity)
  const levelCount = 5 + Math.round(complexity * 5)
  const records: PathRecord[] = []

  for (let levelIndex = 0; levelIndex < levelCount; levelIndex += 1) {
    const amount = levelIndex / Math.max(1, levelCount - 1)
    const level = 0.16 + amount * 0.68
    const role = roleForLevel(levelIndex, levelCount, complexity)
    const maxPaths = 2 + Math.round(complexity * 2)
    const paths = traceSegments(segmentsAtLevel(grid, level))
      .map(annotatePath)
      .filter((path) => path.length >= minDimension * 0.11)
      .sort((a, b) => b.length - a.length)
      .slice(0, maxPaths)
    paths.forEach((path, pathIndex) => {
      records.push({
        levelIndex,
        pathIndex,
        role,
        path,
        gaps: gapsForPath(input.seed, levelIndex, pathIndex, role, complexity),
        motionOffset: chan(
          input.seed,
          levelIndex * 41 + pathIndex,
          'lab.frame.rail.motion',
        ) * TAU,
      })
    })
  }

  const quietZone = quietZoneFor(input.seed, minDimension, records)
  const rails = buildRailRuns(normalizedInput, records, quietZone, colors)
  const { blocks, accentAreaFraction } = buildBlocks(
    normalizedInput,
    aspect,
    records,
    quietZone,
    colors,
  )
  const paletteIndices = Array.from(new Set([
    ...rails.map((rail) => rail.color),
    ...blocks.map((block) => block.color),
  ]))

  return {
    width,
    height,
    aspect,
    portraitCoverage,
    quietZone,
    paletteIndices,
    accentAreaFraction,
    rails,
    blocks,
  }
}

export function frameCompositionAt(
  topology: FrameTopology,
  motion: FrameMotionInput,
): FrameComposition {
  const phase = wrap01(motion.phase ?? 0)
  const amount = motion.phase === undefined ? 0 : clamp01(motion.amount)
  const energy = clamp01((motion.speed - 0.1) / 1.9)
  const minDimension = Math.min(topology.width, topology.height)
  const theta = phase * TAU
  const railAmplitude = minDimension * 0.009 * amount
  const blockAmplitude = minDimension * 0.006 * amount

  const rails = topology.rails.map((rail): FrameRail => ({
    id: rail.id,
    role: rail.role,
    level: rail.level,
    color: rail.color,
    alpha: rail.alpha,
    width: rail.width,
    points: rail.points.map((point) => {
      const primary = Math.sin(
        theta + point.progress * TAU * 2 + rail.motionOffset,
      )
      const secondary = Math.sin(
        theta * 2 - point.progress * TAU * 3 - rail.motionOffset * 0.61,
      )
      const displacement = railAmplitude * (
        primary * (0.72 + energy * 0.1) + secondary * (0.18 + energy * 0.18)
      )
      return {
        x: point.x + point.normalX * displacement,
        y: point.y + point.normalY * displacement,
      }
    }),
  }))

  const blocks = topology.blocks.map((block): FrameBlock => {
    const travel = blockAmplitude * (block.kind === 'coarse' ? 0.72 : 1)
    return {
      id: block.id,
      kind: block.kind,
      x: block.x + Math.cos(theta + block.motionOffset) * travel,
      y: block.y + Math.sin(theta * 2 - block.motionOffset) * travel * 0.72,
      width: block.width,
      height: block.height,
      rotation: block.rotation
        + Math.sin(theta + block.motionOffset) * amount * (block.kind === 'tab' ? 0.035 : 0.018),
      color: block.color,
      alpha: block.alpha,
    }
  })

  return {
    width: topology.width,
    height: topology.height,
    aspect: topology.aspect,
    portraitCoverage: topology.portraitCoverage,
    quietZone: topology.quietZone,
    paletteIndices: topology.paletteIndices,
    accentAreaFraction: topology.accentAreaFraction,
    rails,
    blocks,
  }
}
