import { getPack, type PackId } from '../../color/packs'
import type { Composition, ControlValues, ParamValue } from '../../scene'

const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** 2 to the power of `stops` times (t - 0.5): 1 at the middle of a control. */
const stops2 = (t: number, stops: number) => 2 ** ((t - 0.5) * stops)

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

interface PackLook {
  /** Zenith color (Meta Blue), the low-sky color and the dimmer band right at the horizon. */
  zenith: string
  lowSky: string
  horizonBand: string
  /** Gains at the default Intensity; light colors stay below their white point. */
  lowSkyGain: number
  horizonGain: number
  /** The one light: the glow, the sun glow and the light on the land. */
  light: string
  /** Glow strength at the sun's side at the default Intensity. */
  glow: number
  /**
   * The light's path through the air at the glow line (0 is the pack color itself, below 0 a
   * paler member of its family, above 0 a deeper one), how much deeper it gets toward the
   * horizon and how much paler above the glow.
   */
  path: [number, number, number]
  /** Bridge light amount; higher for pairs that otherwise mix through a hue the pack doesn't have. */
  bridge: number
  /** Share of the glow that stays far from the sun, and how much deeper the light gets there. */
  floor: number
  sideDeeper: number
  /** Haze over the far land, and the near ground, with their gains. */
  landTop: [string, number]
  landBottom: [string, number]
}

/** The pack's sky, light and ground roles for one seed. Every color is a pack hex. */
function packLook(packId: PackId, pick: number): PackLook {
  const [metaBlue, ...rest] = getPack(packId).colors.map((c) => c.hex)
  const sky = { zenith: metaBlue, lowSky: metaBlue, horizonBand: metaBlue, lowSkyGain: 1.3, horizonGain: 0.8 }
  switch (packId) {
    case 'bold': {
      const [cyan, yellow] = rest
      const ground = { landTop: [metaBlue, 0.28] as [string, number], landBottom: [metaBlue, 0.1] as [string, number] }
      if (pick < 0.55) {
        return { ...sky, lowSky: cyan, lowSkyGain: 0.88, light: yellow, glow: 0.92, path: [0.5, 2.6, 0.45], bridge: 1, floor: 0.14, sideDeeper: 0.5, ...ground }
      }
      return { ...sky, light: yellow, glow: 0.95, path: [0.4, 2.6, 0.45], bridge: 0.9, floor: 0.14, sideDeeper: 0.5, ...ground }
    }
    case 'elemental': {
      const [, forest, tan, plum] = rest
      const base = { ...sky, light: tan, glow: 1.35, path: [0.45, 1.6, 0.4] as [number, number, number], bridge: 0.7, floor: 0.12, sideDeeper: 0.4 }
      if (pick < 0.65) return { ...base, landTop: [metaBlue, 0.26], landBottom: [plum, 0.8] }
      return { ...base, landTop: [metaBlue, 0.26], landBottom: [forest, 0.8] }
    }
    case 'atmospheric': {
      const [ice, , slate, nearBlack] = rest
      const base = { ...sky, lowSkyGain: 1.2, horizonGain: 0.82, light: ice, glow: 0.5, path: [0, 0, 0] as [number, number, number], bridge: 0.4, floor: 0.1, sideDeeper: 0 }
      if (pick < 0.5) return { ...base, landTop: [slate, 1], landBottom: [nearBlack, 0.85] }
      return { ...base, landTop: [metaBlue, 0.26], landBottom: [nearBlack, 0.95] }
    }
    default: {
      const unknown: never = packId
      throw new Error(`Unknown pack: ${String(unknown)}`)
    }
  }
}

/** Slot hexes for the recipe: eight stops, two glow layers, sun glow, sunlight tint, land top, land bottom, land light. */
function slotColors(look: PackLook): string[] {
  const stops = [look.zenith, look.lowSky, ...Array.from({ length: 6 }, () => look.horizonBand)]
  return [...stops, look.light, look.light, look.light, look.light, look.landTop[0], look.landBottom[0], look.light]
}

/** The slot colors the recipe uses for a pack and seed. */
export function rampPackColors(packId: PackId, seed: number): string[] {
  return slotColors(packLook(packId, seeded(seed)()))
}

/**
 * A Sunset ramp scene for a pack, the tool controls, a seed and the frame's
 * width over height. Lengths are in short-side units, about 40 degrees of
 * sky. The seed picks the light color (where a pack has two) and the ground,
 * the sun's side and position, a small tilt, the hill shapes, the glow's
 * width and the height of the sky's main edge.
 */
export function composeRamp(packId: PackId, controls: ControlValues, seed: number, aspect: number): Composition {
  const random = seeded(seed)
  const look = packLook(packId, random())
  const intensity = clamp01(controls.intensity)
  const softness = clamp01(controls.softness)
  const mood = clamp01(controls.mood)

  const tall = Math.max(1, 1 / aspect)
  const frameWidth = Math.max(1, aspect)
  const tallShare = clamp01((tall - 1) / 0.78)

  const sunRight = random() < 0.5
  const sunIn = lerp(-0.22, 0.38, random())
  const sunX = sunRight ? 1 - sunIn : sunIn
  const tilt = lerp(-2.5, 2.5, random())
  const glowWidthScale = lerp(0.78, 1.3, random())
  const skyEdgeScale = lerp(0.75, 1.25, random())
  const hillPhase = lerp(-8, 8, random())
  const hillAmount = lerp(0.4, 2, random())
  const hillScale = lerp(0.8, 2.8, random())
  const hillSlope = lerp(-0.06, 0.06, random())
  const dome = lerp(0, 0.025, random())
  const warpPhase = lerp(-8, 8, random())
  const horizonShift = lerp(-0.05, 0.05, random())
  const air = lerp(0.75, 1.45, random())

  // Horizon: the height of the light, composed for the frame. Tall frames keep more sky.
  const horizonY = lerp(lerp(0.95, 0.96, tallShare), lerp(0.62, 0.7, tallShare), mood) + horizonShift
  const skyHeight = horizonY * tall

  // Intensity is daylight: the zenith gains the most, the low sky less and the glow least;
  // the glow rises, widens and pales, and the sun's core whitens near the sun only.
  const zenithGain = stops2(intensity, 1.6)
  const lowGain = look.lowSkyGain * stops2(intensity, look.lowSkyGain < 1 ? 0.3 : 0.7)
  const glowGain = stops2(intensity, 0.6)
  const sunGain = stops2(intensity, 2.4)
  const day = stops2(intensity, 0.7)
  const [path, deeper, paler] = look.path

  // Softness is haze: wider edges and glow, a softer land edge, a duller horizon band.
  const haze = stops2(softness, 1.4)
  const glowHaze = stops2(softness, 0.8)
  // The glow is larger where more sky shows, so a tall frame doesn't get a thin stripe.
  const skyScale = 0.72 + 0.36 * Math.min(skyHeight, 1.6)

  const glowScale = glowHaze * day * skyScale * air
  const glowRise = 0.09 * day * skyScale * air * stops2(softness, 0.5)
  const skyEdgeAt = -0.55 * skyHeight * skyEdgeScale
  const skyEdgeWidth = 0.85 * Math.abs(skyEdgeAt) * Math.sqrt(haze)
  const narrow = 0.65 + 0.35 * Math.min(1, frameWidth / 1.78)

  const params: Record<string, ParamValue> = {
    anchor: [0.5, horizonY],
    angle: tilt,
    drop: dome,
    stops: 2,
    at1: skyEdgeAt,
    width1: skyEdgeWidth,
    gain1: zenithGain,
    gain2: lowGain,
    horizonEdge: 0,
    warp: 0.01 * skyScale,
    warpScale: 1.6,
    warpPhase,
    warpOctaves: 3,
    warpReach: 0.3,
    softVary: 0.25 + 0.35 * softness,
    softScale: 1.3,
    softReach: 0.3,
    drift: 0.16,
    driftScale: 1.4,
    vary: 0.3,
    softness: 0,
    sunAt: [sunX, horizonY + 0.03 / tall],
    sunlight: 0.3 * glowGain,
    sunlightWidth: 0.55 * glowWidthScale * day * narrow,
    sunlightHeight: 0.6,
    sunlightWarmth: 0,
    falloff: 1.6,
    widen: 1.2,
    glow: look.glow * glowGain,
    glowOffset: -glowRise,
    glowVary: 0.35,
    glowVaryScale: 1.3,
    glowLateral: 1 - look.floor * narrow,
    glowWidth: 0.6 * glowWidthScale * day * glowHaze * narrow,
    glow1Weight: 1,
    glow1Up: 0.1 * glowScale,
    glow1Down: 0.06 * glowHaze * skyScale,
    glow2Weight: 0.2 * lerp(0.6, 1.5, softness),
    glow2Up: 0.17 * glowScale,
    glow2Down: 0.08 * glowHaze,
    extinction: 2,
    horizonDim: (1 - look.horizonGain) * 7 * stops2(softness, -0.6),
    horizonDimHeight: 0.04 * skyScale * Math.sqrt(haze),
    reddenDown: deeper * stops2(1 - intensity, 1.1) * stops2(1 - softness, 0.6),
    reddenUp: paler > 0 ? clamp01(paler + (intensity - 0.5) * 0.35) * 0.9 : 0,
    reddenSide: look.sideDeeper,
    glowPath: path - (intensity - 0.5) * 0.5,
    sunGlow: 0.25 * sunGain,
    sunGlow1Radius: 0.05 * glowScale,
    sunGlow1Weight: 1,
    sunGlow2Radius: 0.18 * glowScale,
    sunGlow2Weight: 0.35,
    sunGlowAspect: 2.5,
    sunGlowBeta: 1.3,
    occlude: 0.85,
    occludeWidth: 0.04 * glowHaze,
    bridge: look.bridge,
    bridgeLift: 0.15 + 0.1 * softness,
    bridgeWarmth: 0.6,
    bridgeFloor: 0.18,
    land: 1,
    landAt: horizonY + 0.01 / tall,
    landTilt: hillSlope,
    landDrop: 0,
    landWarp: 0.03 * hillAmount,
    landWarpScale: hillScale,
    landWarpPhase: hillPhase,
    landOctaves: 3,
    landSoft: 0.05 * stops2(softness, 1.6),
    landSoftVary: 0.5,
    landTopGain: look.landTop[1] * stops2(intensity, 0.8),
    landBottomGain: look.landBottom[1] * stops2(intensity, 0.8),
    landDepth: 0.14,
    landLight: 0,
    landLightWidth: 0.4,
    landLightDepth: 0.06,
  }
  return { colors: slotColors(look), params, lens: {}, output: { exposure: 0 } }
}
