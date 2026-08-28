import type { LabState, LabView } from '../types'
import type { LabSource } from '../sourceCache'
import { V2_SYSTEM_IDS } from '../looks'
import { buildV2Env } from './system'
import { renderPattern } from './pattern'
import { renderMandala } from './mandala'
import { renderStitch } from './stitch'
import { renderDither } from './dither'

// Dispatch for the rebuilt V2 systems. Returns false when this lab is not
// a V2 system (or asks for a debug view), so the caller can fall through.
export function renderLabV2System(
  ctx: CanvasRenderingContext2D,
  lab: LabState,
  source: LabSource | null,
  view: LabView,
): boolean {
  const id = lab.look?.id
  if (!id || !V2_SYSTEM_IDS.has(id as never)) return false
  if (view !== 'composite') return false
  const env = buildV2Env(lab, source)
  ctx.clearRect(0, 0, env.outW, env.outH)
  if (id === 'pattern') renderPattern(ctx, env)
  else if (id === 'mandala') renderMandala(ctx, env)
  else if (id === 'stitch') renderStitch(ctx, env)
  else renderDither(ctx, env)
  return true
}
