import { chan } from '@/core/organic/random'
import type { AnalysisMaps } from '../analysis'
import { sampleMap } from '../analysis'
import type { Field, FitRect } from '../field'
import { coherenceField } from '../field'
import { bandAt } from '../territory'
import type { MarkParams, StructureState, TerritoryState, TreatmentId } from '../types'

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
}): CellNode[] {
  const { T, territory, structure, maps, rect, outW, outH, seed, restore } = opts
  // ONE square pitch — deriving separate x/y pitches and sizing cells
  // min(cw, ch) left unpainted paper gutters along the larger axis.
  // The last column/row overflows past the edge instead; the canvas
  // clips it and every treatment paints flush.
  const cell = Math.max(8, structure.baseCell)
  const cols = Math.max(1, Math.ceil(outW / cell))
  const rows = Math.max(1, Math.ceil(outH / cell))
  const bands = territory.bands.length
  const out: CellNode[] = []

  const detailAt = (x: number, y: number): number => {
    if (!maps) return 0
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
      treatment !== 'flat' &&
      detailAt(cx, cy) * structure.subdivide > 0.16 / (level + 1)
    if (canSplit) {
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
  // material mode: tone comes from cell.t (the shaded border-distance
  // territory, already normalized to the subject's own luminance range)
  // while edge/detail/orientation still read the captured frame — raw
  // (1-lum) on a near-white model would make lit faces SPARSER than the
  // background and hollow the form out
  toneFromTerritory?: boolean
}): MarkStamp[] {
  const { cells, params: p, maps, rect, seed, bankSize, flowField, toneFromTerritory } = opts
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

    // outside the fitted source (or with no source at all) there is
    // still territory — marks fall back to the territory value as their
    // tone so the curve can carry composition beyond the photo's edge
    const a = inSource && maps ? sampleMap(maps.alpha, maps.w, maps.h, mx, my) : 0
    const tone = toneFromTerritory
      ? cell.t
      : inSource && maps
        ? (1 - sampleMap(maps.lum, maps.w, maps.h, mx, my)) * a + cell.t * (1 - a)
        : cell.t
    const edge = inSource && maps ? sampleMap(maps.edge, maps.w, maps.h, mx, my) : 0
    const detail = inSource && maps ? sampleMap(maps.detailFine, maps.w, maps.h, mx, my) : 0
    const structure = Math.min(1, edge * 0.7 + detail * 0.65)
    const value = tone * (1 - p.evidenceMix) + structure * p.evidenceMix

    const presence = Math.min(1, p.occupancy * (0.15 + 0.85 * value) * 1.35)
    if (chan(seed, id, 'lab.cull') >= presence) continue

    const coh = region(x, y)
    let protoIndex = 0
    if (bankSize > 1) {
      const shift = (coh - 0.5) * 0.55 * (bankSize - 1)
      const jit = (chan(seed, id, 'lab.pick') - 0.5) * 0.9
      protoIndex = Math.round(value * (bankSize - 1) + shift + jit)
      protoIndex = Math.max(0, Math.min(bankSize - 1, protoIndex))
    }

    const size = cell.size * (p.minScale + (p.maxScale - p.minScale) * Math.pow(tone, 0.85))
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

    out.push({ x, y, size, rot: rot || 0, protoIndex, tone, mx, my })
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
