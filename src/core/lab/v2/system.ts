import type { LabState } from '../types'
import type { LabSource } from '../sourceCache'
import type { Field } from '../field'
import { fieldFromMap, fitRect } from '../field'
import type { LookColorPlan } from '../colorDirection'
import type { CurveSnapshot } from '../types'
import { buildCurveField } from '../territory'

// The V2 systems are pattern generators rebuilt from the approved are.na
// references. They draw directly from this environment — seed, palette,
// complexity, the mark's field — and never touch the band machinery.

export type SymbolFieldOptions = {
  scale?: number // multiplier over the recipe's placement box
  offsetX?: number // -1..1 of half-extent
  offsetY?: number
  rotation?: number // radians
  softness?: number
}

export type V2Env = {
  outW: number
  outH: number
  seed: number
  complexity: number // 0..1 from the Complexity slider
  ground: string // canvas ground hex
  ink: string // strongest ink hex
  palette: string[] // the dealt palette (plan swatches)
  plan: LookColorPlan | undefined
  // 0..1 field, 1 inside the mark. Call with overrides to place the
  // geometry yourself (oversized, off-center, tilted). Cached per options.
  symbolField: (options?: SymbolFieldOptions) => Field
  // source luminance 0..1 when processing a captured frame (3D mode),
  // null for generated backgrounds
  luminance: Field | null
  motionPhase: number // 0..1, exactly loopable
  motionAmount: number // 0..1
  motionEnergy: number // 0..1, from the Energy slider (motion.speed 0.1..2)
}

// Integer temporal harmonic for the look renderers: the Energy slider picks
// 1, 2 or 3 sine cycles per loop. Keeping h an INTEGER is what guarantees
// sin(2π·phase·h + constant) matches exactly at phase 0 and phase 1, so the
// loop seam stays byte-identical at every energy.
export function motionHarmonic(env: V2Env): number {
  return 1 + Math.round(2 * Math.max(0, Math.min(1, env.motionEnergy)))
}

const symbolCache = new Map<string, Field>()

export function buildV2Env(lab: LabState, source: LabSource | null): V2Env {
  const { width: outW, height: outH } = lab.output
  const curveSource = lab.territory.sources.find(
    (item) => item.kind === 'curve' && item.enabled && item.curve,
  )
  const snapshot = curveSource?.curve

  const symbolField = (options: SymbolFieldOptions = {}): Field => {
    if (!snapshot) return () => 0
    const resolved: CurveSnapshot = {
      ...snapshot,
      amplitudeX: snapshot.amplitudeX * (options.scale ?? 1),
      amplitudeY: snapshot.amplitudeY * (options.scale ?? 1),
      offsetX: options.offsetX ?? snapshot.offsetX,
      offsetY: options.offsetY ?? snapshot.offsetY,
      rotation: options.rotation ?? snapshot.rotation,
    }
    const softness = options.softness ?? curveSource.softness
    const key = `${JSON.stringify(resolved)}|${outW}x${outH}|${softness.toFixed(3)}|${lab.seed}`
    let field = symbolCache.get(key)
    if (!field) {
      if (symbolCache.size > 12) symbolCache.clear()
      field = buildCurveField(resolved, outW, outH, softness)
      symbolCache.set(key, field)
    }
    return field
  }

  let luminance: Field | null = null
  const maps = source?.maps
  if (maps) {
    const rect = fitRect(source.fullW, source.fullH, outW, outH, lab.source?.fit ?? 'cover')
    luminance = fieldFromMap(maps.lum, maps.w, maps.h, rect)
  }

  return {
    outW,
    outH,
    seed: lab.seed,
    complexity: Math.max(0, Math.min(1, lab.look.complexity ?? 0.5)),
    ground: lab.colors.paper,
    ink: lab.colors.ink,
    palette: lab.colors.palette,
    plan: lab.colors.plan,
    symbolField,
    luminance,
    motionPhase: (((lab.motion.frame?.phase ?? 0) % 1) + 1) % 1,
    motionAmount: lab.motion.enabled ? Math.max(0, Math.min(1, lab.motion.amount)) : 0,
    // motion.speed runs 0.1..2 (see MotionState); normalize to 0..1 with the
    // same mapping the v1 band path and organic warp use
    motionEnergy: Math.max(0, Math.min(1, (lab.motion.speed - 0.1) / 1.9)),
  }
}
