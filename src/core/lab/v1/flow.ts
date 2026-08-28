import { chan } from '@/core/organic/random'
import type { AnalysisMaps } from '../analysis'
import { sampleMap } from '../analysis'
import type { Field, FitRect } from '../field'
import type { CellNode } from './composition'
import { cellId } from './composition'
import type { FlowState } from '../types'

// The VECTOR field — the direction the process treatments move. The
// scalar territory says where a law applies; flow says which way scan
// lines bend, dabs stroke, and streams travel. Four bases:
//   curve    — the brand curve's tangents (the figure steers)
//   noise    — seeded curl noise (eddies)
//   contour  — perpendicular to the territory gradient (flow ALONG the
//              band edges, topographic)
//   angle    — one fixed direction
// CURL blends noise turbulence over any basis. All pure; the walkers
// resolve the mod-π sign ambiguity by direction continuity — the same
// trick the smear shader uses.

export type Vec = [number, number]
export type VectorField = (x: number, y: number) => Vec

// smooth seeded scalar lattice (value noise) for curl — cosine-eased
// bilinear over chan values, same recipe as coherenceField but at a
// caller-set feature size
function noiseLattice(seed: number, cellPx: number, channel: string): Field {
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const inv = 1 / Math.max(8, cellPx)
  return (x, y) => {
    const u = x * inv
    const v = y * inv
    const i0 = Math.floor(u)
    const j0 = Math.floor(v)
    const fu = smooth(u - i0)
    const fv = smooth(v - j0)
    const val = (i: number, j: number) =>
      chan(seed, ((j & 1023) + 512) * 4096 + ((i & 1023) + 512), channel)
    const top = val(i0, j0) * (1 - fu) + val(i0 + 1, j0) * fu
    const bot = val(i0, j0 + 1) * (1 - fu) + val(i0 + 1, j0 + 1) * fu
    return top * (1 - fv) + bot * fv
  }
}

// curl of a scalar lattice: divergence-free swirls
function curlField(seed: number, cellPx: number, channel: string): VectorField {
  const n = noiseLattice(seed, cellPx, channel)
  const e = Math.max(2, cellPx * 0.08)
  return (x, y) => {
    const dx = (n(x + e, y) - n(x - e, y)) / (2 * e)
    const dy = (n(x, y + e) - n(x, y - e)) / (2 * e)
    return [dy, -dx]
  }
}

export function composeFlow(
  state: FlowState,
  deps: {
    seed: number
    outW: number
    outH: number
    // curve tangent angle field (mod π) — null when no curve source
    curveAngle: ((x: number, y: number) => number) | null
    T: Field
  },
): VectorField {
  const { seed, outW, outH, curveAngle, T } = deps
  const minDim = Math.min(outW, outH)
  const noisePx = Math.max(24, minDim * (0.08 + state.scale * 0.35))
  const curl = state.curl > 0 ? curlField(seed, noisePx, 'lab.flow') : null

  let basis: VectorField
  if (state.basis === 'curve' && curveAngle) {
    basis = (x, y) => {
      const a = curveAngle(x, y)
      return [Math.cos(a), Math.sin(a)]
    }
  } else if (state.basis === 'contour') {
    const e = Math.max(2, minDim * 0.01)
    basis = (x, y) => {
      const gx = (T(x + e, y) - T(x - e, y)) / (2 * e)
      const gy = (T(x, y + e) - T(x, y - e)) / (2 * e)
      const len = Math.hypot(gx, gy)
      // perpendicular of the gradient = along the level sets; flat
      // regions fall back to the fixed angle so streams keep moving
      return len > 1e-5 ? [gy / len, -gx / len] : [Math.cos(state.angle), Math.sin(state.angle)]
    }
  } else if (state.basis === 'noise') {
    const n = curlField(seed, noisePx, 'lab.flowbasis')
    basis = (x, y) => n(x, y)
  } else {
    const v: Vec = [Math.cos(state.angle), Math.sin(state.angle)]
    basis = () => v
  }

  if (!curl || state.curl <= 0) return basis
  const k = state.curl
  return (x, y) => {
    const b = basis(x, y)
    const c = curl(x, y)
    const bl = Math.hypot(b[0], b[1]) || 1
    const cl = Math.hypot(c[0], c[1]) || 1
    return [b[0] / bl + (c[0] / cl) * k * 1.6, b[1] / bl + (c[1] / cl) * k * 1.6]
  }
}

// one continuity-preserving step: pick the ± of the field vector that
// agrees with where we were heading (mod-π bases like curve tangents
// flip sign across the atan2 wrap — without this, streams fold back)
function step(field: VectorField, x: number, y: number, prev: Vec, len: number): Vec {
  let [vx, vy] = field(x, y)
  const l = Math.hypot(vx, vy)
  if (l < 1e-6) return prev
  vx /= l
  vy /= l
  if (vx * prev[0] + vy * prev[1] < 0) {
    vx = -vx
    vy = -vy
  }
  return [vx * len, vy * len]
}

export function traceStream(
  field: VectorField,
  x0: number,
  y0: number,
  steps: number,
  stepLen: number,
  dir0: Vec = [1, 0],
): number[] {
  const pts: number[] = [x0, y0]
  let x = x0
  let y = y0
  const l0 = Math.hypot(dir0[0], dir0[1]) || 1
  let prev: Vec = [dir0[0] / l0, dir0[1] / l0]
  for (let i = 0; i < steps; i++) {
    const d = step(field, x, y, prev, stepLen)
    x += d[0]
    y += d[1]
    pts.push(x, y)
    const dl = Math.hypot(d[0], d[1]) || 1
    prev = [d[0] / dl, d[1] / dl]
  }
  return pts
}

// ---------------------------------------------------------------------------
// SCAN — the slit-scan read: parallel lines marching across the canvas,
// displaced by image luminance (dark pulls) and bent by the flow. Drawn
// globally, clipped by the render layer to the cells that own them.
export function buildScanlines(opts: {
  outW: number
  outH: number
  spacing: number
  warp: number // 0..1 — displacement amplitude in spacings
  maps: AnalysisMaps | null
  rect: FitRect
  field: VectorField | null
  bend: number // 0..1 how much the flow bends the line direction
}): number[][] {
  const { outW, outH, spacing, warp, maps, rect, field, bend } = opts
  const lines: number[][] = []
  const dx = 4
  const amp = warp * spacing * 3.2
  for (let y = spacing / 2; y < outH; y += spacing) {
    const pts: number[] = []
    let yy = y
    for (let x = 0; x <= outW; x += dx) {
      let off = 0
      if (maps && amp > 0) {
        const u = (x - rect.x) / rect.w
        const v = (yy - rect.y) / rect.h
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
          const lum = sampleMap(maps.lum, maps.w, maps.h, u * maps.w - 0.5, v * maps.h - 0.5)
          off = -(1 - lum) * amp
        }
      }
      if (field && bend > 0) {
        const [vx, vy] = field(x, yy)
        const l = Math.hypot(vx, vy) || 1
        yy += (vy / l) * bend * dx * 0.6 * Math.sign(vx || 1)
      }
      pts.push(x, yy + off)
    }
    lines.push(pts)
  }
  return lines
}

// ---------------------------------------------------------------------------
// DABS — short strokes riding the flow (the book-cover spirals):
// per cell, a few 2-4 step walks, width from tone, deterministic per
// cell id and dab index.
export type Dab = { pts: number[]; tone: number; mx: number; my: number; width: number }

export function buildDabs(opts: {
  cells: CellNode[]
  maps: AnalysisMaps | null
  rect: FitRect
  seed: number
  field: VectorField
  occupancy: number
  // material mode: density gets an ambient floor INSIDE the subject
  // (alpha > 0.5) so lit faces fill in instead of rendering hollow,
  // and the background settles at a calm constant presence
  material?: boolean
}): Dab[] {
  const { cells, maps, rect, seed, field, occupancy, material } = opts
  const out: Dab[] = []
  for (const cell of cells) {
    if (cell.treatment !== 'dabs') continue
    const id = cellId(cell.level, cell.ix, cell.iy)
    const n = Math.round(occupancy * 3)
    for (let k = 0; k < n; k++) {
      const x0 = cell.x + chan(seed, id, `lab.dab.x${k}`) * cell.size
      const y0 = cell.y + chan(seed, id, `lab.dab.y${k}`) * cell.size
      const u = (x0 - rect.x) / rect.w
      const v = (y0 - rect.y) / rect.h
      const inSrc = !!maps && u >= 0 && u <= 1 && v >= 0 && v <= 1
      const mx = maps ? u * maps.w - 0.5 : 0
      const my = maps ? v * maps.h - 0.5 : 0
      const a = inSrc && maps ? sampleMap(maps.alpha, maps.w, maps.h, mx, my) : 0
      const tone =
        inSrc && maps
          ? (1 - sampleMap(maps.lum, maps.w, maps.h, mx, my)) * a + cell.t * (1 - a)
          : cell.t
      // presence follows tone so dab density carries the image
      const presence = material
        ? a > 0.5
          ? 0.5 + tone * 0.5
          : 0.26
        : 0.15 + tone * 0.85
      if (chan(seed, id, `lab.dab.cull${k}`) > presence) continue
      const seedAngle = chan(seed, id, `lab.dab.a${k}`) * Math.PI * 2
      const pts = traceStream(
        field,
        x0,
        y0,
        3,
        cell.size * 0.3,
        [Math.cos(seedAngle), Math.sin(seedAngle)],
      )
      out.push({ pts, tone, mx, my, width: Math.max(1, cell.size * (0.12 + tone * 0.16)) })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// STREAMS — long hairlines integrated through the field (field-line
// drawings). Starts seed on a coarse lattice inside stream cells.
export function buildStreams(opts: {
  cells: CellNode[]
  seed: number
  field: VectorField
  outW: number
  outH: number
  // material mode: per-cell seed probability (default the classic 0.6
  // everywhere) — density then concentrates where the subject is
  presence?: (cell: CellNode) => number
}): number[][] {
  const { cells, seed, field, outW, outH, presence } = opts
  const streamCells = cells.filter((c) => c.treatment === 'streams')
  if (!streamCells.length) return []
  const minDim = Math.min(outW, outH)
  const stepLen = Math.max(2.5, minDim * 0.004)
  const steps = Math.round(Math.min(220, minDim * 0.16))
  const out: number[][] = []
  for (const cell of streamCells) {
    const id = cellId(cell.level, cell.ix, cell.iy)
    // one start per cell, culled to keep density readable
    if (chan(seed, id, 'lab.stream.cull') > (presence ? presence(cell) : 0.6)) continue
    const x0 = cell.x + chan(seed, id, 'lab.stream.x') * cell.size
    const y0 = cell.y + chan(seed, id, 'lab.stream.y') * cell.size
    const a0 = chan(seed, id, 'lab.stream.a') * Math.PI * 2
    out.push(traceStream(field, x0, y0, steps, stepLen, [Math.cos(a0), Math.sin(a0)]))
  }
  return out
}

export const FLOW_DEFAULTS = {
  basis: 'curve' as const,
  angle: 0,
  curl: 0.25,
  scale: 0.4,
  warp: 0.5,
}
