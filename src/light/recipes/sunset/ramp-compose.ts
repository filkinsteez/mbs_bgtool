import { getPack, type PackId } from '../../color/packs'
import type { Composition, ControlValues, ParamValue } from '../../scene'
import { hexToLinear } from '../../color/srgb'

const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** 2 to the power of `stops` times (t - 0.5): 1 at the middle of a control. */
const stops2 = (t: number, stops: number) => 2 ** ((t - 0.5) * stops)
const luminance = (hex: string, gain: number) => {
  const [r, g, b] = hexToLinear(hex)
  return gain * (0.2126 * r + 0.7152 * g + 0.0722 * b)
}
/** Width of a 16:9 frame in short sides. */
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

/** Index of the seed's run of four: seeds 1-4 are run 0, 5-8 run 1, and so on. */
const seedRun = (seed: number) => Math.floor((Math.round(seed) - 1) / 4)

/** Every run of four seeds holds each structure once, in a seeded order. */
export function rampStructure(seed: number): RampStructure {
  const n = Math.round(seed) - 1
  const random = seeded(seedRun(seed) * 7919 + 101)
  const order = [...RAMP_STRUCTURES]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const swap = order[i]
    order[i] = order[j]
    order[j] = swap
  }
  return order[((n % 4) + 4) % 4]
}

/** The frame in short-side units around its center: half its width and its height. */
interface Frame {
  half: number
  tall: number
}

/** The ramp's anchor (short-side units from the frame center), tilt (radians) and bend, as the shader reads them. */
interface RampAxis {
  anchorX: number
  anchorY: number
  turn: number
  drop: number
}

/** The shader's base coordinate at a point (y down): distance down the tilted, bent axis from the anchor. */
function rampAt(f: Frame, r: RampAxis, x: number, y: number): number {
  const dx = x - r.anchorX
  const dy = y - r.anchorY
  const along = dx * Math.sin(r.turn) + dy * Math.cos(r.turn)
  const across = dx * Math.cos(r.turn) - dy * Math.sin(r.turn)
  return along - (r.drop * across * across) / (f.half * f.half)
}

/** The anchor height that puts the horizon line just below the whole bottom edge of the frame. */
function anchorBelow(f: Frame, r: Omit<RampAxis, 'anchorY'>, margin: number): number {
  let anchorY = f.tall / 2
  for (let k = 0; k < 4; k++) {
    let lowest = -Infinity
    for (let i = 0; i <= 32; i++) lowest = Math.max(lowest, rampAt(f, { ...r, anchorY }, -f.half + (i / 32) * 2 * f.half, f.tall / 2))
    anchorY += (lowest + margin) / Math.cos(r.turn)
  }
  return anchorY
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
  /** The one light: the glow and the sunlight tint. */
  light: string
  /** The sun glow's color. */
  coreColor: string
  /** Glow strength at the sun's side at the default Intensity. */
  glow: number
  /**
   * The light's path through the air at the glow line (0 is the pack color itself, below 0 a
   * paler member of its family, above 0 a deeper one), how much deeper it gets toward the
   * horizon and how much paler above the glow.
   */
  path: [number, number, number]
  /** How far the seed moves the light to a paler (below 0) or deeper member of its family. */
  hue: [number, number]
  /** Bridge light amount, lift and warmth; more for pairs that otherwise mix through a hue the pack doesn't have. */
  bridge: number
  bridgeLift: number
  bridgeWarmth: number
  /** Strength of the glow's long, pale haze tail relative to the default. */
  haze: number
  /**
   * How far the glow reaches below its line, relative to the line's height above the horizon:
   * deep red may darken toward the horizon, but darker orange, yellow or tan turn brown.
   */
  downReach: number
  /** How much deeper the light gets away from the sun. */
  sideDeeper: number
  /** Sun glow strength relative to the default, and at the arcs' center; a pale light makes a white spot sooner. */
  sunGlow: number
  core: number
  /** Least share of the glow that stays far from the sun, and least glow height above the horizon. */
  minFloor: number
  minLift: number
  /**
   * The band below a wavy horizon, near the horizon and at the bottom, with gains. It starts as a
   * deeper Meta Blue, the sky in the Earth's shadow; a dark pack color as its top reads as ground.
   */
  darkTop: Tone
  darkBottom: Tone
  /** How much redder the light gets below a wavy horizon's glow line. */
  waveRedden: number
}

/**
 * The pack's sky, light and dark band for one seed and structure. Every color is a pack hex.
 * `darkAlt` picks the other dark band, so consecutive wavy seeds differ.
 */
function packLook(packId: PackId, structure: RampStructure, darkAlt: boolean, random: () => number): PackLook {
  const [metaBlue, ...rest] = getPack(packId).colors.map((c) => c.hex)
  const pickLight = random()
  const pickSky = random()
  const sky = {
    zenith: metaBlue,
    lowSky: metaBlue,
    lowSkyGain: 1.3,
    horizonGain: 0.9,
    skyEdge: [0.55, 1.1] as [number, number],
    bridgeLift: 0.12,
    bridgeWarmth: 0.6,
    downReach: 4,
    sunGlow: 1,
    core: 1.5,
    minFloor: 0,
    minLift: 0,
    darkTop: [metaBlue, 0.8] as Tone,
    waveRedden: 3,
  }
  switch (packId) {
    case 'bold': {
      const [cyan, yellow, orangeRed] = rest
      const darkBottom: Tone = [metaBlue, 0.2]
      // Orange-red lights open and corner skies over a Cyan low sky: the two add up to a pale
      // neutral. The arcs' dome and a wavy horizon's band reach above the Cyan, where Orange-red
      // and Meta Blue add up to violet and pink, so those take Yellow.
      if (pickLight < 0.55 && (structure === 'open' || structure === 'corner')) {
        return { ...sky, lowSky: cyan, lowSkyGain: 0.85, horizonGain: 0.7, skyEdge: [0.62, 0.75], light: orangeRed, coreColor: orangeRed, glow: 0.9, path: [-0.15, 0.5, 0.45], hue: [-0.25, 0.2], bridge: 1.2, bridgeLift: 0.45, bridgeWarmth: 0.6, haze: 0.3, downReach: 0.75, sideDeeper: 0.3, darkBottom }
      }
      // Over a wavy horizon the low sky stays Meta Blue: Cyan dimmed toward the horizon turns teal-grey.
      const cyanSky = pickSky < 0.5 && structure !== 'wave'
      const low = cyanSky ? { lowSky: cyan, lowSkyGain: 0.85, skyEdge: [0.42, 1.1] as [number, number] } : {}
      return { ...sky, ...low, light: yellow, coreColor: yellow, glow: cyanSky ? 0.92 : 0.95, path: [cyanSky ? 0.5 : 0.4, 1, 0.45], hue: [-0.3, 0.35], bridge: cyanSky ? 0.35 : 0.5, haze: cyanSky ? 0.5 : 0.75, sideDeeper: 0.4, core: 2, darkBottom }
    }
    case 'elemental': {
      // No Lime: as the light it is a pale green band, as the sun's core a spot on the bottom edge,
      // and as the bridge's tint it turns the bridge grey.
      const [, forest, tan, plum] = rest
      // Forest only under cool light: a wavy horizon whose glow is a pale Meta Blue, with Forest as
      // the deepest ground. Warm light over Forest mixes to olive.
      if (structure === 'wave' && darkAlt) {
        return { ...sky, light: metaBlue, coreColor: metaBlue, glow: 0.75, path: [-0.75, 0, 0], hue: [-0.15, 0.1], bridge: 0.2, haze: 0.8, sideDeeper: 0, sunGlow: 0, darkBottom: [forest, 1.3], waveRedden: 0 }
      }
      return { ...sky, light: tan, coreColor: tan, glow: 1.35, path: [0.1, 0.3, 0.4], hue: [-0.3, 0.1], bridge: 0.45, haze: 0.8, sideDeeper: 0.1, darkBottom: [plum, 1.4] }
    }
    case 'atmospheric': {
      const [ice, , slate, nearBlack] = rest
      // Ice makes a white spot wherever its light is concentrated, so it gets no sun glow and a wide, flat band.
      const darkBottom: Tone = darkAlt ? [nearBlack, 1.2] : [slate, 1.2]
      return { ...sky, lowSkyGain: 1.2, light: ice, coreColor: ice, glow: 0.42, path: [0, 0, 0], hue: [0, 0], bridge: 0.3, haze: 0.8, sideDeeper: 0, sunGlow: 0, core: 0, minFloor: 0.65, minLift: 0.08, darkBottom }
    }
    default: {
      const unknown: never = packId
      throw new Error(`Unknown pack: ${String(unknown)}`)
    }
  }
}

/**
 * Slot hexes for the recipe: eight stops, two glow layers, sun glow, sunlight tint, then the unused
 * land slots. `midSky` puts a second, lighter Meta Blue step between the zenith and the low sky.
 */
function slotColors(look: PackLook, structure: RampStructure, midSky: boolean): string[] {
  const sky = midSky ? [look.zenith, look.zenith, look.lowSky] : [look.zenith, look.lowSky]
  const below = structure === 'wave' ? [look.darkTop[0], look.darkBottom[0]] : []
  const used = [...sky, ...below]
  const stops = [...used, ...Array.from({ length: 8 - used.length }, () => used[used.length - 1])]
  return [...stops, look.light, look.light, look.coreColor, look.light, '#000000', '#000000', '#000000']
}

/** Whether a seed's sky has a second, lighter Meta Blue step. */
const hasMidSky = (seed: number) => seeded(seed * 31 + 7)() < 0.5

/** The slot colors the recipe uses for a pack and seed. */
export function rampPackColors(packId: PackId, seed: number): string[] {
  const structure = rampStructure(seed)
  return slotColors(packLook(packId, structure, darkAlternate(seed), seeded(seed)), structure, hasMidSky(seed))
}

/** Every other run of four seeds takes the pack's other dark band. */
const darkAlternate = (seed: number) => seedRun(seed) % 2 !== 0

/**
 * A Sunset ramp scene for a pack, the tool controls, a seed and the frame's
 * width over height. Lengths are in short-side units, about 40 degrees of
 * sky. The seed picks the structure, the light color and the dark band
 * (where a pack has a choice), and within the structure moves the sun's side
 * and position, the tilt and bend, the glow's height, width and color, the
 * number and height of the sky's edges and the horizon's waves.
 */
export function composeRamp(packId: PackId, controls: ControlValues, seed: number, aspect: number): Composition {
  const structure = rampStructure(seed)
  const random = seeded(seed)
  const look = packLook(packId, structure, darkAlternate(seed), random)
  const intensity = clamp01(controls.intensity)
  const softness = clamp01(controls.softness)
  const mood = clamp01(controls.mood)

  const tall = Math.max(1, 1 / aspect)
  const frameWidth = Math.max(1, aspect)
  const half = frameWidth / 2
  const frame: Frame = { half, tall }
  const tallShare = clamp01((tall - 1) / 0.78)
  const narrow = 0.65 + 0.35 * Math.min(1, frameWidth / WIDE)

  // The sun's side alternates between runs and between structures, so a structure's repeats light both sides.
  const sunRight = (seedRun(seed) + RAMP_STRUCTURES.indexOf(structure)) % 2 === 0
  const side = sunRight ? 1 : -1
  // Each pick moves one thing continuously within the structure.
  const sunPick = random()
  const tiltPick = random()
  const widthPick = random()
  const edgePick = random()
  const bendPick = random()
  const shift = random() * 2 - 1
  const air = lerp(0.7, 1.5, random())
  const wavePick = random()
  const wanderPick = random()
  const bandPick = random()
  const depthPick = random()
  const huePick = random()
  const latticePick = random()
  const floorPick = random()
  const risePick = random()

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
      lift = lerp(0.04, 0.26, mood) + 0.09 * shift
      sunIn = lerp(-0.35, 0.3, sunPick)
      tilt = side * lerp(0.5, 6, tiltPick)
      dome = lerp(-0.01, 0.03, bendPick)
      floor = lerp(0.45, 0.85, floorPick)
      lateral = lerp(0.9, 1.6, widthPick)
      sunlight = 0.35
      break
    case 'corner':
      lift = lerp(0.05, 0.24, mood) + 0.08 * shift
      sunIn = lerp(-0.2, 0.08, sunPick)
      tilt = side * lerp(4, 14, tiltPick)
      dome = lerp(-0.03, 0.015, bendPick)
      floor = lerp(0.02, 0.15, floorPick)
      lateral = lerp(0.6, 1.1, widthPick)
      sunlight = 0.55
      break
    case 'arcs':
      // The arcs center on the sun, off the frame's center, and lean toward it.
      lift = lerp(0.04, 0.22, mood) + 0.05 * shift
      sunIn = lerp(0.1, 0.4, sunPick)
      tilt = side * lerp(0, 6, tiltPick)
      dome = lerp(0.04, 0.1, bendPick) * frameWidth
      floor = lerp(0.25, 0.55, floorPick)
      lateral = lerp(1.1, 1.8, widthPick)
      sunlight = 0.2
      break
    case 'wave':
      // The Earth's shadow: a darker band rising from the horizon under a pale warm band, on the
      // side of the sky away from the sun, so no sun sits on the horizon.
      horizonY = lerp(lerp(0.82, 0.86, tallShare), lerp(0.62, 0.68, tallShare), mood) + 0.05 * shift
      sunIn = lerp(-0.7, -0.3, sunPick)
      tilt = lerp(-4, 4, tiltPick)
      dome = lerp(-0.02, 0.008, bendPick)
      floor = lerp(0.6, 0.9, floorPick)
      lateral = lerp(1.1, 1.7, widthPick)
      sunlight = 0.1
      break
    default: {
      const unknown: never = structure
      throw new Error(`Unknown structure: ${String(unknown)}`)
    }
  }
  floor = Math.max(floor, look.minFloor)
  lift = Math.max(lift, look.minLift)
  const wave = structure === 'wave'
  const arcs = structure === 'arcs'
  const sunX = sunRight ? 1 - sunIn : sunIn
  const turn = (tilt * Math.PI) / 180
  const anchorX = arcs ? (sunX - 0.5) * frameWidth : 0
  // The bend is set by how far the farther side edge drops.
  const drop = dome * (half / (half + Math.abs(anchorX))) ** 2
  const anchorY = wave ? (horizonY - 0.5) * tall : anchorBelow(frame, { anchorX, turn, drop }, 0.02)
  if (!wave) horizonY = anchorY / tall + 0.5
  const axis: RampAxis = { anchorX, anchorY, turn, drop }
  const skyHeight = horizonY * tall
  // A short sky has no room for a second step: its edges would crowd and the fold guard calm them all.
  const midSky = hasMidSky(seed) && skyHeight >= 0.9

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
  const glowRise = wave ? 0.09 * lerp(0.7, 1.35, risePick) * day * skyScale * air * stops2(softness, 0.5) : lift * Math.sqrt(day) * stops2(softness, 0.3)

  // The least height above the horizon along the top edge: the sky's edges and the sun's light
  // stay below it, so the top of the frame is the pack's Meta Blue.
  let topHeight = Infinity
  for (let i = 0; i <= 32; i++) topHeight = Math.min(topHeight, -rampAt(frame, axis, -half + (i / 32) * frameWidth, -tall / 2))
  const skyEdgeAt = -look.skyEdge[0] * topHeight * lerp(0.6, 0.92, edgePick)
  const skyEdgeWidth = look.skyEdge[1] * Math.abs(skyEdgeAt) * Math.sqrt(haze)

  // Every edge and the glow move with the shared boundary model (ramp-boundary.ts): the sky
  // edge most, the glow and the horizon less, the ground least. A softer sky drifts a little more.
  const drift = Math.sqrt(haze)
  const skyWander = lerp(0.012, 0.018, wanderPick) * drift
  const boundaryWander = wave
    ? [skyWander, 0.013 * drift, lerp(0.012, 0.02, wavePick) * drift, 0.007 * drift]
    : [skyWander, 0.012 * drift, 0.01 * drift, 0.006 * drift]
  const lattice = wave ? lerp(0.4, 0.6, latticePick) : lerp(0.32, 0.52, latticePick)

  // The upper sky deepens slowly toward the top edge and away from the sun, 3 % and 2 % either
  // way, so the pack's Meta Blue is the mean of the top fifth of the frame, not a flat fill.
  let sSum = 0
  let aSum = 0
  let topSum = 0
  for (let k = 0; k <= 8; k++) {
    for (let i = 0; i <= 16; i++) {
      const x = -half + (i / 16) * frameWidth
      const y = -tall / 2 + (k / 8) * 0.2 * tall
      const s = rampAt(frame, axis, x, y)
      sSum += s
      aSum += (x * Math.cos(turn) - y * Math.sin(turn)) / half
      if (k === 0) topSum += s
    }
  }
  const sRef = sSum / (9 * 17)
  const zenithShade = [0.03 / Math.max(0.05, sRef - topSum / 17), sRef, 0.02 * side, aSum / (9 * 17)]

  // Over a wavy horizon the sky dims down to the band's own brightness, so the soft step into the
  // band has no bright or dark seam.
  const darkTopGain = look.darkTop[1] * groundGain
  const seamDim = wave ? Math.max(0, Math.log(luminance(look.lowSky, lowGain) / luminance(look.darkTop[0], darkTopGain))) : 0

  // The stop edges, top down. A second, lighter Meta Blue step splits the sky's edge in two: a
  // wide one higher up and a narrower one lower down, each with its own shape. Below a wavy
  // horizon: a wide, soft step into the dark band, then a wider one to its bottom.
  const midGain = zenithGain * (look.lowSky === look.zenith ? Math.sqrt(lowGain / zenithGain) : 1.18)
  const edges: [at: number, width: number][] = midSky
    ? [
        [skyEdgeAt * lerp(1.15, 1.4, bandPick), 0.75 * skyEdgeWidth],
        [skyEdgeAt * lerp(0.5, 0.7, depthPick), 0.45 * skyEdgeWidth],
      ]
    : [[skyEdgeAt, skyEdgeWidth]]
  // The highest edge's upper tail stays out of the top quarter of the frame, where Meta Blue is the mean.
  const [topAt, topWidth] = edges[0]
  const room = (topHeight - 0.25 * tall) / (Math.abs(topAt) + 0.5 * topWidth)
  if (room < 1) edges.forEach((edge) => (edge[0] *= Math.max(0.3, room)))
  edges[0][1] *= Math.max(0.3, Math.min(1, room))
  const gains = midSky ? [zenithGain, midGain, lowGain] : [zenithGain, lowGain]
  if (wave) {
    edges.push([0, lerp(0.1, 0.22, bandPick) * Math.sqrt(haze) * (1 + 0.3 * tallShare)])
    edges.push([lerp(0.15, 0.35, depthPick) * (1 + 0.4 * tallShare), lerp(0.25, 0.5, depthPick) * Math.sqrt(haze) * (1 + 0.4 * tallShare)])
    gains.push(darkTopGain, look.darkBottom[1] * groundGain)
  }
  const stopParams: Record<string, number> = {}
  edges.forEach(([at, width], j) => {
    stopParams[`at${j + 1}`] = at
    stopParams[`width${j + 1}`] = width
  })
  gains.forEach((gain, k) => (stopParams[`gain${k + 1}`] = gain))

  const params: Record<string, ParamValue> = {
    anchor: [anchorX / frameWidth + 0.5, horizonY],
    angle: tilt,
    drop,
    stops: gains.length,
    ...stopParams,
    // The horizon is the edge into the dark band (numbered from 1), or the anchor line below the frame.
    horizonEdge: wave ? edges.length - 1 : 0,
    zenithShade,
    warp: 0,
    softVary: 0,
    softFollow: 0,
    drift: 0,
    vary: 0,
    softness: 0,
    boundaryWander,
    // A wavy horizon's sky holds many transitions in little height: its noise row changes more
    // slowly across them, or the fold guard calms the whole frame.
    boundaryNoise: [0.35, lattice, 0.25, wave ? 2.5 : 2],
    // Wide edges change their softness less (the 0.15 width), or their color climbs higher in columns.
    boundarySoft: [0.15, 0.5, 0.25, 0.15],
    // The arcs' center: the sun right at the horizon, so its core shows at the bottom edge.
    sunAt: [sunX, horizonY + (arcs ? 0 : 0.03 / tall)],
    sunlight: sunlight * glowGain,
    sunlightWidth: 0.55 * lateral * lerp(0.75, 1.3, widthPick) * Math.sqrt(day) * narrow,
    sunlightHeight: 0.6,
    sunlightWarmth: 0,
    falloff: structure === 'corner' ? 2.2 : 1.6,
    widen: arcs ? 0.3 : 1.4,
    falloffRound: 0.6,
    // The sun's added light fades out below the top fifth, which holds only the sky's own light.
    lightTop: (topHeight - 0.2 * tall - 2.5 * skyWander) * lerp(0.85, 1.15, intensity),
    glow: look.glow * glowGain * (arcs ? 1.2 : 1),
    glowOffset: -glowRise,
    glowVary: 0,
    glowArch: wave ? 0.15 : 0.6,
    glowLateral: 1 - floor * narrow,
    glowWidth: 0.45 * lateral * Math.sqrt(day) * glowHaze * narrow,
    shadowHeight: 0,
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
    // Below a wavy horizon's glow the light is redder, so where it mixes with the blue band it
    // passes through pink and mauve instead of a grey.
    reddenDown: (wave ? look.waveRedden : deeper) * stops2(1 - intensity, 1.1) * stops2(1 - softness, 0.6),
    reddenEase: 1,
    reddenUp: paler > 0 ? clamp01(paler + (intensity - 0.5) * 0.35) * 0.9 : 0,
    reddenSide: look.sideDeeper,
    glowPath: path + lerp(look.hue[0], look.hue[1], huePick) - (intensity - 0.5) * 0.5,
    sunGlow: wave ? 0 : 0.25 * sunGain * look.sunGlow * (arcs ? look.core : 1),
    sunGlow1Radius: 0.05 * glowScale,
    sunGlow1Weight: 1,
    sunGlow2Radius: 0.18 * glowScale,
    sunGlow2Weight: 0.35,
    sunGlowAspect: 2.5,
    sunGlowBeta: 1.3,
    occlude: 0.85,
    occludeWidth: 0.04 * glowHaze,
    bridge: look.bridge * stops2(intensity, 1.2),
    bridgeLift: look.bridgeLift + 0.12 * softness,
    bridgeWarmth: look.bridgeWarmth,
    bridgeFloor: 0.3,
    land: 0,
  }
  return { colors: slotColors(look, structure, midSky), params, lens: {}, output: { exposure: 0 } }
}
