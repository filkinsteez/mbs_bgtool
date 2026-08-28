import { chan } from '@/core/organic/random'
import type { AnalysisMaps } from '../analysis'
import { sampleMap } from '../analysis'
import type { Field, FitRect } from '../field'
import { coherenceField } from '../field'
import { bandAt } from '../territory'
import type { MarkParams, StructureState, TerritoryState, TreatmentId } from '../types'
import {
  sampleCompositionPlan,
  type CompositionPlan,
} from '../compositionPlan'

// The multiscale carrier + per-cell law assignment. Base cells read the
// territory and take a band; cells whose image detail (times SUBDIVIDE)
// crosses the split threshold recurse — children re-read the territory
// at their own coordinates, so band boundaries sharpen where the grid
// is fine. Every cell id is stable across parameter changes:
// (level, ix, iy) packs into one 31-bit int for the chan channels.

export type CellNode = {
  x: number // top-left, output px
  y: number
  size: number
  ix: number // grid coords AT ITS LEVEL (dither indexes these)
  iy: number
  level: number
  band: number
  treatment: TreatmentId
  t: number // territory at the cell center
}

export type MarkStamp = {
  x: number
  y: number
  size: number
  rot: number
  protoIndex: number
  tone: number
  mx: number // analysis-space coords for paint-time color sampling
  my: number
  hierarchy: number
}

export function cellId(level: number, ix: number, iy: number): number {
  return ((level * 4096 + (iy & 4095)) * 8192 + (ix & 8191)) >>> 0
}

export function buildCells(opts: {
  T: Field
  territory: TerritoryState
  structure: StructureState
  maps: AnalysisMaps | null
  rect: FitRect
  outW: number
  outH: number
  seed: number
  // the eraser's core: where this field is strong the cell IS the
  // photo, whatever the bands say — pushing territory to the top band
  // was not enough when the top band itself is a treatment (a mosaic
  // near-band made faces impossible to un-blur)
  restore?: Field | null
  // MATERIAL MODE (3D overlay): cells straddling the subject silhouette
  // keep subdividing down to this level even when detail or maxLevels
  // says stop, so the model's outline survives coarse complexity
  // settings. 0 (the default) leaves the 2D behavior untouched.
  edgeSplitLevels?: number
}): CellNode[] {
  const {
    T,
    territory,
    structure,
    maps,
    rect,
    outW,
    outH,
    seed,
    restore,
    edgeSplitLevels = 0,
  } = opts
  // ONE square pitch — deriving separate x/y pitches and sizing cells
  // min(cw, ch) left unpainted paper gutters along the larger axis.
  // The last column/row overflows past the edge instead; the canvas
  // clips it and every treatment paints flush.
  const cell = Math.max(8, structure.baseCell)
  const cols = Math.max(1, Math.ceil(outW / cell))
  const rows = Math.max(1, Math.ceil(outH / cell))
  const bands = territory.bands.length
  const out: CellNode[] = []
  const proceduralDetail = maps
    ? null
    : coherenceField(
        seed,
        { x: 0, y: 0, w: outW, h: outH },
        7 + structure.maxLevels * 2,
        'lab.structure.detail',
      )

  const detailAt = (x: number, y: number): number => {
    if (!maps) {
      const e = Math.max(2, cell * 0.2)
      const gradient = Math.hypot(T(x + e, y) - T(x - e, y), T(x, y + e) - T(x, y - e))
      return Math.min(1, (proceduralDetail?.(x, y) ?? 0) * 0.36 + gradient * 1.6)
    }
    const u = (x - rect.x) / rect.w
    const v = (y - rect.y) / rect.h
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0
    return sampleMap(maps.detailCoarse, maps.w, maps.h, u * maps.w - 0.5, v * maps.h - 0.5)
  }

  const emit = (x: number, y: number, size: number, ix: number, iy: number, level: number) => {
    const cx = x + size / 2
    const cy = y + size / 2
    const t = T(cx, cy)
    const band = bandAt(t, bands, territory.boundary, ix, iy, seed, cellId(level, ix, iy))
    const treatment: TreatmentId =
      restore && restore(cx, cy) > 0.45 ? 'photo' : (territory.bands[band] ?? 'empty')

    // split while detail earns it — and only where a treatment can use
    // the resolution (empty and flat cells gain nothing from splitting)
    const canSplit =
      level < structure.maxLevels &&
      treatment !== 'empty' &&
      treatment !== 'quiet' &&
      treatment !== 'flat' &&
      detailAt(cx, cy) * structure.subdivide > 0.16 / (level + 1)
    // material silhouette split: the border-distance territory is ~0
    // outside the subject and >=0.17 inside, so a corner spread across
    // that step marks a boundary cell — refine it regardless of detail
    const straddlesEdge = (): boolean => {
      if (edgeSplitLevels <= 0 || level >= edgeSplitLevels) return false
      const v0 = T(x, y)
      const v1 = T(x + size, y)
      const v2 = T(x, y + size)
      const v3 = T(x + size, y + size)
      const low = Math.min(v0, v1, v2, v3, t)
      const high = Math.max(v0, v1, v2, v3, t)
      return low < 0.17 && high > 0.17
    }
    if (canSplit || straddlesEdge()) {
      const half = size / 2
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 2; i++)
          emit(x + i * half, y + j * half, half, ix * 2 + i, iy * 2 + j, level + 1)
      return
    }
    out.push({ x, y, size, ix, iy, level, band, treatment, t })
  }

  for (let iy = 0; iy < rows; iy++)
    for (let ix = 0; ix < cols; ix++) emit(ix * cell, iy * cell, cell, ix, iy, 0)
  return out
}

// ---------------------------------------------------------------------------
// Marks for the cells that carry the 'marks' treatment. Same evidence
// division as the first study — tone is coverage and size, structure is
// selection and rotation — plus FLOW: rotation can hand over from image
// edges to the curve's own tangent field.

export function buildCellMarks(opts: {
  cells: CellNode[]
  params: MarkParams
  maps: AnalysisMaps | null // null = no source; territory alone carries tone
  rect: FitRect
  seed: number
  bankSize: number
  flowField: ((x: number, y: number) => number) | null // angle, radians
  composition?: CompositionPlan
  outW?: number
  outH?: number
  // MATERIAL MODE (3D overlay): the captured model is bright, so the
  // (1-lum)*alpha ink evidence reads ~0 across the whole subject and the
  // marks grammar starves. The territory already carries the shaded
  // silhouette — let it drive tone (and guarantee presence) instead.
  material?: boolean
}): MarkStamp[] {
  const {
    cells,
    params: p,
    maps,
    rect,
    seed,
    bankSize,
    flowField,
    composition,
    outW = rect.w,
    outH = rect.h,
    material = false,
  } = opts
  const region = coherenceField(
    seed,
    rect,
    Math.round(3 + (1 - p.coherenceScale) * 17),
    'lab.region',
  )
  const out: MarkStamp[] = []

  for (const cell of cells) {
    if (cell.treatment !== 'marks') continue
    const id = cellId(cell.level, cell.ix, cell.iy)
    const x = cell.x + cell.size / 2
    const y = cell.y + cell.size / 2

    const u = (x - rect.x) / rect.w
    const v = (y - rect.y) / rect.h
    const inSource = !!maps && u >= 0 && u <= 1 && v >= 0 && v <= 1
    const mx = maps ? u * maps.w - 0.5 : 0
    const my = maps ? v * maps.h - 0.5 : 0

    const coh = region(x, y)
    // outside the fitted source (or with no source at all) there is
    // still territory — marks fall back to the territory value as their
    // tone, shaded by the coherence field so a flat territory interior
    // still breathes instead of stamping one uniform size everywhere
    const a = inSource && maps ? sampleMap(maps.alpha, maps.w, maps.h, mx, my) : 0
    const tone = material
      ? Math.max(
          cell.t,
          inSource && maps
            ? (1 - sampleMap(maps.lum, maps.w, maps.h, mx, my)) * a * 0.6
            : 0,
        )
      : inSource && maps
        ? (1 - sampleMap(maps.lum, maps.w, maps.h, mx, my)) * a + cell.t * (1 - a)
        : cell.t * (0.6 + coh * 0.4)
    const edge = inSource && maps ? sampleMap(maps.edge, maps.w, maps.h, mx, my) : 0
    const detail = inSource && maps ? sampleMap(maps.detailFine, maps.w, maps.h, mx, my) : 0
    const structure = Math.min(1, edge * 0.7 + detail * 0.65)
    const value = tone * (1 - p.evidenceMix) + structure * p.evidenceMix

    const planSample = composition && p.bank !== 'brand'
      ? sampleCompositionPlan(composition, x, y, outW, outH)
      : null
    const planActivity = planSample
      ? (0.46 + planSample.focus * 0.75)
        * (1 - planSample.quiet * 0.9)
        * (planSample.pulse ? 1.14 : 0.72)
      : 1
    // material: the art-direction plan may declare the subject's area
    // "quiet" — the model must still render, so the shaded silhouette
    // floors the activity inside the subject
    const activity = material ? Math.max(planActivity, tone) : planActivity
    let presence = Math.min(1, p.occupancy * (0.15 + 0.85 * value) * 1.35 * activity)
    // material: the lit faces of the model sit at the shading floor —
    // guarantee enough stamps there that the treated form stays solid,
    // leaving tone to grade SIZE while presence keeps the body covered
    if (material && tone > 0.2) presence = Math.max(presence, 0.3 + tone * 0.25)
    if (chan(seed, id, 'lab.cull') >= presence) continue

    const hero = (planSample?.focus ?? 0) > 0.52
      && chan(seed, id, 'lab.mark.hero') > 0.78
    const hierarchy = hero
      ? 1
      : planSample?.pulse
        ? 0.58
        : 0.24 + chan(seed, id, 'lab.mark.hierarchy') * 0.16
    let protoIndex = 0
    if (bankSize > 1) {
      const shift = (coh - 0.5) * 0.55 * (bankSize - 1)
      const jit = (chan(seed, id, 'lab.pick') - 0.5) * 0.9
      protoIndex = Math.round(value * (bankSize - 1) + shift + jit)
      protoIndex = Math.max(0, Math.min(bankSize - 1, protoIndex))
    }

    const size = cell.size
      * (p.minScale + (p.maxScale - p.minScale) * Math.pow(tone, 0.85))
      * (p.bank === 'brand' ? 1 : 0.68 + hierarchy * 0.82)
    if (size < 0.75) continue

    // Orientations are mod-π: blending them as scalars cancels at the
    // ±π/2 wrap (a 91° edge and an 89° tangent would average to 0 —
    // horizontal, perpendicular to both). All blending happens in
    // doubled-angle vector space, the same representation the analysis
    // and flow fields already use, then halves back at the end.
    const ox = inSource && maps ? sampleMap(maps.orientX, maps.w, maps.h, mx, my) : 0
    const oy = inSource && maps ? sampleMap(maps.orientY, maps.w, maps.h, mx, my) : 0
    const confidence = Math.min(1, Math.hypot(ox, oy) * 6)
    const edgeAngle = 0.5 * Math.atan2(oy, ox)
    const regionAngle = (coh - 0.5) * (Math.PI / 2)
    let vx =
      Math.cos(2 * edgeAngle) * confidence + Math.cos(2 * regionAngle) * (1 - confidence)
    let vy =
      Math.sin(2 * edgeAngle) * confidence + Math.sin(2 * regionAngle) * (1 - confidence)
    if (flowField && p.flow > 0) {
      const fa = flowField(x, y)
      vx = vx * (1 - p.flow) + Math.cos(2 * fa) * p.flow
      vy = vy * (1 - p.flow) + Math.sin(2 * fa) * p.flow
    }
    const rot = p.rotationInfluence * 0.5 * Math.atan2(vy, vx)

    // Sourceless marks have no image evidence pinning them to the grid —
    // seeded sub-cell drift breaks the punch-card read. With a source the
    // stamp stays put so it keeps reporting the pixels it sampled.
    const jitterX = maps ? 0 : (chan(seed, id, 'lab.mark.jx') - 0.5) * cell.size * 0.4
    const jitterY = maps ? 0 : (chan(seed, id, 'lab.mark.jy') - 0.5) * cell.size * 0.4

    out.push({
      x: x + jitterX,
      y: y + jitterY,
      size,
      rot: rot || 0,
      protoIndex,
      tone,
      mx,
      my,
      hierarchy,
    })
  }
  return out
}

// The curve's tangent as an orientation Field: doubled-angle vectors on
// a lattice (nearest curve point per node), sampled bilinearly so
// orientations average instead of cancelling. Pure; built once per
// curve snapshot.
export function curveFlowField(
  pts: { x: number; y: number; angle: number }[],
  outW: number,
  outH: number,
  budget = 48,
): (x: number, y: number) => number {
  // budget the LONG side so extreme aspect ratios stay bounded
  const cols = Math.max(4, Math.round((budget * outW) / Math.max(outW, outH)))
  const rows = Math.max(4, Math.round((cols * outH) / Math.max(outW, 1)))
  const vx = new Float32Array((cols + 1) * (rows + 1))
  const vy = new Float32Array((cols + 1) * (rows + 1))
  const cellW = outW / cols
  const cellH = outH / rows
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const px = c * cellW
      const py = r * cellH
      let best = Infinity
      let ang = 0
      for (const p of pts) {
        const d = (p.x - px) * (p.x - px) + (p.y - py) * (p.y - py)
        if (d < best) {
          best = d
          ang = p.angle
        }
      }
      const i = r * (cols + 1) + c
      vx[i] = Math.cos(2 * ang)
      vy[i] = Math.sin(2 * ang)
    }
  }
  return (x, y) => {
    const gx = Math.max(0, Math.min(cols - 0.001, x / cellW))
    const gy = Math.max(0, Math.min(rows - 0.001, y / cellH))
    const c0 = Math.floor(gx)
    const r0 = Math.floor(gy)
    const fx = gx - c0
    const fy = gy - r0
    const w = cols + 1
    const i = r0 * w + c0
    const X = (vx[i] * (1 - fx) + vx[i + 1] * fx) * (1 - fy) + (vx[i + w] * (1 - fx) + vx[i + w + 1] * fx) * fy
    const Y = (vy[i] * (1 - fx) + vy[i + 1] * fx) * (1 - fy) + (vy[i + w] * (1 - fx) + vy[i + w + 1] * fx) * fy
    return 0.5 * Math.atan2(Y, X)
  }
}

// quantized print tints for the 'tint' color mode — three inks, no
// continuous alpha (limited states read as typeset; continuous ones
// read as a filter)
export const TINT_LEVELS = [0.32, 0.58, 1] as const

export function tintFor(tone: number): number {
  return tone > 0.62 ? TINT_LEVELS[2] : tone > 0.28 ? TINT_LEVELS[1] : TINT_LEVELS[0]
}

export const MARK_DEFAULTS: MarkParams = {
  bank: 'brand',
  evidenceMix: 0.35,
  occupancy: 0.85,
  minScale: 0.25,
  maxScale: 0.95,
  rotationInfluence: 0.6,
  flow: 0,
  coherenceScale: 0.45,
  // palette by default — 'ink' left the color system dead until the
  // user found the buried Color-from control
  colorMode: 'palette',
  echo: 0,
}
