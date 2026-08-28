import { sampleCurve } from '@/core/lissajous/sampler'
import { META_PHASE } from '@/core/lissajous/equation'
import type { SheetState, SheetShape } from '@/core/state/types'

// The sheet register's engine: a Cavalry-style grid cloner as pure data.
// One function produces every clone; the SVG layer and the PNG export
// both consume it, so the two renders are the same drawing.
//
// The craft is in WHERE the variation comes from:
//   RANDOM — per-clone white jitter (position, tilt, size). Texture.
//   NOISE  — a smooth value-noise field sampled at each clone: size
//            swells and shrinks across the sheet in patches, stroke vs
//            fill arrives in coherent regions, and mixed shapes cluster
//            into neighborhoods. This is what reads as organic — white
//            noise alone reads as salt.
//   PACKED — recursive grid subdivision: some cells stay big, others
//            split into quarters (occasionally halves), the editorial
//            mixed-cell-size layout.
// Truchet discipline: halves and quarters rotate in 90-degree steps, so
// neighboring clones can join into larger figures by accident — the
// classic tile move. Everything is deterministic in (state, seed).

export type SheetClone = {
  x: number // center, artboard px
  y: number
  r: number // half-size, artboard px
  rotate: number // radians
  opacity: number
  shape: Exclude<SheetShape, 'mixed'>
  stroked: boolean // outline instead of fill
  drawnIndex?: number // index into the layer's bound drawn protos
  z: number // layer index, 0 = front
}

const MIX: Exclude<SheetShape, 'mixed'>[] = [
  'circle',
  'square',
  'triangle',
  'half',
  'quarter',
  'cross',
  'meta',
]

// shapes whose rotation should stay on the 90-degree lattice (truchet)
const QUANTIZED = new Set<Exclude<SheetShape, 'mixed'>>(['half', 'quarter', 'triangle'])

function hash(ix: number, iy: number, iz: number, k: number, seed: number): number {
  const v = Math.sin(ix * 127.1 + iy * 311.7 + iz * 74.7 + k * 269.5 + seed * 0.173) * 43758.5453
  return v - Math.floor(v) // 0..1
}

// smooth 2-D value noise over unit coordinates, quintic fade — the field
// that makes variation arrive in patches
function fieldNoise(x: number, y: number, k: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
  const a = hash(ix, iy, 0, k, seed)
  const b = hash(ix + 1, iy, 0, k, seed)
  const c = hash(ix, iy + 1, 0, k, seed)
  const d = hash(ix + 1, iy + 1, 0, k, seed)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

type Cell = { x: number; y: number; w: number; h: number }

// PACKED layout: recursive subdivision. Cells split into 2x2 (or a half
// split) with a probability that falls with depth — big editorial cells
// coexist with dense clusters.
function packCells(
  width: number,
  height: number,
  baseCols: number,
  baseRows: number,
  seed: number,
): Cell[] {
  const out: Cell[] = []
  const cols = Math.max(2, Math.round(baseCols / 2))
  const rows = Math.max(2, Math.round(baseRows / 2))
  const cellW = width / cols
  const cellH = height / rows

  const subdivide = (x: number, y: number, w: number, h: number, depth: number, id: number) => {
    const p = hash(Math.round(x * 0.13), Math.round(y * 0.17), depth, 7 + id, seed)
    const splitProb = depth === 0 ? 0.72 : depth === 1 ? 0.45 : 0
    if (p < splitProb) {
      const mode = hash(Math.round(x * 0.31), Math.round(y * 0.11), depth, 11, seed)
      if (mode < 0.62) {
        // quarter split
        subdivide(x, y, w / 2, h / 2, depth + 1, 1)
        subdivide(x + w / 2, y, w / 2, h / 2, depth + 1, 2)
        subdivide(x, y + h / 2, w / 2, h / 2, depth + 1, 3)
        subdivide(x + w / 2, y + h / 2, w / 2, h / 2, depth + 1, 4)
      } else if (mode < 0.81) {
        // vertical halves
        subdivide(x, y, w / 2, h, depth + 1, 5)
        subdivide(x + w / 2, y, w / 2, h, depth + 1, 6)
      } else {
        // horizontal halves
        subdivide(x, y, w, h / 2, depth + 1, 7)
        subdivide(x, y + h / 2, w, h / 2, depth + 1, 8)
      }
    } else {
      out.push({ x, y, w, h })
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      subdivide(c * cellW, r * cellH, cellW, cellH, 0, r * cols + c)
    }
  }
  return out
}

function gridCells(width: number, height: number, nx: number, ny: number): Cell[] {
  const cellW = width / nx
  const cellH = height / ny
  const out: Cell[] = []
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      out.push({ x: ix * cellW, y: iy * cellH, w: cellW, h: cellH })
    }
  }
  return out
}

// distance to a polyline + even-odd insideness — the CURVE effector's
// two signals, the same ones the field shader reads
function curveSignals(
  pts: { x: number; y: number }[],
  x: number,
  y: number,
): { dist: number; inside: boolean } {
  let best = Infinity
  let crossings = 0
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1].x
    const ay = pts[i - 1].y
    const bx = pts[i].x
    const by = pts[i].y
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy || 1e-9
    let t = ((x - ax) * dx + (y - ay) * dy) / len2
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const ex = x - (ax + dx * t)
    const ey = y - (ay + dy * t)
    const d2 = ex * ex + ey * ey
    if (d2 < best) best = d2
    if (ay > y !== by > y) {
      const xInt = ax + ((y - ay) / (by - ay)) * dx
      if (xInt > x) crossings++
    }
  }
  return { dist: Math.sqrt(best), inside: crossings % 2 === 1 }
}

export function buildSheetClones(
  sheet: SheetState,
  width: number,
  height: number,
  seed: number,
  curvePts?: { x: number; y: number }[],
  drawnCount?: number,
): SheetClone[] {
  const nx = Math.max(2, Math.round(sheet.countX))
  const ny = Math.max(2, Math.round(sheet.countY))
  const nz = Math.max(1, Math.round(sheet.countZ))
  const minDim = Math.min(width, height)
  // BOUNDS: the grid lays inside the fractional box (absent = full
  // bleed). Cells land in true artboard coordinates, so the noise and
  // curve fields read the same space as every other layer.
  const bx = (sheet.boxX ?? 0) * width
  const by = (sheet.boxY ?? 0) * height
  const bw = Math.max(0.02, sheet.boxW ?? 1) * width
  const bh = Math.max(0.02, sheet.boxH ?? 1) * height
  const cells = (
    (sheet.layout ?? 'grid') === 'packed'
      ? packCells(bw, bh, nx, ny, seed)
      : gridCells(bw, bh, nx, ny)
  ).map((c) => ({ ...c, x: c.x + bx, y: c.y + by }))
  const cx = width * 0.5
  const cy = height * 0.5
  const curveFx = (sheet.curve ?? 0) * (curvePts && curvePts.length > 1 ? 1 : 0)
  // the noise field's scale: a handful of patches across the sheet
  const freq = 2.6 / minDim

  const out: SheetClone[] = []
  for (let iz = nz - 1; iz >= 0; iz--) {
    const layerScale = 1 + sheet.depth * 0.12 * iz
    const driftX = sheet.depth * iz * minDim * 0.018
    const driftY = sheet.depth * iz * minDim * 0.028
    const layerOpacity = Math.max(0.12, 1 - sheet.depth * 0.4 * iz)
    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci]
      const gx = cell.x + cell.w / 2
      const gy = cell.y + cell.h / 2
      const ix = Math.round(gx * 0.37)
      const iy = Math.round(gy * 0.41)
      const noiseAmt = sheet.noise ?? 0

      // NOISE field: coherent patches of size / stroke / shape
      const nSize = fieldNoise(gx * freq + iz * 3.7, gy * freq, 1, seed)
      const nStroke = fieldNoise(gx * freq * 1.4 + 11.3, gy * freq * 1.4, 2, seed)
      const nShape = fieldNoise(gx * freq * 0.8 + 23.7, gy * freq * 0.8, 3, seed)

      // RANDOM: white jitter
      const jx = (hash(ix, iy, iz, 1, seed) * 2 - 1) * sheet.random * cell.w * 0.35
      const jy = (hash(ix, iy, iz, 2, seed) * 2 - 1) * sheet.random * cell.h * 0.35
      const sizeJ = 1 + (hash(ix, iy, iz, 4, seed) * 2 - 1) * sheet.random * 0.45

      const base = (Math.min(cell.w, cell.h) * sheet.size) / 2
      const sizeN = 1 + (nSize - 0.5) * 2 * noiseAmt * 0.65
      const px = cx + (gx + jx - cx) * layerScale + driftX
      const py = cy + (gy + jy - cy) * layerScale + driftY

      // shape: mixed picks from the field (neighborhoods of the same
      // shape) nudged by white hash so patches stay lively inside
      let shape: Exclude<SheetShape, 'mixed'>
      if (sheet.shape === 'mixed') {
        const t = noiseAmt > 0 ? nShape * 0.8 + hash(ix, iy, iz, 5, seed) * 0.2 : hash(ix, iy, iz, 5, seed)
        shape = MIX[Math.min(MIX.length - 1, Math.floor(t * MIX.length))]
      } else {
        shape = sheet.shape as Exclude<SheetShape, 'mixed'>
        // old saves may carry the retired 'diamond'
        if ((shape as string) === 'diamond') shape = 'square'
      }

      // bound drawn protos deal from the SAME noise-blended t as MIX, so
      // coherent noise patches still select coherently
      let drawnIndex: number | undefined
      if (drawnCount && drawnCount > 0) {
        const t = noiseAmt > 0 ? nShape * 0.8 + hash(ix, iy, iz, 5, seed) * 0.2 : hash(ix, iy, iz, 5, seed)
        drawnIndex = Math.min(drawnCount - 1, Math.floor(t * drawnCount))
      }

      // rotation: truchet shapes turn in 90-degree steps; everything else
      // tilts continuously with RANDOM
      let rotate: number
      if (QUANTIZED.has(shape)) {
        rotate = Math.floor(hash(ix, iy, iz, 6, seed) * 4) * (Math.PI / 2)
        rotate += (hash(ix, iy, iz, 3, seed) * 2 - 1) * sheet.random * 0.2
      } else {
        rotate = (hash(ix, iy, iz, 3, seed) * 2 - 1) * sheet.random * Math.PI * 0.5
      }

      // stroke vs fill: the stroke population arrives in coherent patches
      // when NOISE is up, as pure chance when it is not
      const strokeT = noiseAmt > 0 ? nStroke * 0.75 + hash(ix, iy, iz, 8, seed) * 0.25 : hash(ix, iy, iz, 8, seed)
      let stroked = strokeT < (sheet.strokeMix ?? 0)
      let sizeC = 1

      // CURVE effector: the sheet reads the same figure the field draws.
      // Clones swell in a band along the curve and shrink far from it;
      // inside the lobes the population flips to FILLED, outside to
      // stroked — the mark prints itself through the clones.
      if (curveFx > 0 && curvePts) {
        const sig = curveSignals(curvePts, gx, gy)
        const band = Math.exp(-Math.pow(sig.dist / (minDim * 0.14), 2))
        sizeC = 1 + curveFx * (band * 0.85 - 0.3 * (1 - band))
        if (hash(ix, iy, iz, 9, seed) < curveFx) stroked = !sig.inside
      }

      // drawn protos carry their own fill — the stroke population and the
      // meta-is-a-line rule only apply to the built-in vocabulary
      if (drawnIndex !== undefined) stroked = false
      else if (shape === 'meta') stroked = true // the mark is always a line drawing

      out.push({
        x: px,
        y: py,
        r: Math.max(0.5, base * sizeJ * sizeN * sizeC * layerScale),
        rotate,
        opacity: layerOpacity,
        shape,
        stroked,
        drawnIndex,
        z: iz,
      })
    }
  }
  return out
}

// ---- unit geometry (coordinates in -1..1, scaled by the clone's r) ----

export function unitPolygon(shape: 'square' | 'triangle' | 'cross'): { x: number; y: number }[] {
  if (shape === 'square') {
    return [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ]
  }
  if (shape === 'cross') {
    const a = 0.34 // arm half-thickness
    return [
      { x: -a, y: -1 }, { x: a, y: -1 }, { x: a, y: -a },
      { x: 1, y: -a }, { x: 1, y: a }, { x: a, y: a },
      { x: a, y: 1 }, { x: -a, y: 1 }, { x: -a, y: a },
      { x: -1, y: a }, { x: -1, y: -a }, { x: -a, y: -a },
    ]
  }
  // triangle: right isoceles, hypotenuse down — tiles with the truchet set
  return [
    { x: -1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ]
}

let metaCache: { x: number; y: number }[] | null = null

// Legacy unit-centered curve glyph (-1..1). V1 marks keep this commit-era
// centerline; canonical identity geometry lives in core/metaSymbol.ts.
export function metaUnitOutline(): { x: number; y: number }[] {
  if (metaCache) return metaCache
  const samples = sampleCurve(
    {
      frequencyX: 1,
      frequencyY: 2,
      phase: META_PHASE,
      amplitudeX: 1,
      amplitudeY: 1,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      sampleDensity: 64,
      curve: 'meta',
    },
    2,
    2,
    64,
  )
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const s of samples) {
    if (s.x < minX) minX = s.x
    if (s.x > maxX) maxX = s.x
    if (s.y < minY) minY = s.y
    if (s.y > maxY) maxY = s.y
  }
  const half = Math.max(maxX - minX, maxY - minY) / 2 || 1
  const mx = (minX + maxX) / 2
  const my = (minY + maxY) / 2
  metaCache = samples.map((s) => ({ x: (s.x - mx) / half, y: (s.y - my) / half }))
  return metaCache
}
