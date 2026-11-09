import { getPack, type PackId } from '../../color/packs'
import { linearToOklab } from '../../color/oklab'
import { hexToSrgb, srgbToLinearRgb } from '../../color/srgb'
import type { Composition, ControlValues, ParamValue } from '../../scene'
import { horizonRise, horizonScene, placeHorizon } from './horizon'
import { limitTilt, rampLine } from './ramp-drag'
import { edgeFbm } from './ramp-noise'
import { RAMP_EDGES, SKY_GREY_KNEE } from './ramp-shader'

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
/** Height (share of the frame from the top) above which land's line climbs at LAND_SLOW_RATE of the shared rate. */
const LAND_SLOW = 0.42
const LAND_SLOW_RATE = 0.55
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

/** How much of a run pick is the seed's own. */
const RUN_OWN = 0.1
/**
 * A pick spread over a structure's repeats, one per run: each run steps 2√2 - 2 of the range on
 * (about a sixth back), plus a little of the seed's own pick, so neighbouring repeats take picks
 * about a sixth apart and the repeats of one variant, three runs apart, about half the range apart.
 */
const runPick = (seed: number, own: number) => (seedRun(seed) * (2 * Math.SQRT2 - 2) + RUN_OWN * own) % 1
/**
 * A pick in thirds over a structure's repeats: the third is the run's variant plus how many times the
 * variant has come round, so neither neighbouring repeats nor the repeats of one variant share a
 * third; within it the pick is the seed's own.
 */
const thirdPick = (seed: number, own: number) => {
  const run = seedRun(seed)
  return (((run % 3) + Math.floor(run / 3)) % 3) / 3 + own / 3
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
  /** The zenith's light at the far edge of the sky, as a share of the pack's Meta Blue (1: the hex itself). */
  farSink: number
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
    farSink: 1,
  }
  switch (packId) {
    case 'bold': {
      const [cyan, yellow, orangeRed] = rest
      const dark = { landTop: [metaBlue, 0.6] as Tone, landBottom: [metaBlue, 0.12] as Tone, water: [metaBlue, 0.3] as Tone, veilColor: cyan, veil: [0.2, 0.05] as [number, number] }
      // Yellow under a band of Cyan, so Meta Blue, Cyan and the warm light all show.
      const yellowLook = { ...sky, ...dark, lowSky: cyan, lowSkyGain: 1.6, skyEdge: [0.97, 1.0, 0.3] as [number, number, number], light: yellow, coreColor: yellow, glow: 0.9, glowUp: 0.65, path: [0.5, 1, 0.45] as [number, number, number], hue: [-0.3, 0.35] as [number, number], bridge: 0.5, haze: 0.5, sideDeeper: 0.4, core: 2 }
      // A compact sun over land is Yellow, high over a dark ridge that it doesn't light: spilled
      // over land, Yellow turns khaki.
      if (structure === 'land' && sceneTurn(structure, variant, 1) === 0) return { ...yellowLook, glow: 1.6, glowUp: 0.35, glowRise: 1.4, horizonGain: 0.5, bridge: 0.9, bridgeLift: 0.4, landLit: 0, landHaze: 0.05 }
      // Orange-red over a Cyan low sky: the two add up to a pale neutral, which keeps its bridge
      // at low light too. It lights every other water and land frame: reflected in water, Yellow
      // turns khaki.
      if (ground || (pickLight < 0.55 && (structure === 'open' || structure === 'corner'))) {
        // Where Orange-red meets the Cyan and blue sky the bridge is a pale peach-cream, not the
        // pink or mauve the two make when mixed; under the glow line and inside the glow's dense
        // haze the skylight fades out, so the glow's body is Orange-red itself. A compact, low glow
        // leaves a band of Cyan above it.
        return { ...sky, ...dark, lowSky: cyan, lowSkyGain: 1.8, horizonGain: 0.42, skyEdge: [0.95, 0.9, 0.15], groundVeil: 0.05, light: orangeRed, coreColor: yellow, glow: 1.2, glowUp: 0.25, glowRise: structure === 'land' ? 0.62 : 0.25, path: [-0.15, 0.55, 0.45], hue: [-0.25, 0.2], bridge: 0.9, bridgeLift: 0.5, bridgeWarmth: 0.8, bridgeFloor: 0.1, haze: 0.3, downReach: 1.5, sideDeeper: 0.3, waterDegrees: [6, 9], landHaze: 0.03, extinction: 3 }
      }
      return yellowLook
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
      // Over water the sky stays a deeper Meta Blue that sinks toward the dark at the far edge, with
      // little veil: paled, its reflection over the dark water turns periwinkle and mauve.
      const bank = structure === 'water' ? { bank: 0.17, veil: [0.08, 0.1] as [number, number], farSink: 0.45, ...(pickLight < 0.5 ? { landTop: [forest, 1.8] as Tone, landBottom: [forest, 0.7] as Tone } : {}) } : {}
      return { ...sky, ...dark, ...bank, extinction: 3, glowUp: 0.5, glowRise: 0.4, horizonGain: 0.42, landHaze: 0.05, landLit: 0.25, light: tan, coreColor: tan, lowSky: structure === 'water' ? metaBlue : tan, lowSkyGain: structure === 'water' ? 1.3 : 1.2, glow: 1.6, path: [0.1, 0.1, 0.4], hue: [-0.3, 0.1], bridge: 1.8, bridgeLift: structure === 'land' ? 0.25 : 0.5, bridgeWarmth: 1, bridgeFloor: 0.1, haze: 0.8, sideDeeper: 0, waterDegrees: [1, 1.5], waterMirror: 1, ...dusk([plum, 1.0]) }
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
 * The variant turned by the scene, `step` places per scene, so the three scenes of one run take
 * different turns, and so do a scene's repeats in seeds 1-9. Steps 1 and 2 give every seed of 1-9
 * its own pair of turns.
 */
const sceneTurn = (structure: RampStructure, variant: number, step: number) => (variant + step * (structure === 'water' ? 1 : structure === 'land' ? 2 : 0)) % 3

/**
 * How much of the frame the warm light fills, by the seed's turn (compact, broad, between): the
 * height of the glow's line over water and land, the glow's size, and how far its light reaches up
 * the sky.
 */
const WARM = { share: [1, 2.2, 1.3], size: [0.8, 1.35, 1.05], reach: [0.65, 2, 1.15] }
/** How dark the water, the land and the far sky are, by the seed's turn: light, dark, between. */
const DEPTH = [0, 1, 0.5]
/**
 * Under a dragged line, the share of the sky's reach at its far end that sinks into deep navy in
 * Bold and Atmospheric, by the seed's depth turn (light, dark, between); the seed picks within it.
 * Elemental's seeds differ by their light and ground.
 */
const NAVY_SHARE = [[0.04, 0.14], [0.38, 0.56], [0.2, 0.34]] as const
/** Under a long line, how much Bold's and Atmospheric's haze thickens and thins in the sky's masses, by warm turn (compact, broad, between). */
const HAZE_MASS = [0.15, 1, 0.6]
/** Under a dragged line, how far up the frame's own sky Elemental's highest sky edge lies at most. */
const ELEMENTAL_ZENITH = 0.77
/** Under a long line, the widest Elemental's sky edges get, in short sides. */
const ELEMENTAL_EDGE = 0.3
/** The line lengths (short sides) over which Elemental's far side comes in. */
const ELEMENTAL_FAR = [0.5, 1.2] as const
/** Under a long line, the most of the way up the frame's own sky that Atmospheric's highest sky edge lies. */
const ATMOSPHERIC_ZENITH = 0.6
/** Under a long line, the least of the way up the frame's own sky that Atmospheric's low sky's edge is brought down to. */
const ATMOSPHERIC_PALE = 0.35
/**
 * Under a glow above the frame, how far (frame heights) above the glow the sky the water mirrors takes
 * to darken by e, and how fast (per short side of depth) the sky it mirrors climbs past the far strip,
 * for a light and a deep seed: a deep seed's water turns navy nearer the horizon.
 */
const MIRROR_GLINTS = { dark: [1.6, 0.7], climb: [1, 2.4] }
/**
 * Under a field of glints, a calm and a rough sea: how wide the glints spread as a share of the
 * mirrored path's width, the size of their rows, how far the warm reflection along the far edge
 * reaches as a share of the water's height (under a far bank no less than the lens's strip, so the
 * bank never blurs into the blue), and how much more of the low sky's light the water takes just
 * past it. A calm sea's path is a narrow column of fine glints under a long warm reflection and a
 * pale band of the low sky; a rough sea's a wide field of coarse ones, and its ripples turn toward
 * the high sky near the horizon.
 */
const GLINT_SEA = { spread: [0.3, 0.65], rows: [0.6, 1.5], strip: [0.45, 0.15], sheen: [0.8, 0.1] }
/**
 * Under a dragged line, the most (frame heights) that a water seed's horizon stops below the Horizon
 * control's highest line: a line far above the frame leaves each seed its own share of sky and water.
 */
const WATER_HIGHEST = 0.18
/**
 * How far (frame heights) a line's start rises above the frame over warm-lit water while the sun's
 * path there turns into a field of glints: over a shorter rise the water changes in a few steps.
 */
const GLINT_RAMP = 0.2
/** Under a glow above the frame, the most (short sides) the sun stands above the water's horizon, by seed. */
const SUN_RISE = 0.1
/** Oklab lightness under which a pack color reads as itself only up to one stop over its own (Forest, Plum, Slate). */
const DARK_L = 0.5
/** How much deeper the light in the haze over dark land is under a warm light (pathColor's longer path). */
const LAND_AIR_DEEPER = 1.5
/** Under a sideways line, the most an open sky's edges lean and bow as a multiple of their own, and how much their softness changes along them. */
const SIDE_SHAPE = 3
const SIDE_SOFT = 0.22
/** Under a sideways line, an open sky's edges' own S-shaped wave at most, before the room scale (base units at their ends). */
const SIDE_WAVE = 0.05
/** How deep the pale tint of the low sky is that the band along the water's far edge takes away from the light (0 white, 1 the color itself). */
const BAND_DEPTH = 0.35
/**
 * Under a field of glints, how far a two-color light's path moves when its core leads the sky (a
 * paler member of the light's family, toward the core) and when the light itself does (a deeper
 * one), and how far (short sides) higher past the far strip the water mirrors the sky when the
 * zenith's Meta Blue leads it rather than the low sky.
 */
const LEAD_WARM = [-0.35, 0.25]
const LEAD_BLUE = 0.5
/** Under a sideways line, the most lean, bow and wave all of an open sky's edges share, per short side the frame's height runs past one (base units at their ends). */
const SIDE_SHARED = [0.2, 0.16, 0.16]
/** Under a long line, how far Elemental's bridge lifts toward white. */
const ELEMENTAL_FAR_LIFT = 0.8
/** Under a long line, the range of a seed's own factor on its sky edges' widths. */
const DRAG_SOFT = [0.6, 1.2] as const
/** Under a long line, the most an open sky leans off the line by seed, in degrees. */
const DRAG_LEAN = 15
/** The zenith's light where the sky turns toward navy, and at the line's end by depth turn, as shares of Meta Blue. */
const NAVY_TURN = 0.5
const NAVY_END = [0.24, 0.12, 0.17]
/** The darkest the zenith may go under a dragged line, as a share of Meta Blue; without one it stays at its old floor. */
const NAVY_FLOOR = 0.08
/**
 * Bold's and Elemental's glow reach: how much higher it reaches at the sun, and by warm turn
 * (compact, broad, between) the share of its height it keeps far from the sun and the share of the
 * glow's width over which it rises: a broad seed's hazy air spreads its glow wide.
 */
const GLOW_ARCH = 2.2
const GLOW_ARCH_SHAPE = [[0.2, 0.35], [0.45, 0.7], [0.28, 0.5]]
/**
 * Atmospheric at the seed's own view, by warm turn (compact, broad, between): the least amount of
 * the sky's grey masses, and the gain of the Ice light. A broad seed's hazy air always shows its
 * masses, and its light is brighter so their darker parts don't hide it.
 */
const ICE_MASSES = [0, 0.2, 0]
const ICE_GAIN = [1, 1.25, 1]
/**
 * Water at the seed's own view, and Elemental's and Atmospheric's under a dragged line too: how much it
 * squashes the sky it mirrors, the least degrees below the horizon half a short side under the line, and
 * the share of the band above the glow that the sun's path mirrors toward its sides. Elemental's and Atmospheric's
 * water past the far bank's image and a strip as deep as the lens is wide mirrors the sky higher up,
 * by a share of that band, and keeps a share of its reflection there, by depth turn (light, dark,
 * between); Bold's keeps mirroring its Cyan.
 */
const OWN_WATER = {
  squeeze: 1.8,
  degrees: 5,
  band: 0.4,
  lift: { elemental: [0.05, 0.2, 0.15], atmospheric: [0.15, 0.5, 0.3] },
  keep: [0.85, 0.65, 0.75],
}
/**
 * A far bank: its length from the frame's edge to its spit, as a share of the frame's width (so it ends inside
 * the frame at every format), its height at that edge, its waterline's drop below the horizon as a share of its
 * height, and how many times shorter than the bank its mirror image is, at every view.
 */
const BANK = { length: [0.7, 0.9], peak: 2.2, foot: 0.1, mirror: 3.6 }
/**
 * Under a field of glints, the range of a far bank's length (some end well short of the sun, some run
 * past it) and of a seed's factor on its height.
 */
const GLINT_BANK = { length: [0.4, 0.95], height: [0.5, 1.6] }
/**
 * Under a dragged line, the most a warm glow lifted above the land's own glow ends above the land,
 * and how far above an open sky's horizon a warm glow's end lies before the sky under it comes
 * back fully as the glow fades (short sides).
 */
const LAND_LIFT = 0.25
const END_LIFT = 0.1
/** The navy band of a Bold open sky behind a glow above the frame, as a share of the low sky's gain. */
const BEHIND_NAVY = 0.2
/** How far (short sides) the start goes below the horizon before the sun's own light dims by e. */
const SINK_FADE = 0.6
/**
 * How far (short sides) the start goes below the horizon before the twilight glow's size shrinks
 * by e. Bold's glow, the main difference between its seeds under a line, shrinks half as fast.
 */
const SET_SHRINK = 0.5
const BOLD_SET_SHRINK = 1
/** Under a dragged line, how much further a broad seed's warm haze reaches per short side of the line's length. */
const DRAG_WARM_REACH = 0.2

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

/**
 * Over water and land, the glow's line's height above the horizon as a share of the sky's height.
 * Over land it stays lower, so the low sky keeps a band of its own above the ridge's glow.
 */
const glowShare = (look: PackLook, structure: RampStructure, warmShare: number, pick: number, softness: number, day: number) =>
  Math.min(structure === 'land' ? 0.36 : 0.5, lerp(0.25, 0.45, pick) * warmShare * stops2(softness, 0.3) * Math.sqrt(day) * look.glowRise)

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
  const warmTurn = sceneTurn(structure, variant, 1)
  const warmShare = WARM.share[warmTurn]
  const warmReach = WARM.reach[warmTurn]
  // An open sky's broad warm haze over a deep sky reads grey-brown or salmon: it takes the depth
  // between instead.
  const openSky = structure !== 'water' && structure !== 'land'
  const depthTurn = openSky && warmTurn === 1 && sceneTurn(structure, variant, 2) === 1 ? 2 : sceneTurn(structure, variant, 2)
  const depth = DEPTH[depthTurn]
  const veilScale = lerp(1.4, 0.5, depth) / (warmTurn === 1 ? Math.SQRT2 : 1)
  const look = packLook(packId, structure, darkAlternate(seed), variant, random)
  const intensity = clamp01(controls.intensity)
  const softness = clamp01(controls.softness)
  const mood = clamp01(controls.mood)
  // Over water and land each seed's depth puts the line at its own height: a deep seed shows more of
  // its dark ground, a light seed more sky. An open sky's variant sets the height of its band. The
  // shift fades out toward both ends of the Horizon control, which keep the shared heights.
  const shared = placeHorizon(mood, seed, aspect)
  // Atmospheric's grey seeds differ most by where the line sits, so theirs spread further.
  const lineShift = openSky ? [-0.1, 0.05, 0][variant] : packId === 'atmospheric' ? [0.18, -0.26, -0.1][depthTurn] : [0.05, -0.1, -0.03][depthTurn]
  // A light seed's land lies nearly level.
  const tiltScale = structure === 'land' ? [0.45, 1, 1][depthTurn] : 1
  const shiftedY = shared.y + lineShift * Math.min(1, mood / 0.25, (1 - mood) / 0.25)
  // Land's line climbs more slowly above LAND_SLOW, so the top of the Horizon control still shows a
  // band of sky over the land instead of a field of dark ground.
  const lineY0 = structure === 'land' && shiftedY < LAND_SLOW ? LAND_SLOW - (LAND_SLOW - shiftedY) * LAND_SLOW_RATE : shiftedY
  const placed = { ...shared, y: lineY0, tilt: Math.max(-LAND_MOST_TILT, Math.min(LAND_MOST_TILT, shared.tilt * tiltScale)) }
  // A dragged line takes the Horizon control's place: the glow sits at its start, the horizon runs
  // across it, and the sky reaches the zenith's color at its end. The seed keeps everything else.
  const line = controls.drag ? rampLine(controls.drag, aspect) : null
  // Atmospheric's grey veil keeps its blue under full strength, so its seeds keep their own haze.
  const dragVeil = line && packId !== 'atmospheric' ? Math.max(0.75, Math.min(1, veilScale)) : veilScale
  // A broad Elemental seed's warm haze reaches further along a longer line, so it shows in the
  // frame even where the line leaves the glow itself outside it. Atmospheric's light is pale Ice,
  // whose haze reaching further would wash the frame to one color; Bold's would meet the navy far
  // sky and mix into grey.
  const dragWarm = line && packId === 'elemental' ? 1 + DRAG_WARM_REACH * line.length * [0, 1, 0.4][warmTurn] : 1

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
  const shorePick = random()

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
      // A light seed's glow is an even band, a deep seed's a patch of light near the sun.
      floor = within(([[0.48, 0.62], [0.12, 0.22], [0.28, 0.4]] as const)[depthTurn], floorPick)
      lateral = lerp(1.0, 1.5, widthPick)
      sunlight = 0.25
      break
    case 'land':
      // The light just above the ridge's high end, on the sun's side.
      sunIn = within(([[0.08, 0.17], [0.21, 0.3], [0.14, 0.24]] as const)[variant], sunPick)
      tilt = side * lerp(0, 3, tiltPick)
      dome = lerp(-0.01, 0.01, bendPick)
      floor = within(([[0.52, 0.65], [0.25, 0.35], [0.38, 0.5]] as const)[depthTurn], floorPick)
      lateral = lerp(0.8, 1.3, widthPick)
      sunlight = 0.4
      break
    default: {
      const unknown: never = structure
      throw new Error(`Unknown structure: ${String(unknown)}`)
    }
  }
  floor = Math.max(floor, look.minFloor)
  // At the seed's own view Bold's and Elemental's glow is tallest at the sun and narrows along the
  // horizon away from it; Atmospheric's Ice keeps its even band. A dragged line keeps the glow as
  // it was.
  const gather = !controls.drag && packId !== 'atmospheric' ? 1 : 0
  // At the seed's own view Atmospheric's ground keeps its variant's greys: darkened by the seed's
  // depth as well, a deep seed's light ground and a between seed's dark ground meet at one grey.
  const ownGreys = !controls.drag && packId === 'atmospheric'
  const groundDepth = ownGreys ? 0 : depth
  // An open sky with a dusk band raises its glow, leaving the band room under it; a corner's glow
  // sits lower, so it rises more.
  if (look.dusk) bandAt -= structure === 'corner' ? 0.22 : 0.12
  const day = stops2(intensity, 0.7)
  // Water and land follow a dragged line's tilt only so far: tilted further, the horizon no longer
  // reads as level ground seen from the shore. Open skies follow the line all the way round. Over
  // water and land the sky keeps its own lean against the line.
  const lineTilt = line ? (ground ? limitTilt(line.tilt, water ? WATER_MOST_TILT : LAND_MOST_TILT) : line.tilt) : 0
  // Under a long line an open sky leans a little off the line by seed, toward the frame's upright
  // or away from it (the same way for a line and its mirror image; not at all for an upright
  // line), so seeds' deep skies sit in different places along the line's far end.
  const skyLean = line && !ground ? DRAG_LEAN * (2 * seeded(Math.round(seed) * 71 + 37)() - 1) * Math.sin((lineTilt * Math.PI) / 180) * smoothstep(0.9, 1.6, line.length) : 0
  const skyTilt = line ? lineTilt + (ground ? tilt : skyLean) : tilt
  const turn = (skyTilt * Math.PI) / 180

  // How far a dragged line's start lies above the frame's top over warm-lit water, as the sun's path
  // there turns into a field of glints.
  const overTop = line && water && packId !== 'atmospheric' ? clamp01((-0.5 * tall - line.from[1]) / (GLINT_RAMP * tall)) : 0
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
    // A far bank on the water's line; it lowers as a high line leaves less sky above it. Its height
    // differs more by seed under a line whose start lies above the frame.
    const bankHeight = water ? look.bank * lerp(lerp(0.8, 1.3, bankPick), lerp(GLINT_BANK.height[0], GLINT_BANK.height[1], bankPick), overTop) * clamp01((lineAt + 0.5 * tall) / 0.6) : 0
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
    const share = glowShare(look, structure, warmShare, risePick, softness, day)
    const aboveGlow = (y: number) => {
      const lineAt = (y - 0.5) * tall
      const anchorY = water ? groundAt(y).anchor[1] : lineAt
      const from: RampAxis = { anchorX: 0, anchorY, turn, drop: dome }
      return -rampAt(frame, from, line.from[0], line.from[1]) - share * Math.max(0.2, anchorY + tall / 2)
    }
    let high = placeHorizon(1, seed, aspect).y
    let low = placeHorizon(0, seed, aspect).y
    // Water's horizon rises no higher than the seed's own highest line. Elemental's keeps the
    // highest: its far bank grows as the horizon lowers, so lowered its frames are one picture moved
    // and scaled.
    const highest = high + (water && packId !== 'elemental' ? WATER_HIGHEST * runPick(seed, seeded(Math.round(seed) * 89 + 41)()) : 0)
    for (let k = 0; k < 24; k++) {
      const mid = 0.5 * (high + low)
      if (aboveGlow(mid) > 0) low = mid
      else high = mid
    }
    lineY = Math.max(0.5 * (high + low), highest)
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
  // The frame's highest and lowest points above the horizon, along the sky's axis.
  let frameHigh = -Infinity
  let frameLow = Infinity
  for (const [x, y] of [[-half, -tall / 2], [half, -tall / 2], [-half, tall / 2], [half, tall / 2]]) {
    frameHigh = Math.max(frameHigh, -rampAt(frame, axis, x, y))
    frameLow = Math.min(frameLow, -rampAt(frame, axis, x, y))
  }
  // Under a dragged line the glow sits at its start, and the sky reaches the zenith's color at its
  // end: that height above the horizon is the sky's reach, and the top of the sky lies the zenith's
  // own room above it.
  const dragRise = Math.max(0.03, lineRise)
  // A line whose start lies below the horizon sets the sun below it: the twilight glow stays on the
  // horizon but shrinks the further below the start lies, and the sun's own light fades, so
  // lowering the line still changes the frame. The glow keeps its light (dimmed, a warm glow reads
  // brown).
  const setDepth = line ? Math.min(0.9, Math.max(0, 0.03 - lineRise)) : 0
  const setGlow = Math.exp(-setDepth / SINK_FADE)
  const setShrink = Math.exp(-setDepth / (packId === 'bold' ? BOLD_SET_SHRINK : SET_SHRINK))
  // How far the frame lies behind a glow that a line puts above water: 1 when the glow's line is
  // above the whole frame. The sky above that glow shows only in the water, which mirrors it from
  // the horizon toward the viewer, so it reaches at least a frame height past the glow: room for
  // the sky's lighter bridge and its Cyan band before the deep sky.
  // Elemental's high sky greys under its veil, so its water keeps mirroring the low sky.
  const waterBehind = line && water && packId !== 'elemental' ? clamp01((dragRise - frameHigh) / (0.1 * tall)) : 0
  const dragReach = line ? dragRise + lerp(line.length, Math.max(line.length, tall), waterBehind) : 0
  const dragTop = skyTopOf(dragReach, tall)
  const skyHeight = Math.max(0.2, line ? dragTop : horizonY * tall)
  // Under a line that puts a warm glow above the frame, the sun's path is a field of glints.
  const glints = line && water && packId !== 'atmospheric' ? clamp01((dragRise - frameHigh) / (GLINT_RAMP * tall)) : 0
  // Under a dragged line the sun sits on the line's axis, just past the horizon below its start.
  // Under a glow above the frame it stands up to SUN_RISE above the horizon by seed, and no higher
  // than halfway to the frame's top.
  const sunBelow = line ? dragRise + (arcs ? 0 : 0.03) - glints * Math.min(SUN_RISE * seeded(Math.round(seed) * 101 + 59)(), 0.5 * (anchorY + 0.5 * tall)) : 0
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
  // A deep seed's low sky is dimmer, so its color stays saturated instead of paling, and seeds
  // differ in how bright their sky is; most of all Atmospheric's, whose greys differ in little else.
  const lowGain = look.lowSkyGain * stops2(intensity, look.lowSkyGain < 1 ? 0.8 : 0.35) * (packId === 'atmospheric' ? lerp(1.15, 0.55, depth) : lerp(1, 0.7, depth))
  const glowGain = stops2(intensity, 0.15)
  const sunGain = stops2(intensity, 2.4)
  const groundGain = stops2(intensity, 0.8)
  const [path, deeper, paler] = look.path

  // Softness is haze: wider edges and glow, and a wider lens.
  const haze = stops2(softness, 1.4)
  const glowHaze = stops2(softness, 0.8)
  // The glow is larger where more sky shows, so a tall frame doesn't get a thin stripe.
  const skyScale = 0.72 + 0.36 * Math.min(skyHeight, 1.6)
  // Each seed's glow has the size of its warm fill: small, large, or between.
  const glowSize = WARM.size[warmTurn] * lerp(0.9, 1.1, sizePick)
  const glowScale = glowHaze * day * skyScale * air * glowSize
  // How high the glow's line sits above the horizon: for open skies where the Horizon control puts
  // the brightest band, over water and land up to half of the sky's height by warm fill and seed,
  // higher in haze; under a dragged line, at its start.
  // Over land the glow's line stays a little above the ridge's crest, which would hide it. Bold's
  // stays lower, leaving its Cyan band room above the glow.
  // Over land under a high line the glow's band is at least about the lens wide, or the lens
  // blurs it away and the frame is a field of dark ground.
  const highLand = clamp01((0.5 * tall - lineAt - 0.55 * tall) / (0.15 * tall))
  const lensBand = anchorY - crest + 1.5 * lerp(0.045, 0.12, softness)
  const aboveCrest = land ? (packId !== 'bold' ? Math.max(anchorY - crest + 0.04, lerp(0, lensBand, highLand)) : lensBand * highLand) : 0
  const glowRise = line ? dragRise : ground ? Math.max(glowShare(look, structure, warmShare, risePick, softness, day) * skyHeight, aboveCrest) : openRiseAt(anchorY)
  // How far the glow's lower side, the dusk band and the dimming toward the horizon reach. Over an
  // open sky a dragged line's horizon can lie far behind the glow; they keep the seed's own size
  // there, and the low sky fills the rest. The glow's lower side ends where the seed's own frame
  // ends below it, or at the horizon.
  const glowReach = line && !ground ? Math.min(glowRise, ownRise) : glowRise
  // A warm glow that a dragged line lifts above the land's own glow ends that much above the land,
  // up to LAND_LIFT, so a low sky of its own color shows between the warm light and the ground: at
  // the land's edge the lens mixes warm light and the dark ground into red and mauve.
  const warmLight = packId !== 'atmospheric'
  const ownLandRise = Math.max(glowShare(look, structure, warmShare, risePick, softness, day) * Math.max(0.2, horizonY * tall), aboveCrest)
  const landLift = line && land && warmLight && look.lowSky !== look.light ? Math.min(LAND_LIFT, Math.max(0, glowRise - ownLandRise)) : 0
  // Where a warm glow's lower side ends above the horizon, the sky under it comes back as the glow
  // fades, fully once the end lies END_LIFT above an open sky's horizon or LAND_LIFT above the land.
  const follow = !line || !warmLight ? 0 : land ? landLift / LAND_LIFT : ground ? 0 : smoothstep(0, END_LIFT, glowRise - glowReach)
  const glowEnd = line && !ground ? [glowReach, 0.5 * glowReach, follow] : landLift > 0 ? [glowRise - landLift, 0.6 * landLift, follow] : [0, 0.1, 0]

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
  // A light seed's low sky reaches high; a deep seed's Meta Blue reaches further down, less far over
  // an open sky, whose glow would leave its low sky no room.
  const edgeShare = ground ? ([[0.82, 0.98], [0.45, 0.62], [0.66, 0.84]] as const)[depthTurn] : ([[0.82, 0.98], [0.58, 0.7], [0.7, 0.84]] as const)[depthTurn]
  const skyEdgeAt = -(edgeFloor + look.skyEdge[0] * Math.max(0.1, topHeight - edgeFloor) * within(edgeShare, edgePick))
  // A sky edge narrower than about a third of a short side reads as the edge of a cloud bank. A
  // look whose low sky must show as its own band between the zenith and the glow allows a
  // narrower one: the lens still softens it. Under a broad seed's warm haze it is narrower too, so
  // the low sky's own color shows between the zenith and the glow.
  const skyEdgeWidth = (Math.max(look.skyEdge[2], look.skyEdge[1] * Math.abs(skyEdgeAt)) * Math.sqrt(haze)) / Math.sqrt(Math.max(1, warmReach))

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
  // How high the line's end lies above the horizon along the sky's own axis.
  const toHeight = line ? -rampAt(frame, axis, line.to[0], line.to[1]) : 0
  // Under a dragged line the zenith is the pack's Meta Blue at the line's end instead.
  if (line) {
    const [x, y] = line.to
    zenithShade = [1.0 / Math.max(0.2, topHeight), rampAt(frame, axis, x, y), 0.02 * side, (x * Math.cos(turn) - y * Math.sin(turn)) / half]
  }
  // Where the sky sinks toward the dark at its far edge, the zenith there is that share of the hex;
  // a deep seed's far sky sinks further, and so does Bold's wide sky of a corner or of arcs, which
  // is deep blue far from the light (muted as Elemental's is, it would go grey). A deep
  // Atmospheric seed's far sky sinks to a dark, Slate-like overcast.
  const sink = (packId === 'bold' && (structure === 'corner' || arcs) ? 0.5 : 1) * (packId === 'atmospheric' ? lerp(1, 0.55, depth) : 1)
  zenithShade[1] += (1 - look.farSink * lerp(1, 0.4, depth * depth) * sink) / zenithShade[0]

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
  // Under a dragged line Bold's and Atmospheric's far sky sinks into deep navy, as a real sky
  // darkens away from the sun, over the seed's own share of the line's far end. A short line's
  // far end stays near the light and doesn't sink; pulled down onto the glow, the low sky would
  // turn mint under the warm light and the navy olive under the warm haze.
  const longLine = line ? smoothstep(0.9, 1.6, line.length) : 0
  const navyReach = packId !== 'elemental' ? longLine : 0
  // Elemental's far side keeps Meta Blue from a shorter line on, as soon as the line runs past
  // most of the frame.
  const farLine = line && packId === 'elemental' ? smoothstep(ELEMENTAL_FAR[0], ELEMENTAL_FAR[1], line.length) : 0
  const navyShare = within(NAVY_SHARE[depthTurn], seeded(Math.round(seed) * 53 + 19)()) * navyReach
  let navyVeil: [number, number] | null = null
  let navyEnd = 0
  // How high above the horizon the low sky's band may reach under a line (Elemental's far side).
  let zenithCap = Infinity
  if (line) {
    // Under a dragged line the edges stretch or shrink about the glow, widths included, so the
    // highest edge's upper tail ends at the line's end. Water and land can't turn their sky to
    // follow a steep line, so there the edges stretch over how far the line climbs the sky's own
    // axis. The seed's navy share then pulls the edges toward the light: a deep seed's sky turns
    // toward navy early, a light seed's stays its low sky's color nearly to the end.
    const climb = ground ? longLine * clamp01((toHeight - lineRise) / Math.max(0.05, line.length)) : 0
    const edgeTop = lerp(topHeight, Math.min(topHeight, toHeight + zenithRoom), climb)
    const stretch = Math.max(0.1, (edgeTop - zenithRoom - glowRise) / Math.max(0.05, Math.abs(topAt) + tail * topWidth - glowRise))
    // Elemental's far sky has no navy: under a long line its highest edge comes down instead until
    // it lies at most ELEMENTAL_ZENITH of the way up the frame's own sky, so Meta Blue holds the
    // frame's far side.
    let nearer = 1 - navyShare
    if (packId === 'elemental') {
      const target = lerp(Math.max(0, frameLow), frameHigh, ELEMENTAL_ZENITH)
      const highest = glowRise + (-edges[0][0] - glowRise) * stretch
      if (highest > target && target > glowRise) nearer = lerp(1, Math.max(0.15, (target - glowRise) / (highest - glowRise)), farLine)
      // The low sky's own band above the glow stays under that height too.
      zenithCap = Math.max(target, glowRise) / Math.max(farLine, 1e-3)
    } else if (navyReach > 0) {
      // So does Bold's and Atmospheric's, under the deep sky's edge that the navy share pulled in,
      // or over water and land it pushes the deep sky back out of the frame.
      zenithCap = (glowRise + (-edges[0][0] - glowRise) * stretch * nearer) / navyReach
    }
    // Under a long line Bold's and Atmospheric's seeds differ in how softly the low sky turns to
    // the deep sky (Elemental's edge between them stays as narrow as it can).
    const soft = lerp(1, lerp(DRAG_SOFT[0], DRAG_SOFT[1], seeded(Math.round(seed) * 61 + 29)()), navyReach)
    // Elemental's Meta Blue and its warm low sky blend through grey, so under a long line their
    // edge stays narrow: a band of Meta Blue at the far side, not a wide grey field.
    const widest = packId === 'elemental' ? Math.min(6, ELEMENTAL_EDGE / Math.max(0.05, farLine) ** 2) : 6
    for (const edge of edges) {
      edge[0] = -glowRise + (edge[0] + glowRise) * stretch * nearer
      edge[1] = Math.min(widest, edge[1] * stretch * nearer * soft)
    }
    navyEnd = edgeTop - zenithRoom
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
    const highest = -Math.min(topHeight - zenithRoom - tail * low[1], zenithCap)
    const under = Math.max(glowRise, land ? anchorY - crest : 0)
    // Above a broad seed's warm haze, which reaches further up. At the seed's own view, where the
    // low sky is a warm light's own color (Elemental's Lime and Tan), the glow is already part of
    // that band, and pushed up as far as the top fifth allows the light's band made the seeds'
    // skies one picture: there it rises half as far, and the seed's depth decides the rest.
    const ownBand = !line && packId !== 'atmospheric' && look.lowSky === look.light
    const band = 0.3 * skyScale * Math.max(1, warmReach) * (ownBand ? 0.5 : 1)
    low[0] = Math.max(highest, Math.min(low[0], -(under + band)))
  }
  // Under a long line Atmospheric's light seeds sink too little to give an all-sky frame a deep
  // side, so its sky's edges come down about the glow until the highest lies at most
  // ATMOSPHERIC_ZENITH of the way up the frame's own sky, as long as the low sky's edge stays at
  // least ATMOSPHERIC_PALE of the way up.
  if (packId === 'atmospheric' && navyReach > 0) {
    const target = lerp(Math.max(0, frameLow), frameHigh, ATMOSPHERIC_ZENITH)
    const pale = lerp(Math.max(0, frameLow), frameHigh, ATMOSPHERIC_PALE)
    const highest = -Math.min(...edges.map((edge) => edge[0]))
    const lowest = -edges[edges.length - 1][0]
    if (highest > target && target > glowRise && lowest > pale) {
      // The pull fades out as the glow nears the target or the low sky's edge nears the pale height.
      const down = Math.max((target - glowRise) / (highest - glowRise), pale > glowRise ? (pale - glowRise) / (lowest - glowRise) : 0)
      const k = lerp(1, Math.max(0.15, down), navyReach * smoothstep(0, 0.2, target - glowRise) * smoothstep(0, 0.1, lowest - pale))
      for (const edge of edges) {
        edge[0] = -glowRise + (edge[0] + glowRise) * k
        edge[1] *= k
      }
    }
  }
  const gains = midSky ? [zenithGain, midGain, lowGain] : [zenithGain, lowGain]
  const lowSkyEdge = edges[edges.length - 1][0]
  // The dusk band's edge sits just under the glow's line, hiding the glow's lower part; the band is
  // the sky's own light, so it gains with daylight like the low sky. Its edge is about as soft as
  // land's: the lens softens it, and a wider one mixes the two sides into a third hue.
  // The sky's lowest edge moves up out of the band's way, as far as the top fifth allows.
  // Under a line that puts the glow above the whole frame, Bold's open sky deepens away from the
  // light: a band of navy rises at the frame's far side, as far as the frame lies behind the glow,
  // and otherwise stays under the horizon.
  const behind = line && !ground ? clamp01((glowRise - frameHigh) / (0.1 * tall)) : 0
  const dusk: Tone | null = look.dusk ?? (packId === 'bold' && line && !ground ? [look.zenith, BEHIND_NAVY] : null)
  if (dusk) {
    const last = edges[edges.length - 1]
    const duskWidth = 0.04 * Math.sqrt(haze) * skyScale
    const duskAt = look.dusk ? -lerp(0.75, 0.9, duskPick) * glowReach : lerp(0.3, -lerp(0.75, 0.9, duskPick) * glowReach, behind)
    const margin = 0.3 * (last[1] + duskWidth)
    const above = edges.length > 1 ? edges[edges.length - 2] : null
    const ceiling = Math.max(-(topHeight - zenithRoom - tail * last[1]), above ? above[0] + 0.3 * (above[1] + last[1]) : -Infinity)
    last[0] = Math.min(last[0], Math.max(ceiling, duskAt - margin))
    edges.push([Math.max(duskAt, last[0] + margin), duskWidth])
    gains.push(dusk[1] * lowGain)
  }
  // Each edge sits at least half their widths above the one below it. Closer, or crossed where the
  // low sky's band or the dusk band pushed the lower one up, the stop between them would take a
  // negative share and draw its color out of the sky: blue drawn out of grey reads olive, out of
  // Cyan mint.
  for (let k = edges.length - 1; k > 0; k--) edges[k - 1][0] = Math.min(edges[k - 1][0], edges[k][0] - 0.5 * (edges[k - 1][1] + edges[k][1]))
  // Under a long line the navy takes the lighter Meta Blue step's place: the step's upper edge
  // comes down to its lower one, where the sky then turns toward navy, or the step would be a
  // wide band of full-strength Meta Blue under the navy.
  if (navyReach > 0 && midSky) edges[0] = [lerp(edges[0][0], edges[1][0], navyReach), lerp(edges[0][1], edges[1][1], navyReach)]
  // Under the line the zenith is NAVY_TURN of Meta Blue where the sky turns and sinks to the
  // seed's navy where the highest edge's tail ends: Meta Blue's own dim hue, below full strength.
  // The veil fades out across the turn, so the navy stays clear.
  // All of it comes in with the line's length, as the navy share does.
  if (navyReach > 0 && line) {
    const turnAt = Math.max(edges[0][0], 0.05 - navyEnd)
    const slope = (NAVY_TURN - NAVY_END[depthTurn]) / (turnAt + navyEnd)
    zenithShade[0] = lerp(zenithShade[0], slope, navyReach)
    zenithShade[1] = lerp(zenithShade[1], turnAt + (1 - NAVY_TURN) / slope, navyReach)
    navyVeil = [lerp(topHeight - 0.3 * tall, -turnAt - 0.5 * edges[0][1], navyReach), lerp(topHeight - 0.08 * tall, -turnAt + 0.5 * edges[0][1], navyReach)]
  }
  // A pale stop stays below the shader's grey hold (SKY_GREY_KNEE), so a bright low sky reaches
  // about Ice, a pale grey, only under the sun's light and keeps its masses elsewhere.
  slotColors({ ...look, dusk }, midSky)
    .slice(0, gains.length)
    .forEach((hex, k) => {
      const grey = Math.min(...srgbToLinearRgb(hexToSrgb(hex)))
      if (grey > 0) gains[k] = Math.min(gains[k], SKY_GREY_KNEE / grey)
    })
  const stopParams: Record<string, number> = {}
  edges.forEach(([at, width], j) => {
    stopParams[`at${j + 1}`] = at
    stopParams[`width${j + 1}`] = width
  })
  gains.forEach((gain, k) => (stopParams[`gain${k + 1}`] = gain))
  // Each edge and the glow's line lean and bow a little on their own, so neighbours are never
  // parallel in any direction the sky runs. A stream of its own leaves the other picks as they are.
  const shapePick = seeded(Math.round(seed) * 31 + 7)
  const ownShape = Array.from({ length: 2 * RAMP_EDGES }, (_, i) => (shapePick() * 2 - 1) * (i % 2 === 0 ? 0.07 : 0.05))
  // Under a line that turns an open sky toward sideways, its edges run across the frame's height,
  // over which that lean and bow read as straight, parallel stripes. There each edge leans and bows
  // up to SIDE_SHAPE times as much and takes an S-shaped wave of its own, as far as its neighbours
  // leave room, so no two edges cross and a bow doesn't put every seed's bend in the same place.
  // A taller frame's edges run further, so they take as much more, to bend as far round. There
  // neighbours leave little room for more, so all of them also share one lean, bow and wave of the
  // seed's own as far as the frame's height runs past a short side, which changes no gap.
  const sideways = line && !ground ? smoothstep(0.85, 0.98, Math.abs(Math.sin((lineTilt * Math.PI) / 180))) : 0
  const extent = (Math.abs(half * Math.cos(turn)) + Math.abs(0.5 * tall * Math.sin(turn))) / 0.5
  const wavePick = seeded(Math.round(seed) * 43 + 11)
  const ownWave = Array.from({ length: RAMP_EDGES + 1 }, () => (wavePick() * 2 - 1) * SIDE_WAVE * extent * sideways)
  const sideShared = SIDE_SHARED.map((most) => (wavePick() * 2 - 1) * most * (tall - 1) * sideways)
  const neighbours = edges.slice(1).map((below, j) => ({
    room: below[0] - edges[j][0] - 0.25 * (edges[j][1] + below[1]),
    shape: Math.abs(ownShape[2 * j + 2] - ownShape[2 * j]) + (2 / 3) * Math.abs(ownShape[2 * j + 3] - ownShape[2 * j + 1]),
    wave: Math.abs(ownWave[j + 1] - ownWave[j]),
  }))
  let shapeScale = 1 + (SIDE_SHAPE * extent - 1) * sideways
  for (const n of neighbours) if (n.shape > 1e-6) shapeScale = Math.min(shapeScale, Math.max(1, n.room / n.shape))
  let waveScale = shapeScale
  for (const n of neighbours) if (n.wave > 1e-6) waveScale = Math.min(waveScale, Math.max(0, n.room - shapeScale * n.shape) / n.wave)
  const edgeShape = ownShape.map((v, i) => v * shapeScale + sideShared[i % 2])
  const edgeWave = ownWave.map((v) => v * waveScale + sideShared[2])
  const glowShape = [(shapePick() * 2 - 1) * 0.05, (shapePick() * 2 - 1) * 0.04].map((v, i) => v * clamp01(glowRise / 0.15) * shapeScale + sideShared[i])

  // Over land the sun sits just above the crest at its x; over water just under the line.
  const underLine = line ? (line.from[1] + sunBelow * Math.cos(turn)) / tall + 0.5 : horizonY + (arcs ? 0 : 0.03 / tall)
  const sunY = land ? lineOf((sunX - 0.5) * frameWidth) / tall + 0.5 - lerp(0.03, 0.1, crestPick) : underLine
  // The glow's height that the sun's path mirrors, and the band above it.
  const pathGlow = glowRise + 1.2 * bankHeight
  const skyBand = Math.min(0.3, Math.max(0.05, 0.7 * (-lowSkyEdge - glowRise)))
  const ownWater = water && (packId !== 'bold' || !controls.drag)
  const lift = ownWater && packId !== 'bold' ? OWN_WATER.lift[packId][depthTurn] : 0
  const lensRadius = lerp(0.045, 0.12, softness)
  // Under a field of glints, which of a two-color light's warm colors leads the sky and which blue
  // leads the water: 0 its core and the low sky, 1 its light and the low sky, 2 its core and the
  // zenith, 3 its light and the zenith, in turn over the runs. A one-color light keeps its own.
  const leads = look.coreColor !== look.light ? seedRun(seed) % 4 : -1
  const warmLead = leads >= 0 ? LEAD_WARM[leads % 2] : 0
  const blueLead = leads >= 2 ? 1 : 0
  // The seed's sea under a field of glints, from calm (0) to rough (1).
  const sea = thirdPick(seed, seeded(Math.round(seed) * 97 + 53)())
  const lensStrip = 0.05 + 1.5 * lensRadius
  // A dark land color (Oklab L under DARK_L) reads as itself only up to one stop over its own, and
  // under a warm light it has no clean mix with the light.
  const darkLand = warmLight && linearToOklab(srgbToLinearRgb(hexToSrgb(look.landTop[0])))[0] < DARK_L
  const litMost = darkLand ? Math.max(1, (2 / look.landTop[1] - 1) / Math.max(look.landLit, 1e-3)) : Infinity
  const strip = lerp(lensStrip, Math.max(lerp(GLINT_SEA.strip[0], GLINT_SEA.strip[1], sea) * (0.5 * tall - lineAt), bankHeight > 0 ? lensStrip : 0.05), glints)

  const params: Record<string, ParamValue> = {
    anchor: [anchorX / frameWidth + 0.5, horizonY],
    angle: skyTilt,
    drop,
    stops: gains.length,
    ...stopParams,
    edgeShape,
    glowShape,
    edgeWave,
    horizonEdge: 0,
    zenithShade,
    zenithFloor: lerp(0.35, NAVY_FLOOR, navyReach),
    warp: 0,
    softVary: 0,
    softFollow: 0,
    drift: 0,
    vary: 0,
    softness: 0,
    boundaryWander,
    boundaryNoise: [0.35, lattice, 0.25, 2],
    // Wide edges change their softness less (the 0.15 width), or their color climbs higher in columns.
    // A sideways sky's edges change their softness more along their length.
    boundarySoft: [lerp(0.15, SIDE_SOFT, sideways), 0.5, 0.25, 0.15],
    sunAt: [sunX, sunY],
    sunlight: sunlight * glowGain * setGlow,
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
    glow: look.glow * glowGain * (arcs ? 1.2 : 1) * (ownGreys ? ICE_GAIN[warmTurn] : 1),
    glowOffset: -glowRise,
    glowEnd,
    // Scattered daylight over the sky, denser toward the horizon, mutes and pales it toward the
    // light. A band of full Meta Blue stays at the far edge: the top twentieth of the frame, fading
    // into the veil over the next sixth.
    // Elemental's warm side reaches farther, so its light's own color shows over more of the sky.
    // A light seed's sky is hazier, a deep seed's clearer, and a broad seed's warm haze pales it
    // in the veil's place. Under a dragged line, which can leave a frame that is all sky, no seed
    // is hazier than the pack's own sky, and the band of full Meta Blue reaches further down from
    // the line's end, so the frame keeps a second pack color.
    veil: [look.veil[0] * zenithGain * dragVeil, look.veil[1] * zenithGain * dragVeil, (packId === 'elemental' ? 0.6 : 0.3) * Math.max(0.2, topHeight)],
    // Under a long line Elemental's veil fades out across its highest edge, so the Meta Blue that
    // holds the frame's far side shows clear instead of greyed.
    veilFar:
      navyVeil ??
      (line && farLine > 0
        ? [lerp(topHeight - 0.3 * tall, -edges[0][0] - 0.5 * edges[0][1], farLine), lerp(topHeight - 0.08 * tall, -edges[0][0] + 0.5 * edges[0][1], farLine)]
        : line
          ? [topHeight - 0.3 * tall, topHeight - 0.08 * tall]
          : [topHeight - 0.22 * tall, topHeight - 0.05 * tall]),
    veilTint: paleTint(look.veilColor, packId === 'bold' ? 0.35 : packId === 'elemental' ? 0.25 : 0.6),
    // Under the far band the sky's blue greys at its own hue (Elemental, whose pale side is its
    // light's color), or toward Steel (Atmospheric, overcast), instead of turning periwinkle.
    // Atmospheric's light seeds are overcast grey, its deep seeds keep more of their clear blue.
    veilMute: packId === 'atmospheric' ? 0.8 * lerp(1.15, 0.5, depth) : packId === 'elemental' ? 0.5 : 0,
    // Under a long line the haze thickens and thins in the sky's masses, so skies that a line
    // leaves without a glow still differ in where they are paler and deeper: most in a broad
    // seed's hazy air, least in a compact seed's clear air, more in a light seed's.
    hazeMass: HAZE_MASS[warmTurn] * lerp(1.3, 0.8, depth) * navyReach,
    blueHue: 1,
    // Elemental's veil takes its light's own color near the light, so the pale side reads Tan or
    // Lime; the other packs take the bridge's warm white there.
    veilNear: packId === 'elemental' ? paleTint(look.light, 0.6) : [0, 0, 0],
    // Under a field of glints the band along the water's far edge mirrors the sky just above the
    // horizon, which away from the light is a clear pale tint of the low sky.
    bandTint: paleTint(look.lowSky, BAND_DEPTH),
    glowVary: 0,
    // A sun's glow is tallest near the sun and narrows away from it along the horizon, keeping its
    // light, so its edges are never parallel: far from the sun it reaches up only a share of its
    // height, and it rises toward the sun over part of its width. Atmospheric's Ice keeps its
    // wide, flat band.
    glowArch: lerp(0.6, GLOW_ARCH, gather),
    glowArchShape: GLOW_ARCH_SHAPE[warmTurn].map((v) => lerp(1, v, gather)),
    // More daylight gathers the glow toward the sun, so white shows only near the light.
    glowLateral: 1 - floor * narrow * stops2(intensity, -0.8),
    glowWidth: 0.45 * lateral * Math.sqrt(day) * glowHaze * narrow * setShrink,
    shadowHeight: 0,
    glow1Weight: 1,
    // The glow's light reaches up the sky as far as the seed's warm fill: a broad seed's warm haze
    // fills much of the sky, also where a dragged line leaves the glow itself outside the frame.
    glow1Up: 0.1 * glowScale * look.glowUp * warmReach * dragWarm * setShrink,
    glow1Down: Math.min(2, Math.max((0.03 + 0.03 * glowHaze) * skyScale, look.downReach * glowReach)),
    glow2Weight: 0.2 * look.haze * lerp(0.6, 1.5, softness) * warmReach,
    glow2Up: 0.17 * glowScale * look.glowUp * warmReach * dragWarm * setShrink,
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
    glowPath: path + lerp(look.hue[0], look.hue[1], huePick) - (intensity - 0.5) * 0.25 + glints * warmLead,
    sunGlow: 0.25 * sunGain * look.sunGlow * (arcs ? look.core : water ? 0.5 : 1) * setGlow,
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
    // Where Elemental's far side brings Meta Blue against its warm low sky, the bridge between the
    // two is paler, a cream rather than a grey.
    bridgeLift: lerp(look.bridgeLift + 0.12 * softness, ELEMENTAL_FAR_LIFT, packId === 'elemental' ? longLine : 0),
    bridgeWarmth: look.bridgeWarmth,
    bridgeFloor: look.bridgeFloor,
    // A light whose core is another color (Bold's Orange-red, whose core is Yellow) pales through
    // it, as bright orange light goes amber, cream and then white, and its bridge turns neutral
    // toward the sky: it meets Cyan through amber cream and white, not peach, salmon or green.
    bridgeCore: 1,
    bridgeSky: look.coreColor !== look.light ? 1 : 0,
    duskStop: dusk ? gains.length - 1 : -1,
    land: 0,
    // One lens over the whole scene: Softness is its radius.
    lensRadius,
    // Patches of light in the sky, a third to half of the frame across.
    // Atmospheric's overcast takes seeds' own brighter and darker masses, some faint, some clear.
    skyPatch: [packId === 'atmospheric' ? Math.max(lerp(0.04, 0.24, patchPick), ownGreys ? ICE_MASSES[warmTurn] : 0) : 0.08, lerp(0.33, 0.5, patchPick) * frameWidth, 1.6],
    ground: groundKind,
    groundAt: lineY,
    groundTilt: (Math.atan(outline.slope) * 180) / Math.PI,
    groundWave: outline.wave,
    ridge: [outline.rise, outline.toward, outline.bowl, outline.waveLength],
    shore: [bankHeight, 0.5],
    // A far bank is a headland: thick where it runs off the frame on the side away from the sun and
    // thinning to nothing toward it, its waterline just under the horizon.
    shoreShape: [-side, lerp(lerp(BANK.length[0], BANK.length[1], shorePick), lerp(GLINT_BANK.length[0], GLINT_BANK.length[1], shorePick), glints) * frameWidth, BANK.peak],
    shoreFoot: bankHeight > 0 ? [BANK.foot, BANK.mirror] : [0, 1],
    // The path mirrors the glow's line, which sits above most of the far bank.
    // Light water is a near mirror with a faint path, deep water dark with a strong one. A tall,
    // narrow frame's path widens less, so it never fills the water's width.
    sunPath: [water ? look.sunPath * lerp(0.45, 1.25, depth) : 0, 0.02, 0.5 * Math.sqrt(frameWidth / tall), pathGlow],
    // Under a line that puts a warm glow above the frame, the path is a field of glints that adds the
    // sun's light, densest down the middle and thinning to the sides with no outline, not a wide
    // blend into the blue that reads grey or olive. The seed's sea sets how wide it spreads and the
    // size of its rows, and its depth how fast the water past the far strip mirrors the sky higher
    // up. Atmospheric's Ice path meets its water without a third hue.
    sunGlints: [glints, lerp(GLINT_SEA.spread[0], GLINT_SEA.spread[1], sea), lerp(GLINT_SEA.rows[0], GLINT_SEA.rows[1], sea), lerp(MIRROR_GLINTS.climb[0], MIRROR_GLINTS.climb[1], depth)],
    // The path's middle reaches the glow's paler top at the bottom edge. Toward its sides it
    // mirrors the band part way from the glow up to the low sky's edge, at the seed's own view the
    // light just above the glow.
    // A seed whose water Meta Blue leads mirrors the sky from LEAD_BLUE higher past the far strip.
    sunLight: [Math.max(0.3, 0.5 * tall - lineAt), skyBand * (ownWater ? OWN_WATER.band : 1) + glints * LEAD_BLUE * blueLead],
    // Past the far bank's image and a strip wider than the lens, so the bank never blurs into the
    // blue, the water mirrors the sky above the glow: the glow's mirror image is a thinner, weaker
    // strip, and the warm reflection gathers in the sun's path.
    // Under a field of glints Bold's water does the same, so the glints lie on its blue and not on
    // the warm glow's mirror image. There the warm strip reaches further on a calm sea, and just
    // past it a calm sea takes more of the low sky's light.
    waterLift: [
      ...(lift > 0 ? [pathGlow + skyBand * lift + 0.05, strip, OWN_WATER.keep[depthTurn]] : glints > 0 ? [glints * (pathGlow + skyBand + 0.05), strip, 1] : [0, 0.05, 1]),
      glints * lerp(GLINT_SEA.sheen[0], GLINT_SEA.sheen[1], sea),
    ],
    // The strip under the line is thin and bright, so it still shows after the lens. Under a high
    // line the ripples draw the short sky's reflection out over more of the water, so the water
    // carries the sky's colors and not only the zenith's.
    // Under a glow above the frame the reflection climbs past the glow within the water's top half:
    // the warm part is a band near the horizon, and the high sky takes the near water.
    // Water that mirrors the sky higher up also squashes it and grows darker toward the viewer, so
    // it reads as water under the sky and not as the sky's mirror image.
    water: [lift > 0 ? OWN_WATER.squeeze : lerp(Math.min(1.25, Math.max(0.5, (0.77 * lineY) / Math.max(0.05, 1 - lineY))), Math.min(3, (3 * glowRise) / Math.max(0.2, (1 - lineY) * tall)), waterBehind), Math.max(lift > 0 ? OWN_WATER.degrees : 0, lerp(look.waterDegrees[0], look.waterDegrees[1], ridgePick) * [0.6, 1.6, 1][variant]), 0.12, 1.5],
    waterMirror: water ? look.waterMirror : 1,
    // Under a high line the near water mirrors the sky high above the frame, which is darker.
    // Deep water mirrors more of that darker sky.
    mirrorDeep: water ? lerp(lerp(0.25, 1.4, depth), lerp(MIRROR_GLINTS.dark[0], MIRROR_GLINTS.dark[1], depth), glints) * tall : 0,
    // Bold's water under its warm glow, and Elemental's where it mirrors the sky higher up; the other
    // packs' water keeps its own Slate or Meta Blue.
    waterTint: water && (packId === 'bold' || (lift > 0 && packId === 'elemental')) ? 0.6 : 0,
    // A tall land area reaches nearer the viewer: the haze over its far ground reaches further
    // down, and its near ground is darker. A dark land color's haze doesn't: through more air
    // Forest under Lime light turns olive, and Plum under Tan grey-brown. The light in a dark land
    // color's haze has come a longer way through the air and is deeper, as a warm light's tail is:
    // Lime goes toward Forest's green, where Lime itself at that low light reads olive.
    groundHaze: [look.landHaze, land ? (darkLand ? (line ? 0.1 : 0.1 * tall) : Math.max(0.1 * tall, 0.25 * landRoom)) : 0.05 * tall, darkLand ? LAND_AIR_DEEPER : 0],
    groundVeil: [land ? look.groundVeil * groundGain : 0, 0.35 * landRoom],
    // A tall land area carries more of the light, so a high line doesn't leave a dark field. A dark
    // land color takes no more of it than one stop over its own: brighter, Plum turns magenta and
    // Forest green.
    landLit: [ground ? look.landLit * (land ? Math.min(1 + 1.5 * clamp01((landRoom - 0.4 * tall) / (0.4 * tall)), litMost) : 1) : 0, lerp(0.3, 0.5, widthPick) * frameWidth, ground ? 0.6 : 0],
    // A deep seed's ground is darker. A light seed's keeps the pack's own: brightened, Plum turns
    // magenta.
    groundTopGain: look.landTop[1] * groundGain * lerp(1, 0.55, groundDepth),
    // The near ground stays a deep tone of its color, never black.
    groundBottomGain: Math.max(0.35 * look.landTop[1] * groundGain * lerp(1, 0.55, groundDepth), look.landBottom[1] * groundGain * lerp(1, 0.5, groundDepth) * (land ? Math.min(1, ((0.4 * tall) / landRoom) ** 1.5) : 1)),
    waterGain: look.water[1] * groundGain * lerp(1, 0.6, groundDepth),
  }
  return { colors: slotColors({ ...look, dusk }, midSky), params, lens: {}, output: { exposure: 0 } }
}
