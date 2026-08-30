import type { V2Env } from '../v2/system'
import { chan } from '@/core/organic/random'

// 'Loom' — WORKING STUB. Deterministic placeholder so the V4 tab is
// testable end-to-end: vertical warp threads of seeded palette color
// across the ground, flipping to horizontal weft runs inside the
// canonical mark, so the silhouette reads as a weave-direction change.
// The builder replaces this file's body wholesale; the only contract is
// the exported signature renderLoom(ctx, env) and randomness through
// 'v4.loom.*' channels. The stub is static (no motion terms), which
// satisfies the loop contract trivially; the real system owns its
// motion.

const C = 'v4.loom.'

export function renderLoom(ctx: CanvasRenderingContext2D, env: V2Env): void {
  const { outW, outH, seed, palette } = env
  ctx.fillStyle = env.ground
  ctx.fillRect(0, 0, outW, outH)

  const pool = palette.length ? palette : [env.ink]
  const minDim = Math.min(outW, outH)
  // thread pitch is resolution-relative; complexity runs coarse -> fine
  const pitch = Math.max(3, Math.round(minDim / (24 + Math.round(env.complexity * 72))))
  const thread = Math.max(1, Math.round(pitch * 0.62))
  const symbol = env.symbolField()

  // warp: vertical threads, sampled down each column in pitch-tall runs
  // so the mark's interior can drop out per run, not per column
  const cols = Math.ceil(outW / pitch)
  const rows = Math.ceil(outH / pitch)
  for (let col = 0; col < cols; col++) {
    const pick = Math.floor(chan(seed, col, C + 'warp') * pool.length)
    ctx.fillStyle = pool[Math.min(pool.length - 1, pick)]
    const x = col * pitch
    for (let row = 0; row < rows; row++) {
      const y = row * pitch
      if (symbol(x + pitch / 2, y + pitch / 2) >= 0.5) continue
      ctx.fillRect(x, y, thread, pitch)
    }
  }

  // weft: horizontal runs inside the mark, dealt from the opposite end
  // of the palette so the direction flip also reads as a color shift
  for (let row = 0; row < rows; row++) {
    const pick = Math.floor(chan(seed, row, C + 'weft') * pool.length)
    ctx.fillStyle = pool[Math.max(0, pool.length - 1 - pick)]
    const y = row * pitch
    for (let col = 0; col < cols; col++) {
      const x = col * pitch
      if (symbol(x + pitch / 2, y + pitch / 2) < 0.5) continue
      ctx.fillRect(x, y, pitch, thread)
    }
  }
}
