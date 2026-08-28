import type { V2Env } from './system'
import type { Field } from '../field'
import { chan } from '@/core/organic/random'

// 'Pattern' — a bold two-color half-drop tile pattern whose motif is a
// PIXEL-CROP of the Meta mark itself. A seeded fragment of the symbol field
// (oversized, pushed off-center, tilted) is rasterized onto a small motif
// grid and thresholded, so every tile is a stepped curved fragment carrying
// the mark's arc DNA — never the whole logo. The fragment is packed to fill
// its tile (bounding-box crop stretched to the grid) and crops are accepted
// dense (42-68% of cells), so figure masses from neighboring half-drop
// mirrored columns nearly touch and the ground reads as channels between
// them — a dense interlocking two-color textile, not spot motifs on ground.
// The tiling itself is unchanged from round 2: strict grid, half-drop
// columns, seeded mirrored-column phase, exactly two colors, whole-pixel
// cells, diagonal whole-period motion scroll.

const C = 'v2.pattern.'

// ---------------------------------------------------------------------------
// Motif: rasterized crop of the mark
// ---------------------------------------------------------------------------

// Sample a field over a square crop window onto an n x n cell grid,
// thresholding at 0.5 into a chunky bitmap.
function rasterizeCrop(
  field: Field,
  centerX: number,
  centerY: number,
  size: number,
  n: number,
): Uint8Array {
  const cells = new Uint8Array(n * n)
  const x0 = centerX - size / 2
  const y0 = centerY - size / 2
  const step = size / n
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (field(x0 + (i + 0.5) * step, y0 + (j + 0.5) * step) >= 0.5) {
        cells[j * n + i] = 1
      }
    }
  }
  return cells
}

type CleanedMotif = {
  cells: Uint8Array // only the largest 4-connected component survives
  count: number // on-cells in that component
  spansVertical: boolean // touches both top and bottom window edges
  spansHorizontal: boolean // touches both left and right window edges
  spansCorner: boolean // touches one horizontal edge plus one vertical edge
  bboxW: number // component bounding-box width in cells
  bboxH: number // component bounding-box height in cells
  bboxX: number // bounding-box left cell
  bboxY: number // bounding-box top cell
}

// Keep only the largest 4-connected component; islands are dropped so the
// motif reads as one stepped mass, not scattered noise.
function cleanLargest(raw: Uint8Array, n: number): CleanedMotif {
  const seen = new Uint8Array(n * n)
  let best: number[] = []
  for (let start = 0; start < n * n; start++) {
    if (!raw[start] || seen[start]) continue
    seen[start] = 1
    const stack = [start]
    const members: number[] = []
    while (stack.length > 0) {
      const idx = stack.pop() as number
      members.push(idx)
      const x = idx % n
      const y = (idx - x) / n
      if (x > 0 && raw[idx - 1] && !seen[idx - 1]) {
        seen[idx - 1] = 1
        stack.push(idx - 1)
      }
      if (x < n - 1 && raw[idx + 1] && !seen[idx + 1]) {
        seen[idx + 1] = 1
        stack.push(idx + 1)
      }
      if (y > 0 && raw[idx - n] && !seen[idx - n]) {
        seen[idx - n] = 1
        stack.push(idx - n)
      }
      if (y < n - 1 && raw[idx + n] && !seen[idx + n]) {
        seen[idx + n] = 1
        stack.push(idx + n)
      }
    }
    if (members.length > best.length) best = members
  }
  const cells = new Uint8Array(n * n)
  let minX = n
  let minY = n
  let maxX = -1
  let maxY = -1
  for (const idx of best) {
    cells[idx] = 1
    const x = idx % n
    const y = (idx - x) / n
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const left = minX === 0
  const right = maxX === n - 1
  const top = minY === 0
  const bottom = maxY === n - 1
  return {
    cells,
    count: best.length,
    spansVertical: top && bottom,
    spansHorizontal: left && right,
    spansCorner: (left || right) && (top || bottom),
    bboxW: best.length > 0 ? maxX - minX + 1 : 0,
    bboxH: best.length > 0 ? maxY - minY + 1 : 0,
    bboxX: minX,
    bboxY: minY,
  }
}

// Pack the component so it fills the whole motif grid: crop to its bounding
// box and nearest-neighbor stretch back to n x n (whole cells, deterministic,
// 4-connectivity preserved). This strips the implicit ground margins a crop
// leaves inside its tile — margins that tiling would otherwise repeat as wide
// empty channels — so neighboring tiles' figure masses meet at the tile seams
// and the half-drop mirror columns interlock like houndstooth teeth.
function packMotif(cleaned: CleanedMotif, n: number): Uint8Array {
  const { cells, bboxW, bboxH, bboxX, bboxY } = cleaned
  if (cleaned.count === 0 || (bboxW === n && bboxH === n)) return cells
  const packed = new Uint8Array(n * n)
  for (let j = 0; j < n; j++) {
    const sy = bboxY + Math.floor(((j + 0.5) * bboxH) / n)
    for (let i = 0; i < n; i++) {
      const sx = bboxX + Math.floor(((i + 0.5) * bboxW) / n)
      packed[j * n + i] = cells[sy * n + sx]
    }
  }
  return packed
}

// Deterministic fallback if no crop retry lands on a usable arc edge (e.g.
// no curve source in the recipe): a stepped quarter-ring from a seeded
// corner — same curved-stepped character, still not the logo.
function fallbackMotif(seed: number, n: number): Uint8Array {
  const fx = chan(seed, 0, C + 'fallbackCX') < 0.5 ? 0 : 1
  const fy = chan(seed, 0, C + 'fallbackCY') < 0.5 ? 0 : 1
  const cells = new Uint8Array(n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const r = Math.hypot((i + 0.5) / n - fx, (j + 0.5) / n - fy)
      if (r >= 0.58 && r <= 1.04) cells[j * n + i] = 1
    }
  }
  return cells
}

const CROP_RETRIES = 10

// Build the motif bitmap by cropping the mark. Each retry index derives a
// fresh seeded placement (scale, push direction, tilt) — or, in 3D material
// mode, a fresh window over the captured frame's luminance — and the first
// horizontally-spanning dense crop wins (corner-to-corner spans are the
// fallback tier). Fully deterministic per (seed, retry index).
function buildMotif(env: V2Env, n: number): Uint8Array {
  const { outW, outH, seed } = env
  const total = n * n
  const TARGET = 0.53
  let horizontal: { cells: Uint8Array; dist: number } | null = null
  let corner: { cells: Uint8Array; dist: number } | null = null
  let nearest: { cells: Uint8Array; coverage: number; spansVertical: boolean } | null = null
  for (let k = 0; k < CROP_RETRIES; k++) {
    let field: Field
    let cx: number
    let cy: number
    let size: number
    if (env.luminance) {
      // 3D material mode: crop the captured frame's luminance instead —
      // the seeded window wanders the frame looking for a bold edge.
      field = env.luminance
      cx = outW * (0.22 + chan(seed, k, C + 'lumWinX') * 0.56)
      cy = outH * (0.22 + chan(seed, k, C + 'lumWinY') * 0.56)
      size = Math.min(outW, outH) * 0.4
    } else {
      // Oversize the mark and push it off-center so one arc edge sweeps
      // through the (canvas-centered) crop window: different seeds catch
      // different lobe corners or the crossover.
      const scale = 2.2 + chan(seed, k, C + 'cropScale') * 1.2
      const rotation = (chan(seed, k, C + 'cropRot') * 2 - 1) * 0.6
      const dir = chan(seed, k, C + 'cropDir') * Math.PI * 2
      const dist = 0.35 + chan(seed, k, C + 'cropDist') * 0.5
      field = env.symbolField({
        scale,
        offsetX: Math.cos(dir) * dist,
        offsetY: Math.sin(dir) * dist,
        rotation,
        softness: 0.15,
      })
      cx = outW / 2
      cy = outH / 2
      // A wide window relative to the mark's arc radius, so the crop spans
      // enough of the bend that the stepped edge visibly changes direction.
      size = Math.min(outW, outH) * 0.72
    }
    const cleaned = cleanLargest(rasterizeCrop(field, cx, cy, size, n), n)
    if (cleaned.count === 0) continue
    // Judge the PACKED tile — its coverage is the figure share the render
    // will actually show. A good crop is dense enough to leave ground only
    // as channels (42-68% of cells) but not solid, and its component must
    // run left-to-right or corner-to-corner so the half-drop columns
    // interlock. Top-to-bottom spans stay rejected — under half-drop tiling
    // they fuse into plain vertical stripes — and skinny bounding boxes are
    // rejected too, since stretching those to the full grid degenerates
    // into stripes as well.
    const packed = packMotif(cleaned, n)
    let count = 0
    for (let idx = 0; idx < total; idx++) count += packed[idx]
    const coverage = count / total
    const stocky = cleaned.bboxW * 3 >= n && cleaned.bboxH * 3 >= n
    if (coverage >= 0.42 && coverage <= 0.68 && stocky && !cleaned.spansVertical) {
      // Horizontal spans interlock best — one landing in the 45-60% sweet
      // band wins outright. Denser or lighter (but still in-window) crops
      // are kept ranked by distance from the target share, corner-to-corner
      // spans one tier below, so a heavy first retry can't shade the whole
      // pattern toward one color when a better-balanced retry exists.
      const dist = Math.abs(coverage - TARGET)
      if (cleaned.spansHorizontal) {
        if (coverage >= 0.45 && coverage <= 0.6) return packed
        if (!horizontal || dist < horizontal.dist) horizontal = { cells: packed, dist }
      } else if (cleaned.spansCorner) {
        if (!corner || dist < corner.dist) corner = { cells: packed, dist }
      }
    }
    if (
      !nearest ||
      (nearest.spansVertical && !cleaned.spansVertical) ||
      (nearest.spansVertical === cleaned.spansVertical &&
        Math.abs(coverage - 0.55) < Math.abs(nearest.coverage - 0.55))
    ) {
      nearest = { cells: packed, coverage, spansVertical: cleaned.spansVertical }
    }
  }
  if (horizontal) return horizontal.cells
  if (corner) return corner.cells
  if (nearest && nearest.coverage >= 0.25 && nearest.coverage <= 0.8) {
    return nearest.cells
  }
  return packMotif(cleanLargest(fallbackMotif(seed, n), n), n)
}

// ---------------------------------------------------------------------------
// Tile prerender
// ---------------------------------------------------------------------------

let tileNormal: HTMLCanvasElement | null = null
let tileMirror: HTMLCanvasElement | null = null

// Paint the motif bitmap into an offscreen tile as filled raster squares.
// Each cell overdraws 1px right and down so adjacent cells fuse into stepped
// masses with no hairline seams; the tile canvas carries the 1px apron.
function paintTile(
  existing: HTMLCanvasElement | null,
  motif: Uint8Array,
  n: number,
  cell: number,
  color: string,
  mirrored: boolean,
): HTMLCanvasElement {
  const canvas = existing ?? document.createElement('canvas')
  const size = n * cell + 1
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size
    canvas.height = size
  }
  const tctx = canvas.getContext('2d')
  if (!tctx) return canvas
  tctx.clearRect(0, 0, size, size)
  tctx.fillStyle = color
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (!motif[j * n + i]) continue
      const x = (mirrored ? n - 1 - i : i) * cell
      tctx.fillRect(x, j * cell, cell + 1, cell + 1)
    }
  }
  return canvas
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

// Figure color: highest-weight plan swatch that is not the ground role.
// With 3+ candidate inks the seed picks among the top two by weight.
function pickFigure(env: V2Env): string {
  const plan = env.plan
  if (!plan) return env.ink
  const groundLower = env.ground.trim().toLowerCase()
  const candidates = plan.swatches
    .map((swatch, index) => ({ swatch, index }))
    .filter(({ swatch, index }) => index !== plan.roles.ground && swatch.hex.trim().toLowerCase() !== groundLower)
    .sort((a, b) => b.swatch.weight - a.swatch.weight)
  if (candidates.length === 0) return env.ink
  if (candidates.length >= 3 && chan(env.seed, 0, C + 'figurePick') < 0.5) {
    return candidates[1].swatch.hex
  }
  return candidates[0].swatch.hex
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function renderPattern(ctx: CanvasRenderingContext2D, env: V2Env): void {
  const { outW, outH, seed, complexity } = env

  // Ground first — the whole canvas is one of the two colors.
  ctx.fillStyle = env.ground
  ctx.fillRect(0, 0, outW, outH)

  const level = Math.max(0, Math.min(1, complexity))

  // Motif resolution: 10x10 cells at complexity 0 up to 14x14 at 1.
  const n = 10 + Math.round(4 * level)

  // Tile size: outW/5 at complexity 0 down to outW/13 at 1, snapped so each
  // motif cell is a whole number of pixels (raster cells stay crisp).
  const divisor = 5 + 8 * level
  const cell = Math.max(2, Math.round(outW / divisor / n))
  const unit = cell * n
  const half = Math.floor(unit / 2)

  // Seeded variation — the grid itself never varies, only these choices
  // (and the crop the motif is cut from).
  const mirrorParity = chan(seed, 1, C + 'mirrorPhase') < 0.5 ? 0 : 1
  const dropDir = chan(seed, 2, C + 'dropDir') < 0.5 ? -1 : 1
  const dirX = chan(seed, 3, C + 'motionDirX') < 0.5 ? -1 : 1
  const dirY = chan(seed, 4, C + 'motionDirY') < 0.5 ? -1 : 1

  // Motion: diagonal scroll by whole pattern periods per loop so phase 0 and
  // phase 1 are pixel-identical. The horizontal period is 2 tiles (mirrored
  // column pairs), the vertical period is 1 tile. motionAmount scales the
  // speed in whole periods (1 or 2 per loop) — fractions would break the loop.
  const periods = env.motionAmount <= 0 ? 0 : env.motionAmount > 0.6 ? 2 : 1
  const travel = env.motionPhase * periods
  const wrap = (value: number, span: number) => -((((value % span) + span) % span))
  const offsetX = Math.round(wrap(travel * dirX * unit * 2, unit * 2))
  const offsetY = Math.round(wrap(travel * dirY * unit, unit))

  const motif = buildMotif(env, n)
  const figure = pickFigure(env)
  tileNormal = paintTile(tileNormal, motif, n, cell, figure, false)
  tileMirror = paintTile(tileMirror, motif, n, cell, figure, true)

  const cols = Math.ceil(outW / unit)
  const rows = Math.ceil(outH / unit)
  for (let i = -3; i <= cols + 3; i++) {
    const parity = ((i % 2) + 2) % 2
    const drop = parity === 1 ? dropDir * half : 0
    const mirrored = parity === mirrorParity
    const tile = mirrored ? tileMirror : tileNormal
    const x = i * unit + offsetX
    for (let j = -3; j <= rows + 3; j++) {
      ctx.drawImage(tile, x, j * unit + drop + offsetY)
    }
  }
}
