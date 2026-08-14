import { chan } from '@/core/organic/random'
import { META_PHASE } from '@/core/lissajous/equation'
import { sampleCurve } from '@/core/lissajous/sampler'
import { buildDistanceGrid } from '@/core/cloner/contours'
import {
  META_SYMBOL_HEIGHT,
  META_SYMBOL_WIDTH,
  sampleMetaSymbol,
} from '@/core/metaSymbol'
import type { AnalysisMaps } from './analysis'
import type { Field, FitRect } from './field'
import { fieldFromMap } from './field'
import type {
  BoundaryMode,
  CurveSnapshot,
  FieldSourceState,
  TerritoryState,
} from './types'

// Territory compilation: the source stack becomes ONE Field, evaluated
// lazily per query. Sources fold in list order — each contributes
// weight * value through its combine mode — and the result clamps to
// 0..1. Everything here is pure; the painted mask arrives as a
// pre-built Field from the browser layer.

export type TerritoryDeps = {
  rect: FitRect // where the source image sits in output space
  outW: number
  outH: number
  maps: AnalysisMaps | null
  paintField: Field | null
  // pre-built fields by source id (the render layer's lattice caches).
  // An override REPLACES the source's field but keeps its position in
  // the fold — weight, invert, and combine semantics stay intact.
  fieldOverrides?: Map<string, Field>
}

type DistGrid = ReturnType<typeof buildDistanceGrid>

// distance-to-curve on a lattice, sampled bilinearly. The snapshot's
// amplitudes are fractions of the output half-extent — the same
// convention the editor uses against its artboard.
export function buildCurveField(
  snap: CurveSnapshot,
  outW: number,
  outH: number,
  softness: number,
): Field {
  if (snap.silhouette === 'meta-symbol') {
    return buildMetaSymbolField(snap, outW, outH, softness)
  }
  const samples = sampleCurve(
    { ...snap, sampleDensity: 96, curve: snap.curve },
    outW,
    outH,
    256,
  )
  const pts = samples.map((s) => ({ x: s.x, y: s.y }))
  // budget the LONG side: buildDistanceGrid derives rows from aspect,
  // so a tall-narrow output must shrink cols or the lattice explodes
  // (64x8192 would otherwise cost ~1.2M nodes x 255 segments)
  const cols = Math.max(12, Math.round((96 * outW) / Math.max(outW, outH)))
  const grid = buildDistanceGrid(pts, outW, outH, cols)
  const falloff = Math.max(8, softness * Math.min(outW, outH) * 0.75)
  return (x, y) => {
    const d = sampleDistGrid(grid, x, y)
    // 1 on the curve, easing to 0 at the falloff distance
    const t = Math.max(0, 1 - d / falloff)
    return t * t * (3 - 2 * t)
  }
}

export function buildMetaSymbolField(
  snap: CurveSnapshot,
  outW: number,
  outH: number,
  softness: number,
): Field {
  const centerX = outW / 2 + (snap.offsetX * outW) / 2
  const centerY = outH / 2 + (snap.offsetY * outH) / 2
  const boxWidth = Math.max(0.001, Math.abs(snap.amplitudeX) * outW)
  const boxHeight = Math.max(0.001, Math.abs(snap.amplitudeY) * outH)
  const symbolScale = Math.max(
    0.001,
    Math.min(boxWidth / META_SYMBOL_WIDTH, boxHeight / META_SYMBOL_HEIGHT),
  )
  const falloff = Math.max(1, softness * symbolScale * 2)
  const cos = Math.cos(snap.rotation)
  const sin = Math.sin(snap.rotation)
  const cols = Math.max(12, Math.round((128 * outW) / Math.max(outW, outH)))
  const rows = Math.max(12, Math.round((128 * outH) / Math.max(outW, outH)))
  const cellW = outW / cols
  const cellH = outH / rows
  const values = new Float32Array((cols + 1) * (rows + 1))

  for (let row = 0; row <= rows; row += 1) {
    const y = row * cellH
    for (let column = 0; column <= cols; column += 1) {
      const x = column * cellW
      const dx = x - centerX
      const dy = y - centerY
      const localX = dx * cos + dy * sin
      const localY = -dx * sin + dy * cos
      const point = sampleMetaSymbol(
        localX / symbolScale + META_SYMBOL_WIDTH / 2,
        localY / symbolScale + META_SYMBOL_HEIGHT / 2,
      )
      let value = 1
      if (!point.inside) {
        const amount = Math.max(0, 1 - (point.distance * symbolScale) / falloff)
        value = amount * amount * (3 - 2 * amount)
      }
      values[row * (cols + 1) + column] = value
    }
  }

  const grid: DistGrid = { cols, rows, cellW, cellH, values }
  return (x, y) => sampleDistGrid(grid, x, y)
}

function sampleDistGrid(grid: DistGrid, x: number, y: number): number {
  const gx = Math.max(0, Math.min(grid.cols - 0.001, x / grid.cellW))
  const gy = Math.max(0, Math.min(grid.rows - 0.001, y / grid.cellH))
  const c0 = Math.floor(gx)
  const r0 = Math.floor(gy)
  const fx = gx - c0
  const fy = gy - r0
  const w = grid.cols + 1
  const i = r0 * w + c0
  const top = grid.values[i] * (1 - fx) + grid.values[i + 1] * fx
  const bot = grid.values[i + w] * (1 - fx) + grid.values[i + w + 1] * fx
  return top * (1 - fy) + bot * fy
}

function sourceField(src: FieldSourceState, deps: TerritoryDeps): Field | null {
  const override = deps.fieldOverrides?.get(src.id)
  if (override) return override
  const { rect, outW, outH, maps } = deps
  switch (src.kind) {
    case 'curve': {
      if (!src.curve) return null
      return buildCurveField(src.curve, outW, outH, src.softness)
    }
    case 'linear': {
      // signed distance along the gradient axis from the offset point,
      // eased over the softness ramp
      const dx = Math.cos(src.angle)
      const dy = Math.sin(src.angle)
      const span = Math.abs(dx) * outW + Math.abs(dy) * outH || 1
      const mid = (src.offset - 0.5) * span
      const ramp = Math.max(1e-3, src.softness) * span
      return (x, y) => {
        const p = (x - outW / 2) * dx + (y - outH / 2) * dy - mid
        const t = Math.max(0, Math.min(1, p / ramp + 0.5))
        return t * t * (3 - 2 * t)
      }
    }
    case 'radial': {
      const cx = src.centerX * outW
      const cy = src.centerY * outH
      const r = Math.max(4, src.radius * Math.min(outW, outH))
      const ramp = Math.max(1e-3, src.softness) * r
      return (x, y) => {
        const d = Math.hypot(x - cx, y - cy)
        const t = Math.max(0, Math.min(1, (r - d) / ramp + 0.5))
        return t * t * (3 - 2 * t)
      }
    }
    case 'tone': {
      if (!maps) return null
      const f = fieldFromMap(maps.lum, maps.w, maps.h, rect)
      return (x, y) => 1 - f(x, y) // dark = high
    }
    case 'detail': {
      if (!maps) return null
      return fieldFromMap(maps.detailCoarse, maps.w, maps.h, rect)
    }
    case 'paint':
      return deps.paintField
  }
}

export function compileTerritory(state: TerritoryState, deps: TerritoryDeps): Field {
  const active: { f: Field; src: FieldSourceState }[] = []
  for (const src of state.sources) {
    if (!src.enabled || src.weight <= 0) continue
    const f = sourceField(src, deps)
    if (f) active.push({ f, src })
  }
  if (!active.length) return () => 0
  const gain = state.gain ?? 1
  return (x, y) => {
    let acc = 0
    let first = true
    for (const { f, src } of active) {
      let v = f(x, y)
      if (src.invert) v = 1 - v
      v *= src.weight
      if (first) {
        // a leading multiply/max folds against nothing — it seeds the
        // territory instead; a leading subtract carves from nothing
        acc = src.combine === 'subtract' ? 0 : v
        first = false
      } else if (src.combine === 'multiply') acc *= v
      else if (src.combine === 'max') acc = Math.max(acc, v)
      else if (src.combine === 'subtract') acc -= v
      else acc += v
    }
    return Math.max(0, Math.min(1, acc * gain))
  }
}

// ---------------------------------------------------------------------------
// Band resolution. Boundaries live at the CELL level so hard mode makes
// the stepped, grid-aware edges of the reference poster; dither mode
// runs the band handoff through an ordered Bayer matrix indexed by cell
// coordinates (stable across render scales); porous mode uses the
// seeded per-cell channel.

// 8x8 Bayer matrix, normalized to -0.5..0.5
const BAYER8 = (() => {
  const m = [
    0, 32, 8, 40, 2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37,
    63, 31, 55, 23, 61, 29, 53, 21,
  ]
  return m.map((v) => v / 64 - 0.5)
})()

export function bandAt(
  t: number,
  bandCount: number,
  boundary: BoundaryMode,
  ix: number,
  iy: number,
  seed: number,
  cellId: number,
): number {
  const n = Math.max(1, bandCount)
  let v = t
  if (boundary === 'dither') {
    v += BAYER8[((iy & 7) << 3) | (ix & 7)] * (0.9 / n)
  } else if (boundary === 'porous') {
    v += (chan(seed, cellId, 'lab.band') - 0.5) * (1.1 / n)
  }
  return Math.max(0, Math.min(n - 1, Math.floor(v * n)))
}

// ---------------------------------------------------------------------------
// Topographic contours OF the territory itself, for the 'contours'
// treatment: sample T onto a lattice shaped like the cloner's distance
// grid and reuse its marching squares.

export function territoryGrid(T: Field, outW: number, outH: number, budget = 128): DistGrid {
  // the LONG side gets the budget — extreme aspect ratios stay bounded
  const cols = Math.max(8, Math.round((budget * outW) / Math.max(outW, outH)))
  const rows = Math.max(8, Math.round((cols * outH) / Math.max(outW, 1)))
  const cellW = outW / cols
  const cellH = outH / rows
  const values = new Float32Array((cols + 1) * (rows + 1))
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      values[r * (cols + 1) + c] = T(c * cellW, r * cellH)
    }
  }
  return { cols, rows, cellW, cellH, values }
}

// Source ids only need uniqueness within one recipe's stack — minted
// here (a plain module, same as the editor's createShapeLayer) so
// component code stays pure under the React compiler rules.
let srcCounter = 0

export function mintSourceId(): string {
  return `src-${Date.now().toString(36)}-${srcCounter++}`
}

// stable per-kind defaults for a freshly added source
export function createFieldSource(
  kind: FieldSourceState['kind'],
  id: string,
  curve?: CurveSnapshot,
): FieldSourceState {
  return {
    id,
    kind,
    enabled: true,
    // paint at full weight so ERASE (full mask) reliably reaches the
    // empty band whatever the other sources say
    weight: kind === 'paint' ? 1 : kind === 'tone' || kind === 'detail' ? 0.5 : 0.8,
    invert: false,
    // paint arrives as a SIGNED field (brush negative, erase positive,
    // neutral zero — see paintRuntime), so plain add is its fold
    combine: 'add',
    angle: Math.PI / 2,
    offset: 0.5,
    softness: kind === 'curve' ? 0.3 : 0.35,
    centerX: 0.5,
    centerY: 0.5,
    radius: 0.32,
    curve: kind === 'curve' ? (curve ?? META_CURVE) : undefined,
  }
}

// the ∞ mark as the fallback curve when the editor autosave is absent
export const META_CURVE: CurveSnapshot = {
  frequencyX: 1,
  frequencyY: 2,
  phase: META_PHASE,
  amplitudeX: 0.62,
  amplitudeY: 0.62,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  curve: 'meta',
}
