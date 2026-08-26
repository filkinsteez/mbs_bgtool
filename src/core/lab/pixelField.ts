import {
  META_SYMBOL_HEIGHT,
  META_SYMBOL_WIDTH,
  sampleMetaSymbol,
} from '@/core/metaSymbol'
import { chan } from '@/core/organic/random'
import type { LookColorPlan } from './colorDirection'
import type { CompositionPlan } from './compositionPlan'

// Pixels owns a normalized, source-independent topology. Complexity chooses
// the canonical grid once; output resolution only scales it, and motion never
// enters this planner. That keeps preview/export geometry aligned and lets the
// painter animate a few bounded overlays without reshuffling the field.
const TAU = Math.PI * 2
const PLAN_REVISION = 1

export type PixelBlockScale = 'macro' | 'meso' | 'micro'
export type PixelColorRole = 'dominant' | 'support' | 'accent'

export type PixelGlitch = {
  axis: 'x' | 'y'
  direction: -1 | 1
  maxOffset: number
  bandStart: number
  bandSize: number
  harmonic: 1 | 2 | 3
  phase: number
  secondaryPhase: number
  colorIndex: number
}

export type PixelFieldTile = {
  id: number
  column: number
  row: number
  columnSpan: number
  rowSpan: number
  x: number
  y: number
  width: number
  height: number
  scale: PixelBlockScale
  role: PixelColorRole
  colorIndex: number
  edgeExposure: number
  protected: boolean
  glitch: PixelGlitch | null
}

export type PixelFieldPlan = {
  revision: typeof PLAN_REVISION
  columns: number
  rows: number
  tiles: readonly PixelFieldTile[]
  masks: {
    active: Uint8Array
    protected: Uint8Array
    quiet: Uint8Array
  }
  quietZone: {
    x: number
    y: number
    radiusX: number
    radiusY: number
    rotation: number
  }
  colorHierarchy: {
    ground: number
    dominant: number
    support: readonly number[]
    accent: number
    visible: readonly number[]
  }
  diagnostics: {
    activeCellCount: number
    protectedCellCount: number
    quietCellCount: number
    accentArea: number
    glitchArea: number
    scaleCounts: Record<PixelBlockScale, number>
  }
}

export type PixelFieldInput = {
  seed: number
  complexity: number
  aspect: number
  paletteSize: number
  colorPlan?: LookColorPlan
  composition?: CompositionPlan
}

export type PixelGlitchFrame = {
  offset: number
  bandShift: number
}

type QuietZone = PixelFieldPlan['quietZone']
type GridCandidate = {
  column: number
  row: number
  size: number
  score: number
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function normalizedPhase(value: number): number {
  return ((value % 1) + 1) % 1
}

function rangesOverlap(
  aStart: number,
  aSpan: number,
  bStart: number,
  bSpan: number,
): boolean {
  return aStart < bStart + bSpan && bStart < aStart + aSpan
}

function candidatesOverlap(a: GridCandidate, b: GridCandidate): boolean {
  return rangesOverlap(a.column, a.size, b.column, b.size)
    && rangesOverlap(a.row, a.size, b.row, b.size)
}

function paletteHierarchy(
  paletteSize: number,
  colorPlan?: LookColorPlan,
): PixelFieldPlan['colorHierarchy'] {
  const size = Math.max(1, paletteSize)
  const valid = (index: number | null | undefined): index is number =>
    index != null && index >= 0 && index < size
  const ground = valid(colorPlan?.roles.ground) ? colorPlan.roles.ground : size - 1
  const depthOrder = colorPlan?.depthOrder.filter(valid) ?? Array.from(
    { length: size },
    (_, index) => index,
  )
  const visiblePool = depthOrder.filter((index) => index !== ground)
  if (!visiblePool.length) visiblePool.push(ground)
  const localLimit = Math.max(
    1,
    Math.min(visiblePool.length, colorPlan?.localColorLimit ?? visiblePool.length),
  )
  const plannedDominant = colorPlan?.roles.dominant
  const dominant = valid(plannedDominant) && plannedDominant !== ground
    ? plannedDominant
    : visiblePool[0]
  const plannedSupport = colorPlan?.roles.support.filter(
    (index) => valid(index) && index !== ground && index !== dominant,
  ) ?? []
  const plannedAccent = colorPlan?.roles.accent
  const accentCandidate = valid(plannedAccent) && plannedAccent !== ground
    ? plannedAccent
    : visiblePool.at(-1) ?? dominant
  const visible = [...new Set([
    dominant,
    ...plannedSupport,
    ...visiblePool,
  ])].slice(0, localLimit)
  if (
    localLimit > 1
    && accentCandidate !== dominant
    && !visible.includes(accentCandidate)
  ) {
    visible[visible.length - 1] = accentCandidate
  }
  const accent = visible.includes(accentCandidate) ? accentCandidate : dominant
  const support = visible.filter((index) => index !== dominant && index !== accent)

  return {
    ground,
    dominant,
    support: support.length ? support : [dominant],
    accent,
    visible,
  }
}

function gridDimensions(complexity: number, aspect: number): {
  columns: number
  rows: number
} {
  const longCells = 40 + Math.round(clamp01(complexity) * 40)
  if (aspect >= 1) {
    return {
      columns: longCells,
      rows: Math.max(20, Math.round(longCells / aspect)),
    }
  }
  return {
    columns: Math.max(20, Math.round(longCells * aspect)),
    rows: longCells,
  }
}

function metaSample(u: number, v: number, aspect: number) {
  const symbolScale = 0.86 * Math.min(
    aspect / META_SYMBOL_WIDTH,
    1 / META_SYMBOL_HEIGHT,
  )
  const x = ((u - 0.5) * aspect) / symbolScale + META_SYMBOL_WIDTH / 2
  const y = (v - 0.5) / symbolScale + META_SYMBOL_HEIGHT / 2
  const sample = sampleMetaSymbol(x, y)
  return {
    inside: sample.inside,
    distance: sample.distance * symbolScale,
  }
}

function floodExterior(
  inside: Uint8Array,
  columns: number,
  rows: number,
): Uint8Array {
  const exterior = new Uint8Array(inside.length)
  const queue = new Int32Array(inside.length)
  let read = 0
  let write = 0
  const push = (column: number, row: number) => {
    if (column < 0 || column >= columns || row < 0 || row >= rows) return
    const index = row * columns + column
    if (inside[index] || exterior[index]) return
    exterior[index] = 1
    queue[write] = index
    write += 1
  }

  for (let column = 0; column < columns; column += 1) {
    push(column, 0)
    push(column, rows - 1)
  }
  for (let row = 1; row < rows - 1; row += 1) {
    push(0, row)
    push(columns - 1, row)
  }

  while (read < write) {
    const index = queue[read]
    read += 1
    const column = index % columns
    const row = Math.floor(index / columns)
    push(column - 1, row)
    push(column + 1, row)
    push(column, row - 1)
    push(column, row + 1)
  }
  return exterior
}

function quietZoneCandidates(
  input: PixelFieldInput,
  aspect: number,
): QuietZone[] {
  const { seed, composition } = input
  const radiusY = 0.12 + chan(seed, 0, 'lab.pixel.quiet.radius') * 0.055
  const stretch = 1.15 + chan(seed, 1, 'lab.pixel.quiet.radius') * 0.48
  const radiusX = Math.min(0.26, radiusY * stretch / Math.max(0.62, aspect))
  const rotation = (composition?.field.angle ?? chan(seed, 0, 'lab.pixel.quiet.angle') * TAU)
    + Math.PI / 2
  const candidates: QuietZone[] = []

  for (const shape of composition?.quietShapes ?? []) {
    candidates.push({
      x: shape.x,
      y: shape.y,
      radiusX: Math.max(radiusX, Math.min(0.28, shape.radiusX * 0.82)),
      radiusY: Math.max(radiusY, Math.min(0.22, shape.radiusY * 0.9)),
      rotation: shape.rotation,
    })
  }

  const angle = composition?.field.angle ?? chan(seed, 0, 'lab.pixel.quiet.angle') * TAU
  for (let index = 0; index < 8; index += 1) {
    const theta = angle + index * TAU / 8
    const distance = 0.29 + (index % 2) * 0.055
    candidates.push({
      x: 0.5 + Math.cos(theta) * distance / Math.max(1, aspect * 0.86),
      y: 0.5 + Math.sin(theta) * distance,
      radiusX,
      radiusY,
      rotation,
    })
  }
  return candidates
}

function quietZoneScore(zone: QuietZone, aspect: number, seed: number, id: number): number {
  let overlap = 0
  const samples = 24
  for (let index = 0; index < samples; index += 1) {
    const theta = index * TAU / samples
    const cos = Math.cos(zone.rotation)
    const sin = Math.sin(zone.rotation)
    const localX = Math.cos(theta) * zone.radiusX * 0.72
    const localY = Math.sin(theta) * zone.radiusY * 0.72
    const x = zone.x + localX * cos - localY * sin
    const y = zone.y + localX * sin + localY * cos
    if (metaSample(x, y, aspect).inside) overlap += 1
  }
  const edgePenalty = (
    Math.max(0, zone.radiusX + 0.025 - zone.x)
    + Math.max(0, zone.x + zone.radiusX + 0.025 - 1)
    + Math.max(0, zone.radiusY + 0.025 - zone.y)
    + Math.max(0, zone.y + zone.radiusY + 0.025 - 1)
  ) * 20
  return overlap / samples + edgePenalty + chan(seed, id, 'lab.pixel.quiet.tie') * 0.015
}

function resolveQuietZone(input: PixelFieldInput, aspect: number): QuietZone {
  const candidates = quietZoneCandidates(input, aspect)
  return candidates
    .map((zone, index) => ({
      zone: {
        ...zone,
        x: Math.max(zone.radiusX + 0.025, Math.min(1 - zone.radiusX - 0.025, zone.x)),
        y: Math.max(zone.radiusY + 0.025, Math.min(1 - zone.radiusY - 0.025, zone.y)),
      },
      index,
    }))
    .sort((a, b) =>
      quietZoneScore(a.zone, aspect, input.seed, a.index)
      - quietZoneScore(b.zone, aspect, input.seed, b.index))[0].zone
}

function inQuietZone(u: number, v: number, zone: QuietZone): boolean {
  const cos = Math.cos(zone.rotation)
  const sin = Math.sin(zone.rotation)
  const dx = u - zone.x
  const dy = v - zone.y
  const x = (dx * cos + dy * sin) / zone.radiusX
  const y = (-dx * sin + dy * cos) / zone.radiusY
  return x * x + y * y <= 1
}

function massAt(
  input: PixelFieldInput,
  u: number,
  v: number,
  quietZone: QuietZone,
): number {
  const { seed, composition } = input
  const aspect = Math.max(0.25, Math.min(4, input.aspect))
  const meta = metaSample(u, v, aspect)
  const halo = meta.inside ? 1 : Math.exp(-((meta.distance / 0.075) ** 2))
  let cluster = 0
  const anchors = composition?.anchors ?? [{
    x: 0.5,
    y: 0.5,
    radius: 0.3,
    strength: 1,
    angle: 0,
  }]
  for (const anchor of anchors) {
    const dx = (u - anchor.x) * aspect
    const dy = v - anchor.y
    const radius = 0.18 + anchor.radius * 0.72
    const distance = (dx * dx + dy * dy) / Math.max(0.001, radius * radius)
    cluster = Math.max(cluster, Math.exp(-distance * 1.65) * anchor.strength)
  }

  const quietDx = (u - quietZone.x) * aspect
  const quietDy = v - quietZone.y
  const quietRingDistance = Math.hypot(quietDx, quietDy)
  const quietRingOffset = (quietRingDistance - 0.2) / 0.105
  const quietRing = Math.exp(-(quietRingOffset * quietRingOffset)) * 0.72
  const angle = composition?.field.angle ?? chan(seed, 0, 'lab.pixel.field.angle') * TAU
  const phase = composition?.field.phase ?? chan(seed, 0, 'lab.pixel.field.phase') * TAU
  const along = (u - 0.5) * Math.cos(angle) + (v - 0.5) * Math.sin(angle)
  const across = -(u - 0.5) * Math.sin(angle) + (v - 0.5) * Math.cos(angle)
  const wave = (
    Math.sin((along * 1.7 + across * 0.72) * TAU + phase)
    + Math.sin((along * -0.63 + across * 2.15) * TAU - phase * 0.61) * 0.45
  ) / 1.45
  return Math.max(halo * 0.96, cluster, quietRing) + wave * 0.105
}

function fullyActive(
  active: Uint8Array,
  columns: number,
  rows: number,
  column: number,
  row: number,
  size: number,
): boolean {
  if (column + size > columns || row + size > rows) return false
  for (let y = row; y < row + size; y += 1) {
    for (let x = column; x < column + size; x += 1) {
      if (!active[y * columns + x]) return false
    }
  }
  return true
}

function candidateLists(
  active: Uint8Array,
  columns: number,
  rows: number,
  seed: number,
): Map<number, GridCandidate[]> {
  const result = new Map<number, GridCandidate[]>()
  for (const size of [6, 4, 2]) {
    const candidates: GridCandidate[] = []
    for (let row = 0; row <= rows - size; row += 1) {
      for (let column = 0; column <= columns - size; column += 1) {
        if (!fullyActive(active, columns, rows, column, row, size)) continue
        const id = row * columns + column + size * 0x10000
        candidates.push({
          column,
          row,
          size,
          score: chan(seed, id, `lab.pixel.scale.${size}`),
        })
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.row - b.row || a.column - b.column)
    result.set(size, candidates)
  }
  return result
}

function forcedScaleCandidates(
  lists: Map<number, GridCandidate[]>,
  complexity: number,
): GridCandidate[] {
  if (complexity < 0.34) return []
  const forced: GridCandidate[] = []
  for (const size of [6, 4, 2]) {
    const candidate = lists.get(size)?.find((item) =>
      forced.every((picked) => !candidatesOverlap(item, picked)))
    if (candidate) forced.push(candidate)
  }
  return forced
}

function tileScale(size: number): PixelBlockScale {
  if (size >= 4) return 'macro'
  if (size >= 2) return 'meso'
  return 'micro'
}

function tileId(columns: number, column: number, row: number, size: number): number {
  return (((row * columns + column) * 17) ^ (size * 0x9e37)) >>> 0
}

function edgeExposure(
  active: Uint8Array,
  columns: number,
  rows: number,
  column: number,
  row: number,
  size: number,
): number {
  let exposed = 0
  let boundary = 0
  const inspect = (x: number, y: number) => {
    boundary += 1
    if (x < 0 || x >= columns || y < 0 || y >= rows || !active[y * columns + x]) {
      exposed += 1
    }
  }
  for (let offset = 0; offset < size; offset += 1) {
    inspect(column + offset, row - 1)
    inspect(column + offset, row + size)
    inspect(column - 1, row + offset)
    inspect(column + size, row + offset)
  }
  return exposed / Math.max(1, boundary)
}

function regionHasProtected(
  protectedMask: Uint8Array,
  columns: number,
  column: number,
  row: number,
  size: number,
): boolean {
  for (let y = row; y < row + size; y += 1) {
    for (let x = column; x < column + size; x += 1) {
      if (protectedMask[y * columns + x]) return true
    }
  }
  return false
}

function baseTileColor(
  hierarchy: PixelFieldPlan['colorHierarchy'],
  seed: number,
  id: number,
  scale: PixelBlockScale,
  isProtected: boolean,
): number {
  const supportChance = scale === 'macro'
    ? 0.18
    : scale === 'meso'
      ? 0.31
      : 0.46
  const sample = chan(seed, id, 'lab.pixel.color.role')
  if (isProtected && sample > 0.72 && hierarchy.visible.length > 1) {
    return hierarchy.visible.at(-1) ?? hierarchy.dominant
  }
  if (sample >= supportChance || !hierarchy.support.length) return hierarchy.dominant
  return hierarchy.support[
    Math.min(
      hierarchy.support.length - 1,
      Math.floor(chan(seed, id, 'lab.pixel.color.support') * hierarchy.support.length),
    )
  ]
}

function buildTiles(
  input: PixelFieldInput,
  active: Uint8Array,
  protectedMask: Uint8Array,
  columns: number,
  rows: number,
  hierarchy: PixelFieldPlan['colorHierarchy'],
): PixelFieldTile[] {
  const covered = new Uint8Array(active.length)
  const lists = candidateLists(active, columns, rows, input.seed)
  const forced = forcedScaleCandidates(lists, input.complexity)
  const forcedKeys = new Set(forced.map((item) =>
    `${item.column}:${item.row}:${item.size}`))
  const tiles: PixelFieldTile[] = []
  const sizeChances: Record<number, number> = {
    6: 0.6 - clamp01(input.complexity) * 0.2,
    4: 0.62 - clamp01(input.complexity) * 0.14,
    2: 0.72 - clamp01(input.complexity) * 0.12,
  }

  const available = (candidate: GridCandidate) => {
    for (let y = candidate.row; y < candidate.row + candidate.size; y += 1) {
      for (let x = candidate.column; x < candidate.column + candidate.size; x += 1) {
        if (covered[y * columns + x]) return false
      }
    }
    return true
  }
  const emit = (column: number, row: number, size: number) => {
    for (let y = row; y < row + size; y += 1) {
      for (let x = column; x < column + size; x += 1) {
        covered[y * columns + x] = 1
      }
    }
    const id = tileId(columns, column, row, size)
    const scale = tileScale(size)
    const isProtected = regionHasProtected(protectedMask, columns, column, row, size)
    tiles.push({
      id,
      column,
      row,
      columnSpan: size,
      rowSpan: size,
      x: column / columns,
      y: row / rows,
      width: size / columns,
      height: size / rows,
      scale,
      role: 'dominant',
      colorIndex: baseTileColor(hierarchy, input.seed, id, scale, isProtected),
      edgeExposure: edgeExposure(active, columns, rows, column, row, size),
      protected: isProtected,
      glitch: null,
    })
  }

  for (const candidate of forced) {
    if (available(candidate)) {
      emit(candidate.column, candidate.row, candidate.size)
    }
  }
  for (const size of [6, 4, 2]) {
    for (const candidate of lists.get(size) ?? []) {
      if (!available(candidate)) continue
      const key = `${candidate.column}:${candidate.row}:${candidate.size}`
      if (!forcedKeys.has(key) && candidate.score > sizeChances[size]) continue
      emit(candidate.column, candidate.row, candidate.size)
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column
      if (active[index] && !covered[index]) emit(column, row, 1)
    }
  }
  return tiles
}

function applyEdgeAccents(
  tiles: PixelFieldTile[],
  input: PixelFieldInput,
  hierarchy: PixelFieldPlan['colorHierarchy'],
): number {
  if (hierarchy.accent === hierarchy.dominant && hierarchy.support.every(
    (index) => index === hierarchy.dominant,
  )) return 0
  const maximum = Math.min(
    input.colorPlan?.accentAreaLimit ?? 0.05,
    0.018 + clamp01(input.complexity) * 0.022,
  )
  const candidates = tiles
    .filter((tile) =>
      !tile.protected
      && tile.scale !== 'macro'
      && tile.edgeExposure > 0)
    .map((tile) => ({
      tile,
      score: tile.edgeExposure
        * (0.55 + chan(input.seed, tile.id, 'lab.pixel.accent') * 0.45),
    }))
    .sort((a, b) => b.score - a.score || a.tile.id - b.tile.id)
  let area = 0
  for (const candidate of candidates) {
    const tileArea = candidate.tile.width * candidate.tile.height
    if (area > 0 && area + tileArea > maximum) continue
    candidate.tile.role = 'accent'
    candidate.tile.colorIndex = hierarchy.accent
    area += tileArea
    if (area >= maximum * 0.72) break
  }
  return area
}

function alternateColor(
  hierarchy: PixelFieldPlan['colorHierarchy'],
  base: number,
  seed: number,
  id: number,
): number {
  const alternatives = hierarchy.visible.filter((index) => index !== base)
  if (!alternatives.length) return base
  return alternatives[
    Math.min(
      alternatives.length - 1,
      Math.floor(chan(seed, id, 'lab.pixel.glitch.color') * alternatives.length),
    )
  ]
}

function applyGlitches(
  tiles: PixelFieldTile[],
  input: PixelFieldInput,
  columns: number,
  rows: number,
  hierarchy: PixelFieldPlan['colorHierarchy'],
): number {
  const targetCount = 1 + Math.round(clamp01(input.complexity) * 5)
  const candidates = tiles
    .filter((tile) =>
      !tile.protected
      && tile.role !== 'accent'
      && tile.scale !== 'macro'
      && tile.edgeExposure > 0)
    .map((tile) => ({
      tile,
      score: tile.edgeExposure
        * (0.45 + chan(input.seed, tile.id, 'lab.pixel.glitch.pick') * 0.55),
    }))
    .sort((a, b) => b.score - a.score || a.tile.id - b.tile.id)
  let area = 0
  for (const { tile } of candidates.slice(0, targetCount)) {
    const horizontal = chan(input.seed, tile.id, 'lab.pixel.glitch.axis') >= 0.5
    const direction = chan(input.seed, tile.id, 'lab.pixel.glitch.direction') >= 0.5 ? 1 : -1
    const unit = horizontal ? 1 / columns : 1 / rows
    const maxOffset = unit * (0.55 + chan(input.seed, tile.id, 'lab.pixel.glitch.offset') * 0.7)
    tile.glitch = {
      axis: horizontal ? 'x' : 'y',
      direction,
      maxOffset,
      bandStart: 0.12 + chan(input.seed, tile.id, 'lab.pixel.glitch.band') * 0.42,
      bandSize: 0.24 + chan(input.seed, tile.id, 'lab.pixel.glitch.size') * 0.28,
      harmonic: (1 + Math.floor(
        chan(input.seed, tile.id, 'lab.pixel.glitch.harmonic') * 3,
      )) as 1 | 2 | 3,
      phase: chan(input.seed, tile.id, 'lab.pixel.glitch.phase') * TAU,
      secondaryPhase: chan(input.seed, tile.id, 'lab.pixel.glitch.secondary') * TAU,
      colorIndex: alternateColor(hierarchy, tile.colorIndex, input.seed, tile.id),
    }
    area += tile.width * tile.height * tile.glitch.bandSize
  }
  return area
}

export function resolvePixelGlitchFrame(
  glitch: PixelGlitch,
  phase: number,
  motionAmount: number,
  motionSpeed: number,
): PixelGlitchFrame {
  const loopPhase = normalizedPhase(phase)
  const theta = loopPhase * TAU
  const amount = clamp01(motionAmount)
  const energy = clamp01((motionSpeed - 0.1) / 1.9)
  const primary = Math.sin(theta * glitch.harmonic + glitch.phase)
  const secondary = Math.sin(
    theta * (glitch.harmonic + 2) + glitch.secondaryPhase,
  )
  const signal = primary * (1 - energy * 0.52) + secondary * energy * 0.52
  const magnitude = glitch.maxOffset * (0.48 + amount * (0.24 + signal * 0.2))
  return {
    offset: glitch.direction * Math.max(0, Math.min(glitch.maxOffset, magnitude)),
    bandShift: amount * Math.sin(
      theta * (glitch.harmonic + 1) + glitch.secondaryPhase,
    ) * 0.12,
  }
}

export function planPixelField(input: PixelFieldInput): PixelFieldPlan {
  const complexity = clamp01(input.complexity)
  const aspect = Math.max(0.25, Math.min(4, input.aspect))
  const normalizedInput = { ...input, complexity, aspect }
  const { columns, rows } = gridDimensions(complexity, aspect)
  const quietZone = resolveQuietZone(normalizedInput, aspect)
  const protectedMask = new Uint8Array(columns * rows)
  const quietMask = new Uint8Array(columns * rows)
  const active = new Uint8Array(columns * rows)

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column
      const u = (column + 0.5) / columns
      const v = (row + 0.5) / rows
      if (metaSample(u, v, aspect).inside) protectedMask[index] = 1
    }
  }
  const exterior = floodExterior(protectedMask, columns, rows)
  const silhouetteVoid = new Uint8Array(active.length)
  for (let index = 0; index < silhouetteVoid.length; index += 1) {
    silhouetteVoid[index] = protectedMask[index] || exterior[index] ? 0 : 1
  }

  const neighborProtected = (column: number, row: number) => {
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const x = column + offsetX
        const y = row + offsetY
        if (
          x >= 0
          && x < columns
          && y >= 0
          && y < rows
          && protectedMask[y * columns + x]
        ) return true
      }
    }
    return false
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column
      const u = (column + 0.5) / columns
      const v = (row + 0.5) / rows
      const protectedCell = protectedMask[index] === 1
      const guardedVoid = !protectedCell && (
        silhouetteVoid[index] === 1 || neighborProtected(column, row)
      )
      const quiet = !protectedCell && inQuietZone(u, v, quietZone)
      if (quiet) quietMask[index] = 1
      if (protectedCell) {
        active[index] = 1
        continue
      }
      if (guardedVoid || quiet) continue
      const threshold = 0.31 + (1 - complexity) * 0.04
      if (massAt(normalizedInput, u, v, quietZone) >= threshold) active[index] = 1
    }
  }

  const hierarchy = paletteHierarchy(input.paletteSize, input.colorPlan)
  const tiles = buildTiles(
    normalizedInput,
    active,
    protectedMask,
    columns,
    rows,
    hierarchy,
  )
  const accentArea = applyEdgeAccents(tiles, normalizedInput, hierarchy)
  const glitchArea = applyGlitches(
    tiles,
    normalizedInput,
    columns,
    rows,
    hierarchy,
  )
  const scaleCounts: Record<PixelBlockScale, number> = {
    macro: 0,
    meso: 0,
    micro: 0,
  }
  for (const tile of tiles) scaleCounts[tile.scale] += 1

  return {
    revision: PLAN_REVISION,
    columns,
    rows,
    tiles,
    masks: { active, protected: protectedMask, quiet: quietMask },
    quietZone,
    colorHierarchy: hierarchy,
    diagnostics: {
      activeCellCount: active.reduce((sum, value) => sum + value, 0),
      protectedCellCount: protectedMask.reduce((sum, value) => sum + value, 0),
      quietCellCount: quietMask.reduce((sum, value) => sum + value, 0),
      accentArea,
      glitchArea,
      scaleCounts,
    },
  }
}
