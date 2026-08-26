import {
  META_SYMBOL_HEIGHT,
  META_SYMBOL_WIDTH,
  sampleMetaSymbol,
} from '@/core/metaSymbol'
import { chan } from '@/core/organic/random'
import type { LookColorPlan } from './colorDirection'
import type { CompositionPlan } from './compositionPlan'

// Pixels owns a normalized, source-independent topology. Every complexity uses
// the same coarse attached masses; higher values add fine edge stairs without
// moving those masses. Output resolution only scales the plan, and motion never
// enters it, so preview/export geometry and animated topology stay aligned.
const TAU = Math.PI * 2
const PLAN_REVISION = 2

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

export type PixelAttachment = {
  angle: number
  startX: number
  startY: number
  endX: number
  endY: number
  startRadius: number
  endRadius: number
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
    base: Uint8Array
    mass: Uint8Array
    protected: Uint8Array
    quiet: Uint8Array
  }
  attachments: readonly PixelAttachment[]
  quietZone: {
    x: number
    y: number
    radiusX: number
    radiusY: number
    rotation: number
    attachment: number
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
    maxGlitchDisplacement: number
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

function gridDimensions(aspect: number): {
  columns: number
  rows: number
} {
  const longCells = 72
  const even = (value: number) => Math.max(24, Math.round(value / 2) * 2)
  if (aspect >= 1) {
    return {
      columns: longCells,
      rows: even(longCells / aspect),
    }
  }
  return {
    columns: even(longCells * aspect),
    rows: longCells,
  }
}

function metaSample(u: number, v: number, aspect: number) {
  const fit = aspect < 0.75 ? 0.8 : 0.86
  const symbolScale = fit * Math.min(
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

function movePhysical(
  point: { x: number; y: number },
  angle: number,
  distance: number,
  aspect: number,
): { x: number; y: number } {
  return {
    x: point.x + Math.cos(angle) * distance / aspect,
    y: point.y + Math.sin(angle) * distance,
  }
}

function metaBoundaryAlong(angle: number, aspect: number): { x: number; y: number } {
  let boundary = { x: 0.5, y: 0.5 }
  let found = metaSample(boundary.x, boundary.y, aspect).inside
  const maximum = Math.hypot(aspect / 2, 0.5)
  for (let step = 1; step <= 180; step += 1) {
    const radius = maximum * step / 180
    const point = movePhysical({ x: 0.5, y: 0.5 }, angle, radius, aspect)
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) break
    if (!metaSample(point.x, point.y, aspect).inside) continue
    boundary = point
    found = true
  }
  return found ? boundary : { x: 0.5, y: 0.5 }
}

function clampPoint(
  point: { x: number; y: number },
  margin = 0.025,
): { x: number; y: number } {
  return {
    x: Math.max(margin, Math.min(1 - margin, point.x)),
    y: Math.max(margin, Math.min(1 - margin, point.y)),
  }
}

function buildAttachments(input: PixelFieldInput, aspect: number): PixelAttachment[] {
  const { seed, composition } = input
  const fieldAngle = composition?.field.angle
    ?? chan(seed, 0, 'lab.pixel.field.angle') * TAU
  const portrait = aspect < 0.72
  const squareish = aspect >= 0.72 && aspect < 1.15
  const lean = (chan(seed, 0, 'lab.pixel.attach.lean') - 0.5) * 0.42
  const angles = portrait
    ? [-Math.PI / 2 + lean, Math.PI / 2 - lean * 0.72]
    : squareish
      ? [fieldAngle, fieldAngle + TAU / 3, fieldAngle + TAU * 2 / 3]
      : [fieldAngle + lean * 0.4, fieldAngle + Math.PI - lean * 0.55]

  return angles.map((angle, index) => {
    const boundary = metaBoundaryAlong(angle, aspect)
    const length = portrait
      ? 0.235 + chan(seed, index, 'lab.pixel.attach.length') * 0.055
      : squareish
        ? 0.075 + chan(seed, index, 'lab.pixel.attach.length') * 0.045
        : 0.075 + chan(seed, index, 'lab.pixel.attach.length') * 0.05
    const startRadius = (
      portrait ? 0.028 : squareish ? 0.034 : 0.038
    ) + chan(seed, index, 'lab.pixel.attach.radius') * (
      portrait ? 0.012 : 0.014
    )
    const endRadius = startRadius * (
      0.48 + chan(seed, index, 'lab.pixel.attach.taper') * 0.14
    )
    const start = movePhysical(boundary, angle, -startRadius * 0.62, aspect)
    const end = movePhysical(boundary, angle, length, aspect)
    const clampedStart = clampPoint(start)
    const clampedEnd = clampPoint(end)
    return {
      angle,
      startX: clampedStart.x,
      startY: clampedStart.y,
      endX: clampedEnd.x,
      endY: clampedEnd.y,
      startRadius,
      endRadius,
    }
  })
}

function attachmentMassAt(
  attachment: PixelAttachment,
  u: number,
  v: number,
  aspect: number,
): number {
  const px = u * aspect
  const py = v
  const startX = attachment.startX * aspect
  const startY = attachment.startY
  const endX = attachment.endX * aspect
  const endY = attachment.endY
  const dx = endX - startX
  const dy = endY - startY
  const denominator = dx * dx + dy * dy
  const progress = denominator > 0
    ? clamp01(((px - startX) * dx + (py - startY) * dy) / denominator)
    : 0
  const closestX = startX + dx * progress
  const closestY = startY + dy * progress
  const distance = Math.hypot(px - closestX, py - closestY)
  const radius = attachment.startRadius
    + (attachment.endRadius - attachment.startRadius) * progress
  const normalized = distance / Math.max(0.001, radius)
  return Math.exp(-(normalized * normalized) * 1.7)
}

function attachmentInfluence(
  attachments: readonly PixelAttachment[],
  u: number,
  v: number,
  aspect: number,
): number {
  let influence = 0
  for (const attachment of attachments) {
    influence = Math.max(influence, attachmentMassAt(attachment, u, v, aspect))
  }
  return influence
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

function resolveQuietZone(
  input: PixelFieldInput,
  aspect: number,
  attachments: readonly PixelAttachment[],
): QuietZone {
  const { seed } = input
  const attachmentIndex = Math.min(
    attachments.length - 1,
    Math.floor(chan(seed, 0, 'lab.pixel.quiet.attachment') * attachments.length),
  )
  const attachment = attachments[Math.max(0, attachmentIndex)]
  const progress = 0.5 + chan(seed, 0, 'lab.pixel.quiet.progress') * 0.18
  const center = {
    x: attachment.startX + (attachment.endX - attachment.startX) * progress,
    y: attachment.startY + (attachment.endY - attachment.startY) * progress,
  }
  const side = chan(seed, 0, 'lab.pixel.quiet.side') < 0.5 ? -1 : 1
  const physicalRadius = (
    0.075 + chan(seed, 0, 'lab.pixel.quiet.radius') * 0.02
  ) * Math.min(1, aspect)
  const offsetCenter = movePhysical(
    center,
    attachment.angle + side * Math.PI / 2,
    physicalRadius * 0.88,
    aspect,
  )
  const radiusX = physicalRadius / aspect
  const radiusY = physicalRadius * (
    0.68 + chan(seed, 1, 'lab.pixel.quiet.radius') * 0.14
  )
  return {
    x: Math.max(radiusX + 0.02, Math.min(1 - radiusX - 0.02, offsetCenter.x)),
    y: Math.max(radiusY + 0.02, Math.min(1 - radiusY - 0.02, offsetCenter.y)),
    radiusX,
    radiusY,
    rotation: attachment.angle,
    attachment: Math.max(0, attachmentIndex),
  }
}

function inQuietZone(u: number, v: number, zone: QuietZone, aspect: number): boolean {
  const cos = Math.cos(zone.rotation)
  const sin = Math.sin(zone.rotation)
  const dx = (u - zone.x) * aspect
  const dy = v - zone.y
  const x = (dx * cos + dy * sin) / (zone.radiusX * aspect)
  const y = (-dx * sin + dy * cos) / zone.radiusY
  return x * x + y * y <= 1
}

function massAt(
  input: PixelFieldInput,
  u: number,
  v: number,
  attachments: readonly PixelAttachment[],
): number {
  const { seed, composition } = input
  const aspect = Math.max(0.25, Math.min(4, input.aspect))
  const meta = metaSample(u, v, aspect)
  const haloScale = aspect < 0.72 ? 0.034 : aspect < 1.15 ? 0.042 : 0.047
  const halo = meta.inside ? 1 : Math.exp(-((meta.distance / haloScale) ** 2))
  const attached = attachmentInfluence(attachments, u, v, aspect)
  const angle = composition?.field.angle ?? chan(seed, 0, 'lab.pixel.field.angle') * TAU
  const phase = composition?.field.phase ?? chan(seed, 0, 'lab.pixel.field.phase') * TAU
  const along = (u - 0.5) * Math.cos(angle) + (v - 0.5) * Math.sin(angle)
  const across = -(u - 0.5) * Math.sin(angle) + (v - 0.5) * Math.cos(angle)
  const wave = (
    Math.sin((along * 1.7 + across * 0.72) * TAU + phase)
    + Math.sin((along * -0.63 + across * 2.15) * TAU - phase * 0.61) * 0.45
  ) / 1.45
  return Math.max(halo * 0.96, attached) * (0.95 + wave * 0.05)
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
  complexity: number,
): Map<number, GridCandidate[]> {
  const result = new Map<number, GridCandidate[]>()
  const step = complexity < 0.34 ? 2 : 1
  for (const size of [6, 4, 2]) {
    const candidates: GridCandidate[] = []
    for (let row = 0; row <= rows - size; row += step) {
      for (let column = 0; column <= columns - size; column += step) {
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
): GridCandidate[] {
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
  const lists = candidateLists(active, columns, rows, input.seed, input.complexity)
  const forced = forcedScaleCandidates(lists)
  const forcedKeys = new Set(forced.map((item) =>
    `${item.column}:${item.row}:${item.size}`))
  const tiles: PixelFieldTile[] = []
  const complexity = clamp01(input.complexity)
  const sizeChances: Record<number, number> = {
    6: 0.72 - complexity * 0.44,
    4: 0.86 - complexity * 0.3,
    2: complexity < 0.34 ? 1 : 0.82,
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
  hierarchy: PixelFieldPlan['colorHierarchy'],
): { area: number; maxDisplacement: number } {
  const complexity = clamp01(input.complexity)
  const targetCount = complexity < 0.34 ? 0 : complexity < 0.67 ? 2 : 5
  const candidates = tiles
    .filter((tile) =>
      !tile.protected
      && tile.scale !== 'macro'
      && tile.edgeExposure > 0)
    .map((tile) => ({
      tile,
      score: tile.edgeExposure
        * (0.45 + chan(input.seed, tile.id, 'lab.pixel.glitch.pick') * 0.55),
    }))
    .sort((a, b) => b.score - a.score || a.tile.id - b.tile.id)
  let area = 0
  let maxDisplacement = 0
  let count = 0
  for (const { tile } of candidates) {
    if (count >= targetCount) break
    const horizontal = chan(input.seed, tile.id, 'lab.pixel.glitch.axis') >= 0.5
    const direction = chan(input.seed, tile.id, 'lab.pixel.glitch.direction') >= 0.5 ? 1 : -1
    const aspect = Math.max(0.25, Math.min(4, input.aspect))
    const normalizedLimit = horizontal
      ? 0.0078 / Math.max(1, aspect)
      : 0.0078 / Math.max(1, 1 / aspect)
    const maxOffset = normalizedLimit * (
      0.55 + chan(input.seed, tile.id, 'lab.pixel.glitch.offset') * 0.4
    )
    const bandSize = 0.24 + chan(input.seed, tile.id, 'lab.pixel.glitch.size') * 0.28
    const glitchArea = tile.width * tile.height * bandSize
    if (area + glitchArea > 0.035) continue
    tile.glitch = {
      axis: horizontal ? 'x' : 'y',
      direction,
      maxOffset,
      bandStart: 0.12 + chan(input.seed, tile.id, 'lab.pixel.glitch.band') * 0.42,
      bandSize,
      harmonic: (1 + Math.floor(
        chan(input.seed, tile.id, 'lab.pixel.glitch.harmonic') * 3,
      )) as 1 | 2 | 3,
      phase: chan(input.seed, tile.id, 'lab.pixel.glitch.phase') * TAU,
      secondaryPhase: chan(input.seed, tile.id, 'lab.pixel.glitch.secondary') * TAU,
      colorIndex: alternateColor(hierarchy, tile.colorIndex, input.seed, tile.id),
    }
    area += glitchArea
    maxDisplacement = Math.max(
      maxDisplacement,
      horizontal
        ? maxOffset * Math.max(1, aspect)
        : maxOffset * Math.max(1, 1 / aspect),
    )
    count += 1
  }
  return { area, maxDisplacement }
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

function hasNeighbor(
  mask: Uint8Array,
  columns: number,
  rows: number,
  column: number,
  row: number,
): boolean {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue
      const x = column + offsetX
      const y = row + offsetY
      if (x >= 0 && x < columns && y >= 0 && y < rows && mask[y * columns + x]) {
        return true
      }
    }
  }
  return false
}

function retainAttached(
  active: Uint8Array,
  protectedMask: Uint8Array,
  columns: number,
  rows: number,
): void {
  const attached = new Uint8Array(active.length)
  const queue = new Int32Array(active.length)
  let read = 0
  let write = 0
  for (let index = 0; index < active.length; index += 1) {
    if (!active[index] || !protectedMask[index]) continue
    attached[index] = 1
    queue[write] = index
    write += 1
  }
  while (read < write) {
    const index = queue[read]
    read += 1
    const column = index % columns
    const row = Math.floor(index / columns)
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) continue
        const x = column + offsetX
        const y = row + offsetY
        if (x < 0 || x >= columns || y < 0 || y >= rows) continue
        const neighbor = y * columns + x
        if (!active[neighbor] || attached[neighbor]) continue
        attached[neighbor] = 1
        queue[write] = neighbor
        write += 1
      }
    }
  }
  for (let index = 0; index < active.length; index += 1) {
    if (!attached[index]) active[index] = 0
  }
}

function expandCoarseMask(
  coarse: Uint8Array,
  coarseColumns: number,
  coarseRows: number,
  columns: number,
): Uint8Array {
  const expanded = new Uint8Array(columns * coarseRows * 2)
  for (let row = 0; row < coarseRows; row += 1) {
    for (let column = 0; column < coarseColumns; column += 1) {
      if (!coarse[row * coarseColumns + column]) continue
      const x = column * 2
      const y = row * 2
      expanded[y * columns + x] = 1
      expanded[y * columns + x + 1] = 1
      expanded[(y + 1) * columns + x] = 1
      expanded[(y + 1) * columns + x + 1] = 1
    }
  }
  return expanded
}

export function planPixelField(input: PixelFieldInput): PixelFieldPlan {
  const complexity = clamp01(input.complexity)
  const aspect = Math.max(0.25, Math.min(4, input.aspect))
  const normalizedInput = { ...input, complexity, aspect }
  const { columns, rows } = gridDimensions(aspect)
  const attachments = buildAttachments(normalizedInput, aspect)
  const quietZone = resolveQuietZone(normalizedInput, aspect, attachments)
  const coarseColumns = columns / 2
  const coarseRows = rows / 2
  const coarseProtected = new Uint8Array(coarseColumns * coarseRows)
  const coarseMass = new Uint8Array(coarseProtected.length)
  const coarseBase = new Uint8Array(coarseProtected.length)
  const coarseQuiet = new Uint8Array(coarseProtected.length)

  for (let row = 0; row < coarseRows; row += 1) {
    for (let column = 0; column < coarseColumns; column += 1) {
      const index = row * coarseColumns + column
      const u = (column + 0.5) / coarseColumns
      const v = (row + 0.5) / coarseRows
      if (metaSample(u, v, aspect).inside) coarseProtected[index] = 1
    }
  }
  const exterior = floodExterior(coarseProtected, coarseColumns, coarseRows)
  const coarseVoid = new Uint8Array(coarseProtected.length)
  for (let index = 0; index < coarseVoid.length; index += 1) {
    coarseVoid[index] = coarseProtected[index] || exterior[index] ? 0 : 1
  }

  const neighborProtected = (column: number, row: number) => {
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const x = column + offsetX
        const y = row + offsetY
        if (
          x >= 0
          && x < coarseColumns
          && y >= 0
          && y < coarseRows
          && coarseProtected[y * coarseColumns + x]
        ) return true
      }
    }
    return false
  }

  for (let row = 0; row < coarseRows; row += 1) {
    for (let column = 0; column < coarseColumns; column += 1) {
      const index = row * coarseColumns + column
      const u = (column + 0.5) / coarseColumns
      const v = (row + 0.5) / coarseRows
      const protectedCell = coarseProtected[index] === 1
      const attachment = attachmentInfluence(attachments, u, v, aspect)
      const guardedVoid = !protectedCell && (
        coarseVoid[index] === 1
        || (neighborProtected(column, row) && attachment < 0.48)
      )
      const quiet = !protectedCell
        && attachment < 0.4
        && inQuietZone(u, v, quietZone, aspect)
      if (protectedCell) {
        coarseMass[index] = 1
        coarseBase[index] = 1
        continue
      }
      if (quiet) {
        coarseQuiet[index] = 1
        coarseMass[index] = 1
        continue
      }
      if (guardedVoid) continue
      if (massAt(normalizedInput, u, v, attachments) < 0.34) continue
      coarseMass[index] = 1
      if (!quiet) coarseBase[index] = 1
    }
  }

  const protectedMask = expandCoarseMask(
    coarseProtected,
    coarseColumns,
    coarseRows,
    columns,
  )
  const massMask = expandCoarseMask(coarseMass, coarseColumns, coarseRows, columns)
  const quietMask = expandCoarseMask(coarseQuiet, coarseColumns, coarseRows, columns)
  const voidMask = expandCoarseMask(coarseVoid, coarseColumns, coarseRows, columns)
  const base = expandCoarseMask(coarseBase, coarseColumns, coarseRows, columns)
  retainAttached(base, protectedMask, columns, rows)
  const active = base.slice()
  const detailAmount = clamp01((complexity - 0.28) / 0.57)
  if (detailAmount > 0) {
    const coarseSnapshot = active.slice()
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column
        if (
          active[index]
          || quietMask[index]
          || voidMask[index]
          || !hasNeighbor(coarseSnapshot, columns, rows, column, row)
        ) continue
        const u = (column + 0.5) / columns
        const v = (row + 0.5) / rows
        const meta = metaSample(u, v, aspect)
        const score = massAt(normalizedInput, u, v, attachments)
        const exactEdge = meta.inside || score >= 0.34
        const nearEdge = score >= 0.275
        if (!exactEdge && !nearEdge) continue
        const chance = exactEdge
          ? 0.28 + detailAmount * 0.7
          : detailAmount * 0.2
        if (chan(input.seed, index, 'lab.pixel.edge.stair') >= chance) continue
        active[index] = 1
        if (meta.inside) protectedMask[index] = 1
      }
    }
    retainAttached(active, protectedMask, columns, rows)
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
  const glitches = applyGlitches(tiles, normalizedInput, hierarchy)
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
    masks: {
      active,
      base,
      mass: massMask,
      protected: protectedMask,
      quiet: quietMask,
    },
    attachments,
    quietZone,
    colorHierarchy: hierarchy,
    diagnostics: {
      activeCellCount: active.reduce((sum, value) => sum + value, 0),
      protectedCellCount: protectedMask.reduce((sum, value) => sum + value, 0),
      quietCellCount: quietMask.reduce((sum, value) => sum + value, 0),
      accentArea,
      glitchArea: glitches.area,
      maxGlitchDisplacement: glitches.maxDisplacement,
      scaleCounts,
    },
  }
}
