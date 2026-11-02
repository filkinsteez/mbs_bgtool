import { linearToOklch } from '../../color/oklab'
import type { Rgb } from '../../color/srgb'

/** Color slots of sunset.blooms. `deep1` and `deep2` are the colors the sky deepens toward, `light1` and `light2` the glow colors. */
export const SLOT = { sky: 0, deep1: 1, deep2: 2, light1: 3, light2: 4 } as const
export const SLOT_COUNT = 5
export const GLOW_COUNT = 4

/** One glow. Positions are frame fractions (outside 0..1 is off-frame); sizes are in units of sqrt(width * height). */
export interface GlowSpec {
  color: number
  at: [number, number]
  radius: number
  /** Width over height. */
  aniso: number
  /** Tilt of the long axis in degrees; positive descends to the right. */
  angle: number
  /** 1 gives the slot color at the glow's center. */
  gain: number
  /** Falloff exponent; lower gives a longer tail. */
  beta: number
  /** How much this glow's haze hides the sky near its center. A glow with none sits behind the others' haze. */
  haze: number
  /** How much the glow's reach and falloff change along its edge, 0..1. */
  vary: number
  /** How much the long axis bows: positive lowers both ends, so the light is highest above its source. */
  bend: number
}

/** Where and how strongly the sky deepens toward a deep color. Its radius is in units of the frame's short side. */
export interface ZenithSpec {
  color: number
  at: [number, number]
  radius: number
  aniso: number
  angle: number
  /** Share of the deep color at the center of the darkening, 0..1. */
  amount: number
  /** Falloff exponent; lower spreads the darkening further. */
  falloff: number
}

export interface BloomsLayout {
  glows: GlowSpec[]
  zenith: ZenithSpec
  /** Domain warp: amount in units of sqrt(width * height), and frequency in cycles per unit. */
  warp: number
  warpScale: number
  /** Multiplies the solved bridge light between each glow and the sky. */
  bridge: number
}

/** The tool's three controls, 0..1. `rise` is the mood control (Horizon): how high the light rises. */
export interface BloomsControls {
  intensity: number
  softness: number
  rise: number
}

const LUMA: Rgb = [0.2126, 0.7152, 0.0722]
const luminance = (c: readonly number[]) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2]
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Warm light: oranges through yellows with real chroma (Yellow, Tan, Orange-red; not Lime, Cyan or Ice). */
export function isWarm(c: Rgb): boolean {
  const [, chroma, hue] = linearToOklch(c)
  return chroma > 0.04 && hue >= 25 && hue <= 105
}

/**
 * Gain that puts every light color's center at the same luminance. Cyan then
 * sits a little above max channel 1 at its center, so the brightest part of
 * a cyan glow is also its palest. Green-yellow light has no match in a sky,
 * so it is brighter (paler) at its center and the composer keeps it smaller.
 */
export function lightGain(c: Rgb): number {
  const y = luminance(c)
  if (y <= 1e-6) return 0
  return clamp((isGreen(c) ? 0.8 : 0.62) / y, 0.5, 2.2)
}

/** Lime-like light: chroma with a hue between yellow and cyan. */
export function isGreen(c: Rgb): boolean {
  const [, chroma, hue] = linearToOklch(c)
  return chroma > 0.04 && hue > 105 && hue < 200
}

function hashSeed(seed: number): number {
  let h = Math.imul((seed | 0) ^ 0x5bd1e995, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return (h ^ (h >>> 16)) >>> 0
}

/** mulberry32; consecutive seeds are hashed first so their first draws are unrelated. */
export function random(seed: number): () => number {
  let t = hashSeed(seed)
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(options: readonly (readonly [T, number])[], u: number): T {
  let acc = 0
  for (const [value, weight] of options) {
    acc += weight
    if (u < acc) return value
  }
  return options[options.length - 1][0]
}

type Kind = 'low' | 'corner' | 'side' | 'pair'

/** Longest half-length of the lead glow, in units of sqrt(width * height) (a 16:9 frame is 1.33 wide). */
const LEAD_MAX_LONG_RADIUS = 1.15

const KINDS: readonly (readonly [Kind, number])[] = [
  ['low', 0.22],
  ['corner', 0.3],
  ['side', 0.3],
  ['pair', 0.18],
]

/**
 * Which light slot leads: the warm light more often than not; with no warm
 * light, the lighter one. Green-yellow light leads less often (it has no
 * match in a sky).
 */
function pickLead(colors: readonly Rgb[], u: number): { lead: number; other: number } {
  const a = SLOT.light1
  const b = SLOT.light2
  const warmA = isWarm(colors[a])
  const warmB = isWarm(colors[b])
  if (warmA !== warmB) {
    const warm = warmA ? a : b
    const cool = warmA ? b : a
    const coolOdds = isGreen(colors[cool]) ? 0.3 : 0.45
    return u < 1 - coolOdds ? { lead: warm, other: cool } : { lead: cool, other: warm }
  }
  const lighter = luminance(colors[a]) >= luminance(colors[b]) ? a : b
  const darker = lighter === a ? b : a
  return u < 0.6 ? { lead: lighter, other: darker } : { lead: darker, other: lighter }
}

/**
 * The pack composition: one dominant light from off-frame (below the bottom
 * edge, beyond a lower corner, or beyond a side), up to three more glows on
 * the same horizon (a smaller lobe of the same light, a second light of the
 * same color on the other side, a weaker light of the other color or a paler
 * patch of sky at the far edge), and the sky deepening in the corner away
 * from the light. Seeds pick the kind, side, height, sizes, glow count and
 * which light leads; Softness widens and softens; Rise lifts the light.
 * A cool lead never gets a warm light on the far side: that would be a
 * second light direction.
 */
export function composeLayout(colors: readonly Rgb[], seed: number, controls: BloomsControls): BloomsLayout {
  const r = random(seed)
  const soft = clamp(controls.softness, 0, 1)
  const rise = clamp(controls.rise, 0, 1)
  const kind = pick(KINDS, r())
  const side = r() < 0.5 ? -1 : 1
  const { lead, other } = pickLead(colors, r())

  // Softness changes how the light falls off, not how far it reaches: the radius is scaled so the
  // half-brightness extent stays put while the tail gets longer. Rise lifts and widens the light.
  const beta = lerp(3.0, 1.6, soft)
  const sameHalfWidth = Math.sqrt(2 ** (1 / 2.2) - 1) / Math.sqrt(2 ** (1 / beta) - 1)
  const size = lerp(0.8, 1.2, r()) * lerp(0.95, 1.08, soft) * sameHalfWidth * lerp(0.88, 1.16, rise) * (isGreen(colors[lead]) ? 0.72 : 1)
  const bend = () => lerp(0.04, 0.2, r())

  // Centers stay off-frame: below the bottom edge, beyond a lower corner, or beyond a side.
  let at: [number, number]
  let tilt: number
  let radius: number
  let aniso: number
  switch (kind) {
    case 'low':
      at = [0.5 + side * lerp(0.16, 0.34, r()), Math.max(1.01, lerp(1.15, 1.0, rise) + lerp(-0.02, 0.03, r()))]
      tilt = lerp(2, 9, r())
      radius = lerp(0.58, 0.7, r())
      aniso = lerp(3.8, 4.6, r())
      break
    case 'corner':
      // Beyond the side edge, low, with the horizon tilted down away from the light.
      at = [0.5 + side * lerp(0.55, 0.64, r()), lerp(1.0, 0.76, rise) + lerp(-0.04, 0.04, r())]
      tilt = lerp(16, 28, r())
      radius = lerp(0.56, 0.68, r())
      aniso = lerp(3.9, 4.9, r())
      break
    case 'side':
      at = [0.5 + side * (lerp(0.7, 0.58, rise) + lerp(0, 0.05, r())), lerp(0.94, 0.66, rise) + lerp(-0.1, 0.08, r())]
      tilt = lerp(-3, 7, r())
      radius = lerp(0.52, 0.62, r())
      aniso = lerp(3.8, 4.8, r())
      break
    case 'pair':
      at = [0.5 + side * lerp(0.22, 0.34, r()), Math.max(1.01, lerp(1.15, 1.0, rise) + lerp(-0.02, 0.02, r()))]
      tilt = lerp(1, 6, r())
      radius = lerp(0.54, 0.64, r())
      aniso = lerp(3.6, 4.4, r())
      break
    default: {
      const unknown: never = kind
      throw new Error(`Unknown composition: ${String(unknown)}`)
    }
  }
  radius *= size
  // The lead stays narrower than the frame, so there is sky beside it for the other blooms.
  radius *= Math.min(1, LEAD_MAX_LONG_RADIUS / (radius * Math.sqrt(aniso)))
  const angle = -side * tilt
  const leadGain = lightGain(colors[lead]) * lerp(0.94, 1.06, r())

  const glows: GlowSpec[] = [
    { color: lead, at, radius, aniso, angle, gain: leadGain, beta, haze: lerp(1.8, 2.6, r()), vary: lerp(0.45, 0.85, r()), bend: bend() },
  ]

  if (kind === 'pair') {
    // A second, weaker light of the same color across the horizon, with sky between the two.
    glows.push({
      color: lead,
      at: [0.5 - side * lerp(0.28, 0.4, r()), Math.max(1.01, at[1] + lerp(0.01, 0.06, r()))],
      radius: radius * lerp(0.7, 0.88, r()),
      aniso: lerp(3.6, 4.6, r()),
      angle: -angle * lerp(0.3, 1.0, r()),
      gain: leadGain * lerp(0.5, 0.7, r()),
      beta,
      haze: lerp(0.9, 1.4, r()),
      vary: lerp(0.45, 0.85, r()),
      bend: bend(),
    })
  }

  // Near the light: a smaller, weaker lobe of the same light further along the same edge
  // (at a side light, in the bottom corner below it), so the light is not one ellipse.
  if (r() < 0.45) {
    const lobeAt: [number, number] =
      kind === 'side'
        ? [0.5 + side * lerp(0.3, 0.46, r()), lerp(1.06, 1.14, r())]
        : [at[0] - side * lerp(0.3, 0.42, r()), Math.max(1.03, at[1] + lerp(0.03, 0.08, r()))]
    glows.push({
      color: lead,
      at: lobeAt,
      radius: radius * lerp(0.5, 0.68, r()),
      aniso: lerp(3.8, 5.2, r()),
      angle: angle + lerp(-10, 10, r()),
      gain: leadGain * lerp(0.35, 0.55, r()),
      beta,
      haze: lerp(0.6, 1.0, r()),
      vary: lerp(0.4, 0.8, r()),
      bend: bend(),
    })
  }

  // The far edge: a smaller light of the other color, or a paler patch of sky, with blue sky
  // between it and the lead. It sits on the opposite side, clearly higher than the lead; when the
  // lead is already high, it sits in the opposite bottom corner instead.
  // A dim green light over the blue turns grey-teal, so a green far light becomes a paler patch of sky.
  const coolLeadWarmOther = !isWarm(colors[lead]) && isWarm(colors[other])
  const far = pick<'none' | 'other' | 'sky'>(
    coolLeadWarmOther ? [['none', 0.45], ['sky', 0.55]] : [['none', 0.25], ['other', 0.55], ['sky', 0.2]],
    r(),
  )
  if (far !== 'none' && glows.length < GLOW_COUNT) {
    const farHeight = Math.min(lerp(0.5, 0.72, rise) + lerp(-0.06, 0.06, r()), at[1] - 0.25)
    const farCorner = farHeight < 0.42
    const farAt: [number, number] = farCorner
      ? [0.5 - side * lerp(0.5, 0.62, r()), lerp(1.0, 1.06, r())]
      : [0.5 - side * lerp(0.6, 0.7, r()), farHeight]
    const farAngle = side * (farCorner ? lerp(10, 22, r()) : lerp(-4, 8, r()))
    // From a side edge a very wide shape reads as a streak, so it is rounder there.
    const farAniso = farCorner ? lerp(3.6, 4.6, r()) : lerp(2.6, 3.4, r())
    const farRadius = radius * lerp(0.55, 0.72, r())
    if (far === 'other' && !isGreen(colors[other])) {
      glows.push({
        color: other,
        at: farAt,
        radius: farRadius,
        aniso: farAniso,
        angle: farAngle,
        gain: lightGain(colors[other]) * lerp(0.4, 0.55, r()),
        beta: beta * lerp(0.85, 0.95, r()),
        // Little haze: a dim light that hides the blue behind it turns grey.
        haze: lerp(0.1, 0.35, r()),
        vary: lerp(0.4, 0.8, r()),
        bend: bend(),
      })
    } else {
      glows.push({
        color: SLOT.sky,
        at: farAt,
        radius: farRadius * lerp(1.05, 1.25, r()),
        aniso: farAniso * lerp(1, 1.1, r()),
        angle: farAngle,
        gain: lerp(0.6, 0.9, r()),
        beta: beta * lerp(0.85, 0.95, r()),
        haze: 0,
        vary: lerp(0.4, 0.8, r()),
        bend: bend(),
      })
    }
  }

  // The sky deepens broadly toward the top, most in the upper corner away from the light
  // (for a pair, either one). It lies along the top edge so it never parallels a tilted glow.
  const deep = r() < 0.5 ? SLOT.deep1 : SLOT.deep2
  const zSide = kind === 'pair' ? (r() < 0.5 ? -1 : 1) : -side
  const zenith: ZenithSpec = {
    color: deep,
    at: [0.5 + zSide * lerp(0.45, 0.65, r()), lerp(-0.3, -0.18, r())],
    radius: lerp(0.48, 0.64, r()) * lerp(0.92, 1.12, soft),
    aniso: lerp(1.5, 2.1, r()),
    angle: lerp(-8, 8, r()),
    amount: lerp(0.32, 0.5, r()),
    falloff: 2.2,
  }

  return {
    glows: glows.slice(0, GLOW_COUNT),
    zenith,
    warp: lerp(0.05, 0.085, r()),
    warpScale: lerp(0.9, 1.35, r()),
    bridge: lerp(0.85, 1.2, soft),
  }
}
