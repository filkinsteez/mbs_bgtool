import type { LabState, LabView } from '../types'
import type { LabSource } from '../sourceCache'
import { V4_SYSTEM_IDS } from '../looks'
import { buildV2Env } from '../v2/system'
import { renderComposite } from './composite'
import { renderPlates } from './plates'
import { renderLoom } from './loom'

// Dispatch for the V4 systems. Returns false when this lab is not a V4
// system (or asks for a debug view), so the caller can fall through.
// The V4 systems consume the SAME environment as the V3-tab systems
// (buildV2Env): seed, complexity, palette/plan, the canonical mark's
// field, luminance in 3D material mode, and the motion contract inputs.
export function renderLabV4System(
  ctx: CanvasRenderingContext2D,
  lab: LabState,
  source: LabSource | null,
  view: LabView,
): boolean {
  const id = lab.look?.id
  if (!id || !V4_SYSTEM_IDS.has(id as never)) return false
  if (view !== 'composite') return false
  const env = buildV2Env(lab, source)
  ctx.clearRect(0, 0, env.outW, env.outH)
  if (id === 'composite') renderComposite(ctx, env)
  else if (id === 'plates') renderPlates(ctx, env)
  else renderLoom(ctx, env)
  return true
}
