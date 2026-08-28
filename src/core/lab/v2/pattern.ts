import type { V2Env } from './system'
import { chan } from '@/core/organic/random'

// 'Pattern' — a bold two-color half-drop tile pattern (houndstooth reinvented).
// One angular stepped-hook motif repeats on a strict grid: odd columns drop by
// half a tile, alternating columns mirror horizontally so motif pairs interlock,
// and diagonals emerge from the stagger. Exactly two colors per render.

// Unit motif on an 8x8 integer lattice (y down): a running-dog hook.
// A stepped diagonal body runs from a broad arm at the top-right down to a
// broad foot at the bottom-left; a short hook hangs from the arm (x 7-8,
// y 2-3) and a matching hook rises from the foot (x 0-1, y 4-5). The shape is
// 180-degree rotationally symmetric about (4, 3.5), which gives it pinwheel
// energy. Rectilinear only — every edge axis-aligned so it renders crisp.
// Covered area = 36/64 = ~56% of the tile. The arm reaches x=8 over y 0..3
// and the foot reaches x=0 over y 4..7, so with the half-drop (U/2 = 4
// lattice units) neighboring motifs link edge-to-edge into diagonal chains,
// exactly like houndstooth, while mirrored pair boundaries stay open channels.
const MOTIF: ReadonlyArray<readonly [number, number]> = [
  [3, 0],
  [8, 0],
  [8, 3],
  [7, 3],
  [7, 2],
  [6, 2],
  [6, 6],
  [5, 6],
  [5, 7],
  [0, 7],
  [0, 4],
  [1, 4],
  [1, 5],
  [2, 5],
  [2, 1],
  [3, 1],
]

function buildMotifPath(unit: number): Path2D {
  const path = new Path2D()
  MOTIF.forEach(([px, py], index) => {
    // unit is a multiple of 8, so every vertex lands on a whole pixel.
    const x = (px * unit) / 8
    const y = (py * unit) / 8
    if (index === 0) path.moveTo(x, y)
    else path.lineTo(x, y)
  })
  path.closePath()
  return path
}

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
  if (candidates.length >= 3 && chan(env.seed, 0, 'v2.pattern.figurePick') < 0.5) {
    return candidates[1].swatch.hex
  }
  return candidates[0].swatch.hex
}

export function renderPattern(ctx: CanvasRenderingContext2D, env: V2Env): void {
  const { outW, outH, seed, complexity } = env

  // Ground first — the whole canvas is one of the two colors.
  ctx.fillStyle = env.ground
  ctx.fillRect(0, 0, outW, outH)

  // Tile size: outW/5 at complexity 0 down to outW/13 at complexity 1,
  // snapped to a multiple of 8 so the lattice stays on whole pixels.
  const divisor = 5 + 8 * Math.max(0, Math.min(1, complexity))
  const unit = Math.max(24, Math.round(outW / divisor / 8) * 8)
  const half = unit / 2

  // Seeded variation — the grid itself never varies, only these choices.
  const mirrorParity = chan(seed, 1, 'v2.pattern.mirrorPhase') < 0.5 ? 0 : 1
  const dropDir = chan(seed, 2, 'v2.pattern.dropDir') < 0.5 ? -1 : 1
  const dirX = chan(seed, 3, 'v2.pattern.motionDirX') < 0.5 ? -1 : 1
  const dirY = chan(seed, 4, 'v2.pattern.motionDirY') < 0.5 ? -1 : 1

  // Motion: diagonal scroll by whole pattern periods per loop so phase 0 and
  // phase 1 are pixel-identical. The horizontal period is 2 tiles (mirrored
  // column pairs), the vertical period is 1 tile. motionAmount scales the
  // speed in whole periods (1 or 2 per loop) — fractions would break the loop.
  const periods = env.motionAmount <= 0 ? 0 : env.motionAmount > 0.6 ? 2 : 1
  const travel = env.motionPhase * periods
  const wrap = (value: number, span: number) => -((((value % span) + span) % span))
  const offsetX = Math.round(wrap(travel * dirX * unit * 2, unit * 2))
  const offsetY = Math.round(wrap(travel * dirY * unit, unit))

  const figurePath = buildMotifPath(unit)
  ctx.fillStyle = pickFigure(env)

  const cols = Math.ceil(outW / unit)
  const rows = Math.ceil(outH / unit)
  for (let i = -3; i <= cols + 3; i++) {
    const parity = ((i % 2) + 2) % 2
    const drop = parity === 1 ? dropDir * half : 0
    const mirrored = parity === mirrorParity
    const x = i * unit + offsetX
    for (let j = -3; j <= rows + 3; j++) {
      const y = j * unit + drop + offsetY
      ctx.save()
      if (mirrored) {
        ctx.translate(x + unit, y)
        ctx.scale(-1, 1)
      } else {
        ctx.translate(x, y)
      }
      ctx.fill(figurePath)
      ctx.restore()
    }
  }
}
