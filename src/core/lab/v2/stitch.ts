import type { V2Env } from './system'

// Placeholder: replaced by the Stitch system builder.
export function renderStitch(ctx: CanvasRenderingContext2D, env: V2Env): void {
  ctx.fillStyle = env.ground
  ctx.fillRect(0, 0, env.outW, env.outH)
  ctx.fillStyle = env.ink
  ctx.globalAlpha = 0.4
  const step = Math.max(24, env.outW / 16)
  for (let x = -env.outH; x < env.outW; x += step) {
    ctx.fillRect(x, 0, step / 2, env.outH)
  }
  ctx.globalAlpha = 1
}
