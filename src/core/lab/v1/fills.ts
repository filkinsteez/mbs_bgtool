import { chan } from '@/core/organic/random'
import type { CellNode } from './composition'
import { cellId } from './composition'

// Per-cell fill decisions for the palette treatments. All pure specs —
// the render layer turns them into paint. The references' sophistication
// is COHERENCE: neighbors sharing a color read as merged blocks, column
// runs read as strings of beads, alternating gradient directions read
// as woven shingles. Randomness only ever breaks a rule locally.

export type BlockFill = { cell: CellNode; color: number; accent: number | null }
export type BeadFill = { cell: CellNode; active: boolean; color: number; inner: number | null }
export type ShingleFill = { cell: CellNode; a: number; b: number; angle: number }

// coarse region index shared by neighbors — quantized smooth noise, so
// same-color cells sit ADJACENT and read as one larger block. Exported:
// the palette color mode deals marks and dabs through the same field.
export function regionValue(seed: number, x: number, y: number, sizePx: number, channel: string): number {
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const inv = 1 / Math.max(8, sizePx)
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

// BLOCKS — the flat color quilt: palette colors dealt over a coarse
// region field (adjacent same-color cells merge visually because fills
// are flush), rare nested-square accents
export function buildBlockFills(opts: {
  cells: CellNode[]
  paletteSize: number
  seed: number
}): BlockFill[] {
  const { cells, paletteSize, seed } = opts
  const out: BlockFill[] = []
  for (const cell of cells) {
    if (cell.treatment !== 'blocks') continue
    const id = cellId(cell.level, cell.ix, cell.iy)
    const cx = cell.x + cell.size / 2
    const cy = cell.y + cell.size / 2
    // stretched region lattice: wider than tall, so blocks run in bands
    const r = regionValue(seed, cx * 0.55, cy, cell.size * 2.6, 'lab.block')
    const color = Math.min(paletteSize - 1, Math.floor(r * paletteSize))
    // occasional nested square in a contrasting palette slot
    const accentRoll = chan(seed, id, 'lab.block.accent')
    const accent =
      accentRoll > 0.94
        ? (color + 1 + Math.floor(chan(seed, id, 'lab.block.accent2') * (paletteSize - 1))) %
          paletteSize
        : null
    out.push({ cell, color, accent })
  }
  return out
}

// BEADS — the pegboard: EVERY cell draws a circle (ground beads
// included — the grid itself is the surface); columns carry colored
// RUNS whose lengths come from seeded windows, occasional concentric
// inner dots
export function buildBeadFills(opts: {
  cells: CellNode[]
  paletteSize: number
  seed: number
  // material mode: scales a cell's run-activation probability (1 = the
  // classic 0.85 everywhere). Lets colored runs concentrate on the
  // subject instead of competing with equally bright background columns.
  activityScale?: (cell: CellNode) => number
}): BeadFill[] {
  const { cells, paletteSize, seed, activityScale } = opts
  const out: BeadFill[] = []
  for (const cell of cells) {
    if (cell.treatment !== 'beads') continue
    const ix = cell.ix
    const iy = cell.iy
    // column personality: how active this column is, and its run length
    const colActivity = chan(seed, ix + cell.level * 8192, 'lab.bead.col')
    const runLen = 3 + Math.floor(chan(seed, ix + cell.level * 8192, 'lab.bead.len') * 9)
    const run = Math.floor(iy / runLen)
    const runRoll = chan(seed, ix * 4096 + run, 'lab.bead.run')
    const active = runRoll < colActivity * 0.85 * (activityScale ? activityScale(cell) : 1)
    const color = Math.min(
      paletteSize - 1,
      Math.floor(chan(seed, ix * 4096 + run, 'lab.bead.color') * paletteSize),
    )
    const id = cellId(cell.level, ix, iy)
    const innerRoll = chan(seed, id, 'lab.bead.inner')
    const inner =
      active && innerRoll > 0.7
        ? Math.min(paletteSize - 1, Math.floor(chan(seed, id, 'lab.bead.inner2') * paletteSize))
        : null
    out.push({ cell, active, color, inner })
  }
  return out
}

// SHINGLE — per-cell linear gradients between two palette slots,
// direction alternating row by row (the woven light read); the flow
// angle leans the whole weave
export function buildShingleFills(opts: {
  cells: CellNode[]
  paletteSize: number
  seed: number
  lean: number // radians added to every shingle
  // material mode: per-cell lean on top of `lean` — the render layer
  // hands in the captured frame's edge orientation so shingles follow
  // the subject's form instead of staying axis-locked.
  leanAt?: (cell: CellNode) => number
}): ShingleFill[] {
  const { cells, paletteSize, seed, lean, leanAt } = opts
  const out: ShingleFill[] = []
  for (const cell of cells) {
    if (cell.treatment !== 'shingle') continue
    const cx = cell.x + cell.size / 2
    const cy = cell.y + cell.size / 2
    // one palette pair per broad region so areas read as one material
    const r = regionValue(seed, cx, cy, cell.size * 3.2, 'lab.shingle')
    const a = Math.min(paletteSize - 1, Math.floor(r * paletteSize))
    const b = (a + 1) % Math.max(1, paletteSize)
    // alternate direction by row parity, flip some columns for weave
    const flip = (cell.iy & 1) === 1 !== ((cell.ix & 3) === 3)
    out.push({ cell, a, b, angle: (flip ? Math.PI : 0) + lean + (leanAt ? leanAt(cell) : 0) })
  }
  return out
}
