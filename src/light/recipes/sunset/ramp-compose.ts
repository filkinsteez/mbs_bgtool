import { getPack, type PackId } from '../../color/packs'
import { hexToSrgb, srgbToLinearRgb } from '../../color/srgb'
import type { Composition, ControlValues, ParamValue } from '../../scene'
import { horizonRise, horizonScene, placeHorizon } from './horizon'
import { limitTilt, rampLine } from './ramp-drag'
import { edgeFbm } from './ramp-noise'
import { RAMP_EDGES } from './ramp-shader'

const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const within = (range: readonly [number, number], t: number) => lerp(range[0], range[1], t)
/** 0 at `from`, 1 at `to` (either may be the larger), with no kink at either end. */
const smoothstep = (from: number, to: number, t: number) => {
  const x = clamp01((t - from) / (to - from))
  return x * x * (3 - 2 * x)
}
/** 2 to the power of `stops` times (t - 0.5): 1 at the middle of a control. */
const stops2 = (t: number, stops: number) => 2 ** ((t - 0.5) * stops)
/** Width of a 16:9 frame in short sides. */
const WIDE = 16 / 9

/** A pale tint of a pack color in linear light at luminance 1; `depth` 0 is white, 1 the color itself. */
function paleTint(hex: string, depth: number): number[] {
  const c = srgbToLinearRgb(hexToSrgb(hex))
  const m = Math.max(c[0], c[1], c[2], 1e-6)
  const tint = c.map((v) => Math.max(v / m, 0.004) ** depth)
  const luma = 0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2]
  return tint.map((v) => v / luma)
}
/** Largest tilt of the horizon, in degrees, that a dragged line gives water and land. */
const WATER_MOST_TILT = 10
const LAND_MOST_TILT = 18

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

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const order = [...items]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const swap = order[i]
    order[i] = order[j]
    order[j] = swap
  }
  return order
}

/**
 * How the frame is built. With open sky below the line (no horizon in the frame) it is one of
 * three skies: open with the light along the bottom (sky-peach), tilted with the light in a lower
 * corner (blue-diagonal), or wide arcs around a center below the frame (red-yellow-arcs). Water
 * (the sea, 33:106) and land (the ridge, 33:112) put the shared horizon in the frame.
 */
export type RampStructure = 'open' | 'corner' | 'arcs' | 'water' | 'land'
export const RAMP_STRUCTURES: readonly RampStructure[] = ['open', 'corner', 'arcs', 'water', 'land']
const OPEN_SKIES: readonly RampStructure[] = ['open', 'corner', 'arcs']

/** The shared horizon's scene for the seed; the open-sky seeds of every nine take each of the three skies once. */
export function rampStructure(seed: number): RampStructure {
  const below = horizonScene(seed)
  if (below !== 'open') return below
  const s = Math.round(seed)
  const block = Math.floor((s - 1) / 9)
  let k = 0
  for (let t = block * 9 + 1; t < s; t++) if (horizonScene(t) === 'open') k++
  return shuffled(OPEN_SKIES, seeded(block * 7919 + 101))[k % 3]
}

/** Index of the seed's run of three: seeds 1-3 are run 0, 4-6 run 1, and so on. */
const seedRun = (seed: number) => Math.floor((Math.round(seed) - 1) / 3)

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

/** How far down the axis the frame's lowest point lies, for any tilt: the largest base coordinate on its edges. */
function beyondFrame(f: Frame, r: RampAxis): number {
  let lowest = -Infinity
  for (let i = 0; i <= 32; i++) {
    const x = -f.half + (i / 32) * 2 * f.half
    const y = -f.tall / 2 + (i / 32) * f.tall
    lowest = Math.max(lowest, rampAt(f, r, x, f.tall / 2), rampAt(f, r, x, -f.tall / 2), rampAt(f, r, -f.half, y), rampAt(f, r, f.half, y))
  }
  return lowest
}

/** Land or water outline, as the shader's groundLine draws it: p.y at column x (short-side units, y down). */
interface Outline {
  at: number
  slope: number
  wave: number
  rise: number
  toward: number
  bowl: number
  waveLength: number
}

function outlineAt(o: Outline, half: number, x: number, seed: number): number {
  const u = Math.min(1, Math.max(-1, x / half))
  const toward = 0.5 + 0.5 * o.toward * u
  const ease = Math.min(1, Math.max(0, (toward - 0.05) / 0.95))
  let line = o.at + o.slope * x
  line -= o.rise * (0.5 * ease * ease * (3 - 2 * ease) + 0.5 * toward * toward - 0.35)
  line += o.bowl * (0.35 - u * u)
  if (o.wave > 0) line += o.wave * edgeFbm(x / o.waveLength + 5.3, Math.round(seed) + 913, 2)
  return line
}

type Tone = [hex: string, gain: number]

interface PackLook {
  /** Zenith color (Meta Blue) and the low sky with its gain at the default Intensity. */
  zenith: string
  lowSky: string
  lowSkyGain: number
  /** How much skylight is left right above the horizon. */
  horizonGain: number
  /**
   * Height of the sky's main edge as a share of the sky, its width relative to that height, and its
   * least width in short sides.
   */
  skyEdge: [number, number, number]
  /** The image's one light: the glow and the sunlight tint. */
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
  /** Bridge light amount, lift and warmth, and the luminance below which it fades out. */
  bridge: number
  bridgeLift: number
  bridgeWarmth: number
  bridgeFloor: number
  /** Strength of the glow's long, pale haze tail relative to the default. */
  haze: number
  /**
   * How far the glow reaches below its line, relative to the line's height above the horizon:
   * deep red may darken toward the horizon, but darker orange, yellow or tan turn brown.
   */
  downReach: number
  /** How much deeper the light gets away from the sun. */
  sideDeeper: number
  /** How far the glow reaches above its line, and how high its line sits over water and land, relative to the default. */
  glowUp: number
  glowRise: number
  /** Sun glow strength relative to the default, and at the arcs' center; a pale light makes a white spot sooner. */
  sunGlow: number
  core: number
  /** Least share of the glow that stays far from the sun, and least glow height above the horizon. */
  minFloor: number
  minLift: number
  /** Land right under its outline and at the bottom edge, and the water's own light, with gains: dark pack colors. */
  landTop: Tone
  landBottom: Tone
  water: Tone
  /**
   * Degrees below the horizon half a short side under the line, least and most. Fewer keep the reflection over
   * most of the water; more bring in the water's own dark color soon after the line, so the band
   * where the two mix (pink, mauve or lavender) stays thin.
   */
  waterDegrees: [number, number]
  /** Share of calm water's reflectance kept. */
  waterMirror: number
  /** Share of the sky's light in the air in front of far land: warm light over a dark land of another hue mixes to purple or mauve. */
  landHaze: number
  /** Extra light on the side toward the sun of the land and the water's own light. */
  landLit: number
  /** A dark band low in the sky in front of the glow, in a dark pack color, with its gain. */
  dusk: Tone | null
  /** Height in short sides of a far bank of land on the water's horizon, in the land's colors (0: none). */
  bank: number
  /** Strength of the sun's path on water, the glow mirrored down toward the viewer. */
  sunPath: number
  /** How much the glow's haze hides the sky behind it. */
  extinction: number
  /**
   * White light scattered over the sky under its far band of full Meta Blue, and more of it low
   * down, at the default Intensity (linear light).
   */
  veil: [main: number, low: number]
  /** White haze in front of far land (linear light); none over Elemental's Plum and Forest, which it would turn mauve. */
  groundVeil: number
  /**
   * The pack color whose pale tint the veil takes away from the light, so a frame that is all sky
   * still reads as its pack: white over Meta Blue would make the same periwinkle in every pack.
   */
  veilColor: string
}

/**
 * The pack's sky, light and ground for one seed and structure. Every color is a pack hex, and each
 * image has one light. `darkAlt` picks the other ground where a pack has one.
 */
function packLook(packId: PackId, structure: RampStructure, darkAlt: boolean, variant: number, random: () => number): PackLook {
  const [metaBlue, ...rest] = getPack(packId).colors.map((c) => c.hex)
  const pickLight = random()
  // A second pick no look uses; drawing it keeps every later pick of the seed the same.
  random()
  const ground = structure === 'water' || structure === 'land'
  const sky = {
    zenith: metaBlue,
    lowSky: metaBlue,
    lowSkyGain: 1.3,
    horizonGain: 0.9,
    // The low sky reaches high, so most of the sky is its own pale color and Meta Blue holds a
    // band at the far edge.
    skyEdge: [0.95, 1.1, 0.3] as [number, number, number],
    bridgeLift: 0.12,
    bridgeWarmth: 0.6,
    bridgeFloor: 0.3,
    downReach: 4,
    sunGlow: 1,
    core: 1.5,
    minFloor: 0,
    minLift: 0,
    waterDegrees: [12, 18] as [number, number],
    // Dimmed, the pale bridges in the reflection turn salmon or khaki; a little dimming only.
    waterMirror: 0.9,
    landHaze: 0.75,
    landLit: 0.5,
    dusk: null as Tone | null,
    bank: 0,
    sunPath: 0.85,
    extinction: 1.2,
    glowUp: 1,
    glowRise: 1,
    veil: [0.22, 0.12] as [number, number],
    groundVeil: 0.1,
    veilColor: metaBlue,
  }
  switch (packId) {
    case 'bold': {
      const [cyan, yellow, orangeRed] = rest
      const dark = { landTop: [metaBlue, 0.6] as Tone, landBottom: [metaBlue, 0.12] as Tone, water: [metaBlue, 0.3] as Tone, veilColor: cyan }
      // Orange-red over a Cyan low sky: the two add up to a pale neutral, which keeps its bridge
      // at low light too. It lights every water and land frame: reflected in water or spilled
      // over land, Yellow turns khaki.
      if (ground || (pickLight < 0.55 && (structure === 'open' || structure === 'corner'))) {
        // Where Orange-red meets the Cyan and blue sky the bridge is a pale peach-cream, not the
        // pink or mauve the two make when mixed; under the glow line and inside the glow's dense
        // haze the skylight fades out, so the glow's body is Orange-red itself. A compact, low glow
        // leaves a band of Cyan above it.
        return { ...sky, ...dark, lowSky: cyan, lowSkyGain: 1.8, horizonGain: 0.42, skyEdge: [0.95, 0.9, 0.15], veil: [0.16, 0.04], groundVeil: 0.05, light: orangeRed, coreColor: yellow, glow: 1.2, glowUp: 0.25, glowRise: structure === 'land' ? 0.62 : 0.25, path: [-0.15, 0.55, 0.45], hue: [-0.25, 0.2], bridge: 0.9, bridgeLift: 0.5, bridgeWarmth: 0.8, bridgeFloor: 0.1, haze: 0.3, downReach: 1.5, sideDeeper: 0.3, waterDegrees: [6, 9], landHaze: 0.03, extinction: 3 }
      }
      // Yellow under a band of Cyan, so Meta Blue, Cyan and the warm light all show.
      return { ...sky, ...dark, lowSky: cyan, lowSkyGain: 1.6, skyEdge: [0.97, 1.0, 0.3], veil: [0.16, 0.04], light: yellow, coreColor: yellow, glow: 0.7, glowUp: 0.5, path: [0.5, 1, 0.45], hue: [-0.3, 0.35], bridge: 0.5, haze: 0.5, sideDeeper: 0.4, core: 2 }
    }
    case 'elemental': {
      const [lime, forest, tan, plum] = rest
      // Little veil far from the light, where white over Meta Blue turns lavender; more near it, in
      // the light's own color.
      const dark = { landTop: [plum, 1.7] as Tone, landBottom: [plum, 0.6] as Tone, water: [metaBlue, 0.3] as Tone, groundVeil: 0, veil: [0.06, 0.18] as [number, number] }
      // Lime or Tan is the one light. Lime pales into Meta Blue through added light; it lights some
      // open skies and the Forest land, never water, where its dim reflection turns olive.
      // The sky's pale side is the light's own color, so a frame that is all sky still reads as
      // Elemental.
      const limeLight = { light: lime, coreColor: lime, glow: 1.0, path: [-0.2, 0, 0.35], hue: [-0.15, 0.1], bridge: 0.3, bridgeLift: 0.3, haze: 0.8, sideDeeper: 0, core: 1, lowSky: lime, lowSkyGain: 1.0 } satisfies Partial<PackLook>
      // Open skies end in a dark dusk band in front of the glow, Forest under Lime and Plum under
      // Tan, so three pack colors show.
      const dusk = (tone: Tone) => (ground ? {} : { dusk: tone, downReach: 0.35, glowUp: 0.6 })
      if (structure === 'land' && darkAlt) return { ...sky, ...dark, ...limeLight, landTop: [forest, 1.8], landBottom: [forest, 0.7], landHaze: 0.05, landLit: 0.35 }
      if (!ground && pickLight < 0.4) return { ...sky, ...dark, ...limeLight, ...dusk([forest, 1.2]) }
      // Tan meets Meta Blue through pale cream; mixed, the two make lavender or grey. Under the glow
      // line the skylight fades out, so the glow's body is Tan itself and the bridge acts only where
      // the two meet; the glow's dense haze hides the sky behind it. Water is nearly a mirror over
      // dark blue: seen through Plum, the mirrored Tan and cream turn mauve and grey, the blue violet.
      // Deepened, Tan turns brown, so it barely deepens toward the horizon or away from the sun.
      // Water has a far bank of Forest or Plum land on its horizon.
      const bank = structure === 'water' ? { bank: 0.17, ...(pickLight < 0.5 ? { landTop: [forest, 1.8] as Tone, landBottom: [forest, 0.7] as Tone } : {}) } : {}
      return { ...sky, ...dark, ...bank, extinction: 3, glowUp: 0.5, glowRise: 0.4, horizonGain: 0.42, landHaze: 0.05, landLit: 0.25, light: tan, coreColor: tan, lowSky: structure === 'water' ? metaBlue : tan, lowSkyGain: structure === 'water' ? 1.3 : 1.2, glow: 1.6, path: [0.1, 0.1, 0.4], hue: [-0.3, 0.1], bridge: 1.8, bridgeLift: 0.5, bridgeWarmth: 1, bridgeFloor: 0.1, haze: 0.8, sideDeeper: 0, waterDegrees: [1, 1.5], waterMirror: 1, ...dusk([plum, 1.0]) }
    }
    case 'atmospheric': {
      const [ice, steel, slate, nearBlack] = rest
      // Ice makes a white spot wherever its light is concentrated, so it gets no sun glow and a wide, flat band.
      // Each variant shows the greys in its own shares: a bright band over light Steel ground and
      // water, a dim band under a Steel low sky over Slate and Near-black, or a band over dark ground.
      const grounds: { landTop: Tone; landBottom: Tone; water: Tone }[] = [
        { landTop: [steel, 1.0], landBottom: [slate, 1.0], water: [steel, 1.0] },
        { landTop: [steel, 0.75], landBottom: [nearBlack, 1.0], water: [slate, 1.2] },
        { landTop: [slate, 1.0], landBottom: darkAlt ? [nearBlack, 1.0] : [slate, 0.7], water: [nearBlack, 1.5] },
      ]
      // The band is bright enough near its line to read as Ice; under it the light fades to Steel,
      // and open skies end in a Slate dusk band.
      // The sky's pale side is an overcast grey: Steel, or Ice in the third variant.
      return { ...sky, ...grounds[variant], lowSky: variant === 2 ? ice : steel, veilColor: steel, lowSkyGain: [1.5, 1.2, 1.2][variant], horizonGain: structure === 'water' ? 0.8 : 0.5, light: ice, coreColor: ice, glow: 0.62 * [1.3, 0.85, 1][variant], path: [0, 0, 0], hue: [0, 0], bridge: 0.3, haze: 0.8, downReach: 0.8, sideDeeper: 0, sunGlow: 0, core: 0, minFloor: 0.5, minLift: 0.08, ...(ground ? {} : { dusk: [slate, 1.0] as Tone, downReach: 0.45 }) }
    }
    default: {
      const unknown: never = packId
      throw new Error(`Unknown pack: ${String(unknown)}`)
    }
  }
}

/**
 * Slot hexes for the recipe: eight stops, two glow layers, sun glow, sunlight tint, the 1:1 land
 * slots (unused), then land top, land bottom and the water's own light. `midSky` puts a second,
 * lighter Meta Blue step between the zenith and the low sky; a dusk band is the last stop.
 */
function slotColors(look: PackLook, midSky: boolean): string[] {
  const sky = [look.zenith, ...(midSky ? [look.zenith] : []), look.lowSky, ...(look.dusk ? [look.dusk[0]] : [])]
  const stops = [...sky, ...Array.from({ length: 8 - sky.length }, () => sky[sky.length - 1])]
  return [...stops, look.light, look.light, look.coreColor, look.light, '#000000', '#000000', '#000000', look.landTop[0], look.landBottom[0], look.water[0]]
}

/** Whether a seed's sky has a second, lighter Meta Blue step. */
const hasMidSky = (seed: number) => seeded(seed * 31 + 7)() < 0.5

/** The slot colors the recipe uses for a pack and seed. */
export function rampPackColors(packId: PackId, seed: number): string[] {
  const structure = rampStructure(seed)
  return slotColors(packLook(packId, structure, darkAlternate(seed), seedVariant(seed), seeded(seed)), hasMidSky(seed))
}

/** Every other run takes the pack's other ground, so both show within the first eight seeds. */
const darkAlternate = (seed: number) => seedRun(seed) % 2 !== 0

/**
 * Which of three variants a seed takes. A structure repeats once per run of three seeds, so its
 * repeats in seeds 1-9 take all three variants and never look alike.
 */
const seedVariant = (seed: number) => seedRun(seed) % 3

/**
 * Share of the frame's height at the top that the sky's edges leave to the zenith's Meta Blue. It is
 * small, so the sky still changes slowly all the way to the top instead of ending in a flat field.
 */
const ZENITH_ROOM = 0.05
/** Sky height (short sides) at and above which the zenith's room is all of ZENITH_ROOM. */
const FULL_ZENITH = 0.2 / 0.45

/**
 * The room at the top of a sky of this height that holds only the zenith's Meta Blue, shrinking
 * with the square of a shorter sky's height. The room below it still grows with the sky's height.
 */
function zenithRoomOf(height: number, tall: number): number {
  const full = FULL_ZENITH * tall
  return ZENITH_ROOM * tall * Math.min(1, (height / full) ** 2)
}

/** The sky height whose room below the zenith's is `reach`: the inverse of height - zenithRoomOf(height). */
function skyTopOf(reach: number, tall: number): number {
  const full = FULL_ZENITH * tall
  if (reach >= full - ZENITH_ROOM * tall) return reach + ZENITH_ROOM * tall
  const a = (ZENITH_ROOM * tall) / (full * full)
  return (1 - Math.sqrt(Math.max(0, 1 - 4 * a * reach))) / (2 * a)
}

/** Over water and land, the glow's line's height above the horizon as a share of the sky's height. */
const glowShare = (look: PackLook, variant: number, pick: number, softness: number, day: number) =>
  lerp(0.25, 0.45, pick) * [0.85, 1.35, 1.05][variant] * stops2(softness, 0.3) * Math.sqrt(day) * look.glowRise

/**
 * A Sunset ramp scene for a pack, the tool controls, a seed and the frame's width over height.
 * Lengths are in short-side units, about 40 degrees of sky. The seed picks the scene below the
 * shared horizon (open sky, water or land), the light and the ground, and within each moves the
 * sun's side and position, the tilt and bend, the glow's height, width and color, the sky's edges,
 * the ridge and the patches of light in the sky. The scene is drawn sharp and seen through one
 * lens whose radius is the Softness.
 */
export function composeRamp(packId: PackId, controls: ControlValues, seed: number, aspect: number): Composition {
  const structure = rampStructure(seed)
  const random = seeded(seed)
  const variant = seedVariant(seed)
  const look = packLook(packId, structure, darkAlternate(seed), variant, random)
  const intensity = clamp01(controls.intensity)
  const softness = clamp01(controls.softness)
  const mood = clamp01(controls.mood)
  // Each variant puts the line at its own height, so a structure's repeats differ in layout. The
  // shift fades out toward both ends of the Horizon control, which keep the shared heights.
  const shared = placeHorizon(mood, seed, aspect)
  const lineShift = [-0.1, 0.05, 0][variant]
  const placed = { ...shared, y: shared.y + lineShift * Math.min(1, mood / 0.25, (1 - mood) / 0.25) }
  // A dragged line takes the Horizon control's place: the glow sits at its start, the horizon runs
  // across it, and the sky reaches the zenith's color at its end. The seed keeps everything else.
  const line = controls.drag ? rampLine(controls.drag, aspect) : null

  const tall = Math.max(1, 1 / aspect)
  const frameWidth = Math.max(1, aspect)
  const half = frameWidth / 2
  const frame: Frame = { half, tall }
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
  const wanderPick = random()
  const bandPick = random()
  const depthPick = random()
  const huePick = random()
  const latticePick = random()
  const floorPick = random()
  const risePick = random()
  const ridgePick = random()
  const bowlPick = random()
  const patchPick = random()
  const crestPick = random()
  const duskPick = random()
  const bankPick = random()
  const sizePick = random()

  // Open skies keep their horizon just below the frame; over the control's whole range the Horizon
  // control raises their brightest band from the bottom edge to mid-frame. Water and land put the
  // line at the shared height.
  // Under a dragged line an open sky's glow keeps the size it has at the seed's own place.
  const band = lerp(0.97, 0.5, horizonRise(line ? placeHorizon(0.5, seed, aspect).y + lineShift : placed.y))
  const water = structure === 'water'
  const land = structure === 'land'
  const arcs = structure === 'arcs'
  const ground = water || land
  let bandAt = band
  let sunIn: number
  let tilt: number
  let dome: number
  // Share of the glow that stays far from the sun, the glow's width and the sunlight's strength.
  let floor: number
  let lateral: number
  let sunlight: number
  switch (structure) {
    case 'open':
      bandAt = band + 0.04 * shift
      sunIn = lerp(-0.35, 0.3, sunPick)
      tilt = side * lerp(0.5, 6, tiltPick)
      dome = lerp(-0.01, 0.03, bendPick)
      floor = lerp(0.45, 0.85, floorPick)
      lateral = lerp(0.9, 1.6, widthPick)
      sunlight = 0.35
      break
    case 'corner':
      bandAt = lerp(band, 1, 0.5) + 0.03 * shift
      sunIn = lerp(-0.2, 0.08, sunPick)
      tilt = side * lerp(4, 14, tiltPick)
      // Bent enough that the diagonal never reads as a ruled line. Enough of the glow stays far
      // from the sun that the horizon there does not go dark.
      dome = lerp(0.025, 0.06, bendPick) * frameWidth
      floor = lerp(0.25, 0.4, floorPick)
      lateral = lerp(0.6, 1.1, widthPick)
      sunlight = 0.55
      break
    case 'arcs':
      // The arcs center on the sun, off the frame's center, and lean toward it; the glow fades
      // toward the far side instead of filling the width.
      bandAt = lerp(band, 1, 0.2) + 0.03 * shift
      sunIn = lerp(0.1, 0.4, sunPick)
      tilt = side * lerp(0, 6, tiltPick)
      dome = lerp(0.04, 0.1, bendPick) * frameWidth
      floor = lerp(0.15, 0.35, floorPick)
      lateral = lerp(0.8, 1.3, widthPick)
      sunlight = 0.2
      break
    case 'water':
      // The sun just under a level line, its light gathered toward it so the water mirrors a
      // warm patch; no sun disc, only a wide, flat, faint glow around it. The sky's bands lean and
      // bend over the level line, so they and their reflections are never parallel stripes.
      // Each variant puts the sun, and its path, in its own part of the width, and keeps its own
      // share of the glow far from the sun: a patch of light on one side, an even band, or between.
      sunIn = within(([[0.12, 0.24], [0.26, 0.38], [0.4, 0.5]] as const)[variant], sunPick)
      tilt = lerp(-4, 4, tiltPick)
      dome = lerp(-0.015, 0.035, bendPick) * frameWidth
      floor = within(([[0.12, 0.22], [0.48, 0.62], [0.28, 0.4]] as const)[variant], floorPick)
      lateral = lerp(1.0, 1.5, widthPick)
      sunlight = 0.25
      break
    case 'land':
      // The light just above the ridge's high end, on the sun's side.
      sunIn = within(([[0.08, 0.17], [0.21, 0.3], [0.14, 0.24]] as const)[variant], sunPick)
      tilt = side * lerp(0, 3, tiltPick)
      dome = lerp(-0.01, 0.01, bendPick)
      floor = within(([[0.25, 0.35], [0.52, 0.65], [0.38, 0.5]] as const)[variant], floorPick)
      lateral = lerp(0.8, 1.3, widthPick)
      sunlight = 0.4
      break
    default: {
      const unknown: never = structure
      throw new Error(`Unknown structure: ${String(unknown)}`)
    }
  }
  floor = Math.max(floor, look.minFloor)
  // An open sky with a dusk band raises its glow, leaving the band room under it; a corner's glow
  // sits lower, so it rises more.
  if (look.dusk) bandAt -= structure === 'corner' ? 0.22 : 0.12
  const day = stops2(intensity, 0.7)
  // Water and land follow a dragged line's tilt only so far: tilted further, the horizon no longer
  // reads as level ground seen from the shore. Open skies follow the line all the way round. Over
  // water and land the sky keeps its own lean against the line.
  const lineTilt = line ? (ground ? limitTilt(line.tilt, water ? WATER_MOST_TILT : LAND_MOST_TILT) : line.tilt) : 0
  const skyTilt = line ? lineTilt + (ground ? tilt : 0) : tilt
  const turn = (skyTilt * Math.PI) / 180

  // The ground's outline. Water is level and nearly still. Land is one ridge climbing toward the
  // light. The ridge grows out of a low bank as the line rises from the bottom edge, and above the
  // middle of the frame it flattens. Each change runs over a wide range of line heights, and the
  // seed alone picks land or water, so no step of the Horizon control switches the ground.
  const groundAt = (y: number) => {
    const flat = smoothstep(0.6, 0.52, y)
    const ridge = land ? smoothstep(1.02, 0.8, y) * (1 - flat) : 0
    const lineAt = (y - 0.5) * tall
    const lineTiltAt = line && ground ? -lineTilt : lerp(Math.max(-2, Math.min(2, placed.tilt)), placed.tilt, ridge)
    const outline: Outline = {
      at: lineAt,
      slope: Math.tan((lineTiltAt * Math.PI) / 180),
      wave: land ? lerp(lerp(0.005, 0.012, ridgePick) * tall, 0.0015, flat) : 0.0015,
      rise: ridge * lerp(0.1, 0.25, ridgePick) * tall,
      toward: side,
      bowl: ridge * lerp(0, 0.06, bowlPick) * tall,
      waveLength: lerp(0.5, 0.9, bowlPick) * frameWidth,
    }
    let lowest = -Infinity
    let crest = Infinity
    for (let i = 0; i <= 32; i++) {
      const at = outlineAt(outline, half, -half + (i / 32) * frameWidth, seed)
      lowest = Math.max(lowest, at)
      crest = Math.min(crest, at)
    }
    // A far bank on the water's line; it lowers as a high line leaves less sky above it.
    const bankHeight = water ? look.bank * lerp(0.8, 1.3, bankPick) * clamp01((lineAt + 0.5 * tall) / 0.6) : 0
    // The ramp's anchor: on the water's line or near the top of its far bank, or just under the
    // land's lowest point, where the sky behind it meets its own horizon; under a tilted line,
    // lowest along the tilted axis.
    let anchor: [number, number] = [0, land ? lowest + 0.03 : lineAt - 1.2 * bankHeight]
    if (line && land) {
      const level: RampAxis = { anchorX: 0, anchorY: lineAt, turn, drop: dome }
      let under = -Infinity
      for (let i = 0; i <= 32; i++) {
        const x = -half + (i / 32) * frameWidth
        under = Math.max(under, rampAt(frame, level, x, outlineAt(outline, half, x, seed)))
      }
      anchor = [(under + 0.03) * Math.sin(turn), lineAt + (under + 0.03) * Math.cos(turn)]
    }
    return { y, flat, ridge, lineAt, outline, lowest, crest, bankHeight, anchor }
  }
  // Under a dragged line the ground's line goes where the seed's glow, at its own share of the
  // sky's height above the line, passes through the line's start, within the Horizon control's
  // range.
  let lineY = placed.y
  if (line && ground) {
    // How far the line's start lies above the seed's glow for a line height, measured from the top
    // of the water's far bank or from the middle of the land's line (land's own anchor moves
    // unevenly as its ridge grows): it grows steadily as the line lowers, so halving the range
    // finds the one height.
    const share = Math.min(0.7, glowShare(look, variant, risePick, softness, day))
    const aboveGlow = (y: number) => {
      const lineAt = (y - 0.5) * tall
      const anchorY = water ? groundAt(y).anchor[1] : lineAt
      const from: RampAxis = { anchorX: 0, anchorY, turn, drop: dome }
      return -rampAt(frame, from, line.from[0], line.from[1]) - share * Math.max(0.2, anchorY + tall / 2)
    }
    let high = placeHorizon(1, seed, aspect).y
    let low = placeHorizon(0, seed, aspect).y
    for (let k = 0; k < 24; k++) {
      const mid = 0.5 * (high + low)
      if (aboveGlow(mid) > 0) low = mid
      else high = mid
    }
    lineY = 0.5 * (high + low)
  }
  const { flat, ridge, lineAt, outline, lowest, crest, bankHeight, anchor: groundAnchor } = groundAt(lineY)
  const groundKind = water ? 1 : land ? 2 : 0
  const landRoom = Math.max(0.1, 0.5 * tall - lineAt)
  const lineOf = (x: number) => outlineAt(outline, half, x, seed)

  // Open skies anchor the ramp just below the frame. Under a dragged line the anchor lies on the
  // line's axis, past the frame and at least a little below the line's start, where the glow sits.
  const sunIs = sunRight ? 1 - sunIn : sunIn
  const anchorX0 = ground ? 0 : line ? line.from[0] : arcs ? (sunIs - 0.5) * frameWidth : 0
  // The bend is set by how far the farther side edge drops.
  let drop = ground ? dome : dome * (half / (half + Math.abs(anchorX0))) ** 2
  let anchorX = ground ? groundAnchor[0] : anchorX0
  let anchorY = ground ? groundAnchor[1] : 0
  let lineRise = 0
  // How high an open sky's glow sits above its horizon: where the Horizon control puts the
  // brightest band, higher in haze; ownRise at the seed's own place.
  const openRiseAt = (anchor: number) => Math.max(0.03, Math.max(anchor - (bandAt - 0.5) * tall, look.minLift) * Math.sqrt(day) * stops2(softness, 0.3))
  const ownX = arcs ? (sunIs - 0.5) * frameWidth : 0
  const ownAxis = { anchorX: ownX, turn: (tilt * Math.PI) / 180, drop: dome * (half / (half + Math.abs(ownX))) ** 2 }
  const ownRise = ground ? 0 : openRiseAt(anchorBelow(frame, ownAxis, 0.02))
  if (!ground && line) {
    const riseFor = (bend: number) => Math.max(beyondFrame(frame, { anchorX: line.from[0], anchorY: line.from[1], turn, drop: bend }) + 0.02, 0.03, look.minLift)
    // A turned line sees the bands across the frame's height or its diagonal, not its width; they
    // bend as much over that as over the width at the seed's own tilt, so they stay curved.
    drop *= (half / (Math.abs(half * Math.cos(turn)) + Math.abs(0.5 * tall * Math.sin(turn)))) ** 2
    // The bands bend around the sun, so with the horizon far behind the glow they bend less, and
    // the glow and the dusk band never close into a ring around a disc.
    drop *= Math.min(1, ownRise / riseFor(drop))
    lineRise = riseFor(drop)
    anchorX = line.from[0] + lineRise * Math.sin(turn)
    anchorY = line.from[1] + lineRise * Math.cos(turn)
  } else if (!ground) {
    anchorY = anchorBelow(frame, { anchorX, turn, drop }, 0.02)
  } else if (line) {
    lineRise = -rampAt(frame, { anchorX, anchorY, turn, drop }, line.from[0], line.from[1])
  }
  const horizonY = anchorY / tall + 0.5
  const axis: RampAxis = { anchorX, anchorY, turn, drop }
  // Under a dragged line the glow sits at its start, and the sky reaches the zenith's color at its
  // end: that height above the horizon is the sky's reach, and the top of the sky lies the zenith's
  // own room above it.
  const dragRise = Math.max(0.03, lineRise)
  const dragReach = line ? dragRise + line.length : 0
  const dragTop = skyTopOf(dragReach, tall)
  const skyHeight = Math.max(0.2, line ? dragTop : horizonY * tall)
  // Under a dragged line the sun sits on the line's axis, just past the horizon below its start.
  const sunBelow = line ? dragRise + (arcs ? 0 : 0.03) : 0
  const sunX = line ? (line.from[0] + sunBelow * Math.sin(turn)) / frameWidth + 0.5 : sunIs
  // A short sky has no room for a second step: its edges would crowd and the fold guard calm them
  // all. The seed decides whether the sky has the step; it fades out as the sky gets shorter.
  // Under a dragged line it fades over a wider range of the line's length: turning a line whose
  // end the tool holds at the edge of its reach changes the length quickly.
  const midSky = hasMidSky(seed)
  const midAmount = midSky ? (line ? smoothstep(0.45, 1.25, skyHeight) : smoothstep(0.75, 1, skyHeight)) : 0

  // Intensity is daylight: the zenith gains the most, the low sky less and the glow least;
  // the glow rises, widens and pales, and the sun's core whitens near the sun only.
  const zenithGain = stops2(intensity, 1.6)
  const lowGain = look.lowSkyGain * stops2(intensity, look.lowSkyGain < 1 ? 0.8 : 0.35)
  const glowGain = stops2(intensity, 0.15)
  const sunGain = stops2(intensity, 2.4)
  const groundGain = stops2(intensity, 0.8)
  const [path, deeper, paler] = look.path

  // Softness is haze: wider edges and glow, and a wider lens.
  const haze = stops2(softness, 1.4)
  const glowHaze = stops2(softness, 0.8)
  // The glow is larger where more sky shows, so a tall frame doesn't get a thin stripe.
  const skyScale = 0.72 + 0.36 * Math.min(skyHeight, 1.6)
  // Each variant has a glow of its own size and height: low and small, high and large, or between.
  const glowSize = [0.9, 1.3, 1.05][variant] * lerp(0.9, 1.1, sizePick)
  const glowScale = glowHaze * day * skyScale * air * glowSize
  // How high the glow's line sits above the horizon: for open skies where the Horizon control puts
  // the brightest band, over water and land 21 to 61% of the sky's height by variant and seed,
  // higher in haze; under a dragged line, at its start.
  const glowRise = line ? dragRise : ground ? glowShare(look, variant, risePick, softness, day) * skyHeight : openRiseAt(anchorY)
  // How far the glow's lower side, the dusk band and the dimming toward the horizon reach. Over an
  // open sky a dragged line's horizon can lie far behind the glow; they keep the seed's own size
  // there, and the low sky fills the rest. The glow's lower side ends where the seed's own frame
  // ends below it, or at the horizon.
  const glowReach = line && !ground ? Math.min(glowRise, ownRise) : glowRise
  const glowEnd = line && !ground ? [glowReach, 0.5 * glowReach] : [0, 0.1]

  // The least height above the horizon along the top edge: the sky's edges and the sun's light
  // stay below it, so the top of the frame is the pack's Meta Blue. Under a dragged line the sky
  // ends at the line's end instead.
  let topHeight = Infinity
  for (let i = 0; i <= 32; i++) topHeight = Math.min(topHeight, -rampAt(frame, axis, -half + (i / 32) * frameWidth, -tall / 2))
  if (line) topHeight = dragTop
  // Meta Blue holds the top fifth of the frame; a short sky gives it less, so the low sky keeps a
  // band of its own between the zenith and the glow wider than the lens.
  const zenithRoom = zenithRoomOf(topHeight, tall)
  // Over open skies the sky's edges sit between the glow and the top, so they rise with the glow.
  const edgeFloor = ground ? 0 : glowRise
  const skyEdgeAt = -(edgeFloor + look.skyEdge[0] * Math.max(0.1, topHeight - edgeFloor) * within(([[0.5, 0.68], [0.82, 0.98], [0.66, 0.84]] as const)[variant], edgePick))
  // A sky edge narrower than about a third of a short side reads as the edge of a cloud bank. A
  // look whose low sky must show as its own band between the zenith and the glow allows a
  // narrower one: the lens still softens it.
  const skyEdgeWidth = Math.max(look.skyEdge[2], look.skyEdge[1] * Math.abs(skyEdgeAt)) * Math.sqrt(haze)

  // Every sky edge and the glow move with the shared boundary model (ramp-boundary.ts): the sky
  // edge most, the glow and the horizon less. A softer sky drifts a little more.
  // A short sky over a high horizon wanders less, or its thin glow breaks into pieces.
  const drift = Math.sqrt(haze) * Math.min(1, Math.max(0.4, skyHeight / 0.6))
  const skyWander = lerp(0.012, 0.018, wanderPick) * drift
  const boundaryWander = [skyWander, 0.012 * drift, 0.01 * drift, 0.006 * drift]
  // Long waves: a shorter lattice puts rows of like-sized bumps along the edges.
  const lattice = lerp(0.45, 0.7, latticePick)

  // The zenith is the pack's Meta Blue at the top edge and gains light slowly all the way down,
  // to twice as much at the horizon, so the sky never holds one flat blue. Away from the sun it is
  // 2 % deeper.
  let aSum = 0
  let topSum = 0
  for (let k = 0; k <= 8; k++) {
    for (let i = 0; i <= 16; i++) {
      const x = -half + (i / 16) * frameWidth
      const y = -tall / 2 + (k / 8) * 0.2 * tall
      const s = rampAt(frame, axis, x, y)
      aSum += (x * Math.cos(turn) - y * Math.sin(turn)) / half
      if (k === 0) topSum += s
    }
  }
  let zenithShade = [1.0 / Math.max(0.2, topHeight), topSum / 17, 0.02 * side, aSum / (9 * 17)]
  // Under a dragged line the zenith is the pack's Meta Blue at the line's end instead.
  if (line) {
    const [x, y] = line.to
    zenithShade = [1.0 / Math.max(0.2, topHeight), rampAt(frame, axis, x, y), 0.02 * side, (x * Math.cos(turn) - y * Math.sin(turn)) / half]
  }

  // The stop edges, top down. A second, lighter Meta Blue step splits the sky's edge in two: a
  // wide one higher up and a narrower one lower down, each with its own shape.
  // Without the step (midAmount 0) the mid stop matches the zenith, and the lower edge is the one
  // edge of a sky without it.
  const midGain = lerp(zenithGain, zenithGain * (look.lowSky === look.zenith ? Math.sqrt(lowGain / zenithGain) : 1.18), midAmount)
  const edges: [at: number, width: number][] = midSky
    ? [
        [skyEdgeAt * lerp(1.15, 1.4, bandPick), 0.75 * skyEdgeWidth],
        [skyEdgeAt * lerp(1, lerp(0.5, 0.7, depthPick), midAmount), lerp(1, 0.45, midAmount) * skyEdgeWidth],
      ]
    : [[skyEdgeAt, skyEdgeWidth]]
  // The highest edge's upper tail stays out of the top fifth of the frame, where Meta Blue is the
  // mean. A low sky much brighter than the zenith shows further up its tail.
  const topEdge = midSky ? edges[1].map((v, i) => lerp(v, edges[0][i], midAmount)) : edges[0]
  const [topAt, topWidth] = topEdge
  const tail = 0.5 * (1 + 0.5 * Math.max(0, Math.log2((midSky ? lerp(lowGain, midGain, midAmount) : lowGain) / zenithGain)))
  if (line) {
    // Under a dragged line the edges stretch or shrink about the glow, widths included, so the
    // highest edge's upper tail ends at the line's end.
    const stretch = Math.max(0.1, (topHeight - zenithRoom - glowRise) / Math.max(0.05, Math.abs(topAt) + tail * topWidth - glowRise))
    for (const edge of edges) {
      edge[0] = -glowRise + (edge[0] + glowRise) * stretch
      edge[1] = Math.min(6, edge[1] * stretch)
    }
  } else {
    const room = (topHeight - zenithRoom) / (Math.abs(topAt) + tail * topWidth)
    if (room < 1) edges.forEach((edge) => (edge[0] *= Math.max(0.3, room)))
    // The top edge narrows too; without the step, the lower edge is the top edge.
    const squeeze = Math.max(0.3, Math.min(1, room))
    edges[0][1] *= squeeze
    if (midSky) edges[1][1] *= lerp(squeeze, 1, midAmount)
  }
  // A low sky of its own color shows as a band above the glow and the ridge's crest instead of
  // under them, as far as the top fifth allows.
  if (look.lowSky !== look.zenith) {
    const low = edges[edges.length - 1]
    const highest = -(topHeight - zenithRoom - tail * low[1])
    const under = Math.max(glowRise, land ? anchorY - crest : 0)
    low[0] = Math.max(highest, Math.min(low[0], -(under + 0.3 * skyScale)))
  }
  const gains = midSky ? [zenithGain, midGain, lowGain] : [zenithGain, lowGain]
  const lowSkyEdge = edges[edges.length - 1][0]
  // The dusk band's edge sits just under the glow's line, hiding the glow's lower part; the band is
  // the sky's own light, so it gains with daylight like the low sky. Its edge is about as soft as
  // land's: the lens softens it, and a wider one mixes the two sides into a third hue.
  // The sky's lowest edge moves up out of the band's way, as far as the top fifth allows.
  if (look.dusk) {
    const last = edges[edges.length - 1]
    const duskWidth = 0.04 * Math.sqrt(haze) * skyScale
    const duskAt = -lerp(0.75, 0.9, duskPick) * glowReach
    const margin = 0.3 * (last[1] + duskWidth)
    const above = edges.length > 1 ? edges[edges.length - 2] : null
    const ceiling = Math.max(-(topHeight - zenithRoom - tail * last[1]), above ? above[0] + 0.3 * (above[1] + last[1]) : -Infinity)
    last[0] = Math.min(last[0], Math.max(ceiling, duskAt - margin))
    edges.push([Math.max(duskAt, last[0] + margin), duskWidth])
    gains.push(look.dusk[1] * lowGain)
  }
  const stopParams: Record<string, number> = {}
  edges.forEach(([at, width], j) => {
    stopParams[`at${j + 1}`] = at
    stopParams[`width${j + 1}`] = width
  })
  gains.forEach((gain, k) => (stopParams[`gain${k + 1}`] = gain))
  // Each edge and the glow's line lean and bow a little on their own, so neighbours are never
  // parallel in any direction the sky runs. A stream of its own leaves the other picks as they are.
  const shapePick = seeded(Math.round(seed) * 31 + 7)
  const edgeShape = Array.from({ length: 2 * RAMP_EDGES }, (_, i) => (shapePick() * 2 - 1) * (i % 2 === 0 ? 0.07 : 0.05))
  const glowShape = [(shapePick() * 2 - 1) * 0.05, (shapePick() * 2 - 1) * 0.04].map((v) => v * clamp01(glowRise / 0.15))

  // Over land the sun sits just above the crest at its x; over water just under the line.
  const underLine = line ? (line.from[1] + sunBelow * Math.cos(turn)) / tall + 0.5 : horizonY + (arcs ? 0 : 0.03 / tall)
  const sunY = land ? lineOf((sunX - 0.5) * frameWidth) / tall + 0.5 - lerp(0.03, 0.1, crestPick) : underLine

  const params: Record<string, ParamValue> = {
    anchor: [anchorX / frameWidth + 0.5, horizonY],
    angle: skyTilt,
    drop,
    stops: gains.length,
    ...stopParams,
    edgeShape,
    glowShape,
    horizonEdge: 0,
    zenithShade,
    warp: 0,
    softVary: 0,
    softFollow: 0,
    drift: 0,
    vary: 0,
    softness: 0,
    boundaryWander,
    boundaryNoise: [0.35, lattice, 0.25, 2],
    // Wide edges change their softness less (the 0.15 width), or their color climbs higher in columns.
    boundarySoft: [0.15, 0.5, 0.25, 0.15],
    sunAt: [sunX, sunY],
    sunlight: sunlight * glowGain,
    sunlightWidth: 0.55 * lateral * lerp(0.75, 1.3, widthPick) * Math.sqrt(day) * narrow,
    sunlightHeight: 0.6,
    sunlightWarmth: 0,
    falloff: structure === 'corner' ? 2.2 : 1.6,
    widen: arcs ? 0.3 : 1.4,
    falloffRound: 0.6,
    // The sun's added light fades out below the top fifth (under a dragged line, by its end), which
    // holds only the sky's own light. A short sky still gives it a third of its height: at 0 the
    // light would have no limit at all.
    lightTop: Math.max((line ? dragReach : topHeight - 0.2 * tall) - 2.5 * skyWander, 0.35 * topHeight) * lerp(0.85, 1.15, intensity),
    glow: look.glow * glowGain * (arcs ? 1.2 : 1),
    glowOffset: -glowRise,
    glowEnd,
    // Scattered daylight over the sky, denser toward the horizon, mutes and pales it toward the
    // light. A band of full Meta Blue stays at the far edge: the top twentieth of the frame, fading
    // into the veil over the next sixth.
    // Elemental's warm side reaches farther, so its light's own color shows over more of the sky.
    veil: [look.veil[0] * zenithGain, look.veil[1] * zenithGain, (packId === 'elemental' ? 0.6 : 0.3) * Math.max(0.2, topHeight)],
    veilFar: [topHeight - 0.22 * tall, topHeight - 0.05 * tall],
    veilTint: paleTint(look.veilColor, packId === 'bold' ? 0.35 : packId === 'elemental' ? 0.25 : 0.6),
    // Under the far band the sky's blue greys at its own hue (Elemental, whose pale side is its
    // light's color), or toward Steel (Atmospheric, overcast), instead of turning periwinkle.
    veilMute: packId === 'atmospheric' ? 0.55 : packId === 'elemental' ? 0.5 : 0,
    // Elemental's veil takes its light's own color near the light, so the pale side reads Tan or
    // Lime; the other packs take the bridge's warm white there.
    veilNear: packId === 'elemental' ? paleTint(look.light, 0.6) : [0, 0, 0],
    glowVary: 0,
    glowArch: 0.6,
    // More daylight gathers the glow toward the sun, so white shows only near the light.
    glowLateral: 1 - floor * narrow * stops2(intensity, -0.8),
    glowWidth: 0.45 * lateral * Math.sqrt(day) * glowHaze * narrow,
    shadowHeight: 0,
    glow1Weight: 1,
    glow1Up: 0.1 * glowScale * look.glowUp,
    glow1Down: Math.min(2, Math.max((0.03 + 0.03 * glowHaze) * skyScale, look.downReach * glowReach)),
    glow2Weight: 0.2 * look.haze * lerp(0.6, 1.5, softness),
    glow2Up: 0.17 * glowScale * look.glowUp,
    glow2Down: 0.08 * glowHaze,
    extinction: look.extinction,
    // Skylight fades toward the horizon, so under the glow line the light is the glow's own.
    // A corner's horizon far from the sun keeps more skylight and deepens less, or it goes dark.
    horizonDim: (1 - look.horizonGain) * 12 * stops2(softness, -0.6) * (structure === 'corner' ? 0.5 : 1),
    horizonDimHeight: 0.7 * glowReach + 0.02,
    dimBelow: 1,
    // Over water the light just above the line deepens less, or it reads as a dark stripe between
    // the sky and its reflection; a raised open band deepens less toward the bottom edge.
    // Over a ridge it does not deepen: deepened at the outline, Orange-red turns red and maroon.
    reddenDown: deeper * stops2(1 - intensity, 1.1) * stops2(1 - softness, 0.6) * (water ? 0.3 : land ? 0 : structure === 'corner' ? 0.4 : 1 - 0.45 * clamp01((0.97 - (line ? 1 - glowReach / tall : band)) / 0.3)),
    reddenEase: 1,
    reddenUp: paler > 0 ? clamp01(paler + (intensity - 0.5) * 0.15) * 0.9 : 0,
    reddenSide: look.sideDeeper,
    glowPath: path + lerp(look.hue[0], look.hue[1], huePick) - (intensity - 0.5) * 0.25,
    sunGlow: 0.25 * sunGain * look.sunGlow * (arcs ? look.core : water ? 0.5 : 1),
    sunGlow1Radius: (water ? 0.12 : 0.05) * glowScale,
    sunGlow1Weight: 1,
    sunGlow2Radius: (water ? 0.35 : 0.18) * glowScale,
    sunGlow2Weight: 0.35,
    sunGlowAspect: water ? 3.5 : 2.5,
    sunGlowBeta: 1.3,
    // Water and land are drawn in front of the sky and hide it themselves.
    occlude: ground ? 0 : 0.85,
    occludeWidth: 0.04 * glowHaze,
    // The bridge gains no faster than the glow, or high Intensity turns the whole low sky white.
    bridge: look.bridge * stops2(intensity, 0.15),
    bridgeLift: look.bridgeLift + 0.12 * softness,
    bridgeWarmth: look.bridgeWarmth,
    bridgeFloor: look.bridgeFloor,
    duskStop: look.dusk ? gains.length - 1 : -1,
    land: 0,
    // One lens over the whole scene: Softness is its radius.
    lensRadius: lerp(0.045, 0.12, softness),
    // Patches of light in the sky, a third to half of the frame across.
    skyPatch: [0.08, lerp(0.33, 0.5, patchPick) * frameWidth, 1.6],
    ground: groundKind,
    groundAt: lineY,
    groundTilt: (Math.atan(outline.slope) * 180) / Math.PI,
    groundWave: outline.wave,
    ridge: [outline.rise, outline.toward, outline.bowl, outline.waveLength],
    shore: [bankHeight, 0.5],
    // The path mirrors the glow's line, which sits above most of the far bank.
    // Each variant has its own water: a near mirror with a medium path, deep dark water with a
    // strong path, or between with a faint one.
    sunPath: [water ? look.sunPath * [0.7, 1, 0.45][variant] : 0, 0.02, 0.6, glowRise + 1.2 * bankHeight],
    // A tall water area keeps its path further down. Around it the water mirrors the band part
    // way from the glow up to the low sky's edge.
    sunLight: [Math.max(0.3, 0.6 * (0.5 * tall - lineAt)), Math.min(0.3, Math.max(0.05, 0.7 * (-lowSkyEdge - glowRise)))],
    // The strip under the line is thin and bright, so it still shows after the lens. Under a high
    // line the ripples draw the short sky's reflection out over more of the water, so the water
    // carries the sky's colors and not only the zenith's.
    water: [Math.min(1.25, Math.max(0.5, (0.77 * lineY) / Math.max(0.05, 1 - lineY))), lerp(look.waterDegrees[0], look.waterDegrees[1], ridgePick) * [0.6, 1.6, 1][variant], 0.12, 1.5],
    waterMirror: water ? look.waterMirror : 1,
    // Under a high line the near water mirrors the sky high above the frame, which is darker.
    mirrorDeep: water ? 0.6 * tall : 0,
    // A tall land area reaches nearer the viewer: the haze over its far ground reaches further
    // down, and its near ground is darker.
    groundHaze: [look.landHaze, land ? Math.max(0.1 * tall, 0.25 * landRoom) : 0.05 * tall],
    groundVeil: [land ? look.groundVeil * groundGain : 0, 0.35 * landRoom],
    landLit: [ground ? look.landLit : 0, lerp(0.3, 0.5, widthPick) * frameWidth, ground ? 0.6 : 0],
    groundTopGain: look.landTop[1] * groundGain,
    groundBottomGain: look.landBottom[1] * groundGain * (land ? Math.min(1, ((0.4 * tall) / landRoom) ** 1.5) : 1),
    waterGain: look.water[1] * groundGain,
  }
  return { colors: slotColors(look, midSky), params, lens: {}, output: { exposure: 0 } }
}
