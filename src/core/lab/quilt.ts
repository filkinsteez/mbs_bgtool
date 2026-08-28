import { chan } from '@/core/organic/random'
import {
  META_SYMBOL_HEIGHT,
  META_SYMBOL_MIN_X,
  META_SYMBOL_MIN_Y,
  META_SYMBOL_PATH,
  META_SYMBOL_WIDTH,
  sampleMetaSymbol,
} from '@/core/metaSymbol'
import type { CellNode } from './composition'
import {
  sampleCompositionPlan,
  type CompositionPlan,
  type CompositionSample,
} from './compositionPlan'
import type { LookColorPlan } from './colorDirection'
import type { CurveSnapshot } from './types'

const DESIGN_WIDTH = META_SYMBOL_WIDTH
const DESIGN_HEIGHT = META_SYMBOL_HEIGHT
const TAU = Math.PI * 2

export type QuiltFamily = 'whole-cloth' | 'half-square' | 'rail' | 'log-cabin'
export type QuiltSeamLevel = 'major' | 'minor' | 'piece' | 'inset'

export type QuiltPoint = {
  x: number
  y: number
}

export type QuiltRect = {
  x: number
  y: number
  width: number
  height: number
}

export type QuiltPiece = {
  color: number
  points: readonly QuiltPoint[]
}

export type QuiltSeam = {
  id: number
  level: QuiltSeamLevel
  points: readonly QuiltPoint[]
  closed?: boolean
}

export type QuiltInset = {
  color: number
  points: readonly QuiltPoint[]
}

export type QuiltPatch = {
  id: number
  depth: number
  regionId: number
  family: QuiltFamily
  rect: QuiltRect
  quiet: number
  focus: number
  baseColor: number
  pieces: readonly QuiltPiece[]
  pieceSeams: readonly QuiltSeam[]
  inset: QuiltInset | null
}

export type QuiltFrame = {
  centerX: number
  centerY: number
  scaleX: number
  scaleY: number
  rotation: number
  clip: 'meta-symbol' | 'cells'
}

export type QuiltPlan = {
  frame: QuiltFrame
  patches: readonly QuiltPatch[]
  constructionSeams: readonly QuiltSeam[]
  roleColors: {
    dominant: number
    ground: number
    ink: number
    accent: number | null
  }
}

export type BuildQuiltPlanOptions = {
  width: number
  height: number
  seed: number
  complexity: number
  paletteSize: number
  colorPlan?: LookColorPlan
  composition?: CompositionPlan
  curve?: CurveSnapshot
}

export type RenderQuiltOptions = BuildQuiltPlanOptions & {
  palette: readonly string[]
  cells: readonly CellNode[]
  motionPhase?: number
  motionAmount: number
  motionSpeed: number
}

type PatchDraft = Omit<QuiltPatch, 'inset'>

type SplitResult = {
  first: QuiltRect
  second: QuiltRect
  seam: readonly QuiltPoint[]
}

type OrientedLayout = {
  pieces: readonly QuiltPiece[]
  seams: readonly QuiltSeam[]
}

let metaSymbolPath: Path2D | null = null

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function unique(values: readonly number[]): number[] {
  return values.filter((value, index) => values.indexOf(value) === index)
}

function validColor(index: number, paletteSize: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < paletteSize
}

function roleColorPool(
  colorPlan: LookColorPlan | undefined,
  paletteSize: number,
): number[] {
  if (!colorPlan) {
    return Array.from({ length: Math.max(1, paletteSize) }, (_, index) => index)
  }

  const candidates = unique([
    colorPlan.roles.dominant,
    ...colorPlan.roles.support,
    ...colorPlan.depthOrder,
  ])
  const pool: number[] = []
  for (const index of candidates) {
    if (!validColor(index, paletteSize)) continue
    if (
      paletteSize > 2
      && index !== colorPlan.roles.dominant
      && (
        index === colorPlan.roles.ground
        || index === colorPlan.roles.accent
      )
    ) continue
    pool.push(index)
    if (pool.length >= Math.max(1, colorPlan.localColorLimit)) break
  }
  if (!pool.length) pool.push(Math.max(0, Math.min(paletteSize - 1, colorPlan.roles.dominant)))
  return unique(pool)
}

function weightedPoolColor(
  pool: readonly number[],
  colorPlan: LookColorPlan | undefined,
  sample: number,
): number {
  if (!colorPlan) {
    return pool[Math.min(pool.length - 1, Math.floor(clamp01(sample) * pool.length))]
  }
  const total = pool.reduce(
    (sum, index) => sum + Math.max(0.001, colorPlan.swatches[index]?.weight ?? 0),
    0,
  )
  let cursor = clamp01(sample) * total
  for (const index of pool) {
    cursor -= Math.max(0.001, colorPlan.swatches[index]?.weight ?? 0)
    if (cursor <= 0) return index
  }
  return pool[pool.length - 1]
}

function neighborColor(
  base: number,
  pool: readonly number[],
  colorPlan: LookColorPlan | undefined,
  sample: number,
): number {
  const allowed = colorPlan?.allowedNeighbors[base]
    ?.filter((index) => index !== base && pool.includes(index)) ?? []
  const candidates = allowed.length ? allowed : pool.filter((index) => index !== base)
  if (!candidates.length) return base
  return candidates[Math.min(candidates.length - 1, Math.floor(clamp01(sample) * candidates.length))]
}

function roleColors(
  colorPlan: LookColorPlan | undefined,
  paletteSize: number,
): QuiltPlan['roleColors'] {
  const last = Math.max(0, paletteSize - 1)
  return {
    dominant: colorPlan && validColor(colorPlan.roles.dominant, paletteSize)
      ? colorPlan.roles.dominant
      : 0,
    ground: colorPlan && validColor(colorPlan.roles.ground, paletteSize)
      ? colorPlan.roles.ground
      : last,
    ink: colorPlan && validColor(colorPlan.roles.ink, paletteSize)
      ? colorPlan.roles.ink
      : 0,
    accent: colorPlan?.roles.accent != null
      && validColor(colorPlan.roles.accent, paletteSize)
      ? colorPlan.roles.accent
      : null,
  }
}

export function resolveQuiltFrame(
  width: number,
  height: number,
  curve?: CurveSnapshot,
): QuiltFrame {
  if (curve?.silhouette === 'meta-symbol') {
    const boxWidth = Math.max(0.001, Math.abs(curve.amplitudeX) * width)
    const boxHeight = Math.max(0.001, Math.abs(curve.amplitudeY) * height)
    const scale = Math.max(
      0.001,
      Math.min(boxWidth / DESIGN_WIDTH, boxHeight / DESIGN_HEIGHT),
    )
    return {
      centerX: width / 2 + (curve.offsetX * width) / 2,
      centerY: height / 2 + (curve.offsetY * height) / 2,
      scaleX: scale,
      scaleY: scale,
      rotation: curve.rotation,
      clip: 'meta-symbol',
    }
  }

  return {
    centerX: width / 2,
    centerY: height / 2,
    scaleX: width / DESIGN_WIDTH,
    scaleY: height / DESIGN_HEIGHT,
    rotation: 0,
    clip: 'cells',
  }
}

function localToOutput(frame: QuiltFrame, point: QuiltPoint): QuiltPoint {
  const localX = (point.x - DESIGN_WIDTH / 2) * frame.scaleX
  const localY = (point.y - DESIGN_HEIGHT / 2) * frame.scaleY
  const cosine = Math.cos(frame.rotation)
  const sine = Math.sin(frame.rotation)
  return {
    x: frame.centerX + localX * cosine - localY * sine,
    y: frame.centerY + localX * sine + localY * cosine,
  }
}

function compositionAt(
  composition: CompositionPlan | undefined,
  frame: QuiltFrame,
  rect: QuiltRect,
  width: number,
  height: number,
): CompositionSample {
  if (!composition) return { focus: 0, quiet: 0, wave: 0, pulse: false }
  const center = localToOutput(frame, {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  })
  return sampleCompositionPlan(composition, center.x, center.y, width, height)
}

function canSplit(rect: QuiltRect, vertical: boolean, fraction: number, minimum: number): boolean {
  const span = vertical ? rect.width : rect.height
  return span * fraction >= minimum && span * (1 - fraction) >= minimum
}

function splitRect(
  rect: QuiltRect,
  seed: number,
  id: number,
  depth: number,
  minimum: number,
): SplitResult | null {
  const ratio = rect.width / Math.max(0.001, rect.height)
  let vertical = ratio > 1.32
    ? true
    : ratio < 0.76
      ? false
      : chan(seed, id, 'lab.quilt.split.axis') > 0.5
  const fractions = [0.34, 0.4, 0.46, 0.54, 0.6, 0.66] as const
  const fraction = fractions[
    Math.min(
      fractions.length - 1,
      Math.floor(chan(seed, id + depth * 4096, 'lab.quilt.split.fraction') * fractions.length),
    )
  ]
  if (!canSplit(rect, vertical, fraction, minimum)) vertical = !vertical
  if (!canSplit(rect, vertical, fraction, minimum)) return null

  if (vertical) {
    const firstWidth = rect.width * fraction
    return {
      first: { ...rect, width: firstWidth },
      second: {
        x: rect.x + firstWidth,
        y: rect.y,
        width: rect.width - firstWidth,
        height: rect.height,
      },
      seam: [
        { x: rect.x + firstWidth, y: rect.y },
        { x: rect.x + firstWidth, y: rect.y + rect.height },
      ],
    }
  }

  const firstHeight = rect.height * fraction
  return {
    first: { ...rect, height: firstHeight },
    second: {
      x: rect.x,
      y: rect.y + firstHeight,
      width: rect.width,
      height: rect.height - firstHeight,
    },
    seam: [
      { x: rect.x, y: rect.y + firstHeight },
      { x: rect.x + rect.width, y: rect.y + firstHeight },
    ],
  }
}

function orientedPoint(
  rect: QuiltRect,
  orientation: number,
  u: number,
  v: number,
): QuiltPoint {
  let orientedU = u
  let orientedV = v
  if (orientation === 1) {
    orientedU = 1 - v
    orientedV = u
  } else if (orientation === 2) {
    orientedU = 1 - u
    orientedV = 1 - v
  } else if (orientation === 3) {
    orientedU = v
    orientedV = 1 - u
  }
  return {
    x: rect.x + orientedU * rect.width,
    y: rect.y + orientedV * rect.height,
  }
}

function polygon(
  rect: QuiltRect,
  orientation: number,
  coordinates: readonly (readonly [number, number])[],
): QuiltPoint[] {
  return coordinates.map(([u, v]) => orientedPoint(rect, orientation, u, v))
}

function familyFor(
  seed: number,
  id: number,
  quiet: number,
  complexity: number,
): QuiltFamily {
  if (quiet > 0.62) return 'whole-cloth'
  const sample = chan(seed, id, 'lab.quilt.family')
  const wholeLimit = 0.12 + quiet * 0.78 + (1 - complexity) * 0.12
  if (sample < wholeLimit) return 'whole-cloth'
  const remaining = (sample - wholeLimit) / Math.max(0.001, 1 - wholeLimit)
  if (remaining < 0.36) return 'half-square'
  if (remaining < 0.7) return 'rail'
  return 'log-cabin'
}

function familyLayout(
  rect: QuiltRect,
  id: number,
  family: QuiltFamily,
  orientation: number,
  colors: readonly [number, number, number],
): OrientedLayout {
  const [base, alternate, tertiary] = colors
  const seam = (
    seamIndex: number,
    coordinates: readonly (readonly [number, number])[],
  ): QuiltSeam => ({
    id: id * 16 + seamIndex,
    level: 'piece',
    points: polygon(rect, orientation, coordinates),
  })
  const piece = (
    color: number,
    coordinates: readonly (readonly [number, number])[],
  ): QuiltPiece => ({
    color,
    points: polygon(rect, orientation, coordinates),
  })

  if (family === 'half-square') {
    return {
      pieces: [
        piece(base, [[0, 0], [1, 0], [1, 1]]),
        piece(alternate, [[0, 0], [1, 1], [0, 1]]),
      ],
      seams: [seam(0, [[0, 0], [1, 1]])],
    }
  }

  if (family === 'rail') {
    return {
      pieces: [
        piece(base, [[0, 0], [0.31, 0], [0.31, 1], [0, 1]]),
        piece(alternate, [[0.31, 0], [0.66, 0], [0.66, 1], [0.31, 1]]),
        piece(tertiary, [[0.66, 0], [1, 0], [1, 1], [0.66, 1]]),
      ],
      seams: [
        seam(0, [[0.31, 0], [0.31, 1]]),
        seam(1, [[0.66, 0], [0.66, 1]]),
      ],
    }
  }

  if (family === 'log-cabin') {
    return {
      pieces: [
        piece(alternate, [[0, 0], [0.26, 0], [0.26, 1], [0, 1]]),
        piece(base, [[0.26, 0], [1, 0], [1, 0.28], [0.26, 0.28]]),
        piece(tertiary, [[0.74, 0.28], [1, 0.28], [1, 1], [0.74, 1]]),
        piece(base, [[0.26, 0.28], [0.74, 0.28], [0.74, 1], [0.26, 1]]),
      ],
      seams: [
        seam(0, [[0.26, 0], [0.26, 1]]),
        seam(1, [[0.26, 0.28], [1, 0.28]]),
        seam(2, [[0.74, 0.28], [0.74, 1]]),
      ],
    }
  }

  return {
    pieces: [
      piece(base, [[0, 0], [1, 0], [1, 1], [0, 1]]),
    ],
    seams: [],
  }
}

function makePatch(
  options: BuildQuiltPlanOptions,
  frame: QuiltFrame,
  pool: readonly number[],
  rect: QuiltRect,
  id: number,
  depth: number,
  regionId: number,
): PatchDraft {
  const complexity = clamp01(options.complexity)
  const sample = compositionAt(
    options.composition,
    frame,
    rect,
    options.width,
    options.height,
  )
  const baseColor = weightedPoolColor(
    pool,
    options.colorPlan,
    chan(options.seed, regionId, 'lab.quilt.region.color'),
  )
  const alternate = neighborColor(
    baseColor,
    pool,
    options.colorPlan,
    chan(options.seed, id, 'lab.quilt.patch.alternate'),
  )
  const tertiary = neighborColor(
    alternate,
    pool,
    options.colorPlan,
    chan(options.seed, id, 'lab.quilt.patch.tertiary'),
  )
  const family = familyFor(options.seed, id, sample.quiet, complexity)
  const orientation = Math.floor(chan(options.seed, id, 'lab.quilt.orientation') * 4)
  const layout = familyLayout(
    rect,
    id,
    family,
    orientation,
    [baseColor, alternate, tertiary],
  )
  return {
    id,
    depth,
    regionId,
    family,
    rect,
    quiet: sample.quiet,
    focus: sample.focus,
    baseColor,
    pieces: layout.pieces,
    pieceSeams: layout.seams,
  }
}

function insetColorFor(
  patch: PatchDraft,
  roles: QuiltPlan['roleColors'],
  pool: readonly number[],
): number {
  if (roles.accent != null && roles.accent !== patch.baseColor) return roles.accent
  for (const candidate of [roles.ink, roles.ground, ...pool].reverse()) {
    if (candidate !== patch.baseColor) return candidate
  }
  return patch.baseColor
}

function insetFor(
  patch: PatchDraft,
  seed: number,
  roles: QuiltPlan['roleColors'],
  pool: readonly number[],
  frame: QuiltFrame,
): QuiltInset | null {
  let width = patch.rect.width
    * (0.19 + chan(seed, patch.id, 'lab.quilt.inset.width') * 0.13)
  let height = patch.rect.height
    * (0.17 + chan(seed, patch.id, 'lab.quilt.inset.height') * 0.12)
  let centerX = patch.rect.x
    + patch.rect.width * (0.42 + chan(seed, patch.id, 'lab.quilt.inset.x') * 0.16)
  let centerY = patch.rect.y
    + patch.rect.height * (0.42 + chan(seed, patch.id, 'lab.quilt.inset.y') * 0.16)
  if (frame.clip === 'meta-symbol') {
    let bestDistance = -1
    for (const v of [0.28, 0.43, 0.57, 0.72]) {
      for (const u of [0.28, 0.43, 0.57, 0.72]) {
        const x = patch.rect.x + patch.rect.width * u
        const y = patch.rect.y + patch.rect.height * v
        const sample = sampleMetaSymbol(x, y)
        if (!sample.inside || sample.distance <= bestDistance) continue
        centerX = x
        centerY = y
        bestDistance = sample.distance
      }
    }
    const halfDiagonal = Math.hypot(width, height) / 2
    const insetScale = Math.min(1, (bestDistance - 0.1) / Math.max(0.001, halfDiagonal) * 0.84)
    if (insetScale < 0.42) return null
    width *= insetScale
    height *= insetScale
  }
  const diamond = chan(seed, patch.id, 'lab.quilt.inset.shape') > 0.5
  const points = diamond
    ? [
        { x: centerX, y: centerY - height / 2 },
        { x: centerX + width / 2, y: centerY },
        { x: centerX, y: centerY + height / 2 },
        { x: centerX - width / 2, y: centerY },
      ]
    : [
        { x: centerX - width / 2, y: centerY - height / 2 },
        { x: centerX + width / 2, y: centerY - height / 2 },
        { x: centerX + width / 2, y: centerY + height / 2 },
        { x: centerX - width / 2, y: centerY + height / 2 },
      ]
  return {
    color: insetColorFor(patch, roles, pool),
    points,
  }
}

export function buildQuiltPlan(options: BuildQuiltPlanOptions): QuiltPlan {
  const complexity = clamp01(options.complexity)
  const paletteSize = Math.max(1, options.paletteSize)
  const frame = resolveQuiltFrame(options.width, options.height, options.curve)
  const pool = roleColorPool(options.colorPlan, paletteSize)
  const roles = roleColors(options.colorPlan, paletteSize)
  const drafts: PatchDraft[] = []
  const constructionSeams: QuiltSeam[] = []
  const maxDepth = complexity < 0.25 ? 3 : complexity < 0.7 ? 4 : 5
  const minimum = 0.74 + (1 - complexity) * 0.34

  const visit = (
    rect: QuiltRect,
    id: number,
    depth: number,
    regionId: number,
  ) => {
    const sample = compositionAt(
      options.composition,
      frame,
      rect,
      options.width,
      options.height,
    )
    const mandatory = depth < 2 && !(depth === 1 && sample.quiet > 0.78)
    const splitProbability = clamp01(
      0.46
      + complexity * 0.34
      + sample.focus * 0.16
      + (sample.pulse ? 0.055 : 0)
      - sample.quiet * 0.7
      - Math.max(0, depth - 2) * 0.045,
    )
    const shouldSplit = depth < maxDepth
      && (
        mandatory
        || chan(options.seed, id + depth * 8192, 'lab.quilt.split.presence') < splitProbability
      )
    const split = shouldSplit
      ? splitRect(rect, options.seed, id, depth, minimum)
      : null
    if (!split) {
      drafts.push(makePatch(
        options,
        frame,
        pool,
        rect,
        id,
        depth,
        depth < 2 ? id : regionId,
      ))
      return
    }

    constructionSeams.push({
      id,
      level: depth <= 1 ? 'major' : 'minor',
      points: split.seam,
    })
    const firstId = id * 2
    const secondId = firstId + 1
    visit(
      split.first,
      firstId,
      depth + 1,
      depth === 1 ? firstId : regionId,
    )
    visit(
      split.second,
      secondId,
      depth + 1,
      depth === 1 ? secondId : regionId,
    )
  }

  visit(
    { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT },
    1,
    0,
    1,
  )

  const accentAreaLimit = options.colorPlan?.accentAreaLimit ?? 0.06
  const insetBudget = DESIGN_WIDTH * DESIGN_HEIGHT * Math.min(0.03, accentAreaLimit * 0.34)
  const candidates = drafts
    .map((patch) => ({
      patch,
      score: chan(options.seed, patch.id, 'lab.quilt.inset.presence')
        + patch.focus * 0.18
        - patch.quiet * 0.46,
    }))
    .filter(({ patch, score }) =>
      score > 0.62
      && patch.quiet < 0.52
      && Math.min(patch.rect.width, patch.rect.height) > 1.1)
    .sort((a, b) => b.score - a.score || a.patch.id - b.patch.id)
  const insets = new Map<number, QuiltInset>()
  const maxInsets = 1 + Math.round(complexity * 2)
  let insetArea = 0
  for (const { patch } of candidates) {
    const area = patch.rect.width * patch.rect.height * 0.075
    if (insetArea > 0 && insetArea + area > insetBudget) continue
    const inset = insetFor(patch, options.seed, roles, pool, frame)
    if (!inset) continue
    if (
      frame.clip === 'meta-symbol'
      && !inset.points.every((point) => {
        const sample = sampleMetaSymbol(point.x, point.y)
        return sample.inside && sample.distance > 0.055
      })
    ) continue
    insets.set(patch.id, inset)
    insetArea += area
    if (insetArea >= insetBudget || insets.size >= maxInsets) break
  }

  return {
    frame,
    patches: drafts.map((patch) => ({
      ...patch,
      inset: insets.get(patch.id) ?? null,
    })),
    constructionSeams,
    roleColors: roles,
  }
}

export function resolveQuiltMotion(
  phase: number | undefined,
  amount: number,
  speed: number,
): { dashTravel: number; stitchAlpha: number } {
  const normalizedPhase = phase === undefined
    ? 0
    : ((phase % 1) + 1) % 1
  const theta = normalizedPhase * TAU
  const strength = clamp01(amount)
  const energy = clamp01((speed - 0.1) / 1.9)
  return {
    dashTravel: (
      Math.sin(theta) * 0.42
      + Math.sin(theta * 2) * 0.14 * energy
    ) * strength,
    stitchAlpha: 1 + (
      (1 - Math.cos(theta)) * 0.08
      + Math.sin(theta * 2) * 0.035 * energy
    ) * strength,
  }
}

function getMetaSymbolPath(): Path2D {
  if (!metaSymbolPath) metaSymbolPath = new Path2D(META_SYMBOL_PATH)
  return metaSymbolPath
}

function beginPolygon(ctx: CanvasRenderingContext2D, points: readonly QuiltPoint[]): void {
  if (!points.length) return
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y)
  }
  ctx.closePath()
}

function seamPath(seams: readonly QuiltSeam[]): Path2D {
  const path = new Path2D()
  for (const seam of seams) {
    if (seam.points.length < 2) continue
    path.moveTo(seam.points[0].x, seam.points[0].y)
    for (let index = 1; index < seam.points.length; index += 1) {
      path.lineTo(seam.points[index].x, seam.points[index].y)
    }
    if (seam.closed) path.closePath()
  }
  return path
}

function applyLocalTransform(ctx: CanvasRenderingContext2D, frame: QuiltFrame): void {
  ctx.translate(frame.centerX, frame.centerY)
  ctx.rotate(frame.rotation)
  ctx.scale(frame.scaleX, frame.scaleY)
  ctx.translate(-DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2)
}

function applyClip(
  ctx: CanvasRenderingContext2D,
  plan: QuiltPlan,
  width: number,
  height: number,
  cells: readonly CellNode[],
): boolean {
  if (plan.frame.clip === 'meta-symbol') {
    ctx.translate(-META_SYMBOL_MIN_X, -META_SYMBOL_MIN_Y)
    ctx.clip(getMetaSymbolPath())
    ctx.translate(META_SYMBOL_MIN_X, META_SYMBOL_MIN_Y)
    return true
  }

  const blocks = cells.filter((cell) => cell.treatment === 'blocks')
  if (!blocks.length) return false
  const clip = new Path2D()
  for (const cell of blocks) {
    clip.rect(
      cell.x / Math.max(1, width) * DESIGN_WIDTH,
      cell.y / Math.max(1, height) * DESIGN_HEIGHT,
      (cell.size + 0.35) / Math.max(1, width) * DESIGN_WIDTH,
      (cell.size + 0.35) / Math.max(1, height) * DESIGN_HEIGHT,
    )
  }
  ctx.clip(clip)
  return true
}

function paletteColor(palette: readonly string[], index: number): string {
  return palette[index] ?? palette[0] ?? '#000000'
}

function strokeSeams(
  ctx: CanvasRenderingContext2D,
  seams: readonly QuiltSeam[],
  color: string,
  width: number,
  alpha: number,
  dash: readonly number[] = [],
  dashOffset = 0,
): void {
  if (!seams.length) return
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.globalAlpha = alpha
  ctx.setLineDash([...dash])
  ctx.lineDashOffset = dashOffset
  ctx.stroke(seamPath(seams))
}

export function renderQuilt(
  ctx: CanvasRenderingContext2D,
  options: RenderQuiltOptions,
): QuiltPlan {
  const plan = buildQuiltPlan(options)
  const complexity = clamp01(options.complexity)
  const motion = resolveQuiltMotion(
    options.motionPhase,
    options.motionAmount,
    options.motionSpeed,
  )
  const dominant = paletteColor(options.palette, plan.roleColors.dominant)
  const ground = paletteColor(options.palette, plan.roleColors.ground)
  const ink = paletteColor(options.palette, plan.roleColors.ink)

  ctx.save()
  applyLocalTransform(ctx, plan.frame)
  if (!applyClip(ctx, plan, options.width, options.height, options.cells)) {
    ctx.restore()
    return plan
  }

  ctx.globalAlpha = 1
  ctx.fillStyle = dominant
  ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)
  for (const patch of plan.patches) {
    ctx.fillStyle = paletteColor(options.palette, patch.baseColor)
    ctx.fillRect(patch.rect.x, patch.rect.y, patch.rect.width, patch.rect.height)
    for (const piece of patch.pieces) {
      beginPolygon(ctx, piece.points)
      ctx.fillStyle = paletteColor(options.palette, piece.color)
      ctx.fill()
    }
    if (patch.inset) {
      beginPolygon(ctx, patch.inset.points)
      ctx.fillStyle = paletteColor(options.palette, patch.inset.color)
      ctx.fill()
    }
  }

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const pieceSeams = plan.patches.flatMap((patch) => patch.pieceSeams)
  const minorSeams = plan.constructionSeams.filter((seam) => seam.level === 'minor')
  const majorSeams = plan.constructionSeams.filter((seam) => seam.level === 'major')
  const insetSeams = plan.patches
    .filter((patch) => patch.inset)
    .map((patch) => ({
      id: patch.id,
      level: 'inset' as const,
      points: patch.inset!.points,
      closed: true,
    }))

  strokeSeams(ctx, pieceSeams, ground, 0.048, 0.22)
  strokeSeams(ctx, pieceSeams, ink, 0.013, 0.34)

  const minorPeriod = 0.19 - complexity * 0.035
  strokeSeams(ctx, minorSeams, ground, 0.076, 0.4)
  strokeSeams(
    ctx,
    minorSeams,
    ink,
    0.015,
    0.58 * motion.stitchAlpha,
    [minorPeriod * 0.52, minorPeriod * 0.48],
    motion.dashTravel * minorPeriod,
  )

  const majorPeriod = 0.25 - complexity * 0.04
  strokeSeams(ctx, majorSeams, ground, 0.13, 0.82)
  strokeSeams(ctx, majorSeams, ink, 0.038, 0.38)
  strokeSeams(
    ctx,
    majorSeams,
    ink,
    0.017,
    0.84 * motion.stitchAlpha,
    [majorPeriod * 0.58, majorPeriod * 0.42],
    -motion.dashTravel * majorPeriod,
  )

  strokeSeams(ctx, insetSeams, ground, 0.082, 0.84)
  strokeSeams(
    ctx,
    insetSeams,
    ink,
    0.017,
    0.9 * motion.stitchAlpha,
    [0.105, 0.075],
    motion.dashTravel * 0.18,
  )

  if (plan.frame.clip === 'meta-symbol') {
    const symbol = getMetaSymbolPath()
    ctx.save()
    ctx.translate(-META_SYMBOL_MIN_X, -META_SYMBOL_MIN_Y)
    ctx.setLineDash([])
    ctx.globalAlpha = 0.9
    ctx.strokeStyle = ground
    ctx.lineWidth = 0.17
    ctx.stroke(symbol)
    ctx.setLineDash([majorPeriod * 0.62, majorPeriod * 0.38])
    ctx.lineDashOffset = motion.dashTravel * majorPeriod
    ctx.globalAlpha = 0.9 * motion.stitchAlpha
    ctx.strokeStyle = ink
    ctx.lineWidth = 0.019
    ctx.stroke(symbol)
    ctx.restore()
  }

  ctx.restore()
  return plan
}
