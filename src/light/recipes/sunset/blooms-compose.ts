import { linearToOklch } from '../../color/oklab'
import type { Rgb } from '../../color/srgb'
import { placeHorizon } from './horizon'

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
  /** How far the glow's lobes spread and how much its falloff and length change along its edge, 0..1. */
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
  /** Share of the deep color at the center of the darkening, 0..2; above 1 the middle is all deep color. */
  amount: number
  /** Falloff exponent; lower spreads the darkening further. */
  falloff: number
  /** 1: the deep color keeps its hex under the darker top (a pack's dark ground); 0: it darkens with the sky. */
  hold: number
  /** Share of the blue's light taken away where the deep color comes in, so the two meet where both are dark. */
  meet: number
}

/**
 * The sky above mid-sky. It is its exact hex at frame height `mid` and gets
 * `top` stops darker toward the top edge, without changing hue; `tilt` (frame
 * heights per frame width) lowers that line on one side, so the side away
 * from the light is deeper. `vary` is slow light variation over the whole sky
 * (one standard deviation, a share of luminance) with the hex at its mean.
 */
export interface SkySpec {
  top: number
  mid: number
  tilt: number
  vary: number
}

export interface BloomsLayout {
  glows: GlowSpec[]
  zenith: ZenithSpec
  sky: SkySpec
  /** Extra light in a narrower core at each light's source, over its peak. */
  core: number
  /** Domain warp: amount in units of sqrt(width * height), and frequency in cycles per unit. */
  warp: number
  warpScale: number
  /** Multiplies the solved bridge light between each glow and the sky. */
  bridge: number
  /** Lowest Oklab L each bridge aims for (0: the lighter side's L only). */
  bridgeFloor: number
}

/**
 * The pack's bridge floor. A warm light and a blue sky are nearly opposite hues, so where they weigh the
 * same the blend loses its color; below this L it reads as mauve-grey, above it as pale light.
 */
const BRIDGE_FLOOR = 0.78

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
 * A light's body stays near its own hex (Tan reads as Tan, not a pale tint), and its brightness comes from
 * its size and from the core at its source, which rolls toward white (perception-additive-light.md 7.4).
 */
const MIN_LIGHT_GAIN = 0.75
const MAX_LIGHT_GAIN = 1.35

/**
 * Gain that puts every light color's body near the same luminance, within its
 * own hex and MAX_LIGHT_GAIN. Green-yellow light has no match in a sky, so the
 * composer keeps it smaller.
 */
export function lightGain(c: Rgb): number {
  const y = luminance(c)
  if (y <= 1e-6) return 0
  return clamp((isGreen(c) ? 0.8 : 0.62) / y, MIN_LIGHT_GAIN, MAX_LIGHT_GAIN)
}

/** Lime-like light: chroma with a hue between yellow and cyan. */
export function isGreen(c: Rgb): boolean {
  const [, chroma, hue] = linearToOklch(c)
  return chroma > 0.04 && hue > 105 && hue < 200
}

/** Cyan-like light; along the bottom edge it reads as a horizon, so it comes from a side. */
function isCyan(c: Rgb): boolean {
  const [, chroma, hue] = linearToOklch(c)
  return chroma > 0.04 && hue >= 200 && hue < 250
}

/** A mid grey of the pack such as Steel: no light of its own, but a color the sky can take on. */
function isGrey(c: Rgb): boolean {
  const [lightness, chroma] = linearToOklch(c)
  return chroma < 0.05 && lightness < 0.8
}

/** A glow that is a light (a light slot whose color is not a pack grey such as Steel), so it has a source. */
export function isSourceLight(slot: number, c: Rgb): boolean {
  return (slot === SLOT.light1 || slot === SLOT.light2) && !isGrey(c)
}

/** A dark color the sky blends into without a third hue between: a grey, or one within 40 degrees of the sky's hue. */
function blendsWithSky(dark: Rgb, sky: Rgb): boolean {
  const [, chroma, hue] = linearToOklch(dark)
  const skyHue = linearToOklch(sky)[2]
  return chroma < 0.05 || Math.abs(((hue - skyHue + 540) % 360) - 180) < 40
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

/** Longest half-length of the lead glow, in units of sqrt(width * height) (a 16:9 frame is 1.33 wide). */
const LEAD_MAX_LONG_RADIUS = 1.15

/** 0 at `from`, 1 at `to` (either may be the larger), with no kink at either end. */
function smoothstep(from: number, to: number, t: number): number {
  const x = clamp((t - from) / (to - from), 0, 1)
  return x * x * (3 - 2 * x)
}

/**
 * Height of the lead light, in frame heights from the top, for the shared
 * horizon height (horizon.ts: 1.06 at Horizon 0, 0.27 at Horizon 1): just
 * below the frame at 0 and about 55% down at 1, as the horizon study proposes
 * for Blooms (docs/light/research/horizon-placement.md). Blooms draws no line.
 */
function lightHeight(horizonY: number): number {
  return 0.55 + (horizonY - 0.27) * ((1.04 - 0.55) / (1.06 - 0.27))
}

/**
 * Which light slot leads: the warm light more often than not, and always over
 * cyan; with no warm light, the lighter one, since a dark color brightened is
 * not a light (Steel never reaches a light color, so Ice leads in every
 * Atmospheric seed). Green-yellow light leads less often (it has no match in
 * a sky).
 */
function pickLead(colors: readonly Rgb[], u: number): { lead: number; other: number } {
  const a = SLOT.light1
  const b = SLOT.light2
  const warmA = isWarm(colors[a])
  const warmB = isWarm(colors[b])
  if (warmA !== warmB) {
    const warm = warmA ? a : b
    const cool = warmA ? b : a
    // A cyan lead would need the warm light beside it, and cyan and yellow light together make mint,
    // so the warm light always leads over cyan, which then comes in as the high, soft second bloom.
    const coolOdds = isCyan(colors[cool]) ? 0 : isGreen(colors[cool]) ? 0.25 : 0.35
    return u < 1 - coolOdds ? { lead: warm, other: cool } : { lead: cool, other: warm }
  }
  const lighter = luminance(colors[a]) >= luminance(colors[b]) ? a : b
  return { lead: lighter, other: lighter === a ? b : a }
}

/**
 * The pack composition: one dominant bloom at the shared light height, from
 * the middle of the frame to near a side edge (cyan always higher), a fainter,
 * wider and much softer bloom higher on the same side (cyan light, the pack's
 * grey such as Steel, or a paler patch of sky), and sometimes a second bloom of
 * the same color, a weaker light of the other color or a paler patch of sky on
 * the far side. Under a cool lead the pack's warm light always comes in on the
 * far side. The sky is its exact hex in mid-sky and deepens toward the top
 * edge, all the way to the pack's dark color (Plum, Forest, Slate, Near-black)
 * in the corner away from the light, or only darker in a pack without one.
 * Seeds pick the side, place, height, sizes, glow count and which light leads;
 * Softness widens and softens; Rise lifts the light and moves the others with it.
 */
export function composeLayout(colors: readonly Rgb[], seed: number, controls: BloomsControls, aspect: number): BloomsLayout {
  const r = random(seed)
  const soft = clamp(controls.softness, 0, 1)
  const rise = clamp(controls.rise, 0, 1)
  const { lead, other } = pickLead(colors, r())
  // A cyan light along the bottom edge reads as a horizon (a sea), so it sits higher and comes in level.
  const cyanLead = isCyan(colors[lead])
  const height = lightHeight(placeHorizon(rise, seed, aspect).y) - (cyanLead ? lerp(0.24, 0.32, r()) : 0)
  const side = r() < 0.5 ? -1 : 1

  // Softness changes how the light falls off, not how far it reaches: the radius is scaled so the
  // half-brightness extent stays put while the tail gets longer. Rise lifts and widens the light.
  const beta = lerp(3.0, 1.6, soft)
  const sameHalfWidth = Math.sqrt(2 ** (1 / 2.2) - 1) / Math.sqrt(2 ** (1 / beta) - 1)
  // A darker light (Tan, Orange-red) keeps its body near its hex and gets its weight in the frame from a
  // larger glow instead.
  const darkerLight = clamp(Math.sqrt(0.6 / Math.max(luminance(colors[lead]), 1e-4)), 1, 1.35)
  const size = lerp(0.8, 1.2, r()) * lerp(0.95, 1.08, soft) * sameHalfWidth * lerp(0.88, 1.16, rise) * (isGreen(colors[lead]) ? 0.85 : darkerLight)
  const bend = () => lerp(0.04, 0.2, r())

  // Every seed is the same kind of image: a bloom at the shared light height, from the middle of the frame
  // to near a side edge, round to wide and small to large by seed. The Horizon control only moves it: low,
  // it sinks below the bottom edge as a setting light does. A cyan bloom stays well clear of the bottom
  // edge, where a warm light may sit.
  const jitter = lerp(-0.06, 0.06, r())
  const at: [number, number] = [0.5 + side * lerp(0.02, 0.4, r()), height + jitter]
  const tilt = lerp(-8, 8, r())
  let radius = lerp(0.3, 0.56, r()) * (cyanLead ? 0.75 : 1)
  const aniso = lerp(1.6, 2.8, r())
  radius *= size
  // The lead stays narrower than the frame, so there is sky beside it for the other blooms.
  radius *= Math.min(1, LEAD_MAX_LONG_RADIUS / (radius * Math.sqrt(aniso)))
  const angle = -side * tilt
  const leadGain = lightGain(colors[lead]) * lerp(0.94, 1.06, r())

  const glows: GlowSpec[] = [
    // A warm light hides the sky where it comes from: warm light over blue turns grey-pink (Tan). White or cool
    // light over blue only pales it, so it needs less haze and leaves more of the blue.
    { color: lead, at, radius, aniso, angle, gain: leadGain, beta, haze: isWarm(colors[lead]) ? lerp(2.8, 3.6, r()) : lerp(1.8, 2.6, r()), vary: lerp(0.45, 0.85, r()), bend: bend() },
  ]

  // Some seeds get a second, weaker bloom of the same light across the frame at another height, with sky
  // between the two, so seeds differ in how many blooms there are as well as where.
  if (r() < 0.35) {
    glows.push({
      color: lead,
      at: [0.5 - side * lerp(0.15, 0.38, r()), at[1] + lerp(-0.16, 0.04, r())],
      radius: radius * lerp(0.55, 0.8, r()),
      aniso: lerp(1.6, 2.6, r()),
      angle: -angle * lerp(0.3, 1.0, r()),
      gain: leadGain * lerp(0.45, 0.65, r()),
      beta,
      haze: lerp(0.9, 1.4, r()),
      vary: lerp(0.45, 0.85, r()),
      bend: bend(),
    })
  }

  // Higher on the same side, a fainter and wider bloom with its center inside the frame, so the
  // light is a few blooms at different heights and sizes, not one glow on an edge. It changes the
  // sky's color more than its brightness where a light can do that faintly: a cyan light (the lead
  // or the other one). Otherwise it is a slightly paler patch of sky: faint green or grey light
  // over blue turns grey-teal or grey, and a warm bloom above a cool light would be a second
  // light direction.
  // Its edge is much softer than the lead's, so the frame has one firm and one very soft edge.
  // A grey of the pack (Steel) takes this place as a patch of haze at its own hex, smaller than the
  // light and partly see-through, so the blue still holds the mid sky around it.
  // A cyan bloom is a bloom, not the sky: rounder and about the lead's size, with blue around it. Under a
  // warm lead it sits on the far side, apart from it: cyan and yellow light on top of each other make mint.
  const greyOther = isGrey(colors[other])
  const innerColor = isCyan(colors[lead]) ? lead : isCyan(colors[other]) || greyOther ? other : SLOT.sky
  const innerGrey = innerColor === other && greyOther
  const innerCyan = innerColor !== SLOT.sky && isCyan(colors[innerColor])
  const innerSide = innerColor === other && isCyan(colors[other]) && isWarm(colors[lead]) ? -side : side
  const [uSize, uAniso, uGain, uBeta, uHaze] = [r(), r(), r(), r(), r()]
  glows.push({
    color: innerColor,
    at: [0.5 + innerSide * lerp(0.05, 0.3, r()), lerp(0.42, 0.28, rise) + lerp(-0.05, 0.05, r())],
    radius: radius * (innerGrey ? lerp(0.6, 0.8, uSize) : innerCyan ? lerp(0.9, 1.15, uSize) : lerp(1.15, 1.4, uSize)),
    aniso: innerCyan || innerGrey ? lerp(1.7, 2.5, uAniso) : lerp(2.8, 3.8, uAniso),
    angle: -side * lerp(-4, 12, r()),
    gain: innerColor === SLOT.sky ? lerp(0.25, 0.4, uGain) : innerGrey ? lerp(1.0, 1.2, uGain) : lightGain(colors[innerColor]) * lerp(0.5, 0.65, uGain),
    beta: beta * (innerCyan ? lerp(0.75, 0.9, uBeta) : lerp(0.5, 0.6, uBeta)),
    // Enough haze that a light bloom's middle is its own color, not a blend with the blue behind it; the
    // grey patch is thinner, so blue shows through its edges.
    haze: innerGrey ? lerp(0.9, 1.3, uHaze) : innerColor === SLOT.sky ? 0 : lerp(0.9, 1.3, uHaze),
    vary: lerp(0.4, 0.8, r()),
    bend: bend(),
  })

  // The far edge: a smaller light of the other color, or a paler patch of sky, with blue sky
  // between it and the lead. It sits on the opposite side, clearly higher than the lead; when the
  // lead is already high, it sits in the opposite bottom corner instead.
  // A dim green light over the blue turns grey-teal, so a green far light becomes a paler patch of sky.
  // Under a cool lead the pack's warm light always comes in here, so the frame still shows it.
  const coolLeadWarmOther = !isWarm(colors[lead]) && isWarm(colors[other])
  const far = pick<'none' | 'other' | 'sky'>(
    coolLeadWarmOther ? [['other', 1]] : [['none', 0.4], ['other', 0.4], ['sky', 0.2]],
    r(),
  )
  if (far !== 'none' && glows.length < GLOW_COUNT) {
    const farHeight = Math.min(lerp(0.5, 0.72, rise) + lerp(-0.06, 0.06, r()), at[1] - 0.25)
    // It moves from the side edge to the bottom corner as its height drops from 0.48 to 0.36, over a wide
    // part of the Horizon range, so the control moves it and never swaps one place for the other.
    const corner = smoothstep(0.48, 0.36, farHeight)
    // The warm light under a cool lead comes in from the opposite side, below the lead's height but
    // clear of the bottom edge, weaker than the lead and apart from it (cyan and yellow light on top
    // of each other make mint, and its pale halo along the bottom would read as a cyan horizon).
    const warmUnderCool = far === 'other' && coolLeadWarmOther
    const ux = r()
    const farAt: [number, number] = warmUnderCool
      ? [0.5 - side * lerp(0.5, 0.58, ux), lerp(0.62, 0.74, r())]
      : [0.5 - side * lerp(lerp(0.6, 0.7, ux), lerp(0.5, 0.62, ux), corner), lerp(farHeight, lerp(1.0, 1.06, ux), corner)]
    const ua = r()
    const farAngle = side * lerp(lerp(-4, 8, ua), lerp(10, 22, ua), corner)
    // From a side edge a very wide shape reads as a streak, so it is rounder there.
    const un = r()
    const farAniso = lerp(lerp(2.6, 3.4, un), lerp(3.6, 4.6, un), corner)
    const farRadius = radius * lerp(0.55, 0.72, r())
    if (far === 'other' && !isGreen(colors[other])) {
      glows.push({
        color: other,
        at: farAt,
        radius: farRadius,
        aniso: warmUnderCool ? lerp(2.2, 3.0, r()) : farAniso,
        angle: farAngle,
        gain: lightGain(colors[other]) * (warmUnderCool ? lerp(0.55, 0.68, r()) : lerp(0.4, 0.55, r())),
        beta: beta * lerp(0.85, 0.95, r()),
        // Little haze: a dim light that hides the blue behind it turns grey.
        haze: warmUnderCool ? lerp(0.6, 1.0, r()) : lerp(0.1, 0.35, r()),
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

  // The sky keeps changing up to the top edge: its exact hex sits in mid-sky and above it the
  // sky gets 1 to 1.5 stops darker, deeper on the side away from the light, and it varies
  // slowly by about 4 % everywhere. The darkest corner, away from the light (for a pair,
  // either one), deepens a little more.
  const sky: SkySpec = {
    top: lerp(1.0, 1.5, r()),
    mid: lerp(0.52, 0.38, rise) + lerp(-0.05, 0.05, r()),
    tilt: side * lerp(0.15, 0.35, r()),
    vary: lerp(0.03, 0.05, r()),
  }
  // With dark colors in the pack (Plum and Forest, Slate and Near-black), the corner away from the
  // light deepens all the way to one of them, so the pack's ground shows as an area of its own. A grey
  // or blue dark color (Slate, Near-black) blends with the blue cleanly at any lightness, so it can
  // reach well into the frame; one of another hue (Plum, Forest) stays in a corner that is already
  // dark, so the two meet where both are dark and no lighter purple or teal band runs between them.
  const deep = r() < 0.5 ? SLOT.deep1 : SLOT.deep2
  const darkGround = luminance(colors[deep]) > 1e-4
  const skyFamily = darkGround && blendsWithSky(colors[deep], colors[SLOT.sky])
  const zSide = -side
  // The dark color keeps its own hex under the darker top, so the corner shows the pack's ground at its
  // hex over a real share of the frame, not a darker mix that reads as night sky. One of another hue
  // reaches into the frame with the blue darkening where it comes in, so the two still meet dark.
  const zenith: ZenithSpec = darkGround
    ? {
        color: deep,
        at: [0.5 + zSide * lerp(0.3, 0.5, r()), skyFamily ? lerp(-0.08, 0.02, r()) : lerp(-0.07, 0.02, r())],
        radius: lerp(0.62, 0.85, r()) * lerp(0.92, 1.12, soft) * (skyFamily ? 1 : 0.88),
        aniso: lerp(1.6, 2.4, r()),
        angle: lerp(-8, 8, r()),
        amount: skyFamily ? lerp(1.6, 2.0, r()) : lerp(1.7, 2.0, r()),
        // One of another hue ends faster, so there is little of the blend between it and the blue.
        falloff: skyFamily ? 1.7 : 2.2,
        hold: 1,
        meet: skyFamily ? 0 : 0.6,
      }
    : {
        color: deep,
        at: [0.5 + zSide * lerp(0.45, 0.65, r()), lerp(-0.3, -0.18, r())],
        radius: lerp(0.48, 0.64, r()) * lerp(0.92, 1.12, soft),
        aniso: lerp(1.5, 2.1, r()),
        angle: lerp(-8, 8, r()),
        amount: lerp(0.18, 0.32, r()),
        falloff: 2.2,
        hold: 0,
        meet: 0,
      }

  return {
    glows: glows.slice(0, GLOW_COUNT),
    zenith,
    sky,
    // More daylight is more exposure at the source: the core takes more of the light as Intensity rises.
    core: lerp(0.35, 1.6, Math.max(0, 2 * clamp(controls.intensity, 0, 1) - 1)),
    warp: lerp(0.05, 0.085, r()),
    warpScale: lerp(0.9, 1.35, r()),
    bridge: lerp(0.85, 1.2, soft),
    bridgeFloor: BRIDGE_FLOOR,
  }
}
