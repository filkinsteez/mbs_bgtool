import { chan } from '@/core/organic/random'
import type { CellNode } from './composition'
import { cellId } from './composition'
import {
  distinctColorIndex,
  weightedColorIndex,
  type LookColorPlan,
} from './colorDirection'

// Per-cell fill decisions for the palette treatments. All pure specs —
// the render layer turns them into paint. The references' sophistication
// is COHERENCE: neighbors sharing a color read as merged blocks, column
// runs read as strings of beads, alternating gradient directions read
// as woven shingles. Randomness only ever breaks a rule locally.

export type BlockFill = { cell: CellNode; color: number; accent: number | null }
export type BeadFill = {
  cell: CellNode
  active: boolean
  color: number
  inner: number | null
  radius: number
  offsetX: number
  offsetY: number
  relief: number
}
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
  colorPlan?: LookColorPlan
  // MATERIAL MODE (3D overlay): the probabilistic territory lean is
  // statistically invisible under a same-hue palette. Instead the shaded
  // silhouette picks the block's depth band outright — exterior cells
  // deal the ground-adjacent end of depthOrder, interior cells climb
  // toward the high-contrast end with the model's shading — and the
  // region lattice only perturbs within that choice, so the quilt still
  // reads as patchwork while re-composing with every pose.
  materialDepth?: boolean
}): BlockFill[] {
  const { cells, paletteSize, seed, colorPlan, materialDepth = false } = opts
  const out: BlockFill[] = []
  for (const cell of cells) {
    if (cell.treatment !== 'blocks') continue
    const id = cellId(cell.level, cell.ix, cell.iy)
    const cx = cell.x + cell.size / 2
    const cy = cell.y + cell.size / 2
    // stretched region lattice: wider than tall, so blocks run in bands.
    // With a plan the deal leans by territory — ink gathers toward the
    // symbol core, ground-colored blocks open up at the fringe — so the
    // quilt reads the composition instead of pure noise.
    const raw = regionValue(seed, cx * 0.55, cy, cell.size * 2.6, 'lab.block')
    const r = colorPlan
      ? Math.max(0, Math.min(1, raw + (1 - cell.t) * 0.5 - 0.28))
      : raw
    const color = colorPlan && materialDepth
      ? (() => {
          const order = colorPlan.depthOrder
          // ground: a quiet two-tone camo between the two ground-adjacent
          // depth slots, patched by the region lattice (the look's 2D
          // patchwork identity, kept deliberately calmer than the model)
          if (cell.t < 0.17) {
            return order[raw > 0.72 && order.length > 1 ? 1 : 0]
          }
          // subject: shading climbs the depth order — lit faces hold the
          // mid slots, shadow reaches the strongest-contrast ink
          const depth = Math.max(
            0,
            Math.min(0.999999, 0.36 + cell.t * 0.55 + (raw - 0.5) * 0.28),
          )
          return order[Math.min(order.length - 1, Math.floor(depth * order.length))]
        })()
      : colorPlan
        ? weightedColorIndex(colorPlan, r)
        : Math.min(paletteSize - 1, Math.floor(r * paletteSize))
    // occasional nested square in a contrasting palette slot
    const accentRoll = chan(seed, id, 'lab.block.accent')
    const accent =
      accentRoll > 0.94
        ? colorPlan
          ? distinctColorIndex(colorPlan, color, chan(seed, id, 'lab.block.accent2'))
          : (color + 1 + Math.floor(chan(seed, id, 'lab.block.accent2') * (paletteSize - 1))) %
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
  colorPlan?: LookColorPlan
}): BeadFill[] {
  const { cells, paletteSize, seed, colorPlan } = opts
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
    const id = cellId(cell.level, ix, iy)
    const hero = chan(seed, id, 'lab.bead.hero') > 0.955
    const active = hero || runRoll < 0.16 + colActivity * 0.54 + cell.t * 0.2
    const colorSample = chan(seed, ix * 4096 + run, 'lab.bead.color')
    const color = colorPlan
      ? weightedColorIndex(colorPlan, colorSample)
      : Math.min(paletteSize - 1, Math.floor(colorSample * paletteSize))
    const innerRoll = chan(seed, id, 'lab.bead.inner')
    const inner =
      active && (hero || innerRoll > 0.7)
        ? colorPlan
          ? distinctColorIndex(colorPlan, color, chan(seed, id, 'lab.bead.inner2'))
          : Math.min(paletteSize - 1, Math.floor(chan(seed, id, 'lab.bead.inner2') * paletteSize))
        : null
    const radius = cell.size * (
      hero
        ? 0.55 + chan(seed, id, 'lab.bead.hero.radius') * 0.13
        : active
        ? 0.32 + chan(seed, id, 'lab.bead.radius') * 0.14
        : 0.17 + chan(seed, id, 'lab.bead.radius.quiet') * 0.08
    )
    out.push({
      cell,
      active,
      color,
      inner,
      radius,
      offsetX: ((iy & 1) === 0 ? -0.1 : 0.1) * cell.size
        + (chan(seed, ix + cell.level * 8192, 'lab.bead.column.drift') - 0.5)
          * cell.size * 0.065,
      offsetY: (chan(seed, iy + cell.level * 8192, 'lab.bead.row.drift') - 0.5)
        * cell.size * 0.075,
      relief: hero ? 1 : chan(seed, id, 'lab.bead.relief'),
    })
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
  colorPlan?: LookColorPlan
  // MATERIAL MODE (3D overlay): territory picks the gradient PAIR
  // outright — exterior shingles weave between the two ground-adjacent
  // depth slots, interior shingles climb depthOrder with the model's
  // shading — and the mask gradient leans each shingle's gradient axis
  // so the weave's light wraps the form.
  materialDepth?: boolean
  leanField?: (x: number, y: number) => number | null
}): ShingleFill[] {
  const {
    cells,
    paletteSize,
    seed,
    lean,
    colorPlan,
    materialDepth = false,
    leanField,
  } = opts
  const out: ShingleFill[] = []
  for (const cell of cells) {
    if (cell.treatment !== 'shingle') continue
    const cx = cell.x + cell.size / 2
    const cy = cell.y + cell.size / 2
    // one palette pair per broad region so areas read as one material —
    // the partner deals from the same region lattice, so neighbors hold
    // one consistent weave instead of per-cell confetti. With a plan the
    // deal leans by territory, the same as blocks: ink gathers where the
    // field runs strong, pale weave opens up at the fringe.
    const raw = regionValue(seed, cx, cy, cell.size * 3.2, 'lab.shingle')
    const r = colorPlan
      ? Math.max(0, Math.min(1, raw + (1 - cell.t) * 0.45 - 0.24))
      : raw
    let a: number
    let b: number
    if (colorPlan && materialDepth) {
      const order = colorPlan.depthOrder
      const depth = Math.max(
        0,
        Math.min(0.999999, cell.t * 0.8 + (raw - 0.5) * 0.26 + 0.05),
      )
      const ia = Math.min(order.length - 1, Math.floor(depth * order.length))
      const ib = ia + 1 < order.length ? ia + 1 : Math.max(0, ia - 1)
      a = order[ia]
      b = order[ib]
    } else {
      a = colorPlan
        ? weightedColorIndex(colorPlan, r)
        : Math.min(paletteSize - 1, Math.floor(r * paletteSize))
      b = colorPlan
        ? distinctColorIndex(colorPlan, a, regionValue(seed, cx, cy, cell.size * 3.2, 'lab.shingle.pair'))
        : (a + 1) % Math.max(1, paletteSize)
    }
    // alternate direction by row parity, flip some columns for weave
    const flip = (cell.iy & 1) === 1 !== ((cell.ix & 3) === 3)
    const leaned = leanField ? leanField(cx, cy) : null
    out.push({
      cell,
      a,
      b,
      angle: leaned !== null ? leaned + (flip ? Math.PI : 0) : (flip ? Math.PI : 0) + lean,
    })
  }
  return out
}
