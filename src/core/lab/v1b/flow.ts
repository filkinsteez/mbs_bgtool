import { chan, chanGauss } from '@/core/organic/random'
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
    motionPhase?: number
    motionAmount?: number
  },
): VectorField {
  const {
    seed,
    outW,
    outH,
    curveAngle,
    T,
    motionPhase,
    motionAmount = 0,
  } = deps
  const minDim = Math.min(outW, outH)
  const noisePx = Math.max(24, minDim * (0.08 + state.scale * 0.35))
  const staticCurl = state.curl > 0 ? curlField(seed, noisePx, 'lab.flow') : null
  const animated = motionPhase !== undefined && motionAmount > 0
  const motionCurlA = animated ? curlField(seed, noisePx * 0.82, 'lab.flow.motion.a') : null
  const motionCurlB = animated ? curlField(seed, noisePx * 0.82, 'lab.flow.motion.b') : null
  const motionAngle = (motionPhase ?? 0) * Math.PI * 2
  const curl: VectorField | null = staticCurl
    ? (x, y) => {
        const base = staticCurl(x, y)
        if (!motionCurlA || !motionCurlB) return base
        const a = motionCurlA(x, y)
        const b = motionCurlB(x, y)
        const amount = Math.max(0, Math.min(1, motionAmount)) * 0.62
        return [
          base[0] + (a[0] * Math.cos(motionAngle) + b[0] * Math.sin(motionAngle)) * amount,
          base[1] + (a[1] * Math.cos(motionAngle) + b[1] * Math.sin(motionAngle)) * amount,
        ]
      }
    : null

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
    const curlScale = noisePx * 2.8
    return [
      b[0] / bl + c[0] * k * curlScale,
      b[1] / bl + c[1] * k * curlScale,
    ]
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
  const midX = x + vx * len * 0.5
  const midY = y + vy * len * 0.5
  let [mx, my] = field(midX, midY)
  const ml = Math.hypot(mx, my)
  if (ml > 1e-6) {
    mx /= ml
    my /= ml
    if (mx * vx + my * vy < 0) {
      mx = -mx
      my = -my
    }
    vx = mx
    vy = my
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
  accept?: (x: number, y: number) => boolean,
): number[] {
  const pts: number[] = [x0, y0]
  let x = x0
  let y = y0
  const l0 = Math.hypot(dir0[0], dir0[1]) || 1
  let prev: Vec = [dir0[0] / l0, dir0[1] / l0]
  for (let i = 0; i < steps; i++) {
    const d = step(field, x, y, prev, stepLen)
    const nextX = x + d[0]
    const nextY = y + d[1]
    if (accept && !accept(nextX, nextY)) break
    x = nextX
    y = nextY
    pts.push(x, y)
    const dl = Math.hypot(d[0], d[1]) || 1
    prev = [d[0] / dl, d[1] / dl]
  }
  return pts
}

// ---------------------------------------------------------------------------
// SCAN — coherent, non-crossing contour bundles. Lane count and sample count
// are normalized, so preview and 4K export share the same logical geometry.
export type Scanline = {
  id: number
  points: number[]
  widthClass: 0 | 1 | 2
  alphaClass: 0 | 1
  anchorX: number
  anchorY: number
}

export function buildScanlines(opts: {
  outW: number
  outH: number
  spacing: number
  warp: number // 0..1 — displacement amplitude in spacings
  maps: AnalysisMaps | null
  rect: FitRect
  field: VectorField | null
  bend: number // 0..1 how much the flow bends the line direction
  seed?: number
  complexity?: number
  motionPhase?: number
  rhythmPattern?: readonly boolean[]
  territory?: Field
}): Scanline[] {
  const {
    outW,
    outH,
    warp,
    maps,
    rect,
    field,
    bend,
    seed = 0,
    complexity = 0.5,
    motionPhase = 0,
    rhythmPattern = [],
    territory,
  } = opts
  const c = Math.max(0, Math.min(1, complexity))
  const groupCount = Math.round(18 + 28 * c)
  const groupWeights = Array.from({ length: groupCount }, (_, group) => {
    const pulse = rhythmPattern.length > 0 && rhythmPattern[group % rhythmPattern.length]
    return Math.max(
      0.62,
      Math.min(
        1.55,
        1
          + Math.sin(group * 2.399 + chan(seed, 0, 'lab.scan.cadence.phase') * Math.PI * 2) * 0.24
          + chanGauss(seed, group, 'lab.scan.cadence') * 0.14
          + (pulse ? -0.18 : 0.22),
      ),
    )
  })
  const totalWeight = groupWeights.reduce((sum, weight) => sum + weight, 0)
  const margin = outH * 0.045
  const available = outH + margin * 2
  const rails: { id: number; baseY: number; group: number; satellite: number }[] = []
  let cursor = -margin
  for (let group = 0; group < groupCount; group += 1) {
    const localPitch = available * groupWeights[group] / totalWeight
    const center = cursor + localPitch / 2
    const pulse = rhythmPattern.length > 0 && rhythmPattern[group % rhythmPattern.length]
    const satelliteCount = pulse ? (c > 0.7 ? 3 : 2) : 1
    for (let satellite = 0; satellite < satelliteCount; satellite += 1) {
      rails.push({
        id: group * 4 + satellite,
        baseY: center + (satellite - (satelliteCount - 1) / 2) * localPitch * 0.2,
        group,
        satellite,
      })
    }
    cursor += localPitch
  }

  const sampleCount = Math.max(
    160,
    Math.min(320, Math.round(180 * outW / Math.max(1, Math.min(outW, outH)))),
  )
  const theta = (((motionPhase % 1) + 1) % 1) * Math.PI * 2
  const phi0 = chan(seed, 0, 'lab.scan.shared.phase.0') * Math.PI * 2
  const phi1 = chan(seed, 0, 'lab.scan.shared.phase.1') * Math.PI * 2
  const phi2 = chan(seed, 0, 'lab.scan.shared.phase.2') * Math.PI * 2
  const meanPitch = available / groupCount
  const amp = meanPitch * warp
  const raw = rails.map(() => new Float64Array(sampleCount + 1))
  const xs = new Float64Array(sampleCount + 1)

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    const along = sampleIndex / sampleCount
    const x = (along * 1.04 - 0.02) * outW
    xs[sampleIndex] = x
    for (let railIndex = 0; railIndex < rails.length; railIndex += 1) {
      const rail = rails[railIndex]
      const across = rail.baseY / Math.max(1, outH)
      let displaced = rail.baseY + amp * (
        (0.5 + c * 0.58)
          * Math.sin(Math.PI * 2 * (0.72 * along + 0.11 * across) + phi0 + theta)
        + (0.08 + c * 0.36)
          * Math.sin(Math.PI * 2 * (2.15 * along - 0.42 * across) + phi1 - theta * 2)
        + c * c * 0.2
          * Math.sin(Math.PI * 2 * (1.35 * along + across) + phi2 + theta * 3)
          * Math.sin(Math.PI * 2 * (0.43 * along - 0.7 * across) - theta)
      )
      if (territory) {
        displaced += territory(x, rail.baseY) * meanPitch * (2 + c * 1.2) * warp
      }
      if (maps && amp > 0) {
        const u = (x - rect.x) / rect.w
        const v = (displaced - rect.y) / rect.h
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
          const lum = sampleMap(maps.lum, maps.w, maps.h, u * maps.w - 0.5, v * maps.h - 0.5)
          displaced -= (1 - lum) * amp * 1.7
        }
      }
      if (field && bend > 0) {
        const [vx, vy] = field(x, displaced)
        const length = Math.hypot(vx, vy) || 1
        displaced += (vy / length) * bend * meanPitch * 1.8
      }
      raw[railIndex][sampleIndex] = displaced
    }

    // Pool-adjacent projection: preserve order and a readable minimum gap.
    const minGap = Math.max(0.7, meanPitch * 0.075)
    for (let railIndex = 1; railIndex < rails.length; railIndex += 1) {
      raw[railIndex][sampleIndex] = Math.max(
        raw[railIndex][sampleIndex],
        raw[railIndex - 1][sampleIndex] + minGap,
      )
    }
    for (let railIndex = rails.length - 2; railIndex >= 0; railIndex -= 1) {
      raw[railIndex][sampleIndex] = Math.min(
        raw[railIndex][sampleIndex],
        raw[railIndex + 1][sampleIndex] - minGap,
      )
    }
  }

  // Smooth along the shared carrier, then re-project separation. This removes
  // the angular kinks that make field-following lines read like a polyline
  // implementation while preserving bundle order.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const values of raw) {
      const previous = values.slice()
      for (let index = 1; index < sampleCount; index += 1) {
        values[index] = previous[index - 1] * 0.22
          + previous[index] * 0.56
          + previous[index + 1] * 0.22
      }
    }
  }
  const minGap = Math.max(0.7, meanPitch * 0.075)
  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    for (let railIndex = 1; railIndex < rails.length; railIndex += 1) {
      raw[railIndex][sampleIndex] = Math.max(
        raw[railIndex][sampleIndex],
        raw[railIndex - 1][sampleIndex] + minGap,
      )
    }
  }

  return rails.map((rail, railIndex) => {
    const points: number[] = []
    for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
      points.push(xs[sampleIndex], raw[railIndex][sampleIndex])
    }
    const pulse = rhythmPattern.length > 0 && rhythmPattern[rail.group % rhythmPattern.length]
    return {
      id: rail.id,
      points,
      widthClass: pulse && rail.satellite === 0 ? 2 : rail.satellite === 0 ? 1 : 0,
      alphaClass: pulse ? 1 : 0,
      anchorX: outW * 0.5,
      anchorY: rail.baseY,
    }
  })
}

// ---------------------------------------------------------------------------
// DABS — short strokes riding the flow (the book-cover spirals):
// per cell, a few 2-4 step walks, width from tone, deterministic per
// cell id and dab index.
export type Dab = {
  pts: number[]
  tone: number
  mx: number
  my: number
  width: number
  pressure: number
  dry: number
}

export function buildDabs(opts: {
  cells: CellNode[]
  maps: AnalysisMaps | null
  rect: FitRect
  seed: number
  field: VectorField
  occupancy: number
  complexity?: number
  minDim?: number
}): Dab[] {
  const { cells, maps, rect, seed, field, occupancy, complexity = 0.5 } = opts
  const minDim = opts.minDim ?? Math.min(rect.w, rect.h)
  const out: Dab[] = []
  for (const cell of cells) {
    if (cell.treatment !== 'dabs') continue
    const id = cellId(cell.level, cell.ix, cell.iy)
    // dab geometry is canvas-scaled, not cell-scaled: coarse cells deal
    // MORE small dabs instead of inflating each stroke into a long dash,
    // so coverage — not stroke size — is what the cell pitch controls
    const stroke = Math.min(cell.size, minDim * 0.012)
    const density = Math.max(1, Math.min(4, Math.pow(cell.size / stroke, 1.5)))
    const n = Math.max(1, Math.round(occupancy * (1.25 + complexity * 0.75) * density))
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
      // presence follows tone steeply, so the far field stays sparse and
      // the subject accumulates as real coverage
      if (chan(seed, id, `lab.dab.cull${k}`) > 0.05 + Math.pow(tone, 1.4) * 0.95) continue
      const seedAngle = chan(seed, id, `lab.dab.a${k}`) * Math.PI * 2
      const pressure = 0.62 + chan(seed, id, `lab.dab.pressure${k}`) * 0.38
      const dry = chan(seed, id, `lab.dab.dry${k}`)
      const steps = 5 + Math.floor(complexity * 6 + chan(seed, id, `lab.dab.steps${k}`) * 4)
      const pts = traceStream(
        field,
        x0,
        y0,
        steps,
        stroke * (0.12 + chan(seed, id, `lab.dab.length${k}`) * 0.08),
        [Math.cos(seedAngle), Math.sin(seedAngle)],
      )
      out.push({
        pts,
        tone,
        mx,
        my,
        width: Math.max(1, stroke * (0.1 + tone * 0.15) * pressure),
        pressure,
        dry,
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// STREAMS — long hairlines integrated through the field (field-line
// drawings). Seeds use deterministic blue-noise rejection in normalized
// canvas space so count, spacing, and path length match at preview and export.
export type Streamline = {
  id: number
  points: number[]
  seedX: number
  seedY: number
  widthClass: 0 | 1 | 2
  alphaClass: 0 | 1
}

export function buildStreams(opts: {
  cells: CellNode[]
  seed: number
  field: VectorField
  outW: number
  outH: number
  complexity?: number
  territory?: Field
}): Streamline[] {
  const { cells, seed, field, outW, outH, complexity = 0.5, territory } = opts
  const streamCells = cells.filter((c) => c.treatment === 'streams')
  if (!streamCells.length) return []
  const minDim = Math.min(outW, outH)
  const normalizedStep = 0.004
  const stepLen = Math.max(1, minDim * normalizedStep)
  const baseSteps = Math.round((0.12 + complexity * 0.14) / normalizedStep)
  const separation = minDim * (0.038 + (0.018 - 0.038) * complexity)
  const gridSize = separation / Math.SQRT2
  const cols = Math.max(1, Math.ceil(outW / gridSize))
  const rows = Math.max(1, Math.ceil(outH / gridSize))
  const occupancy = new Int32Array(cols * rows)
  occupancy.fill(-1)
  const coverage = new Uint8Array(cols * rows)
  if (streamCells.length === cells.length) {
    coverage.fill(1)
  } else {
    for (const cell of streamCells) {
      const left = Math.max(0, Math.floor(cell.x / gridSize))
      const right = Math.min(cols - 1, Math.floor((cell.x + cell.size) / gridSize))
      const top = Math.max(0, Math.floor(cell.y / gridSize))
      const bottom = Math.min(rows - 1, Math.floor((cell.y + cell.size) / gridSize))
      for (let row = top; row <= bottom; row += 1) {
        coverage.fill(1, row * cols + left, row * cols + right + 1)
      }
    }
  }

  const aspectArea = (outW * outH) / Math.max(1, minDim * minDim)
  const target = Math.min(900, Math.round(aspectArea * (150 + complexity * 380)))
  const acceptedX: number[] = []
  const acceptedY: number[] = []
  const acceptedIds: number[] = []
  const separationSq = separation * separation
  const attempts = target * 24
  for (let id = 0; id < attempts && acceptedIds.length < target; id += 1) {
    const x = chan(seed, id, 'lab.stream.seed.x') * outW
    const y = chan(seed, id, 'lab.stream.seed.y') * outH
    const column = Math.min(cols - 1, Math.floor(x / gridSize))
    const row = Math.min(rows - 1, Math.floor(y / gridSize))
    if (!coverage[row * cols + column]) continue
    if (territory && territory(x, y) < 0.12) continue
    let clear = true
    for (let yy = Math.max(0, row - 2); yy <= Math.min(rows - 1, row + 2) && clear; yy += 1) {
      for (let xx = Math.max(0, column - 2); xx <= Math.min(cols - 1, column + 2); xx += 1) {
        const acceptedIndex = occupancy[yy * cols + xx]
        if (acceptedIndex < 0) continue
        const dx = acceptedX[acceptedIndex] - x
        const dy = acceptedY[acceptedIndex] - y
        if (dx * dx + dy * dy < separationSq) {
          clear = false
          break
        }
      }
    }
    if (!clear) continue
    const acceptedIndex = acceptedIds.length
    acceptedX.push(x)
    acceptedY.push(y)
    acceptedIds.push(id)
    occupancy[row * cols + column] = acceptedIndex
  }

  const out: Streamline[] = []
  for (let acceptedIndex = 0; acceptedIndex < acceptedIds.length; acceptedIndex += 1) {
    const id = acceptedIds[acceptedIndex]
    const x0 = acceptedX[acceptedIndex]
    const y0 = acceptedY[acceptedIndex]
    const [fieldX, fieldY] = field(x0, y0)
    const fieldAngle = Math.atan2(fieldY, fieldX)
    const angle = fieldAngle + chanGauss(seed, id, 'lab.stream.angle') * 0.24
    const dir: Vec = [Math.cos(angle), Math.sin(angle)]
    const steps = Math.max(10, Math.round(baseSteps * (0.72 + chan(seed, id, 'lab.stream.length') * 0.5)))
    const accepts = territory
      ? (x: number, y: number) =>
          x >= 0 && x <= outW && y >= 0 && y <= outH && territory(x, y) > 0.08
      : undefined
    const forward = traceStream(field, x0, y0, steps, stepLen, dir, accepts)
    const backward = traceStream(field, x0, y0, steps, stepLen, [-dir[0], -dir[1]], accepts)
    const strand: number[] = []
    for (let index = backward.length - 2; index >= 0; index -= 2) {
      strand.push(backward[index], backward[index + 1])
    }
    strand.push(...forward.slice(2))
    const widthRoll = chan(seed, id, 'lab.stream.width')
    out.push({
      id,
      points: strand,
      seedX: x0,
      seedY: y0,
      widthClass: widthRoll > 0.9 ? 2 : widthRoll > 0.54 ? 1 : 0,
      alphaClass: chan(seed, id, 'lab.stream.alpha') > 0.68 ? 1 : 0,
    })
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
