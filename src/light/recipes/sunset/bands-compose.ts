import { linearToOklch } from '../../color/oklab'
import { PACKS, type ColorPack } from '../../color/packs'
import { hexToLinear, type Rgb } from '../../color/srgb'
import { toneCurve } from '../../engine/output'
import type { LensSettings, OutputSettings, ParamValue } from '../../scene'
import { isWarm } from './bands-light'
import { BAND_MAX, bandKey, BUMP_MAX, MODE_OVER, PATCH_MAX } from './bands-params'

export interface BandsComposeInput {
  /** null takes the first pack. */
  pack: ColorPack | null
  seed: number
  /** Frame width / height. */
  aspect: number
  /** The three tool controls, 0..1. */
  intensity?: number
  softness?: number
  horizon?: number
}

export interface BandsComposition {
  colors: string[]
  params: Record<string, ParamValue>
  lens: Partial<LensSettings>
  output: Partial<OutputSettings>
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Piecewise geometric through (0, lo), (0.5, mid), (1, hi). */
function geo(t: number, lo: number, mid: number, hi: number): number {
  const u = clamp(t, 0, 1)
  return u < 0.5 ? lo * (mid / lo) ** (u * 2) : mid * (hi / mid) ** ((u - 0.5) * 2)
}

interface Random {
  next(): number
  between(a: number, b: number): number
  chance(p: number): boolean
}

/** mulberry32 */
function random(seed: number): Random {
  let a = (Math.imul(seed | 0, 0x9e3779b1) ^ 0x5bd1e995) >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { next, between: (lo, hi) => lerp(lo, hi, next()), chance: (p) => next() < p }
}

/** Light level (times nominal) at which a color reads nearly white after the tone curve (Oklab L 0.95). */
export function headroom(color: Rgb): number {
  const lightness = (k: number) => linearToOklch(toneCurve(color.map((v) => v * k)))[0]
  let lo = 0.05
  let hi = 16
  if (lightness(hi) < 0.95) return hi
  for (let i = 0; i < 40; i++) {
    const k = Math.sqrt(lo * hi)
    if (lightness(k) >= 0.95) hi = k
    else lo = k
  }
  return Math.sqrt(lo * hi)
}

interface Roles {
  sky: string
  upper: string[]
  glow: string
  ground: string[]
}

/** Pack order with Meta Blue as the sky and at most one warm color; the brightest of the rest is the horizon glow. */
export function bandRoles(pack: ColorPack): Roles {
  const [sky, ...rest] = pack.colors.map((c) => c.hex)
  let warm = false
  const kept = rest.filter((hex) => {
    if (!isWarm(hexToLinear(hex))) return true
    if (warm) return false
    warm = true
    return true
  })
  const lightness = (hex: string) => linearToOklch(hexToLinear(hex))[0]
  const glow = kept.reduce((a, b) => (lightness(b) > lightness(a) ? b : a), kept[0])
  const at = kept.indexOf(glow)
  return { sky, upper: kept.slice(0, at), glow, ground: kept.slice(at + 1) }
}

type Bump = [x: number, width: number, shift: number]

/** soft: blurred hard, free to wave. crisp: nearly hard, small drift, softness changes a lot along it. sky: very soft and slow. */
type EdgeKind = 'soft' | 'crisp' | 'sky'

interface BandPlan {
  color: string
  /** Frame heights. */
  top: number
  topRadius: number
  bottom?: number
  bottomRadius?: number
  edge: EdgeKind
  light?: number
  opacity?: number
  line?: boolean
  haze?: number
  pale?: number
  sunLight?: number
  sunCover?: number
  bumps?: Bump[]
  /** Light bumps along the band: x, width (frame widths), gain. */
  lightBumps?: Bump[]
  /** Copies the edge shape of this band (by plan index). */
  follows?: number
}

/**
 * A pack scene for sunset.bands: Meta Blue sky on top, the colors in pack
 * order below it, a thin glow just above the horizon that whitens near the
 * sun and falls off sideways, and the later colors filling the ground. Each
 * band is a layer from its top edge down, painted over the one above, so a
 * crossing mixes two colors. The seed picks the colors used, the spacing,
 * the sun's side, which edge is crisp and the shape of every edge. Which
 * bands exist depends only on the pack, the seed and the frame.
 */
export function composeBands(input: BandsComposeInput): BandsComposition {
  const pack = input.pack ?? PACKS[0]
  const intensity = input.intensity ?? 0.5
  const softness = input.softness ?? 0.5
  const horizonControl = input.horizon ?? 0.5
  const aspect = clamp(input.aspect, 0.25, 4)
  const seed = Math.round(input.seed)
  const pick = random(seed * 7919 + 17)
  const place = random(seed * 104729 + 3)
  const shape = random(seed * 15485863 + 11)

  // Frame size in short-side units, to keep edge shapes the same size in every format.
  const W = Math.max(aspect, 1)
  const H = Math.max(1 / aspect, 1)

  // Structure: seed and frame only.
  const roles = bandRoles(pack)
  const upper = roles.upper.filter(() => pick.chance(0.8))
  let ground = roles.ground.filter((_, i) => i === 0 || pick.chance(H > 1.2 ? 0.8 : 0.65))
  if (ground.length > 2 && W > 1.5 && pick.chance(0.5)) ground = ground.slice(0, 2)
  const zenith = pick.chance(0.55)
  const crispPick = pick.next()
  const crispHorizon = crispPick < 0.2
  const crispGround = !crispHorizon && crispPick < 0.4 && ground.length > 1 ? 1 + Math.floor(pick.next() * (ground.length - 1)) : -1
  const rimLine = crispHorizon && pick.chance(0.5)
  const sunRight = pick.chance(0.5)
  const sunOff = pick.chance(0.2)

  // Placement: seed and controls.
  const radius = geo(softness, 0.03, 0.07, 0.16) * H ** -0.3
  const crispRadius = place.between(0.012, 0.022) * geo(softness, 0.7, 1, 1.6)
  const horizon = clamp(lerp(0.85, 0.35, horizonControl) + place.between(-0.08, 0.08), 0.2, 0.9)
  // The glow is thickest under the sun and thins to a line far from it.
  const glowFar = place.between(0.008, 0.025) / H
  const glowNear = (place.between(0.05, 0.11) * geo(softness, 0.8, 1, 1.35)) / H
  const glowTop = horizon - glowFar
  const horizonRadius = crispHorizon ? crispRadius : radius * place.between(0.4, 0.9)
  const sunX = sunOff ? (sunRight ? 1.12 : -0.12) : sunRight ? place.between(0.62, 0.92) : place.between(0.08, 0.38)
  const sunWidth = place.between(0.5, 0.85) / W

  // Intensity is daylight: every band gets the same gain, except that the glow
  // gains less above the default so only the part near the sun goes white.
  const daylight = geo(intensity, 0.62, 1, 1.9)
  const glowGain = geo(intensity, 0.62, 1, 1.4) / daylight
  const glowColor = hexToLinear(roles.glow)
  const room = headroom(glowColor)
  const peak = clamp(1.15 * room, 1.05, 2.2)
  const far = clamp((0.9 * room) / 1.4, 0.45, 0.95)
  const sunCover = place.between(0.3, 0.55)
  const farthest = Math.max(Math.abs(sunX), Math.abs(1 - sunX))
  const sunFar = 1 / (1 + (farthest / sunWidth) ** 1.6)
  const sunLight = clamp((1 - far / peak) / (1 - sunFar), 0, 1)

  const plans: BandPlan[] = []
  const skyTop = zenith ? clamp(place.between(0.1, 0.28), 0.04, Math.max(0.05, glowTop * 0.6)) : 0
  if (zenith) {
    plans.push({
      color: roles.sky,
      top: -1,
      topRadius: 0.01,
      bottom: skyTop,
      bottomRadius: Math.min(0.6, radius * place.between(2.5, 4)),
      edge: 'sky',
      light: place.between(0.7, 0.85),
    })
  }
  let upperTop = Math.max(skyTop, 0.06)
  for (const color of upper) {
    upperTop = lerp(upperTop, glowTop, place.between(0.15, 0.5))
    plans.push({ color, top: upperTop, topRadius: radius * place.between(1.8, 2.8), edge: 'sky', pale: 0.5 })
  }
  plans.push({
    color: roles.glow,
    top: glowTop,
    topRadius: radius * place.between(1.1, 1.8),
    edge: 'soft',
    light: peak * glowGain,
    haze: lerp(0.15, 0.4, softness),
    pale: 0.7,
    sunLight,
    sunCover,
    bumps: [[sunX, Math.min(1, sunWidth * place.between(0.9, 1.5)), -(glowNear - glowFar)]],
  })
  const horizonIndex = plans.length
  const spans = ground.map(() => place.between(0.6, 1.4))
  const total = spans.reduce((a, b) => a + b, 0)
  let at = horizon
  ground.forEach((color, k) => {
    const crisp = k === 0 ? crispHorizon : k === crispGround
    const r = k === 0 ? horizonRadius : crisp ? crispRadius : radius * place.between(1, 2.2)
    const lightBumps: Bump[] = [[place.between(0.1, 0.9), place.between(0.3, 0.7), place.between(-0.25, 0.25)]]
    // Light the glow reflects onto the first ground band, strongest under the sun; nominal far from it.
    const lit = k === 0 ? place.between(1.1, 1.3) : 1
    const litSun = k === 0 ? clamp((1 - 1 / lit) / (1 - sunFar), 0, 1) : 0
    plans.push({ color, top: at, topRadius: r, edge: crisp ? 'crisp' : 'soft', light: lit, sunLight: litSun, lightBumps })
    at += ((1.04 - horizon) * spans[k]) / total
  })
  if (ground.length === 0) {
    // No later pack color: the ground is the sky's own light, dimmer, and dimmer again lower down.
    const lower = lerp(horizon, 1, place.between(0.35, 0.65))
    plans.push({ color: roles.sky, top: horizon, topRadius: horizonRadius, edge: crispHorizon ? 'crisp' : 'soft', light: place.between(0.5, 0.65) })
    plans.push({ color: roles.sky, top: lower, topRadius: radius * place.between(1.2, 2.4), edge: 'soft', light: place.between(0.28, 0.4) })
  }
  if (rimLine && plans.length < BAND_MAX) {
    plans.push({
      color: roles.glow,
      top: horizon - 0.002,
      topRadius: place.between(0.002, 0.004),
      bottom: horizon + 0.002,
      bottomRadius: 0.002,
      edge: 'crisp',
      line: true,
      light: peak * glowGain,
      opacity: place.between(0.5, 0.8),
      sunCover: 1,
      follows: horizonIndex,
    })
  }

  // Organic edges: every edge gets its own warp, tilt and bumps, sized in short-side units.
  // The whole stack also leans and bows a little, each edge by its own amount, so edges are never parallel.
  const waviness = shape.between(0.7, 1.5)
  const lean = shape.between(-0.06, 0.06)
  const bow: Bump = [shape.between(0.2, 0.8), shape.between(0.35, 0.7), shape.between(-0.06, 0.06)]
  const used = plans.slice(0, BAND_MAX)
  const shares = used.map(() => shape.between(0.4, 1.4))
  // The glow sits on the horizon, so the two lean and bow together.
  shares[horizonIndex] = shares[horizonIndex - 1]
  const shapes = used.map((plan, i) => {
    const scale = plan.edge === 'crisp' ? 0.55 : plan.edge === 'sky' ? 1.3 : 1
    const share = shares[i]
    const bumps: Bump[] = [...(plan.bumps ?? []), [bow[0], Math.min(1, bow[1] * Math.sqrt(H / W)), (bow[2] * share) / H]]
    const extra = 1 + Math.floor(shape.next() * 2)
    const room = BUMP_MAX - (plan.lightBumps?.length ?? 0)
    for (let b = 0; b < extra && bumps.length < room; b++) {
      bumps.push([shape.between(0.05, 0.95), Math.min(1, shape.between(0.2, 0.55) / W), (shape.between(-0.035, 0.035) * waviness * scale) / H])
    }
    return {
      amplitude: (shape.between(0.012, 0.032) * waviness * scale) / H,
      waves: W / (shape.between(0.7, 1.8) * (plan.edge === 'sky' ? 1.5 : 1)),
      tilt: ((lean * share + shape.between(-0.03, 0.03)) * W) / H,
      vary: plan.edge === 'crisp' ? shape.between(0.7, 1.1) : shape.between(0.3, 0.6),
      bumps,
    }
  })

  const params: Record<string, ParamValue> = {}
  const colors = [roles.sky]
  used.forEach((plan, i) => {
    const key = (name: Parameters<typeof bandKey>[1]) => bandKey(i, name)
    const own = shapes[plan.follows ?? i]
    const lightBumps = plan.lightBumps ?? []
    const bumps = own.bumps.slice(0, BUMP_MAX - lightBumps.length)
    colors.push(plan.color)
    params[key('Edges')] = [plan.top, plan.bottom ?? 2]
    params[key('Soft')] = [plan.topRadius, plan.bottomRadius ?? 0.05]
    params[key('Opacity')] = plan.opacity ?? 1
    params[key('Light')] = plan.light ?? 1
    params[key('Mode')] = MODE_OVER
    params[key('Line')] = plan.line ?? false
    params[key('Warp')] = [own.amplitude, plan.bottom !== undefined && plan.follows === undefined ? own.amplitude * 0.6 : 0]
    params[key('Waves')] = own.waves
    params[key('Vary')] = [plan.line ? 0 : own.vary, 0]
    params[key('Tilt')] = [own.tilt, 0, 0]
    params[key('Sun')] = [plan.sunLight ?? 0, plan.sunCover ?? 0]
    params[key('Haze')] = plan.haze ?? 0
    params[key('Pale')] = plan.pale ?? 0
    params[key('Noise')] = plan.follows ?? i
    params[key('BumpAt')] = padded([...bumps.map((b) => b[0]), ...lightBumps.map((b) => b[0])], 0.5)
    params[key('BumpWidth')] = padded([...bumps.map((b) => b[1]), ...lightBumps.map((b) => b[1])], 0)
    params[key('BumpTop')] = padded(bumps.map((b) => b[2]), 0)
    params[key('BumpBottom')] = padded([], 0)
    params[key('BumpCover')] = padded([], 0)
    params[key('BumpLight')] = padded([...bumps.map(() => 0), ...lightBumps.map((b) => b[2])], 0)
  })
  while (colors.length < 1 + BAND_MAX + PATCH_MAX) colors.push(roles.sky)

  params.bands = used.length
  params.patches = 0
  params.intensity = daylight
  params.sun = [sunX, sunWidth]
  params.bridge = 1
  params.deepen = 1.2
  params.rounding = 0.1
  params.shade = [0, 0]
  params.ink = 0

  return {
    colors,
    params,
    lens: { bloom: 0, halation: 0 },
    output: { grain: 0, exposure: 0 },
  }
}

function padded(values: number[], fill: number): number[] {
  return Array.from({ length: BUMP_MAX }, (_, i) => values[i] ?? fill)
}
