import type { RecipeContext } from '../../scene'
import { BOUNDARY_MAX_TRANSITIONS, boundaryContrast, calibrateBoundary, type BoundaryCalibration, type BoundaryParams } from './boundary'
import { GLOW_LAYERS, RAMP_EDGES } from './ramp-shader'

/** The ramp's uniforms as `uniforms()` builds them, before the boundary model's. */
export type RampUniforms = Record<string, number | number[]>

type Vec3 = [number, number, number]

/** A transition of the boundary model: one of the ramp's stop edges, or where the glow's light rises or deepens. */
export interface RampMark {
  at: number
  width: number
  contrast: number
  /** The ramp edge it is, or -1. */
  edge: number
  /** 0: the glow's upper side, 1: its lower side, -1: neither (a stop edge or the glow's peak). */
  glow: number
}

export interface RampBoundary {
  uniforms: Record<string, number | number[]>
  marks: RampMark[]
  params: BoundaryParams | null
  calibration: BoundaryCalibration | null
}

const RISE_K = 4.394449154672439
const rise = (x: number, width: number) => 1 / (1 + Math.exp(Math.min(60, Math.max(-60, (-RISE_K * x) / Math.max(width, 1e-5)))))
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
const sideFalloff = (d: number, width: number, power: number) => 1 / (1 + Math.pow(Math.abs(d) / Math.max(width, 1e-5), power))
const softExp = (d: number, tau: number) => {
  const t = Math.max(tau, 1e-5)
  const eps = 0.5 * t
  return Math.exp(-(Math.sqrt(d * d + eps * eps) - eps) / t)
}
const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/** The shader's pathRise. */
function pathRise(d: number, tau: number, ease: number): number {
  const t = Math.max(tau, 1e-5)
  const sharp = 1 - Math.exp(-d / t)
  if (ease <= 0) return sharp
  const x = d / (0.413 * t)
  return sharp + (1 - (1 + x) * Math.exp(-x) - sharp) * ease
}

function pathColor(c: Vec3, k: number): Vec3 {
  const m = Math.max(c[0], c[1], c[2])
  if (m <= 0 || k === 0) return c
  const power = 1 + Math.max(k, -0.95)
  return c.map((v) => m * Math.max(v / m, 0.004) ** power) as Vec3
}

const num = (u: RampUniforms, key: string) => Number(u[key])
const list = (u: RampUniforms, key: string) => u[key] as number[]
const rgb = (values: number[], i: number): Vec3 => [values[3 * i], values[3 * i + 1], values[3 * i + 2]]

/** The frame and the ramp's base coordinate, in short-side units from the frame center. */
interface Frame {
  halfW: number
  halfH: number
  sin: number
  cos: number
  anchor: [number, number]
  drop: number
}

function frameOf(u: RampUniforms, aspect: number): Frame {
  const w = Math.max(aspect, 1)
  const h = Math.max(1 / aspect, 1)
  const [ax, ay] = list(u, 'uAnchor')
  const [sin, cos] = list(u, 'uAxis')
  return { halfW: w / 2, halfH: h / 2, sin, cos, anchor: [(ax - 0.5) * w, (ay - 0.5) * h], drop: num(u, 'uDrop') }
}

/** The shader's base coordinate s and the distance across the axis from the anchor. */
function base(f: Frame, x: number, y: number) {
  const dx = x - f.anchor[0]
  const dy = y - f.anchor[1]
  const across = dx * f.cos - dy * f.sin
  return { s: dx * f.sin + dy * f.cos - (f.drop * across * across) / (f.halfW * f.halfW), across }
}

/**
 * Luminance of the sky and the glow at a distance across the axis and a base coordinate, as the
 * shader computes them without noise, the sun glow and the bridge. Only for the contrast of
 * each transition.
 */
function lightLuminance(u: RampUniforms, f: Frame, across: number, s: number): number {
  const edges = num(u, 'uEdges')
  const at = list(u, 'uEdgeAt')
  const width = list(u, 'uEdgeWidth')
  const horizonEdge = num(u, 'uHorizonEdge')
  const level: number[] = []
  let horizon = 0
  for (let j = 0; j < edges; j++) {
    if (j === horizonEdge) horizon = at[j]
    level.push(rise(s - at[j], Math.hypot(width[j], num(u, 'uBlur'))))
  }
  const [sunX, sunY] = list(u, 'uSunAt')
  const sun = base(f, (sunX - 0.5) * 2 * f.halfW, (sunY - 0.5) * 2 * f.halfH)
  const [falloff, widenRate, round] = list(u, 'uLateral')
  const roundFalloff = (d: number, width: number) => sideFalloff(Math.hypot(d, round * width) - round * width, width, falloff)
  const height = Math.max(0, horizon - s)
  const widen = 1 + widenRate * height
  const top = num(u, 'uLightTop')
  const lightReach = top > 0 ? 1 - smoothstep(0.45 * top, top, height) : 1
  const [sunlightWidth, sunlightHeight] = list(u, 'uSunlightShape')
  let sunlit = roundFalloff(across - sun.across, sunlightWidth * widen)
  if (sunlightHeight > 0) sunlit *= Math.exp(-height / sunlightHeight)
  const sunlight = list(u, 'uSunlight')
  const gain = [0, 1, 2].map((i) => 1 + sunlight[i] * sunlit * lightReach)

  const [lateral, glowWidth, shadowHeight] = list(u, 'uGlowSpread')
  const dh = s - horizon - num(u, 'uGlowOffset')
  const side = roundFalloff(across - sun.across, glowWidth * widen)
  let far = 1 - lateral
  if (shadowHeight > 0) far *= 1 - Math.exp(-height / shadowHeight)
  const spread = (far + (1 - far) * side) * lightReach
  const reach = 1 + list(u, 'uGlowVary')[2] * side
  const [down, up, sideDeeper, path0] = list(u, 'uRedden')
  const glowColor = list(u, 'uGlowColor')
  const weight = list(u, 'uGlowWeight')
  const tau = list(u, 'uGlowTau')
  const glow: Vec3 = [0, 0, 0]
  let depth = 0
  for (let k = 0; k < GLOW_LAYERS; k++) {
    if (!(weight[k] > 0)) continue
    const tauUp = tau[2 * k] * reach
    const tauDown = tau[2 * k + 1]
    const amount = spread * weight[k] * softExp(dh, dh < 0 ? tauUp : tauDown)
    const ease = num(u, 'uReddenEase')
    const path = dh > 0 ? down * pathRise(dh, tauDown, ease) : -up * pathRise(-dh, tauUp, ease)
    const c = pathColor(rgb(glowColor, k), path0 + path + sideDeeper * (1 - side))
    for (let i = 0; i < 3; i++) glow[i] += c[i] * amount
    depth += amount
  }
  const [dimAmount, dimHeight] = list(u, 'uHorizonDim')
  let dim = dimAmount * Math.exp(-height / Math.max(dimHeight, 1e-4))
  if (horizonEdge >= 0) dim *= 1 + (num(u, 'uDimBelow') - 1) * level[horizonEdge]
  const stops = list(u, 'uStop')
  const sky: Vec3 = [0, 0, 0]
  for (let k = 0; k <= edges; k++) {
    const w = (k === 0 ? 1 : level[k - 1]) - (k < edges ? level[k] : 0)
    const c = rgb(stops, k)
    for (let i = 0; i < 3; i++) sky[i] += w * c[i]
  }
  const fade = Math.exp(-num(u, 'uExtinction') * depth - dim)
  return luminance(sky.map((v, i) => Math.max(v, 0) * gain[i] * fade + glow[i]))
}

/** Contrast at which the boundary model starts to treat an edge as one over a darker ground. */
const DARK_FROM = 0.3
/**
 * Transitions wider than this (short-side units) get proportionally less wander. The ramp's sky
 * edge is 0.3 to 0.8 wide and should still wander 1.2 to 1.8 % of the short side.
 */
const WIDE_WIDTH = 0.6

const CACHE_SIZE = 32
const cache = new Map<string, BoundaryCalibration>()

function calibrated(params: BoundaryParams, aspect: number, seed: number): BoundaryCalibration {
  const key = `${JSON.stringify(params)}|${aspect}|${seed}`
  const hit = cache.get(key)
  if (hit) return hit
  const calibration = calibrateBoundary(params, aspect, seed)
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  cache.set(key, calibration)
  return calibration
}

const OFF = { uBndOn: 0, uEdgeBnd: Array.from({ length: RAMP_EDGES }, () => -1), uGlowTopBnd: -1 }

/**
 * Moves the ramp's edges and its glow with the shared boundary model, in coordinate mode with
 * the number of transitions passed as the noise row. The transitions are the stop edges plus
 * the glow's upper side and, when the horizon is below the frame, its lower side, where the
 * light deepens toward the horizon. So every edge and every step of the glow gets its own
 * shape, and isolines inside one of them move together. Each transition gets the contrast of
 * the light on its two sides, so a band over a much darker one moves as one piece in long
 * waves. Off (the 1:1 presets' own warp) while `boundaryWander` is all zero.
 */
export function rampBoundary(ctx: RecipeContext, u: RampUniforms): RampBoundary {
  const [wanderSky, wanderGlow, wanderHorizon, wanderGround] = ctx.vec('boundaryWander')
  if (!(Math.max(wanderSky, wanderGlow, wanderHorizon, wanderGround) > 0)) return { uniforms: OFF, marks: [], params: null, calibration: null }
  const [share, scale, gain, ly] = ctx.vec('boundaryNoise')
  const [softAmount, softScale, softLy, softWidth] = ctx.vec('boundarySoft')

  const f = frameOf(u, ctx.aspect)
  let sMin = Infinity
  let sMax = -Infinity
  for (let i = 0; i <= 16; i++) {
    for (let k = 0; k <= 16; k++) {
      const { s } = base(f, -f.halfW + (i / 16) * 2 * f.halfW, -f.halfH + (k / 16) * 2 * f.halfH)
      sMin = Math.min(sMin, s)
      sMax = Math.max(sMax, s)
    }
  }

  const edges = num(u, 'uEdges')
  const at = list(u, 'uEdgeAt')
  const width = list(u, 'uEdgeWidth')
  const horizonEdge = num(u, 'uHorizonEdge')
  const horizon = horizonEdge >= 0 ? at[horizonEdge] : 0
  const glowLine = horizon + num(u, 'uGlowOffset')
  const tau = list(u, 'uGlowTau')
  const marks: Omit<RampMark, 'contrast'>[] = []
  for (let j = 0; j < edges; j++) marks.push({ at: at[j], width: width[j], edge: j, glow: -1 })
  if (list(u, 'uGlowWeight')[0] > 0) {
    marks.push({ at: glowLine - 1.2 * tau[0], width: 1.6 * tau[0], edge: -1, glow: 0 })
    marks.push({ at: glowLine, width: 0.8 * tau[0], edge: -1, glow: -1 })
    const deepens = glowLine + 0.6 * tau[1]
    if (horizonEdge < 0 && deepens < sMax) marks.push({ at: deepens, width: 1.2 * tau[1], edge: -1, glow: 1 })
  }
  // A glow mark on a stop edge adds nothing but a fast change of noise row; marks outside the frame nothing at all.
  const kept = marks
    .filter((m) => m.at + m.width > sMin && m.at - m.width < sMax)
    .filter((m) => m.edge >= 0 || !marks.some((e) => e.edge >= 0 && Math.abs(e.at - m.at) < 0.1 * (e.width + m.width)))
    .sort((p, q) => p.at - q.at)
    .slice(0, BOUNDARY_MAX_TRANSITIONS)

  // Contrast from the light on either side, averaged over the frame's width. The glow's peak is
  // not an edge between two areas. Only the first of consecutive darker steps is an edge over a
  // darker ground; the ones below it are inside that ground, and two such edges close together
  // make the fold guard calm the whole frame.
  const offset = f.anchor[0] * f.cos - f.anchor[1] * f.sin
  const columns = [-0.7, -0.35, 0, 0.35, 0.7].map((c) => c * f.halfW - offset)
  const lumAt = (s: number) => {
    const inFrame = Math.min(sMax, Math.max(sMin, s))
    return columns.reduce((sum, across) => sum + lightLuminance(u, f, across, inFrame), 0) / columns.length
  }
  let ground = false
  const withContrast: RampMark[] = kept.map((m) => {
    const peak = m.edge < 0 && m.glow < 0
    const contrast = peak ? 0 : boundaryContrast(lumAt(m.at - 0.5 * m.width), lumAt(m.at + 0.5 * m.width))
    const first = !ground
    ground ||= contrast >= DARK_FROM
    return { ...m, contrast: first ? contrast : Math.min(contrast, 0) }
  })

  const lowest = withContrast.find((m) => m.glow === 1)
  const knots: [number, number][] = []
  if (edges > 0 && at[0] < horizon) knots.push([at[0], wanderSky])
  knots.push([glowLine, wanderGlow])
  knots.push([horizonEdge >= 0 ? horizon : (lowest?.at ?? sMax), wanderHorizon])
  if (horizonEdge >= 0 && horizonEdge + 1 < edges) knots.push([at[edges - 1], wanderGround])

  const params: BoundaryParams = {
    mode: 'coordinate',
    vertical: 'ramp',
    share,
    scale,
    sharedScale: 1.12 * scale,
    gain,
    ly,
    soft: { amount: softAmount, scale: softScale, ly: softLy, wRef: softWidth },
    wideWidth: WIDE_WIDTH,
    transitions: withContrast.map(({ at: a, width: w, contrast }) => ({ at: a, width: w, contrast })),
    wander: knots,
    range: [sMin, sMax],
  }
  const calibration = calibrated(params, ctx.aspect, ctx.seed)
  const indexOf = (pick: (m: RampMark) => boolean) => withContrast.findIndex(pick)
  const edgeBnd = Array.from({ length: RAMP_EDGES }, (_, j) => indexOf((m) => m.edge === j))
  return {
    uniforms: { ...calibration.uniforms, uBndOn: 1, uEdgeBnd: edgeBnd, uGlowTopBnd: indexOf((m) => m.glow === 0) },
    marks: withContrast,
    params,
    calibration,
  }
}
