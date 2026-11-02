import { getPack, type PackId } from '../../color/packs'
import type { Composition, ControlValues, ParamValue } from '../../scene'
import { hexToLinear } from '../../color/srgb'
import { edgeFbm, spread } from './ramp-noise'

const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** 2 to the power of `stops` times (t - 0.5): 1 at the middle of a control. */
const stops2 = (t: number, stops: number) => 2 ** ((t - 0.5) * stops)
const luminance = (hex: string, gain: number) => {
  const [r, g, b] = hexToLinear(hex)
  return gain * (0.2126 * r + 0.7152 * g + 0.0722 * b)
}
/** Width of a 16:9 frame in short sides; horizon wave lengths are set against it in every format. */
const WIDE = 16 / 9

/** Deterministic random numbers in [0, 1) for one seed. */
function seeded(seed: number): () => number {
  let state = (Math.imul(Math.round(seed) | 0, 0x9e3779b1) ^ 0x5bd1e995) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * How the sky is built, one per reference the recipe reproduces: an open sky
 * with the light along the bottom (sky-peach), a tilted sky with the light in
 * a lower corner (blue-diagonal), wide arcs around a center below the frame
 * (red-yellow-arcs) and a wavy horizon over a darker band (violet-wave).
 */
export type RampStructure = 'open' | 'corner' | 'arcs' | 'wave'
export const RAMP_STRUCTURES: readonly RampStructure[] = ['open', 'corner', 'arcs', 'wave']

/** Every run of four seeds (1-4, 5-8, ...) holds each structure once, in a seeded order. */
export function rampStructure(seed: number): RampStructure {
  const n = Math.round(seed) - 1
  const random = seeded(Math.floor(n / 4) * 7919 + 101)
  const order = [...RAMP_STRUCTURES]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const swap = order[i]
    order[i] = order[j]
    order[j] = swap
  }
  return order[((n % 4) + 4) % 4]
}

/** The anchor height (frame fraction) that puts the horizon line just below the whole bottom edge of the frame. */
function horizonBelow(frameWidth: number, tall: number, turn: number, dome: number, margin: number): number {
  const half = frameWidth / 2
  let anchor = tall / 2
  for (let k = 0; k < 4; k++) {
    let lowest = -Infinity
    for (let i = 0; i <= 32; i++) {
      const dx = -half + (i / 32) * frameWidth
      const dy = tall / 2 - anchor
      const along = dx * Math.sin(turn) + dy * Math.cos(turn)
      const across = dx * Math.cos(turn) - dy * Math.sin(turn)
      lowest = Math.max(lowest, along - (dome * across * across) / (half * half))
    }
    anchor += (lowest + margin) / Math.cos(turn)
  }
  return anchor / tall + 0.5
}

type Tone = [hex: string, gain: number]

interface PackLook {
  /** Zenith color (Meta Blue) and the low sky with its gain at the default Intensity. */
  zenith: string
  lowSky: string
  lowSkyGain: number
  /** How much skylight is left right above the horizon. */
  horizonGain: number
  /** Height of the sky's main edge as a share of the sky, and its width relative to that height. */
  skyEdge: [number, number]
  /** The one light: the glow, the sun glow and the sunlight tint. */
  light: string
  /** Glow strength at the sun's side at the default Intensity. */
  glow: number
  /**
   * The light's path through the air at the glow line (0 is the pack color itself, below 0 a
   * paler member of its family, above 0 a deeper one), how much deeper it gets toward the
   * horizon and how much paler above the glow.
   */
  path: [number, number, number]
  /** Bridge light amount and lift; more for pairs that otherwise mix through a hue the pack doesn't have. */
  bridge: number
  bridgeLift: number
  /** Strength of the glow's long, pale haze tail relative to the default. */
  haze: number
  /**
   * How far the glow reaches below its line, relative to the line's height above the horizon:
   * deep red may darken toward the horizon, but darker orange, yellow or tan turn brown.
   */
  downReach: number
  /** How much deeper the light gets away from the sun. */
  sideDeeper: number
  /** The band below a wavy horizon: its color near the horizon and at the bottom, with gains. */
  darkTop: Tone
  darkBottom: Tone
}

/** The pack's sky, light and dark band for one seed. Every color is a pack hex. */
function packLook(packId: PackId, random: () => number): PackLook {
  const [metaBlue, ...rest] = getPack(packId).colors.map((c) => c.hex)
  const pickLight = random()
  const pickSky = random()
  const pickDark = random()
  const sky = { zenith: metaBlue, lowSky: metaBlue, lowSkyGain: 1.3, horizonGain: 0.8, skyEdge: [0.55, 1.1] as [number, number], bridgeLift: 0.12, downReach: 1.6 }
  switch (packId) {
    case 'bold': {
      const [cyan, yellow, orangeRed] = rest
      const dark = { darkTop: [metaBlue, 0.8] as Tone, darkBottom: [metaBlue, 0.2] as Tone }
      // Orange-red always meets a Cyan low sky: the two add up to a pale neutral, never pink.
      if (pickLight < 0.4) {
        return { ...sky, lowSky: cyan, lowSkyGain: 0.85, horizonGain: 0.7, skyEdge: [0.62, 0.75], light: orangeRed, glow: 0.9, path: [0.1, 1.2, 0.45], bridge: 0.35, haze: 0.3, downReach: 0.75, sideDeeper: 0.3, ...dark }
      }
      const cyanSky = pickSky < 0.5
      const low = cyanSky ? { lowSky: cyan, lowSkyGain: 0.85, skyEdge: [0.42, 1.1] as [number, number] } : {}
      return { ...sky, ...low, light: yellow, glow: cyanSky ? 0.92 : 0.95, path: [cyanSky ? 0.5 : 0.4, 2, 0.45], bridge: cyanSky ? 0.35 : 0.5, haze: cyanSky ? 0.5 : 0.75, sideDeeper: 0.4, ...dark }
    }
    case 'elemental': {
      const [, forest, tan, plum] = rest
      // Warm light next to Forest mixes to olive, so the band's top is always Plum; some seeds end in Forest.
      const dark = { darkTop: [plum, 3] as Tone, darkBottom: pickDark < 0.6 ? ([plum, 0.6] as Tone) : ([forest, 0.7] as Tone) }
      return { ...sky, light: tan, glow: 1.35, path: [0.45, 1.25, 0.4], bridge: 0.45, haze: 0.8, sideDeeper: 0.3, ...dark }
    }
    case 'atmospheric': {
      const [ice, , slate, nearBlack] = rest
      const dark = pickDark < 0.6 ? { darkTop: [slate, 1.7] as Tone, darkBottom: [nearBlack, 0.9] as Tone } : { darkTop: [nearBlack, 2.6] as Tone, darkBottom: [nearBlack, 0.7] as Tone }
      return { ...sky, lowSkyGain: 1.2, horizonGain: 0.82, light: ice, glow: 0.42, path: [0, 0, 0], bridge: 0.3, haze: 0.8, sideDeeper: 0, ...dark }
    }
    default: {
      const unknown: never = packId
      throw new Error(`Unknown pack: ${String(unknown)}`)
    }
  }
}

/** Slot hexes for the recipe: eight stops, two glow layers, sun glow, sunlight tint, then the unused land slots. */
function slotColors(look: PackLook, structure: RampStructure): string[] {
  const below = structure === 'wave' ? [look.darkTop[0], look.darkBottom[0]] : [look.lowSky]
  const stops = [look.zenith, look.lowSky, ...below, ...Array.from({ length: 6 - below.length }, () => below[below.length - 1])]
  return [...stops, look.light, look.light, look.light, look.light, '#000000', '#000000', '#000000']
}

/** The slot colors the recipe uses for a pack and seed. */
export function rampPackColors(packId: PackId, seed: number): string[] {
  return slotColors(packLook(packId, seeded(seed)), rampStructure(seed))
}

/**
 * A Sunset ramp scene for a pack, the tool controls, a seed and the frame's
 * width over height. Lengths are in short-side units, about 40 degrees of
 * sky. The seed picks the structure, the light color and the dark band
 * (where a pack has a choice), the sun's side and position, the tilt and bend,
 * the horizon's waves, the glow's width and the height of the sky's main edge.
 */
export function composeRamp(packId: PackId, controls: ControlValues, seed: number, aspect: number): Composition {
  const structure = rampStructure(seed)
  const random = seeded(seed)
  const look = packLook(packId, random)
  const intensity = clamp01(controls.intensity)
  const softness = clamp01(controls.softness)
  const mood = clamp01(controls.mood)

  const tall = Math.max(1, 1 / aspect)
  const frameWidth = Math.max(1, aspect)
  const half = frameWidth / 2
  const tallShare = clamp01((tall - 1) / 0.78)
  const narrow = 0.65 + 0.35 * Math.min(1, frameWidth / WIDE)

  const sunRight = random() < 0.5
  const sunPick = random()
  const tiltPick = random()
  const glowWidthScale = lerp(0.78, 1.3, random())
  const skyEdgeScale = lerp(0.68, 1, random())
  const bendPick = random()
  const warpPhase = lerp(-8, 8, random())
  const shift = random() * 2 - 1
  const air = lerp(0.75, 1.45, random())
  const wavePick = random()
  const wanderPick = random()
  const bandPick = random()

  // Where the light sits and how the sky bends; the sun is measured in from its side edge. A wavy
  // horizon sits in the frame and the Horizon control moves it. The other structures are all
  // sky: their horizon sits just below the frame and the Horizon control raises the glow line,
  // a few degrees above the horizon, as `lift`.
  let horizonY = 1
  let lift = 0
  let sunIn: number
  let tilt: number
  let dome: number
  // Share of the glow that stays far from the sun, the glow's width and the sunlight's strength.
  let floor: number
  let lateral: number
  let sunlight: number
  switch (structure) {
    case 'open':
      lift = lerp(0.04, 0.26, mood) + 0.02 * shift
      sunIn = lerp(-0.3, 0.2, sunPick)
      tilt = lerp(-2.5, 2.5, tiltPick)
      dome = lerp(0, 0.02, bendPick)
      floor = 0.55
      lateral = 1.2
      sunlight = 0.35
      break
    case 'corner':
      lift = lerp(0.05, 0.24, mood) + 0.02 * shift
      sunIn = lerp(-0.14, 0.06, sunPick)
      tilt = (sunRight ? 1 : -1) * lerp(5, 11, tiltPick)
      dome = lerp(-0.03, 0.015, bendPick)
      floor = 0.04
      lateral = 0.8
      sunlight = 0.55
      break
    case 'arcs':
      lift = lerp(0.04, 0.22, mood) + 0.02 * shift
      sunIn = lerp(0.38, 0.62, sunPick)
      tilt = lerp(-5, 5, tiltPick)
      dome = lerp(0.05, 0.085, bendPick) * frameWidth
      floor = 0.4
      lateral = 1.5
      sunlight = 0.2
      break
    case 'wave':
      // The Earth's shadow: a darker band rising from the horizon under a pale warm band, on the
      // side of the sky away from the sun, so no sun sits on the horizon.
      horizonY = lerp(lerp(0.82, 0.86, tallShare), lerp(0.62, 0.68, tallShare), mood) + 0.03 * shift
      sunIn = lerp(-0.7, -0.35, sunPick)
      tilt = lerp(-3, 3, tiltPick)
      dome = lerp(-0.015, 0.005, bendPick)
      floor = 0.75
      lateral = 1.4
      sunlight = 0.1
      break
    default: {
      const unknown: never = structure
      throw new Error(`Unknown structure: ${String(unknown)}`)
    }
  }
  const wave = structure === 'wave'
  const sunX = sunRight ? 1 - sunIn : sunIn
  const turn = (tilt * Math.PI) / 180
  if (!wave) horizonY = horizonBelow(frameWidth, tall, turn, dome, 0.02)
  const skyHeight = horizonY * tall

  // Intensity is daylight: the zenith gains the most, the low sky less and the glow least;
  // the glow rises, widens and pales, and the sun's core whitens near the sun only.
  const zenithGain = stops2(intensity, 1.6)
  const lowGain = look.lowSkyGain * stops2(intensity, look.lowSkyGain < 1 ? 0.8 : 0.7)
  const glowGain = stops2(intensity, 0.4)
  const sunGain = stops2(intensity, 2.4)
  const groundGain = stops2(intensity, 0.8)
  const day = stops2(intensity, 0.7)
  const [path, deeper, paler] = look.path

  // Softness is haze: wider edges and glow, a softer horizon, a duller horizon band.
  const haze = stops2(softness, 1.4)
  const glowHaze = stops2(softness, 0.8)
  // The glow is larger where more sky shows, so a tall frame doesn't get a thin stripe.
  const skyScale = 0.72 + 0.36 * Math.min(skyHeight, 1.6)
  const glowScale = glowHaze * day * skyScale * air
  const glowRise = wave ? 0.09 * day * skyScale * air * stops2(softness, 0.5) : lift * Math.sqrt(day) * stops2(softness, 0.3)

  // The least height above the horizon along the top edge: the sky's main edge and the sun's
  // light stay below it, so the top of the frame is the pack's Meta Blue.
  const anchorY = (horizonY - 0.5) * tall
  let topHeight = Infinity
  for (let i = 0; i <= 32; i++) {
    const dx = -half + (i / 32) * frameWidth
    const dy = -tall / 2 - anchorY
    const along = dx * Math.sin(turn) + dy * Math.cos(turn)
    const across = dx * Math.cos(turn) - dy * Math.sin(turn)
    topHeight = Math.min(topHeight, (dome * across * across) / (half * half) - along)
  }
  const skyEdgeAt = -look.skyEdge[0] * topHeight * skyEdgeScale
  const skyEdgeWidth = look.skyEdge[1] * Math.abs(skyEdgeAt) * Math.sqrt(haze)

  // The horizon's waves are long, 0.67 to 1 of a 16:9 frame's width, so no bump is narrower than
  // about a third of the width. Each frame's wander is set from the noise it shows, over at least
  // 1.2 frame heights, so a tall frame shows the middle of the same pattern.
  const waveScale = 1 / (lerp(0.67, 1, wavePick) * WIDE)
  const waveOctaves = wave ? 1 : 2
  const window = Math.max(frameWidth, 1.2 * tall) / 2
  const waveNoise = (x: number) => edgeFbm(x * Math.cos(turn) * waveScale + 3.7 + warpPhase, Math.round(seed), waveOctaves)
  const noiseSpread = Math.max(0.05, spread(waveNoise, -window, window))
  const wander = wave ? lerp(0.01, 0.018, wanderPick) * Math.sqrt(haze) : 0.006 * skyScale
  const warp = Math.min(0.12, wander / noiseSpread)

  // Over a wavy horizon the sky dims down to the band's own brightness, so the soft step into the
  // band has no bright or dark seam.
  const darkTopGain = look.darkTop[1] * groundGain
  const seamDim = wave ? Math.max(0, Math.log(luminance(look.lowSky, lowGain) / luminance(look.darkTop[0], darkTopGain))) : 0

  const params: Record<string, ParamValue> = {
    anchor: [0.5, horizonY],
    angle: tilt,
    drop: dome,
    stops: wave ? 4 : 2,
    at1: skyEdgeAt,
    width1: skyEdgeWidth,
    gain1: zenithGain,
    gain2: lowGain,
    // Below a wavy horizon: a wide, soft step into the dark band, then a wider one to its bottom.
    at2: 0,
    width2: lerp(0.12, 0.2, bandPick) * Math.sqrt(haze) * (1 + 0.3 * tallShare),
    at3: lerp(0.18, 0.3, bandPick) * (1 + 0.4 * tallShare),
    width3: lerp(0.3, 0.45, bandPick) * Math.sqrt(haze) * (1 + 0.4 * tallShare),
    gain3: darkTopGain,
    gain4: look.darkBottom[1] * groundGain,
    horizonEdge: wave ? 2 : 0,
    warp,
    warpScale: waveScale,
    warpPhase,
    warpOctaves: waveOctaves,
    warpReach: 0.25,
    softVary: wave ? 0.15 : 0.25 + 0.35 * softness,
    softScale: wave ? 0.7 : 1.3,
    softFollow: wave ? 0.45 / noiseSpread : 0,
    softReach: 0.3,
    drift: wave ? 0.08 : 0.16,
    driftScale: wave ? 0.9 : 1.4,
    vary: 0.3,
    softness: 0,
    // The arcs' center: the sun right at the horizon, so its core shows at the bottom edge.
    sunAt: [sunX, horizonY + (structure === 'arcs' ? 0 : 0.03 / tall)],
    sunlight: sunlight * glowGain,
    sunlightWidth: 0.55 * lateral * glowWidthScale * Math.sqrt(day) * narrow,
    sunlightHeight: 0.6,
    sunlightWarmth: 0,
    falloff: structure === 'corner' ? 2.2 : 1.6,
    widen: 1.4,
    lightTop: topHeight * lerp(0.9, 1.15, intensity),
    glow: look.glow * glowGain * (structure === 'arcs' ? 1.2 : 1),
    glowOffset: -glowRise,
    glowVary: wave ? 0.08 : 0.15,
    glowVaryScale: wave ? 0.8 : 1.3,
    glowArch: wave ? 0.15 : 0.6,
    glowLateral: 1 - floor * narrow,
    glowWidth: 0.45 * lateral * glowWidthScale * Math.sqrt(day) * glowHaze * narrow,
    shadowHeight: 0.07 * skyScale * glowHaze,
    glow1Weight: 1,
    glow1Up: 0.1 * glowScale,
    glow1Down: wave ? 0.15 * skyScale * Math.sqrt(glowHaze) : Math.max((0.03 + 0.03 * glowHaze) * skyScale, look.downReach * glowRise),
    glow2Weight: 0.2 * look.haze * lerp(0.6, 1.5, softness),
    glow2Up: 0.17 * glowScale,
    glow2Down: (wave ? 0.04 : 0.08) * glowHaze,
    extinction: 1.2,
    // Skylight fades toward the horizon, so under the glow line the light is the glow's own.
    horizonDim: wave ? seamDim : (1 - look.horizonGain) * 12 * stops2(softness, -0.6),
    horizonDimHeight: wave ? 0.07 * skyScale * Math.sqrt(haze) : 0.7 * glowRise + 0.02,
    dimBelow: wave ? 0 : 1,
    reddenDown: deeper * stops2(1 - intensity, 1.1) * stops2(1 - softness, 0.6),
    reddenUp: paler > 0 ? clamp01(paler + (intensity - 0.5) * 0.35) * 0.9 : 0,
    reddenSide: look.sideDeeper,
    glowPath: path - (intensity - 0.5) * 0.5,
    sunGlow: wave ? 0 : 0.25 * sunGain * (structure === 'arcs' ? 4 : 1),
    sunGlow1Radius: 0.05 * glowScale,
    sunGlow1Weight: 1,
    sunGlow2Radius: 0.18 * glowScale,
    sunGlow2Weight: 0.35,
    sunGlowAspect: 2.5,
    sunGlowBeta: 1.3,
    occlude: 0.85,
    occludeWidth: 0.04 * glowHaze,
    bridge: look.bridge,
    bridgeLift: look.bridgeLift + 0.12 * softness,
    bridgeWarmth: 0.6,
    bridgeFloor: 0.3,
    land: 0,
  }
  return { colors: slotColors(look, structure), params, lens: {}, output: { exposure: 0 } }
}
