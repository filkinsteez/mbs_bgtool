import { getPack, type PackId } from '../../color/packs'
import type { Composition, ControlValues, ParamValue } from '../../scene'
import { edgeFbm, wiggle } from './ramp-noise'

const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** 2 to the power of `stops` times (t - 0.5): 1 at the middle of a control. */
const stops2 = (t: number, stops: number) => 2 ** ((t - 0.5) * stops)
const WARP_SCALE = 1.6
const WARP_OCTAVES = 3

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
  /** Strength of the glow's long, pale haze tail relative to the default. */
  haze: number
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
      const ground = { landTop: [metaBlue, 0.4] as [string, number], landBottom: [metaBlue, 0.1] as [string, number] }
      if (pick < 0.55) {
        return { ...sky, lowSky: cyan, lowSkyGain: 0.85, light: yellow, glow: 0.92, path: [0.5, 2, 0.45], bridge: 0.35, haze: 0.5, floor: 0.1, sideDeeper: 0.4, ...ground }
      }
      return { ...sky, light: yellow, glow: 0.95, path: [0.4, 2, 0.45], bridge: 0.5, haze: 0.75, floor: 0.1, sideDeeper: 0.4, ...ground }
    }
    case 'elemental': {
      const [, forest, tan, plum] = rest
      const base = { ...sky, light: tan, glow: 1.35, path: [0.45, 1.25, 0.4] as [number, number, number], bridge: 0.45, haze: 0.8, floor: 0.1, sideDeeper: 0.3 }
      if (pick < 0.65) return { ...base, landTop: [metaBlue, 0.38], landBottom: [plum, 0.8] }
      return { ...base, landTop: [metaBlue, 0.38], landBottom: [forest, 0.8] }
    }
    case 'atmospheric': {
      const [ice, , slate, nearBlack] = rest
      const base = { ...sky, lowSkyGain: 1.2, horizonGain: 0.82, light: ice, glow: 0.42, path: [0, 0, 0] as [number, number, number], bridge: 0.3, haze: 0.8, floor: 0.08, sideDeeper: 0 }
      if (pick < 0.5) return { ...base, landTop: [slate, 0.95], landBottom: [nearBlack, 0.9] }
      return { ...base, landTop: [metaBlue, 0.38], landBottom: [nearBlack, 0.95] }
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
  const tilt = lerp(-3.5, 3.5, random())
  const glowWidthScale = lerp(0.78, 1.3, random())
  const skyEdgeScale = lerp(0.68, 1, random())
  const hillPhase = lerp(-8, 8, random())
  const hillTarget = lerp(0.008, 0.022, random())
  const hillScale = lerp(0.8, 2.8, random())
  const hillSlope = lerp(-0.08, 0.08, random())
  const dome = lerp(0, 0.025, random())
  const warpPhase = lerp(-8, 8, random())
  const horizonShift = lerp(-0.05, 0.05, random())
  const air = lerp(0.75, 1.45, random())

  // Horizon: the height of the light, composed for the frame. Tall frames keep more sky.
  const horizonY = lerp(lerp(0.95, 0.96, tallShare), lerp(0.66, 0.72, tallShare), mood) + horizonShift
  const skyHeight = horizonY * tall

  // Intensity is daylight: the zenith gains the most, the low sky less and the glow least;
  // the glow rises, widens and pales, and the sun's core whitens near the sun only.
  const zenithGain = stops2(intensity, 1.6)
  const lowGain = look.lowSkyGain * stops2(intensity, look.lowSkyGain < 1 ? 0.8 : 0.7)
  const glowGain = stops2(intensity, 0.4)
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
  const narrow = 0.65 + 0.35 * Math.min(1, frameWidth / 1.78)

  // The hills' wiggle across the visible width, whatever the seed's noise does there; hills
  // stay at least ten times wider than tall.
  const half = frameWidth / 2
  const hillWiggle = Math.min(hillTarget, 1 / (29 * hillScale))
  const hillNoise = (x: number) => edgeFbm(x * hillScale + hillPhase, Math.round(seed) + 211, 3)
  const hillWarp = Math.min(0.12, hillWiggle / Math.max(1e-3, wiggle(hillNoise, -half, half)))
  const landSoft = 0.03 + 0.04 * stops2(softness, 1.8)

  // The land follows the sky's horizon line (its tilt, dome and warp) and its hills rise above
  // it, with the deepest valley just above the horizon: a valley shows the bright band above the
  // horizon, never the dim sky below it.
  const skyWarp = 0.01 * skyScale
  const turn = (tilt * Math.PI) / 180
  const skyLift = (x: number) => (skyWarp * edgeFbm(x * Math.cos(turn) * WARP_SCALE + 3.7 + warpPhase, Math.round(seed), WARP_OCTAVES)) / Math.cos(turn)
  let lowest = -Infinity
  let mean = 0
  for (let i = 0; i <= 64; i++) {
    const x = -half + (i / 64) * 2 * half
    const below = hillSlope * x + hillWarp * hillNoise(x) - skyLift(x)
    lowest = Math.max(lowest, below)
    mean += below / 65
  }
  // The land's mean edge stays at the composed horizon height; the sky's horizon sits below it.
  const landBelow = lowest + 0.5 * landSoft
  const skyY = horizonY + (0.01 + landBelow - mean) / tall
  const landAt = skyY - landBelow / tall

  const skyEdgeAt = -(look.lowSkyGain < 1 ? 0.42 : 0.55) * skyHeight * skyEdgeScale
  const skyEdgeWidth = 1.1 * Math.abs(skyEdgeAt) * Math.sqrt(haze)

  const params: Record<string, ParamValue> = {
    anchor: [0.5, skyY],
    angle: tilt,
    drop: dome,
    stops: 2,
    at1: skyEdgeAt,
    width1: skyEdgeWidth,
    gain1: zenithGain,
    gain2: lowGain,
    horizonEdge: 0,
    warp: skyWarp,
    warpScale: WARP_SCALE,
    warpPhase,
    warpOctaves: WARP_OCTAVES,
    warpReach: 0.3,
    softVary: 0.25 + 0.35 * softness,
    softScale: 1.3,
    softReach: 0.3,
    drift: 0.16,
    driftScale: 1.4,
    vary: 0.3,
    softness: 0,
    sunAt: [sunX, skyY + 0.03 / tall],
    sunlight: 0.3 * glowGain,
    sunlightWidth: 0.55 * glowWidthScale * Math.sqrt(day) * narrow,
    sunlightHeight: 0.6,
    sunlightWarmth: 0,
    falloff: 1.6,
    widen: 1.4,
    lightTop: skyHeight * lerp(0.9, 1.15, intensity),
    glow: look.glow * glowGain,
    glowOffset: -glowRise,
    glowVary: 0.15,
    glowVaryScale: 1.3,
    glowArch: 0.6,
    glowLateral: 1 - look.floor * narrow,
    glowWidth: 0.45 * glowWidthScale * Math.sqrt(day) * glowHaze * narrow,
    shadowHeight: 0.07 * skyScale * glowHaze,
    glow1Weight: 1,
    glow1Up: 0.1 * glowScale,
    glow1Down: (0.03 + 0.03 * glowHaze) * skyScale,
    glow2Weight: 0.2 * look.haze * lerp(0.6, 1.5, softness),
    glow2Up: 0.17 * glowScale,
    glow2Down: 0.08 * glowHaze,
    extinction: 1.2,
    horizonDim: (1 - look.horizonGain) * 5 * stops2(softness, -0.6),
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
    bridgeLift: 0.12 + 0.12 * softness,
    bridgeWarmth: 0.6,
    bridgeFloor: 0.18,
    land: 0.92,
    landAt,
    landTilt: hillSlope - Math.tan(turn),
    landDrop: dome * Math.cos(turn),
    landWarp: hillWarp,
    landWarpScale: hillScale,
    landWarpPhase: hillPhase,
    landOctaves: 3,
    landSoft,
    landSoftVary: 0.7,
    landTopGain: look.landTop[1] * stops2(intensity, 0.8),
    landBottomGain: look.landBottom[1] * stops2(intensity, 0.8),
    landDepth: 0.6,
    landLight: 0,
    landLightWidth: 0.4,
    landLightDepth: 0.06,
  }
  return { colors: slotColors(look), params, lens: {}, output: { exposure: 0 } }
}
