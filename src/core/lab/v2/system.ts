import type { LabState } from '../types'
import type { LabSource } from '../sourceCache'
import type { Field } from '../field'
import { fieldFromMap, fitRect } from '../field'
import type { LookColorPlan } from '../colorDirection'
import type { CurveSnapshot } from '../types'
import { buildCurveField, META_CURVE } from '../territory'
import { CANONICAL_META_SAFE_AREA } from '../metaInfluence'

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
  // 3D material mode only — captured with the frame at the settled pose,
  // null/absent in 2D and whenever the passes are unavailable (context
  // loss, capture failure). Sampled over the same fit rect as luminance.
  //   depth    0..1 view depth normalized over the MODEL's own span:
  //            0 = nearest model point, 1 = farthest; background (and
  //            outside the source rect) reads exactly 1.
  //   normalX  view-space surface normal X packed 0..1 (value*2-1
  //            recovers the component; +X = screen right); background 0.5.
  //   normalY  view-space surface normal Y packed 0..1 (+Y = screen UP);
  //            background 0.5. 0.5/0.5 together = facing the camera.
  depth?: Field | null
  normalX?: Field | null
  normalY?: Field | null
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

// 3D material mode strips the territory stack down to the tone source
// (sourceAwareLabForRecipe), so there is no curve source to read — yet the
// mark stays the only motif geometry the V2 systems may draw from. This is
// the same canonical centered placement backgroundRecipeToLab gives the
// generated path: the official Meta symbol geometry, canonical orientation,
// fit to the canonical safe area. Never mirrored, rotated, or redrawn.
const CANONICAL_META_SNAPSHOT: CurveSnapshot = {
  ...META_CURVE,
  amplitudeX: CANONICAL_META_SAFE_AREA.width,
  amplitudeY: CANONICAL_META_SAFE_AREA.height,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  silhouette: 'meta-symbol',
}

export function buildV2Env(lab: LabState, source: LabSource | null): V2Env {
  const { width: outW, height: outH } = lab.output
  const curveSource = lab.territory.sources.find(
    (item) => item.kind === 'curve' && item.enabled && item.curve,
  )
  const snapshot = curveSource?.curve ?? CANONICAL_META_SNAPSHOT

  const symbolField = (options: SymbolFieldOptions = {}): Field => {
    const resolved: CurveSnapshot = {
      ...snapshot,
      amplitudeX: snapshot.amplitudeX * (options.scale ?? 1),
      amplitudeY: snapshot.amplitudeY * (options.scale ?? 1),
      offsetX: options.offsetX ?? snapshot.offsetX,
      offsetY: options.offsetY ?? snapshot.offsetY,
      rotation: options.rotation ?? snapshot.rotation,
    }
    const softness = options.softness ?? curveSource?.softness ?? 0.3
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
  let depth: Field | null = null
  let normalX: Field | null = null
  let normalY: Field | null = null
  const maps = source?.maps
  if (maps) {
    const rect = fitRect(source.fullW, source.fullH, outW, outH, lab.source?.fit ?? 'cover')
    const aux = source.aux
    if (aux) {
      depth = fieldFromMap(aux.depth, aux.w, aux.h, rect, 1)
      normalX = fieldFromMap(aux.normalX, aux.w, aux.h, rect, 0.5)
      normalY = fieldFromMap(aux.normalY, aux.w, aux.h, rect, 0.5)
    }
    if (lab.sourceMask === 'border-distance') {
      // 3D material mode (the only path that sets this mask): the live
      // capture carries the model silhouette in ALPHA, and the shared
      // analysis reads transparent as paper-white — which would flatten
      // the whole scene to near-uniform brightness and disconnect the
      // look from the viewport. Rebuild luminance from the raw RGB so the
      // systems see the actual viewport image (and live matches export,
      // whose capture is opaque).
      const count = maps.w * maps.h
      const sceneLum = new Float32Array(count)
      for (let i = 0; i < count; i++) {
        const offset = i * 4
        sceneLum[i] = (
          0.2126 * maps.rgba[offset]
          + 0.7152 * maps.rgba[offset + 1]
          + 0.0722 * maps.rgba[offset + 2]
        ) / 255
      }
      luminance = fieldFromMap(sceneLum, maps.w, maps.h, rect)
    } else {
      luminance = fieldFromMap(maps.lum, maps.w, maps.h, rect)
    }
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
    depth,
    normalX,
    normalY,
    motionPhase: (((lab.motion.frame?.phase ?? 0) % 1) + 1) % 1,
    motionAmount: lab.motion.enabled ? Math.max(0, Math.min(1, lab.motion.amount)) : 0,
    // motion.speed runs 0.1..2 (see MotionState); normalize to 0..1 with the
    // same mapping the v1 band path and organic warp use
    motionEnergy: Math.max(0, Math.min(1, (lab.motion.speed - 0.1) / 1.9)),
  }
}
