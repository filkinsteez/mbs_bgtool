import type { RecipeContext } from '../../scene'
import { BOUNDARY_MAX_KNOTS, BOUNDARY_MAX_TRANSITIONS, boundaryContrast, calibrateBoundary, type BoundaryCalibration, type BoundaryParams } from './boundary'
import { BAND_MAX, bandKey, MODE_ADD, MODE_MULTIPLY } from './bands-params'

/** Largest value of the model's noise over its RMS. */
const NOISE_PEAK = 2.5
/** Gap to the edge above, in standard deviations of how much the two close in, below which an edge moves with it. */
const TIE_SPREAD = 2.5
/** Largest amount of the positive factor on a tied edge's distance from its anchor, exp(amount * noise); more makes a glow's top rise in peaks. */
const TIE_MAX = 0.6
/** Transitions wider than this (short-side units) get proportionally less wander; band sky edges are disk blurs up to about 0.6 wide. */
const WIDE_WIDTH = 0.4

interface Edge {
  band: number
  bottom: boolean
  /** Frame heights, 0 top. */
  v: number
  /** 10-90 width, short-side units. */
  width: number
  /** Requested wander, short-side units. */
  wander: number
}

export interface BandBoundary {
  /** BOUNDARY_GLSL's uniforms and uEdgeBnd: per band edge (top, bottom), its transition (-1 none), its distance from the group's anchor (frame heights, 0 or negative), and the amount of the factor on that distance. */
  uniforms: Record<string, number | number[]>
  /** Per band, how far the top and the bottom edge can move (frame heights). */
  move: [number, number][]
  /** Largest softness factor along any edge, before the band's power. */
  softMax: number
}

const cache = new Map<string, BoundaryCalibration>()
const CACHE_SIZE = 32

function calibrated(params: BoundaryParams, aspect: number, seed: number): BoundaryCalibration {
  const key = `${JSON.stringify(params)}|${aspect}|${seed}`
  const hit = cache.get(key)
  if (hit) return hit
  const calibration = calibrateBoundary(params, aspect, seed)
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  cache.set(key, calibration)
  return calibration
}

/** 10-90 width of a disk step of radius 1 mixed with `haze` of a disk three times as wide. */
const diskWidth = (haze: number) => 1.38 * (1 + 2 * haze)

const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/** Luminance of the band stack at height v with hard edges, composited front to back as the shader does. */
function stackLuminance(ctx: RecipeContext, count: number, v: number): number {
  const base = luminance(ctx.colors[0])
  let acc = 0
  let pass = 1
  for (let i = count - 1; i >= 0; i--) {
    const [top, bottom] = ctx.vec(bandKey(i, 'Edges'))
    if (ctx.bool(bandKey(i, 'Line')) || v < top || v >= bottom) continue
    const light = ctx.num(bandKey(i, 'Light'))
    const emit = luminance(ctx.colors[1 + i]) * light
    const mode = Math.round(ctx.num(bandKey(i, 'Mode')))
    const a = mode === MODE_ADD ? 1 : Math.min(1, ctx.num(bandKey(i, 'Opacity')))
    if (mode === MODE_ADD) acc += pass * a * emit
    else if (mode === MODE_MULTIPLY) pass *= 1 - a + (a * emit) / Math.max(base, 1e-4)
    else {
      acc += pass * a * emit
      pass *= 1 - a
    }
  }
  return acc + pass * base
}

/**
 * Moves every band edge with the shared boundary model in edge mode. Edges
 * closer together than the model can keep apart (a glow's top on its
 * horizon, a hard edge and its light line) form a group that is one
 * transition of the model, anchored on its lowest edge. The edges above the
 * anchor keep their distance from it times a slow positive factor sized to
 * their own wander, so a thin glow gets thicker and thinner along the horizon
 * but never crosses it. Each transition gets the contrast of the colors on
 * either side of its anchor, so an edge over a much darker ground is moved as
 * a silhouette edge (long waves, softer crests).
 */
export function bandBoundary(ctx: RecipeContext, count: number): BandBoundary {
  const aspect = ctx.aspect
  const frameH = Math.max(1 / aspect, 1)
  const [share, scale, gain, ly] = ctx.vec('boundaryNoise')
  const [alongAmount, alongScale] = ctx.vec('boundaryAlong')
  const [softAmount, softScale, softLy, softWidth] = ctx.vec('boundarySoft')
  const [featherAmount, featherScale, featherLy] = ctx.vec('boundaryFeather')
  const minGap = ctx.num('boundaryGap')

  const edges: Edge[] = []
  for (let i = 0; i < count; i++) {
    const [top, bottom] = ctx.vec(bandKey(i, 'Edges'))
    const [above, below] = ctx.vec(bandKey(i, 'Soft'))
    const [wanderTop, wanderBottom] = ctx.vec(bandKey(i, 'Wander'))
    const haze = ctx.num(bandKey(i, 'Haze'))
    const seen = (v: number, radius: number) => v > -radius && v < 1 + radius
    if (ctx.bool(bandKey(i, 'Line'))) {
      const v = (top + bottom) / 2
      if (seen(v, above + below)) edges.push({ band: i, bottom: false, v, width: (above + below) * frameH, wander: wanderTop * frameH })
      continue
    }
    if (seen(top, above)) edges.push({ band: i, bottom: false, v: top, width: above * diskWidth(haze) * frameH, wander: wanderTop * frameH })
    if (bottom > top && seen(bottom, below)) edges.push({ band: i, bottom: true, v: bottom, width: below * diskWidth(haze) * frameH, wander: wanderBottom * frameH })
  }
  edges.sort((p, q) => p.v - q.v)

  // Closes in on its neighbour: the gap the model keeps, plus a few standard deviations of their relative move.
  const need = (p: Edge, q: Edge) => (minGap * (p.width + q.width)) / 2 + TIE_SPREAD * Math.hypot(p.wander, q.wander)
  const groups: Edge[][] = []
  for (const edge of edges) {
    const group = groups[groups.length - 1]
    const last = group?.[group.length - 1]
    if (group && ((edge.v - last.v) * frameH < need(last, edge) || groups.length >= BOUNDARY_MAX_TRANSITIONS)) group.push(edge)
    else groups.push([edge])
  }
  const anchorOf = (g: Edge[]) => g[g.length - 1]
  // The factor's amount: the extra wander the edges above the anchor asked for, held so the topmost stays clear of the group above.
  const amounts = groups.map((g, k) => {
    const anchor = anchorOf(g)
    let amount = 0
    for (const e of g.slice(0, -1)) {
      const distance = (anchor.v - e.v) * frameH
      amount = Math.max(amount, Math.sqrt(Math.max(0, e.wander ** 2 - anchor.wander ** 2)) / distance)
    }
    const top = g[0]
    const reach = (anchor.v - top.v) * frameH
    if (k > 0 && reach > 0) {
      const room = (top.v - anchorOf(groups[k - 1]).v) * frameH - need(anchorOf(groups[k - 1]), top)
      amount = room > 0 ? Math.min(amount, Math.log(1 + room / reach) / NOISE_PEAK) : 0
    }
    return Math.min(TIE_MAX, amount)
  })

  const at = (g: Edge[]) => (anchorOf(g).v - 0.5) * frameH
  const contrastOf = (e: Edge) => {
    const reach = e.width / frameH / 2
    return boundaryContrast(stackLuminance(ctx, count, e.v - reach), stackLuminance(ctx, count, e.v + reach))
  }
  const transitions = groups.map((g) => ({ at: at(g), width: anchorOf(g).width, contrast: contrastOf(anchorOf(g)) }))
  const knots = groups.map((g) => [at(g), anchorOf(g).wander] as [number, number])
  while (knots.length > BOUNDARY_MAX_KNOTS) {
    let k = 0
    for (let n = 1; n + 1 < knots.length; n++) if (knots[n + 1][0] - knots[n][0] < knots[k + 1][0] - knots[k][0]) k = n
    knots.splice(k, 2, [(knots[k][0] + knots[k + 1][0]) / 2, (knots[k][1] + knots[k + 1][1]) / 2])
  }
  const params: BoundaryParams = {
    mode: 'edges',
    vertical: 'ramp',
    share,
    scale,
    sharedScale: 1.4 * scale,
    gain,
    ly,
    alongMod: { amount: alongAmount, scale: alongScale },
    soft: { amount: softAmount, scale: softScale, ly: softLy, wRef: softWidth },
    feather: { amount: featherAmount, scale: featherScale, ly: featherLy },
    minGap,
    calWidth: ctx.num('boundaryWindow'),
    wideWidth: WIDE_WIDTH,
    transitions,
    wander: knots,
  }
  const calibration = calibrated(params, aspect, ctx.seed)

  // How far each transition moves across the frame, from the CPU copy of the field.
  const halfW = 0.5 * Math.max(aspect, 1)
  const columns = Array.from({ length: 257 }, (_, k) => -halfW + (2 * halfW * k) / 256)
  const feather = Number((calibration.uniforms.uBndFeather as number[])[0])
  const moves = transitions.map((t, j) => Math.max(...columns.map((a) => Math.abs(calibration.field.edge(a, j)))) * 1.05 + feather * t.width * 3.2)

  const links = Array.from({ length: 2 * BAND_MAX }, () => [-1, 0, 0])
  const move = Array.from({ length: BAND_MAX }, () => [0, 0] as [number, number])
  groups.forEach((g, j) => {
    const anchor = anchorOf(g)
    for (const e of g) {
      const offset = e.v - anchor.v
      const reach = moves[j] / frameH - offset * (Math.exp(NOISE_PEAK * amounts[j]) - 1)
      const ends = ctx.bool(bandKey(e.band, 'Line')) ? [0, 1] : [e.bottom ? 1 : 0]
      for (const end of ends) {
        links[2 * e.band + end] = [j, offset, amounts[j]]
        move[e.band][end] = reach
      }
    }
  })

  return { uniforms: { ...calibration.uniforms, uEdgeBnd: links.flat() }, move, softMax: Math.exp(NOISE_PEAK * softAmount) }
}
