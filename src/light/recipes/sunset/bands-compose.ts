import { linearToOklch } from '../../color/oklab'
import { PACKS, type ColorPack } from '../../color/packs'
import { hexToLinear, type Rgb } from '../../color/srgb'
import { toneCurve } from '../../engine/output'
import type { LensSettings, OutputSettings, ParamValue } from '../../scene'
import { isWarm } from './bands-light'
import { BAND_MAX, bandKey, BUMP_MAX, MODE_ADD, MODE_OVER, PATCH_MAX } from './bands-params'

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
  /** The ground when no pack color comes after the glow. */
  fallbackGround: string
  /** The pack's second warm color took the first one's place. */
  swapped: boolean
}

/**
 * Pack order with Meta Blue as the sky and at most one warm color; the
 * brightest of the rest is the horizon glow. With `secondWarm`, a pack with
 * two warm colors (Bold: Yellow, Orange-red) uses the second one instead,
 * and that warm color is the glow: its hot core whitens through yellow near
 * the sun, and the ground under it is the same color at nominal light.
 */
export function bandRoles(pack: ColorPack, secondWarm = false): Roles {
  const [sky, ...rest] = pack.colors.map((c) => c.hex)
  const warms = rest.filter((hex) => isWarm(hexToLinear(hex)))
  const swapped = secondWarm && warms.length > 1
  const warm = swapped ? warms[1] : warms[0]
  const kept = rest.filter((hex) => !isWarm(hexToLinear(hex)) || hex === warm)
  const lightness = (hex: string) => linearToOklch(hexToLinear(hex))[0]
  const glow = swapped ? warm : kept.reduce((a, b) => (lightness(b) > lightness(a) ? b : a), kept[0])
  const at = kept.indexOf(glow)
  return { sky, upper: kept.slice(0, at), glow, ground: kept.slice(at + 1), fallbackGround: swapped ? glow : sky, swapped }
}

type Bump = [x: number, width: number, shift: number]

/** Wiggle each kind of edge should show across the frame, frame heights. */
const WANDER = { sky: 0.01, glow: 0.009, horizon: 0.006, darkHorizon: 0.004, ground: 0.0045, crisp: 0.004 }
/** Every ground band is at least this tall (frame heights), so it reads as a band of its own color. */
const MIN_SPAN = 0.15
/** A band much darker or much lighter than the bands on both sides is taller, so it reads as a band of its own color instead of a seam. */
const STAND_SPAN = 0.25
/** Softest-edge floor: the 10-90 width of a disk edge is 1.38 radii, so no edge is under about 4% of the frame height. */
const MIN_RADIUS = 0.03
/** Slow light change inside flat areas: amount (RMS share), lattice along and down (short-side units). */
const LIGHT_VARY = [0.02, 0.45, 0.35]

/** Every order-kept, non-empty selection of the list. */
function selections<T>(list: readonly T[]): T[][] {
  const out: T[][] = []
  for (let mask = 1; mask < 1 << list.length; mask++) out.push(list.filter((_, i) => mask & (1 << i)))
  return out
}

/** soft: blurred hard, free to wave. crisp: nearly hard, small drift, softness changes a lot along it. sky: very soft and slow. */
type EdgeKind = 'soft' | 'crisp' | 'sky'

/** A band from its top edge down to below the frame. */
interface BandPlan {
  color: string
  /** Frame heights. */
  top: number
  topRadius: number
  edge: EdgeKind
  light?: number
  opacity?: number
  haze?: number
  pale?: number
  sunLight?: number
  sunCover?: number
  /** Share of the light above nominal at the top edge, depth where it is full (frame heights). */
  lightDown?: [number, number]
  bumps?: Bump[]
}

/**
 * A pack scene for sunset.bands: Meta Blue sky on top, the colors in pack
 * order below it, a wide glow band above the horizon that whitens near the
 * sun and falls off sideways, and the later colors filling the ground, each
 * band tall enough to reach its own color. Each band is a layer from its top
 * edge down, painted over the one above, so a crossing mixes two colors.
 * Light changes slowly inside flat parts, with the exact pack hex at their
 * mean at the default intensity. The seed picks the colors used, the spacing,
 * the sun's side, the glow's shape, which edge is crisp and the shape of every
 * edge; the room under the horizon decides how many ground bands fit.
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

  // Structure: seed and frame only. About a third of seeds use the pack's second warm color.
  const roles = bandRoles(pack, random(seed * 6151 + 29).chance(1 / 3))
  // The upper colors always show: with them every frame has at least three bands, never one stroke of light on the sky.
  const upper = roles.upper
  // The seed's choice among the ground colors that fit under the horizon (below): usually one of the longest.
  const shorter = pick.chance(0.35) ? 1 : 0
  const groundPick = pick.next()
  const sunRight = pick.chance(0.5)
  const sunOff = pick.chance(0.2)
  const aureole = pick.chance(0.7)
  const crispPick = pick.next()

  // Placement: seed and controls.
  const radius = geo(softness, 0.03, 0.07, 0.16) * H ** -0.3
  const crispRadius = place.between(0.012, 0.022) * geo(softness, 0.7, 1, 1.6)
  const horizon = clamp(lerp(0.85, 0.35, horizonControl) + place.between(-0.12, 0.12), 0.3, 0.9)
  // The glow is a wide band: about a tenth of the frame tall away from the sun, taller under it.
  const glowFar = place.between(0.1, 0.14)
  const glowNear = glowFar + place.between(0.04, 0.09) * geo(softness, 0.8, 1, 1.35)
  const glowTop = horizon - glowFar
  // Over a ground of the glow's own color the horizon is only a change of light, and crisper; never under the floor.
  const horizonRadius = Math.max(MIN_RADIUS, radius * place.between(0.55, 0.85) * (roles.swapped ? 0.6 : 1))

  // Every ground band reads as a band of its own color, so the room under the horizon holds as many as fit, in
  // pack order. A band much darker or much lighter than both neighbours needs more room; where it does not fit,
  // the seed picks among the colors that do, and neighbours meet through a bridge instead of a seam.
  const lightness = (hex: string) => linearToOklch(hexToLinear(hex))[0]
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
  const groundRoom = 1.04 - horizon
  const standsOut = (list: string[], k: number) => {
    if (k + 1 >= list.length) return false
    const own = lightness(list[k])
    const above = lightness(k === 0 ? roles.glow : list[k - 1])
    const below = lightness(list[k + 1])
    return Math.min(above, below) - own > 0.2 || own - Math.max(above, below) > 0.2
  }
  const floors = (list: string[]) => list.map((_, k) => (standsOut(list, k) ? STAND_SPAN : MIN_SPAN))
  const fitting = selections(roles.ground).filter((list) => list.length === 1 || sum(floors(list)) <= groundRoom)
  const most = Math.max(0, ...fitting.map((list) => list.length))
  const pool = fitting.filter((list) => list.length >= most - shorter)
  const ground = pool.length > 0 ? pool[Math.floor(groundPick * pool.length)] : [roles.fallbackGround]
  // A crisp edge only between two ground colors of similar lightness.
  const crispable = ground.map((color, k) => k > 0 && Math.abs(lightness(color) - lightness(ground[k - 1])) < 0.2)
  const crispGround = crispable.some(Boolean) && crispPick < 0.45 ? crispable.indexOf(true) : -1
  const sunX = sunOff ? (sunRight ? 1.12 : -0.12) : sunRight ? place.between(0.62, 0.92) : place.between(0.08, 0.38)
  const sunWidth = place.between(0.5, 0.85) / W

  // Intensity is daylight: every band gets the same gain. The glow's far end
  // keeps its pack color (its gain stops where the color would go white), so
  // only the part near the sun whitens.
  const daylight = geo(intensity, 0.72, 1, 1.6)
  const glowColor = hexToLinear(roles.glow)
  const room = headroom(glowColor)
  const far = Math.min(daylight, Math.max(1, 0.85 * room)) / daylight
  const peak = clamp(1.15 * room, 1.05, 3) * Math.min(1, geo(intensity, 0.72, 1, 1.4) / daylight)
  const sunCover = place.between(0.3, 0.55)
  const farthest = Math.max(Math.abs(sunX), Math.abs(1 - sunX))
  const sunFar = 1 / (1 + (farthest / sunWidth) ** 1.6)
  const sunLight = clamp((1 - far / Math.max(peak, far)) / (1 - sunFar), 0, 1)

  // Edge widths differ a lot down the frame: wide sky edges, a narrower glow top and horizon.
  const plans: BandPlan[] = []
  let upperTop = 0.06
  for (const color of upper) {
    upperTop = lerp(upperTop, glowTop, place.between(0.15, 0.5))
    plans.push({ color, top: upperTop, topRadius: radius * place.between(2.6, 3.6) * (roles.swapped ? 1.2 : 1), edge: 'sky', pale: 0.5 })
  }
  const glowBump: Bump = [sunX, Math.min(1, sunWidth * place.between(1.2, 1.8)), -(glowNear - glowFar)]
  // The second warm color's glow sits right under the upper colors' wide edge, so its own top is crisper.
  // The light above nominal grows toward the horizon, so the glow keeps its pack color in its upper part
  // and whitens only low down near the sun.
  plans.push({
    color: roles.glow,
    top: glowTop,
    topRadius: Math.max(MIN_RADIUS, radius * (roles.swapped ? place.between(0.4, 0.55) : place.between(1.1, 1.6))),
    edge: 'soft',
    light: Math.max(peak, far),
    haze: lerp(0.1, 0.25, softness) * (roles.swapped ? 0.35 : 1),
    pale: 0.45,
    sunLight,
    sunCover,
    lightDown: [0.15, glowFar],
    bumps: [glowBump],
  })
  const horizonIndex = plans.length
  // Spans fill the room in proportion to the seed's weights, never under each band's floor.
  const floor = floors(ground)
  const weights = ground.map(() => place.between(0.75, 1.3))
  const extra = Math.max(0, groundRoom - sum(floor))
  const spans = floor.map((f, k) => f + (extra * weights[k]) / sum(weights))
  let at = horizon
  ground.forEach((color, k) => {
    const crisp = k === crispGround
    // A band's top edge never eats much of the bands on either side, so both reach their own color.
    const room = 0.3 * Math.min(spans[k], k > 0 ? spans[k - 1] : Infinity)
    const r = k === 0 ? horizonRadius : crisp ? crispRadius : Math.max(MIN_RADIUS, Math.min(radius * place.between(0.9, 2), room))
    // Light the glow reflects onto the first ground band, strongest under the sun; nominal far from it.
    const lit = k === 0 ? place.between(1.1, 1.3) : 1
    const litSun = k === 0 ? clamp((1 - 1 / lit) / (1 - sunFar), 0, 1) : 0
    plans.push({ color, top: at, topRadius: r, edge: crisp ? 'crisp' : 'soft', light: lit, sunLight: litSun, pale: k === 0 ? 0.4 : 0 })
    at += spans[k]
  })

  // A patch of sky light added above the glow on the sun's side.
  const patches: { color: string; shape: number[]; look: number[] }[] = []
  if (aureole) {
    patches.push({
      color: roles.sky,
      shape: [clamp(sunX, 0.05, 0.95), glowTop - place.between(0.1, 0.22) / H, Math.min(2, sunWidth * place.between(1, 1.8)), place.between(0.08, 0.16) / H],
      look: [1, place.between(0.2, 0.4), MODE_ADD],
    })
  }

  // Organic edges: the boundary model moves every edge, sky edges more than ground edges, and changes
  // its softness along it. Every edge but the horizon also leans and bows by its own amount, so
  // neighbouring edges are not parallel and each band gets thicker and thinner along its length; the
  // horizon stays level, so a ground never slopes up like a hillside. Wander is the wiggle the frame
  // should show (frame heights). A narrow frame shows less of the pattern across it, so edges ask for
  // more there, except the horizon: it keeps a landscape's wander in short-side units, so a tall frame
  // shows the calmer middle of the same horizon. Softer edges also wander a little more.
  const waviness = shape.between(0.8, 1.25)
  const lean = shape.between(-0.03, 0.03)
  const shown = clamp(0.48 + 0.22 * W, 0.7, 0.9)
  const wanderScale = waviness * Math.sqrt(geo(softness, 0.03, 0.07, 0.16) / 0.07)
  const used = plans.slice(0, BAND_MAX)
  // A horizon over a much darker ground stays calmer, so it never reads as a hill line.
  const luminance = (hex: string) => {
    const [r, g, b] = hexToLinear(hex)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const darkGround = 1 - luminance(ground[0]) / Math.max(luminance(roles.glow), 1e-6) > 0.5
  const wanderOf = (plan: BandPlan, i: number) => {
    if (plan.edge === 'sky') return WANDER.sky / shown
    if (i === horizonIndex - 1) return WANDER.glow / shown
    if (i === horizonIndex) return (darkGround ? WANDER.darkHorizon : WANDER.horizon) / (0.87 * H)
    return (plan.edge === 'crisp' ? WANDER.crisp : WANDER.ground) / shown
  }
  // How far each edge leans and bows: the glow's top most, since its soft fade would otherwise sit a fixed
  // height above the level horizon; then sky and ground edges, the horizon not at all.
  const bendOf = (plan: BandPlan, i: number) => (i === horizonIndex ? 0 : i === horizonIndex - 1 ? 1.6 : 1)
  // The glow's top fades far up into the sky; softness that changed along it would make that fade rise in peaks.
  const shapes = used.map((plan, i) => {
    const bend = bendOf(plan, i)
    const bow: Bump = [shape.between(0.2, 0.8), shape.between(0.45, 0.85), (shape.between(-0.03, 0.03) * bend) / H]
    // Ground edges lean only half as much, so a ground never slopes up to one side like a hillside.
    const leanShare = i > horizonIndex ? 0.5 : 1
    return {
      wander: wanderOf(plan, i) * wanderScale,
      tilt: (((lean * shape.between(0.4, 1.4) + shape.between(-0.025, 0.025)) * W) / H) * bend * leanShare,
      softVary: i === horizonIndex - 1 ? shape.between(0.15, 0.3) : plan.edge === 'crisp' ? shape.between(1, 1.3) : shape.between(0.8, 1.2),
      bumps: bend > 0 ? [...(plan.bumps ?? []), bow] : (plan.bumps ?? []),
    }
  })

  const params: Record<string, ParamValue> = {}
  const colors = [roles.sky]
  used.forEach((plan, i) => {
    const key = (name: Parameters<typeof bandKey>[1]) => bandKey(i, name)
    const own = shapes[i]
    const bumps = own.bumps.slice(0, BUMP_MAX)
    colors.push(plan.color)
    params[key('Edges')] = [plan.top, 2]
    params[key('Soft')] = [plan.topRadius, 0.05]
    params[key('Opacity')] = plan.opacity ?? 1
    params[key('Light')] = plan.light ?? 1
    params[key('Mode')] = MODE_OVER
    params[key('Line')] = false
    params[key('Wander')] = [own.wander, own.wander]
    params[key('SoftVary')] = own.softVary
    params[key('Tilt')] = [own.tilt, 0, 0]
    params[key('Sun')] = [plan.sunLight ?? 0, plan.sunCover ?? 0]
    params[key('Haze')] = plan.haze ?? 0
    params[key('Pale')] = plan.pale ?? 0
    params[key('LightDown')] = plan.lightDown ?? [1, 0]
    params[key('BumpAt')] = padded(bumps.map((b) => b[0]), 0.5)
    params[key('BumpWidth')] = padded(bumps.map((b) => b[1]), 0)
    params[key('BumpTop')] = padded(bumps.map((b) => b[2]), 0)
    params[key('BumpBottom')] = padded([], 0)
    params[key('BumpCover')] = padded([], 0)
    params[key('BumpLight')] = padded([], 0)
  })
  while (colors.length < 1 + BAND_MAX) colors.push(roles.sky)
  patches.forEach((patch, j) => {
    colors.push(patch.color)
    params[`patch${j + 1}Shape`] = patch.shape
    params[`patch${j + 1}Look`] = patch.look
  })
  while (colors.length < 1 + BAND_MAX + PATCH_MAX) colors.push(roles.sky)

  params.bands = used.length
  params.patches = patches.length
  params.intensity = daylight
  params.sun = [sunX, sunWidth]
  params.bridge = 1
  params.deepen = 0.8
  params.rounding = 0.1
  params.shade = [0, 0]
  params.ink = 0
  // About the same number of waves across every format: a shorter noise lattice in narrow frames.
  params.boundaryNoise = [0.15, 0.3 * Math.sqrt(W), 0.25, 1]
  params.lightVary = LIGHT_VARY

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
