import { linearToOklab, oklabToOklch } from '../../color/oklab'
import { hexToLinear, normalizeHex } from '../../color/srgb'
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

/** A pale tint of a color in linear light at luminance 1; `depth` 0 is white, 1 the color itself. */
function paleTint(hex: string, depth: number): number[] {
  const c = hexToLinear(hex)
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

/** How far an open sky's glow reaches below its line, relative to the line's height above the horizon. */
const OPEN_DOWN_REACH = 0.4

/** Which warm light of the color list a design asks for: its deepest (Orange-red in Bold) or its palest (Yellow). */
export type LightKind = 'deep' | 'pale'

/**
 * The seed's design: every size, reach and light level, the same whichever colors fill it. The
 * levels were set on Bold's colors, the design's own: Meta Blue in the zenith, land and water,
 * Cyan in the low sky, Yellow or Orange-red as the light. `rampRoles` picks the colors and
 * `levelsOf` brings each to the design's light within its own limits.
 */
interface RampDesign {
  light: LightKind
  /** The low sky's gain at the default Intensity. */
  lowSkyGain: number
  /** How much skylight is left right above the horizon. */
  horizonGain: number
  /**
   * Height of the sky's main edge as a share of the sky, its width relative to that height, and its
   * least width in short sides.
   */
  skyEdge: [number, number, number]
  /** Glow strength at the sun's side at the default Intensity. */
  glow: number
  /**
   * The light's path through the air at the glow line (0 is the color itself, below 0 a paler
   * member of its family, above 0 a deeper one), how much deeper it gets toward the horizon and how
   * much paler above the glow.
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
  /** How far the glow reaches below its line, relative to the line's height above the horizon. */
  downReach: number
  /** How much deeper the light gets away from the sun. */
  sideDeeper: number
  /** How far the glow reaches above its line, and how high its line sits over water and land, relative to the default. */
  glowUp: number
  glowRise: number
  /** Sun glow strength relative to the default, and at the arcs' center. */
  sunGlow: number
  core: number
  /** Land right under its outline and at the bottom edge, and the water's own light: gains on Meta Blue. */
  landTop: number
  landBottom: number
  water: number
  /**
   * Degrees below the horizon half a short side under the line, least and most. Fewer keep the reflection over
   * most of the water; more bring in the water's own dark color soon after the line, so the band
   * where the two mix stays thin.
   */
  waterDegrees: [number, number]
  /** Share of calm water's reflectance kept. */
  waterMirror: number
  /** Share of the sky's light in the air in front of far land. */
  landHaze: number
  /** Extra light on the side toward the sun of the land and the water's own light. */
  landLit: number
  /** Strength of the sun's path on water, the glow mirrored down toward the viewer. */
  sunPath: number
  /** How much the glow's haze hides the sky behind it. */
  extinction: number
  /**
   * Light scattered over the sky under its far band of the zenith's full color, and more of it low
   * down, at the default Intensity (linear light).
   */
  veil: [main: number, low: number]
  /** Pale haze in front of far land (linear light). */
  groundVeil: number
}

/**
 * The seed's design for its structure and variant. A deep light is a compact, low glow under a
 * wide low sky; a pale one a taller glow; over land a third of the seeds take a compact sun high
 * over a dark ridge that it doesn't light.
 */
function rampDesign(structure: RampStructure, variant: number, random: () => number): RampDesign {
  const pickLight = random()
  // A second pick no design uses; drawing it keeps every later pick of the seed the same.
  random()
  const ground = structure === 'water' || structure === 'land'
  // Over an open sky the dusk band hides the glow's lower part, so the glow reaches only a little
  // way down to it.
  const openDown = ground ? {} : { downReach: OPEN_DOWN_REACH }
  const base = {
    horizonGain: 0.9,
    bridgeLift: 0.12,
    bridgeWarmth: 0.6,
    bridgeFloor: 0.3,
    downReach: 4,
    sunGlow: 1,
    core: 1.5,
    landTop: 0.6,
    landBottom: 0.12,
    water: 0.3,
    waterDegrees: [12, 18] as [number, number],
    // Dimmed, the pale bridges in the reflection turn salmon or khaki; a little dimming only.
    waterMirror: 0.9,
    landHaze: 0.75,
    landLit: 0.5,
    sunPath: 0.85,
    extinction: 1.2,
    glowRise: 1,
    veil: [0.2, 0.05] as [number, number],
    groundVeil: 0.1,
  }
  // The low sky's band of its own color shows between the zenith and the light.
  const pale: RampDesign = { ...base, light: 'pale', lowSkyGain: 1.6, skyEdge: [0.97, 1.0, 0.3], glow: 0.9, glowUp: 0.65, path: [0.5, 1, 0.45], hue: [-0.3, 0.35], bridge: 0.5, haze: 0.5, sideDeeper: 0.4, core: 2 }
  if (structure === 'land' && sceneTurn(structure, variant, 1) === 0) return { ...pale, glow: 1.6, glowUp: 0.35, glowRise: 1.4, horizonGain: 0.5, bridge: 0.9, bridgeLift: 0.4, landLit: 0, landHaze: 0.05 }
  // A deep light over a pale low sky: where the two meet the bridge is a pale cream, and under the
  // glow line and inside the glow's dense haze the skylight fades out, so the glow's body is the
  // light itself. A compact, low glow leaves a band of the low sky above it.
  if (ground || (pickLight < 0.55 && (structure === 'open' || structure === 'corner'))) {
    return { ...base, light: 'deep', lowSkyGain: 1.8, horizonGain: 0.42, skyEdge: [0.95, 0.9, 0.15], groundVeil: 0.05, glow: 1.2, glowUp: 0.25, glowRise: structure === 'land' ? 0.62 : 0.25, path: [-0.15, 0.55, 0.45], hue: [-0.25, 0.2], bridge: 0.9, bridgeLift: 0.5, bridgeWarmth: 0.8, bridgeFloor: 0.1, haze: 0.3, downReach: 1.5, sideDeeper: 0.3, waterDegrees: [6, 9], landHaze: 0.03, extinction: 3, ...openDown }
  }
  return { ...pale, ...openDown }
}

/** What the role picks read of a color: its Oklab lightness, warmth (Oklab b), chroma and hue, its luminance, and how pale it is. */
interface ColorFacts {
  hex: string
  L: number
  b: number
  chroma: number
  hue: number
  luminance: number
  /** Its lowest linear channel over its highest: 0 a saturated color, 1 a grey or white. */
  pale: number
}

function factsOf(hex: string): ColorFacts {
  const linear = hexToLinear(hex)
  const lab = linearToOklab(linear)
  const [L, chroma, hue] = oklabToOklch(lab)
  const top = Math.max(...linear)
  return {
    hex: normalizeHex(hex),
    L,
    b: lab[2],
    chroma,
    hue,
    luminance: 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2],
    pale: top > 0 ? Math.min(...linear) / top : 1,
  }
}

/** Degrees between two hues, 0 to 180. */
const hueGap = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180)
/** Meta Blue's Oklab hue: the sky's own blue, which the shader's blue correction turns violet blues back to. */
const BLUE_HUE = 259
/** Oklab b over which a color is a warm light's. */
const WARM_B = 0.03
/**
 * The Oklab hue up to which a warm color is a sun's: red, orange, amber, yellow, tan. A yellow-green
 * light (Lime) dims into olive, so where the list has a sun-hued warm color it is the light and the
 * yellow-green is the low sky.
 */
const FIRE_HUE = 105
/** Oklab lightness from which a color can be the light, and from which it can be the low sky. */
const LIGHT_L = 0.6
const LOW_SKY_L = 0.55
/** Oklab lightness from which the zenith's own color is pale enough to be the low sky as well. */
const PALE_ZENITH_L = 0.65
/** Oklab lightness under which a color reads as itself only up to one stop over its own (Forest, Plum, Slate). */
const DARK_L = 0.5
/** Oklab chroma under which a color is a grey. */
const GREY_CHROMA = 0.04
/** Degrees by which a dark may lie farther from the light's and low sky's hues than the nearest dark and still take turns with it. */
const DARK_HUE_TIE = 20

/** Which color of the list fills each role of a design. */
export interface RampRoles {
  /** The sky far from the light. */
  zenith: string
  /** The sky's pale side between the zenith and the light. */
  lowSky: string
  /** The one light, and the paler color its core goes through on its way to white. */
  light: string
  core: string
  /** Land right under its outline and at the bottom edge, and the water's own light. */
  landTop: string
  landBottom: string
  water: string
  /** An open sky's low band of shadowed light in front of the glow. */
  dusk: string
  /** The light scattered over the sky away from the light. */
  veil: string
}

const lightest = (colors: readonly ColorFacts[]): ColorFacts | undefined => [...colors].sort((p, q) => q.L - p.L)[0]
/** Oklab lightness of the design's own lights: Orange-red for a deep light, Yellow for a pale one. */
const DESIGN_LIGHT_L: Record<LightKind, number> = { deep: factsOf('#FF4F00').L, pale: factsOf('#FFD61E').L }

/**
 * The roles of a design filled from a list of 2 to 5 colors, in any order. The zenith is the most
 * saturated blue; the light a warm color of a sun's hue, the deepest or the palest as the design
 * asks (any warm color when none has a sun's hue, the lightest color when none is warm); its core a
 * paler warm color on the way from the light's hue to yellow; the low sky the lightest cool color
 * left, else the zenith if it is pale, else another warm color; the ground, water and dusk band dark
 * colors, or deep shades of the zenith or the light when the list has none. `darkTurn` takes turns
 * between darks about as near the light's and low sky's hues.
 */
export function rampRoles(colors: readonly string[], want: { light: LightKind; darkTurn: number }): RampRoles {
  const all = [...new Set(colors.map((hex) => normalizeHex(hex)))].sort().map(factsOf)
  if (all.length === 0) throw new Error('rampRoles needs at least one color')
  const sky = (c: ColorFacts) => (c.L < 0.9 ? c.chroma * Math.max(0, Math.cos(((c.hue - BLUE_HUE) * Math.PI) / 180)) : 0)
  const bluest = [...all].sort((p, q) => sky(q) - sky(p))[0]
  const zenith = sky(bluest) > 0 ? bluest : [...all].sort((p, q) => p.L - q.L)[0]
  const rest = all.filter((c) => c !== zenith)
  const warm = rest.filter((c) => c.b > WARM_B && c.L >= LIGHT_L)
  const fireHued = warm.filter((c) => c.hue <= FIRE_HUE)
  const warmLights = (fireHued.length ? fireHued : warm).sort((p, q) => p.L - q.L)
  // Without a warm color the light is the one as light as the design's own (Orange-red for a deep
  // light, Yellow for a pale one), so the frame's light and dark lie where the design puts them.
  const asLight = (c: ColorFacts) => Math.abs(c.L - DESIGN_LIGHT_L[want.light])
  const light = warmLights.length ? (want.light === 'deep' ? warmLights[0] : warmLights[warmLights.length - 1]) : ([...rest].sort((p, q) => asLight(p) - asLight(q))[0] ?? zenith)
  const core =
    warmLights
      .filter((c) => c !== light && c.L > light.L && c.hue > light.hue && c.hue <= FIRE_HUE)
      .sort((p, q) => hueGap(p.hue, light.hue) - hueGap(q.hue, light.hue))[0] ?? light
  const free = rest.filter((c) => c !== light && c !== core && c.L >= LOW_SKY_L)
  const lowSky = lightest(free.filter((c) => c.b <= WARM_B)) ?? (zenith.L >= PALE_ZENITH_L ? zenith : undefined) ?? lightest(free) ?? zenith
  const darks = rest.filter((c) => c.L < DARK_L && c !== light && c !== core && c !== lowSky)
  // The land's outline meets the light and the low sky through the lens, so its dark is the one
  // whose hue lies nearest both: Plum under Tan or Lime mixes grey-brown and olive, Forest stays clean.
  const apart = (c: ColorFacts) => hueGap(c.hue, light.hue) + hueGap(c.hue, lowSky.hue)
  const byHue = [...darks].sort((p, q) => apart(p) - apart(q))
  const near = byHue.filter((c) => apart(c) <= apart(byHue[0]) + DARK_HUE_TIE)
  const landTop = near.length ? near[want.darkTurn % near.length] : zenith
  const sameFamily = (c: ColorFacts) => (c.chroma < GREY_CHROMA && landTop.chroma < GREY_CHROMA) || hueGap(c.hue, landTop.hue) < 30
  const landBottom = darks.filter((c) => c.L < landTop.L && sameFamily(c)).sort((p, q) => p.L - q.L)[0] ?? landTop
  const water = lightest(darks.filter((c) => c.chroma < GREY_CHROMA)) ?? zenith
  // The dusk band meets only the glow above it: the dark nearest the light's hue, or in a list
  // without darks a deep shade of the light's own fire family, the deep red under a sunset glow.
  const dusk = [...darks].sort((p, q) => hueGap(p.hue, light.hue) - hueGap(q.hue, light.hue))[0] ?? (fireHued.length ? warmLights[0] : zenith)
  const veil = lowSky.b <= WARM_B ? lowSky : zenith
  return { zenith: zenith.hex, lowSky: lowSky.hex, light: light.hex, core: core.hex, landTop: landTop.hex, landBottom: landBottom.hex, water: water.hex, dusk: dusk.hex, veil: veil.hex }
}

/** Luminance of the colors the design's light levels were set on: Meta Blue (zenith, land, water) and Cyan (low sky). */
const SET_ON_BLUE = factsOf('#0064E0').luminance
const SET_ON_LOW_SKY = factsOf('#1FCDF0').luminance
/** How far over its own light a dark color may go: brighter, Plum turns magenta and Forest green. */
const DARK_MOST = 2
/**
 * The most gain a warm or muted low sky (Lime, Tan, Steel) takes on its own color: paler, Lime and
 * Tan read as a white band and Steel as Ice. A saturated cool one (Cyan) still reads as itself paled.
 */
const MUTED_LOW_SKY_MOST = 1.2
const CLEAN_SKY_CHROMA = 0.1
/** The most gain a grey low sky (Steel) takes: the veil pales it further. */
const GREY_LOW_SKY_MOST = 1.5
/** The share of the design's dimming toward the horizon, and of its veil, that a warm low sky takes. */
const WARM_SKY_DIM = 0.3
const WARM_SKY_VEIL = 0.6
/** The dusk band's light at the default Intensity, as a share of Meta Blue's luminance, and the least share of its own light a warm dusk band keeps. */
const DUSK_LIGHT = 0.36
const WARM_DEEPEST = 0.4
const DARK_DUSK_MOST = 1.2
/** The veil's tint depth (0.35) was set on Cyan; a greyer color's tint is deeper in proportion, so it still shows. */
const VEIL_TINT = 0.35 * factsOf('#1FCDF0').chroma

/**
 * Each role's gain on its color for the design's light, and what the colors change in how the light
 * mixes: the zenith and the low sky no lighter than the design's own, a pale core less where it
 * would turn a flat white, and the ground, water and dusk band at the design's luminance, a dark
 * color at most one stop over its own.
 */
function levelsOf(design: RampDesign, roles: RampRoles) {
  const f = { zenith: factsOf(roles.zenith), lowSky: factsOf(roles.lowSky), light: factsOf(roles.light), core: factsOf(roles.core), landTop: factsOf(roles.landTop), landBottom: factsOf(roles.landBottom), water: factsOf(roles.water), dusk: factsOf(roles.dusk), veil: factsOf(roles.veil) }
  const ground = (gain: number, c: ColorFacts, most = DARK_MOST) => Math.min((gain * SET_ON_BLUE) / c.luminance, c.L < DARK_L ? most : Infinity)
  // Dimmed, a warm low sky (Lime, Tan) reads olive or brown, and the veil's cool light over it
  // blends toward white.
  const warmSky = smoothstep(0.01, 0.05, f.lowSky.b)
  return {
    facts: f,
    zenith: Math.min(1, SET_ON_BLUE / f.zenith.luminance),
    lowSky: Math.min(1, SET_ON_LOW_SKY / f.lowSky.luminance, (f.lowSky.chroma < GREY_CHROMA ? GREY_LOW_SKY_MOST : f.lowSky.b > WARM_B || f.lowSky.chroma < CLEAN_SKY_CHROMA ? MUTED_LOW_SKY_MOST : Infinity) / design.lowSkyGain),
    core: 1 - smoothstep(0.1, 0.5, f.core.pale),
    // A dark land's side toward the light stays within one stop of its own light too.
    landTop: ground(design.landTop, f.landTop, DARK_MOST / (1 + design.landLit)),
    landBottom: ground(design.landBottom, f.landBottom),
    water: ground(design.water, f.water),
    // The band also takes the sun's added light, so a dark color in it stays nearer its own light.
    // Dimmer than WARM_DEEPEST of its own light, a warm color reads brown.
    dusk: Math.max(ground(DUSK_LIGHT, f.dusk, DARK_DUSK_MOST), f.dusk.b > WARM_B ? WARM_DEEPEST : 0),
    // How far the light deepens along its path: a saturated warm light up to yellow goes amber, red
    // and deep red as fire does; Lime would go olive, Tan brown.
    fire: smoothstep(0.08, 0.14, f.light.chroma) * smoothstep(112, 100, f.light.hue),
    veilDepth: Math.min(0.6, Math.max(0.2, VEIL_TINT / Math.max(f.veil.chroma, 1e-3))),
    lowSkyWarm: f.lowSky.b > WARM_B,
    veil: 1 - (1 - WARM_SKY_VEIL) * warmSky,
    skyDim: 1 - (1 - WARM_SKY_DIM) * warmSky,
    lightWarm: f.light.b > WARM_B,
    blueZenith: hueGap(f.zenith.hue, BLUE_HUE) < 20 && f.zenith.chroma > 0.1,
    // Pale haze in a dark land's own tint: a blue or a grey's stays clean, Plum's turns mauve, Forest's mint.
    groundVeil: Math.max(smoothstep(0.05, 0.03, f.landTop.chroma), smoothstep(60, 30, hueGap(f.landTop.hue, 250))),
  }
}

/**
 * Slot hexes for the recipe: eight stops, two glow layers, sun glow, sunlight tint, the 1:1 land
 * slots (unused), then land top, land bottom and the water's own light. `midSky` puts a second,
 * lighter step of the zenith's color between the zenith and the low sky; an open sky ends in the
 * dusk band.
 */
function slotColors(roles: RampRoles, midSky: boolean, dusk: boolean): string[] {
  const sky = [roles.zenith, ...(midSky ? [roles.zenith] : []), roles.lowSky, ...(dusk ? [roles.dusk] : [])]
  const stops = [...sky, ...Array.from({ length: 8 - sky.length }, () => sky[sky.length - 1])]
  return [...stops, roles.light, roles.light, roles.core, roles.light, '#000000', '#000000', '#000000', roles.landTop, roles.landBottom, roles.water]
}

/** Whether a seed's sky has a second, lighter step of the zenith's color. */
const hasMidSky = (seed: number) => seeded(seed * 31 + 7)() < 0.5

/** The slot colors the recipe uses for a color list and seed. */
export function rampSlotColors(colors: readonly string[], seed: number): string[] {
  const structure = rampStructure(seed)
  const design = rampDesign(structure, seedVariant(seed), seeded(seed))
  return slotColors(rampRoles(colors, { light: design.light, darkTurn: seedRun(seed) }), hasMidSky(seed), structure !== 'water' && structure !== 'land')
}

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
 * Under a dragged line, the share of the sky's reach at its far end that sinks into deep navy, by
 * the seed's depth turn (light, dark, between); the seed picks within it.
 */
const NAVY_SHARE = [[0.04, 0.14], [0.38, 0.56], [0.2, 0.34]] as const
/** Under a long line, how much the haze thickens and thins in the sky's masses, by warm turn (compact, broad, between). */
const HAZE_MASS = [0.15, 1, 0.6]
/**
 * Under a glow above the frame, how far (frame heights) above the glow the sky the water mirrors takes
 * to darken by e, and how fast (per short side of depth) the sky it mirrors climbs past the far strip,
 * for a light and a deep seed: a deep seed's water turns navy nearer the horizon.
 */
const MIRROR_GLINTS = { dark: [1.6, 0.7], climb: [1, 2.4] }
/**
 * Under a field of glints, a calm and a rough sea: how wide the glints spread as a share of the
 * mirrored path's width, the size of their rows, how far the warm reflection along the far edge
 * reaches as a share of the water's height, and how much more of the low sky's light the water
 * takes just past it. A calm sea's path is a narrow column of fine glints under a long warm
 * reflection and a pale band of the low sky; a rough sea's a wide field of coarse ones, and its
 * ripples turn toward the high sky near the horizon.
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
/** How much deeper the light in the haze over dark land is under a warm light (pathColor's longer path). */
const LAND_AIR_DEEPER = 1.5
/** The least height (short sides) of the glow line above the ridge's crest. */
const ABOVE_CREST = -0.1
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
 * zenith leads it rather than the low sky.
 */
const LEAD_WARM = [-0.35, 0.25]
const LEAD_BLUE = 0.5
/** Under a sideways line, the most lean, bow and wave all of an open sky's edges share, per short side the frame's height runs past one (base units at their ends). */
const SIDE_SHARED = [0.2, 0.16, 0.16]
/** Under a long line, the range of a seed's own factor on its sky edges' widths. */
const DRAG_SOFT = [0.6, 1.2] as const
/** Under a long line, the most an open sky leans off the line by seed, in degrees. */
const DRAG_LEAN = 15
/** The zenith's light where the sky turns toward navy, and at the line's end by depth turn, as shares of its color. */
const NAVY_TURN = 0.5
const NAVY_END = [0.24, 0.12, 0.17]
/** The darkest the zenith may go under a dragged line, as a share of its color; without one it stays at its old floor. */
const NAVY_FLOOR = 0.08
/**
 * The glow's reach: how much higher it reaches at the sun, and by warm turn (compact, broad,
 * between) the share of its height it keeps far from the sun and the share of the glow's width over
 * which it rises: a broad seed's hazy air spreads its glow wide.
 */
const GLOW_ARCH = 2.2
const GLOW_ARCH_SHAPE = [[0.2, 0.35], [0.45, 0.7], [0.28, 0.5]]
/** Water at the seed's own view: the share of the band above the glow that the sun's path mirrors toward its sides. */
const OWN_WATER_BAND = 0.4
/**
 * Under a dragged line, the most a warm glow lifted above the land's own glow ends above the land,
 * and how far above an open sky's horizon a warm glow's end lies before the sky under it comes
 * back fully as the glow fades (short sides).
 */
const LAND_LIFT = 0.25
const END_LIFT = 0.1
/** The least width (short sides) of the fade where a lifted glow's lower side ends over land. */
const LAND_END_SOFT = 0.1
/** How far (short sides) the start goes below the horizon before the sun's own light dims by e. */
const SINK_FADE = 0.6
/** How far (short sides) the start goes below the horizon before the twilight glow's size shrinks by e. */
const SET_SHRINK = 1

/**
 * Share of the frame's height at the top that the sky's edges leave to the zenith's color. It is
 * small, so the sky still changes slowly all the way to the top instead of ending in a flat field.
 */
const ZENITH_ROOM = 0.05
/** Sky height (short sides) at and above which the zenith's room is all of ZENITH_ROOM. */
const FULL_ZENITH = 0.2 / 0.45

/**
 * The room at the top of a sky of this height that holds only the zenith's color, shrinking with
 * the square of a shorter sky's height. The room below it still grows with the sky's height.
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
const glowShare = (design: RampDesign, structure: RampStructure, warmShare: number, pick: number, softness: number, day: number) =>
  Math.min(structure === 'land' ? 0.36 : 0.5, lerp(0.25, 0.45, pick) * warmShare * stops2(softness, 0.3) * Math.sqrt(day) * design.glowRise)

/**
 * A Sunset ramp scene for a list of colors, the tool controls, a seed and the frame's width over
 * height. Lengths are in short-side units, about 40 degrees of sky. The seed, the drag and the
 * frame alone set the design: the scene below the shared horizon (open sky, water or land), the
 * sun's side and position, the tilt and bend, the glow's height, width and light, the sky's edges,
 * the ridge and the patches of light in the sky. The colors only fill its roles (`rampRoles`). The
 * scene is drawn sharp and seen through one lens whose radius is the Softness.
 */
export function composeRamp(colors: readonly string[], controls: ControlValues, seed: number, aspect: number): Composition {
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
  const design = rampDesign(structure, variant, random)
  const roles = rampRoles(colors, { light: design.light, darkTurn: seedRun(seed) })
  const level = levelsOf(design, roles)
  const intensity = clamp01(controls.intensity)
  const softness = clamp01(controls.softness)
  const mood = clamp01(controls.mood)
  // Over water and land each seed's depth puts the line at its own height: a deep seed shows more of
  // its dark ground, a light seed more sky. An open sky's variant sets the height of its band. The
  // shift fades out toward both ends of the Horizon control, which keep the shared heights.
  const shared = placeHorizon(mood, seed, aspect)
  const lineShift = openSky ? [-0.1, 0.05, 0][variant] : [0.05, -0.1, -0.03][depthTurn]
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
  const dragVeil = line ? Math.max(0.75, Math.min(1, veilScale)) : veilScale

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
  // The far bank's pick, which no design uses now: drawn so the size pick after it stays the seed's own.
  random()
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
  // At the seed's own view the glow is tallest at the sun and narrows along the horizon away from
  // it. A dragged line keeps the glow as it was.
  const gather = !controls.drag ? 1 : 0
  // An open sky's glow rises, leaving the dusk band room under it; a corner's glow sits lower, so it
  // rises more.
  if (openSky) bandAt -= structure === 'corner' ? 0.22 : 0.12
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
    // The ramp's anchor: on the water's line, or just under the land's lowest point, where the sky
    // behind it meets its own horizon; under a tilted line, lowest along the tilted axis.
    let anchor: [number, number] = [0, land ? lowest + 0.03 : lineAt]
    if (line && land) {
      const level: RampAxis = { anchorX: 0, anchorY: lineAt, turn, drop: dome }
      let under = -Infinity
      for (let i = 0; i <= 32; i++) {
        const x = -half + (i / 32) * frameWidth
        under = Math.max(under, rampAt(frame, level, x, outlineAt(outline, half, x, seed)))
      }
      anchor = [(under + 0.03) * Math.sin(turn), lineAt + (under + 0.03) * Math.cos(turn)]
    }
    return { y, flat, ridge, lineAt, outline, lowest, crest, anchor }
  }
  // Under a dragged line the ground's line goes where the seed's glow, at its own share of the
  // sky's height above the line, passes through the line's start, within the Horizon control's
  // range.
  let lineY = placed.y
  if (line && ground) {
    // How far the line's start lies above the seed's glow for a line height, measured from the
    // middle of the line (land's own anchor moves unevenly as its ridge grows): it grows steadily as
    // the line lowers, so halving the range finds the one height.
    const share = glowShare(design, structure, warmShare, risePick, softness, day)
    const aboveGlow = (y: number) => {
      const anchorY = (y - 0.5) * tall
      const from: RampAxis = { anchorX: 0, anchorY, turn, drop: dome }
      return -rampAt(frame, from, line.from[0], line.from[1]) - share * Math.max(0.2, anchorY + tall / 2)
    }
    let high = placeHorizon(1, seed, aspect).y
    let low = placeHorizon(0, seed, aspect).y
    // Water's horizon rises no higher than the seed's own highest line.
    const highest = high + (water ? WATER_HIGHEST * runPick(seed, seeded(Math.round(seed) * 89 + 41)()) : 0)
    for (let k = 0; k < 24; k++) {
      const mid = 0.5 * (high + low)
      if (aboveGlow(mid) > 0) low = mid
      else high = mid
    }
    lineY = Math.max(0.5 * (high + low), highest)
  }
  const { flat, ridge, lineAt, outline, lowest, crest, anchor: groundAnchor } = groundAt(lineY)
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
  const openRiseAt = (anchor: number) => Math.max(0.03, Math.max(anchor - (bandAt - 0.5) * tall, 0) * Math.sqrt(day) * stops2(softness, 0.3))
  const ownX = arcs ? (sunIs - 0.5) * frameWidth : 0
  const ownAxis = { anchorX: ownX, turn: (tilt * Math.PI) / 180, drop: dome * (half / (half + Math.abs(ownX))) ** 2 }
  const ownRise = ground ? 0 : openRiseAt(anchorBelow(frame, ownAxis, 0.02))
  if (!ground && line) {
    const riseFor = (bend: number) => Math.max(beyondFrame(frame, { anchorX: line.from[0], anchorY: line.from[1], turn, drop: bend }) + 0.02, 0.03)
    // A turned line sees the bands across the frame's height or its diagonal, not its width; they
    // bend as much over that as over the width at the seed's own tilt, so they stay curved.
    drop *= (half / (Math.abs(half * Math.cos(turn)) + Math.abs(0.5 * tall * Math.sin(turn)))) ** 2
    // The bands bend around the sun, so with the horizon far behind the glow they bend less, and
    // the glow and the navy band never close into a ring around a disc.
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
  for (const [x, y] of [[-half, -tall / 2], [half, -tall / 2], [-half, tall / 2], [half, tall / 2]]) frameHigh = Math.max(frameHigh, -rampAt(frame, axis, x, y))
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
  const setShrink = Math.exp(-setDepth / SET_SHRINK)
  // How far the frame lies behind a glow that a line puts above water: 1 when the glow's line is
  // above the whole frame. The sky above that glow shows only in the water, which mirrors it from
  // the horizon toward the viewer, so it reaches at least a frame height past the glow: room for
  // the sky's lighter bridge and its low sky's band before the deep sky.
  const waterBehind = line && water ? clamp01((dragRise - frameHigh) / (0.1 * tall)) : 0
  const dragReach = line ? dragRise + lerp(line.length, Math.max(line.length, tall), waterBehind) : 0
  const dragTop = skyTopOf(dragReach, tall)
  const skyHeight = Math.max(0.2, line ? dragTop : horizonY * tall)
  // Under a line that puts the glow above the frame, the sun's path is a field of glints.
  const glints = line && water ? clamp01((dragRise - frameHigh) / (GLINT_RAMP * tall)) : 0
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
  // differ in how bright their sky is.
  const lowGain = design.lowSkyGain * stops2(intensity, design.lowSkyGain < 1 ? 0.8 : 0.35) * lerp(1, 0.7, depth)
  const glowGain = stops2(intensity, 0.15)
  const sunGain = stops2(intensity, 2.4)
  const groundGain = stops2(intensity, 0.8)
  const [path, deeper, paler] = design.path

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
  // Over land the glow's line stays low, leaving the low sky's band room above the glow, but not
  // far under the ridge's crest: there the ridge hides the glow's body and only its pale bridge
  // shows, dimmed into the land.
  // Over land under a high line the glow's band is at least about the lens wide, or the lens
  // blurs it away and the frame is a field of dark ground.
  const highLand = clamp01((0.5 * tall - lineAt - 0.55 * tall) / (0.15 * tall))
  const lensBand = anchorY - crest + 1.5 * lerp(0.045, 0.12, softness)
  const aboveCrest = land ? Math.max(anchorY - crest + ABOVE_CREST, lerp(0, lensBand, highLand)) : 0
  const glowRise = line ? dragRise : ground ? Math.max(glowShare(design, structure, warmShare, risePick, softness, day) * skyHeight, aboveCrest) : openRiseAt(anchorY)
  // How far the glow's lower side and the dimming toward the horizon reach. Over an open sky a
  // dragged line's horizon can lie far behind the glow; they keep the seed's own size there, and the
  // low sky fills the rest. The glow's lower side ends where the seed's own frame ends below it, or
  // at the horizon.
  const glowReach = line && !ground ? Math.min(glowRise, ownRise) : glowRise
  // A glow that a dragged line lifts above the land's own glow ends that much above the land, up to
  // LAND_LIFT, so a low sky of its own color shows between the light and the ground: at the land's
  // edge the lens mixes a warm light and the dark ground into red and mauve.
  const ownLandRise = Math.max(glowShare(design, structure, warmShare, risePick, softness, day) * Math.max(0.2, horizonY * tall), aboveCrest)
  const landLift = line && land ? Math.min(LAND_LIFT, Math.max(0, glowRise - ownLandRise)) : 0
  // Where the glow's lower side ends above the horizon, the sky under it comes back as the glow
  // fades, fully once the end lies END_LIFT above an open sky's horizon or LAND_LIFT above the land.
  const follow = !line ? 0 : land ? landLift / LAND_LIFT : ground ? 0 : smoothstep(0, END_LIFT, glowRise - glowReach)
  // The fade over land is never narrower than LAND_END_SOFT: a lift just starting would otherwise cut
  // the glow in a hard line that appears all at once as it rises past the ridge's low points.
  const glowEnd = line && !ground ? [glowReach, 0.5 * glowReach, follow] : landLift > 0 ? [glowRise - landLift, Math.max(0.6 * landLift, LAND_END_SOFT), follow] : [0, 0.1, 0]

  // The least height above the horizon along the top edge: the sky's edges and the sun's light
  // stay below it, so the top of the frame is the zenith's color. Under a dragged line the sky
  // ends at the line's end instead.
  let topHeight = Infinity
  for (let i = 0; i <= 32; i++) topHeight = Math.min(topHeight, -rampAt(frame, axis, -half + (i / 32) * frameWidth, -tall / 2))
  if (line) topHeight = dragTop
  // The zenith holds the top fifth of the frame; a short sky gives it less, so the low sky keeps a
  // band of its own between the zenith and the glow wider than the lens.
  const zenithRoom = zenithRoomOf(topHeight, tall)
  // Over open skies the sky's edges sit between the glow and the top, so they rise with the glow.
  const edgeFloor = ground ? 0 : glowRise
  // A light seed's low sky reaches high; a deep seed's zenith reaches further down, less far over
  // an open sky, whose glow would leave its low sky no room.
  const edgeShare = ground ? ([[0.82, 0.98], [0.45, 0.62], [0.66, 0.84]] as const)[depthTurn] : ([[0.82, 0.98], [0.58, 0.7], [0.7, 0.84]] as const)[depthTurn]
  const skyEdgeAt = -(edgeFloor + design.skyEdge[0] * Math.max(0.1, topHeight - edgeFloor) * within(edgeShare, edgePick))
  // A sky edge narrower than about a third of a short side reads as the edge of a cloud bank. The
  // design's low sky must show as its own band between the zenith and the glow, so it allows a
  // narrower one: the lens still softens it. Under a broad seed's warm haze it is narrower too, so
  // the low sky's own color shows between the zenith and the glow.
  const skyEdgeWidth = (Math.max(design.skyEdge[2], design.skyEdge[1] * Math.abs(skyEdgeAt)) * Math.sqrt(haze)) / Math.sqrt(Math.max(1, warmReach))

  // Every sky edge and the glow move with the shared boundary model (ramp-boundary.ts): the sky
  // edge most, the glow and the horizon less. A softer sky drifts a little more.
  // A short sky over a high horizon wanders less, or its thin glow breaks into pieces.
  const drift = Math.sqrt(haze) * Math.min(1, Math.max(0.4, skyHeight / 0.6))
  const skyWander = lerp(0.012, 0.018, wanderPick) * drift
  const boundaryWander = [skyWander, 0.012 * drift, 0.01 * drift, 0.006 * drift]
  // Long waves: a shorter lattice puts rows of like-sized bumps along the edges.
  const lattice = lerp(0.45, 0.7, latticePick)

  // The zenith is its color at the top edge and gains light slowly all the way down, to twice as
  // much at the horizon, so the sky never holds one flat field. Away from the sun it is 2 % deeper.
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
  // Under a dragged line the zenith is its color at the line's end instead.
  if (line) {
    const [x, y] = line.to
    zenithShade = [1.0 / Math.max(0.2, topHeight), rampAt(frame, axis, x, y), 0.02 * side, (x * Math.cos(turn) - y * Math.sin(turn)) / half]
  }
  // Where the sky sinks toward the dark at its far edge, the zenith there is that share of its
  // color; a deep seed's far sky sinks further, and so does the wide sky of a corner or of arcs,
  // which is deep blue far from the light.
  const sink = structure === 'corner' || arcs ? 0.5 : 1
  zenithShade[1] += (1 - lerp(1, 0.4, depth * depth) * sink) / zenithShade[0]

  // The stop edges, top down. A second, lighter step of the zenith's color splits the sky's edge in
  // two: a wide one higher up and a narrower one lower down, each with its own shape.
  // Without the step (midAmount 0) the mid stop matches the zenith, and the lower edge is the one
  // edge of a sky without it.
  const midGain = lerp(zenithGain, zenithGain * 1.18, midAmount)
  const edges: [at: number, width: number][] = midSky
    ? [
        [skyEdgeAt * lerp(1.15, 1.4, bandPick), 0.75 * skyEdgeWidth],
        [skyEdgeAt * lerp(1, lerp(0.5, 0.7, depthPick), midAmount), lerp(1, 0.45, midAmount) * skyEdgeWidth],
      ]
    : [[skyEdgeAt, skyEdgeWidth]]
  // The highest edge's upper tail stays out of the top fifth of the frame, where the zenith's color
  // is the mean. A low sky much brighter than the zenith shows further up its tail.
  const topEdge = midSky ? edges[1].map((v, i) => lerp(v, edges[0][i], midAmount)) : edges[0]
  const [topAt, topWidth] = topEdge
  const tail = 0.5 * (1 + 0.5 * Math.max(0, Math.log2((midSky ? lerp(lowGain, midGain, midAmount) : lowGain) / zenithGain)))
  // Under a dragged line the far sky sinks into deep navy, as a real sky darkens away from the sun,
  // over the seed's own share of the line's far end. A short line's far end stays near the light
  // and doesn't sink; pulled down onto the glow, the low sky would mix with the light and the navy
  // with the warm haze.
  const longLine = line ? smoothstep(0.9, 1.6, line.length) : 0
  const navyReach = longLine
  const navyShare = within(NAVY_SHARE[depthTurn], seeded(Math.round(seed) * 53 + 19)()) * navyReach
  let navyVeil: [number, number] | null = null
  let navyEnd = 0
  // How high above the horizon the low sky's band may reach under a line.
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
    const nearer = 1 - navyShare
    // The low sky's band stays under the deep sky's edge that the navy share pulled in, or over
    // water and land it pushes the deep sky back out of the frame.
    if (navyReach > 0) zenithCap = (glowRise + (-edges[0][0] - glowRise) * stretch * nearer) / navyReach
    // Under a long line seeds differ in how softly the low sky turns to the deep sky.
    const soft = lerp(1, lerp(DRAG_SOFT[0], DRAG_SOFT[1], seeded(Math.round(seed) * 61 + 29)()), navyReach)
    for (const edge of edges) {
      edge[0] = -glowRise + (edge[0] + glowRise) * stretch * nearer
      edge[1] = Math.min(6, edge[1] * stretch * nearer * soft)
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
  // The low sky shows as a band of its own above the glow and the ridge's crest instead of under
  // them, as far as the top fifth allows, and above a broad seed's warm haze, which reaches further
  // up.
  const lowEdge = edges[edges.length - 1]
  const lowHighest = -Math.min(topHeight - zenithRoom - tail * lowEdge[1], zenithCap)
  lowEdge[0] = Math.max(lowHighest, Math.min(lowEdge[0], -(Math.max(glowRise, land ? anchorY - crest : 0) + 0.3 * skyScale * Math.max(1, warmReach))))
  const gains = midSky ? [zenithGain, midGain, lowGain] : [zenithGain, lowGain]
  const lowSkyEdge = lowEdge[0]
  // The zenith's color takes the design's light, the low sky's no more than the design's.
  const stopLevels = midSky ? [level.zenith, level.zenith, level.lowSky] : [level.zenith, level.lowSky]
  // An open sky ends in a dark dusk band just under the glow's line, hiding the glow's lower part:
  // a low bank of the sky's shadowed light, which gains with daylight like the low sky. Its edge is
  // about as soft as land's: the lens softens it, and a wider one mixes the two sides into a third
  // hue. The sky's lowest edge moves up out of the band's way, as far as the top fifth allows.
  if (openSky) {
    const last = edges[edges.length - 1]
    const duskWidth = 0.04 * Math.sqrt(haze) * skyScale
    const duskAt = -lerp(0.75, 0.9, duskPick) * glowReach
    const margin = 0.3 * (last[1] + duskWidth)
    const above = edges.length > 1 ? edges[edges.length - 2] : null
    const ceiling = Math.max(-(topHeight - zenithRoom - tail * last[1]), above ? above[0] + 0.3 * (above[1] + last[1]) : -Infinity)
    last[0] = Math.min(last[0], Math.max(ceiling, duskAt - margin))
    edges.push([Math.max(duskAt, last[0] + margin), duskWidth])
    gains.push((level.dusk * lowGain) / design.lowSkyGain)
    stopLevels.push(1)
  }
  // Each edge sits at least half their widths above the one below it. Closer, or crossed where the
  // low sky's band or the dusk band pushed the lower one up, the stop between them would take a
  // negative share and draw its color out of the sky: blue drawn out of grey reads olive, out of
  // Cyan mint.
  for (let k = edges.length - 1; k > 0; k--) edges[k - 1][0] = Math.min(edges[k - 1][0], edges[k][0] - 0.5 * (edges[k - 1][1] + edges[k][1]))
  // Under a long line the navy takes the lighter zenith step's place: the step's upper edge comes
  // down to its lower one, where the sky then turns toward navy, or the step would be a wide band of
  // the zenith's full color under the navy.
  if (navyReach > 0 && midSky) edges[0] = [lerp(edges[0][0], edges[1][0], navyReach), lerp(edges[0][1], edges[1][1], navyReach)]
  // Under the line the zenith is NAVY_TURN of its color where the sky turns and sinks to the seed's
  // navy where the highest edge's tail ends: its own dim hue, below full strength. The veil fades
  // out across the turn, so the navy stays clear.
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
  const slots = slotColors(roles, midSky, openSky)
  const stopGains = gains.map((gain, k) => {
    const grey = Math.min(...hexToLinear(slots[k]))
    return grey > 0 ? Math.min(gain * stopLevels[k], SKY_GREY_KNEE / grey) : gain * stopLevels[k]
  })
  const stopParams: Record<string, number> = {}
  edges.forEach(([at, width], j) => {
    stopParams[`at${j + 1}`] = at
    stopParams[`width${j + 1}`] = width
  })
  stopGains.forEach((gain, k) => (stopParams[`gain${k + 1}`] = gain))
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
  // The band above the glow that the sun's path mirrors.
  const skyBand = Math.min(0.3, Math.max(0.05, 0.7 * (-lowSkyEdge - glowRise)))
  const ownWater = water && !controls.drag
  const lensRadius = lerp(0.045, 0.12, softness)
  // Under a field of glints, which of a two-color light's colors leads the sky and which sky color
  // leads the water: 0 its core and the low sky, 1 its light and the low sky, 2 its core and the
  // zenith, 3 its light and the zenith, in turn over the runs. A design with a one-color light
  // keeps its own.
  const leads = design.light === 'deep' ? seedRun(seed) % 4 : -1
  const warmLead = leads >= 0 ? LEAD_WARM[leads % 2] : 0
  const blueLead = leads >= 2 ? 1 : 0
  // The seed's sea under a field of glints, from calm (0) to rough (1).
  const sea = thirdPick(seed, seeded(Math.round(seed) * 97 + 53)())
  const lensStrip = 0.05 + 1.5 * lensRadius
  const facts = level.facts
  // A dark land color reads as itself only up to one stop over its own, and under a warm light it
  // has no clean mix with the light.
  const darkLand = level.lightWarm && facts.landTop.L < DARK_L
  const litMost = darkLand ? Math.max(1, (DARK_MOST / level.landTop - 1) / Math.max(design.landLit, 1e-3)) : Infinity
  // Land whose top is dark at its own light takes a warm light's deeper tail in its haze: dimmed
  // over Meta Blue, Orange-red would mix into mauve and pink.
  const dimLand = level.lightWarm && linearToOklab(hexToLinear(roles.landTop).map((v) => v * level.landTop))[0] < DARK_L
  const strip = lerp(lensStrip, Math.max(lerp(GLINT_SEA.strip[0], GLINT_SEA.strip[1], sea) * (0.5 * tall - lineAt), 0.05), glints)

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
    glow: design.glow * glowGain * (arcs ? 1.2 : 1),
    glowOffset: -glowRise,
    glowEnd,
    // Scattered daylight over the sky, denser toward the horizon, mutes and pales it toward the
    // light. A band of the zenith's full color stays at the far edge: the top twentieth of the
    // frame, fading into the veil over the next sixth.
    // A light seed's sky is hazier, a deep seed's clearer, and a broad seed's warm haze pales it
    // in the veil's place. Under a dragged line, which can leave a frame that is all sky, no seed
    // is hazier than the design's own sky, and the band of the zenith's full color reaches further
    // down from the line's end, so the frame keeps a second color.
    // Over a warm low sky the veil's cool light and the warm band blend toward white, so it thins.
    veil: [design.veil[0] * zenithGain * dragVeil * level.veil, design.veil[1] * zenithGain * dragVeil, 0.3 * Math.max(0.2, topHeight)],
    veilFar: navyVeil ?? (line ? [topHeight - 0.3 * tall, topHeight - 0.08 * tall] : [topHeight - 0.22 * tall, topHeight - 0.05 * tall]),
    // The veil takes the pale tint of the sky's pale side, so a frame that is all sky still reads as
    // its colors: white over Meta Blue would make the same periwinkle in every pack. A cool low sky
    // gives its own tint; a warm one leaves the far sky the zenith's.
    veilTint: paleTint(roles.veil, level.veilDepth),
    // Under the far band an overcast grey veil greys the sky's blue toward its own hue, and so does
    // the zenith's own tint where the sky's pale side is warm, instead of turning periwinkle. A
    // light seed's overcast is greyer, a deep seed's keeps more of its clear blue.
    veilMute: Math.max(0.8 * lerp(1.15, 0.5, depth) * smoothstep(0.08, 0.04, facts.veil.chroma), level.lowSkyWarm ? 0.5 : 0),
    // An overcast grey veil greys the blue near the horizon too, where the zenith's blue meets the
    // grey low sky: there a light blue would read as the zenith's pale side, not as the greys.
    veilMuteLow: smoothstep(0.08, 0.04, facts.veil.chroma),
    // Under a long line the haze thickens and thins in the sky's masses, so skies that a line
    // leaves without a glow still differ in where they are paler and deeper: most in a broad
    // seed's hazy air, least in a compact seed's clear air, more in a light seed's.
    hazeMass: HAZE_MASS[warmTurn] * lerp(1.3, 0.8, depth) * navyReach,
    blueHue: level.blueZenith ? 1 : 0,
    // Where the sky's pale side is warm, the veil takes the low sky's own color near the horizon, so
    // the pale side reads as that color; otherwise it takes the bridge's warm white there.
    veilNear: level.lowSkyWarm ? paleTint(roles.lowSky, 0.6) : [0, 0, 0],
    // Under a field of glints the band along the water's far edge mirrors the sky just above the
    // horizon, which away from the light is a clear pale tint of the low sky.
    bandTint: paleTint(roles.lowSky, BAND_DEPTH),
    glowVary: 0,
    // A sun's glow is tallest near the sun and narrows away from it along the horizon, keeping its
    // light, so its edges are never parallel: far from the sun it reaches up only a share of its
    // height, and it rises toward the sun over part of its width.
    glowArch: lerp(0.6, GLOW_ARCH, gather),
    glowArchShape: GLOW_ARCH_SHAPE[warmTurn].map((v) => lerp(1, v, gather)),
    // More daylight gathers the glow toward the sun, so white shows only near the light.
    glowLateral: 1 - floor * narrow * stops2(intensity, -0.8),
    glowWidth: 0.45 * lateral * Math.sqrt(day) * glowHaze * narrow * setShrink,
    shadowHeight: 0,
    glow1Weight: 1,
    // The glow's light reaches up the sky as far as the seed's warm fill: a broad seed's warm haze
    // fills much of the sky, also where a dragged line leaves the glow itself outside the frame.
    glow1Up: 0.1 * glowScale * design.glowUp * warmReach * setShrink,
    glow1Down: Math.min(2, Math.max((0.03 + 0.03 * glowHaze) * skyScale, design.downReach * glowReach)),
    glow2Weight: 0.2 * design.haze * lerp(0.6, 1.5, softness) * warmReach,
    glow2Up: 0.17 * glowScale * design.glowUp * warmReach * setShrink,
    glow2Down: 0.08 * glowHaze,
    extinction: design.extinction,
    // Skylight fades toward the horizon, so under the glow line the light is the glow's own.
    // A corner's horizon far from the sun keeps more skylight and deepens less, or it goes dark.
    horizonDim: (1 - design.horizonGain) * 12 * stops2(softness, -0.6) * (structure === 'corner' ? 0.5 : 1) * level.skyDim,
    horizonDimHeight: 0.7 * glowReach + 0.02,
    dimBelow: 1,
    // Over water the light just above the line deepens less, or it reads as a dark stripe between
    // the sky and its reflection; a raised open band deepens less toward the bottom edge.
    // Over a ridge it does not deepen: deepened at the outline, Orange-red turns red and maroon.
    // Only a light that deepens as fire does gets deeper along its path.
    reddenDown: deeper * level.fire * stops2(1 - intensity, 1.1) * stops2(1 - softness, 0.6) * (water ? 0.3 : land ? 0 : structure === 'corner' ? 0.4 : 1 - 0.45 * clamp01((0.97 - (line ? 1 - glowReach / tall : band)) / 0.3)),
    reddenEase: 1,
    reddenUp: paler > 0 ? clamp01(paler + (intensity - 0.5) * 0.15) * 0.9 : 0,
    reddenSide: design.sideDeeper * level.fire,
    glowPath: level.fire * (path + lerp(design.hue[0], design.hue[1], huePick) + glints * warmLead) - (intensity - 0.5) * 0.25,
    // A pale core turns a flat white wherever its light gathers, so it adds less.
    sunGlow: 0.25 * sunGain * design.sunGlow * (arcs ? design.core : water ? 0.5 : 1) * setGlow * level.core,
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
    bridge: design.bridge * stops2(intensity, 0.15),
    bridgeLift: design.bridgeLift + 0.12 * softness,
    bridgeWarmth: design.bridgeWarmth,
    bridgeFloor: design.bridgeFloor,
    // A light whose core is another color (Bold's Orange-red, whose core is Yellow) pales through
    // it, as bright orange light goes amber, cream and then white, and its bridge turns neutral
    // toward the sky: it meets Cyan through amber cream and white, not peach, salmon or green.
    bridgeCore: 1,
    bridgeSky: roles.core !== roles.light ? 1 : 0,
    // Where the sky's pale side is warm (Elemental's Lime or Tan), the bridge over its blue side
    // goes through white to the blue's own pale tint: the warm pale tint over the blue reads grey.
    // Under a long line, whose far side is clear blue, the bridge keeps the warm pale tint.
    bridgeCool: level.lowSkyWarm ? 0.75 * (1 - longLine) : 0,
    duskStop: openSky ? gains.length - 1 : -1,
    land: 0,
    // One lens over the whole scene: Softness is its radius.
    lensRadius,
    // Patches of light in the sky, a third to half of the frame across.
    skyPatch: [0.08, lerp(0.33, 0.5, patchPick) * frameWidth, 1.6],
    ground: groundKind,
    groundAt: lineY,
    groundTilt: (Math.atan(outline.slope) * 180) / Math.PI,
    groundWave: outline.wave,
    ridge: [outline.rise, outline.toward, outline.bowl, outline.waveLength],
    // Light water is a near mirror with a faint path, deep water dark with a strong one. A tall,
    // narrow frame's path widens less, so it never fills the water's width.
    sunPath: [water ? design.sunPath * lerp(0.45, 1.25, depth) : 0, 0.02, 0.5 * Math.sqrt(frameWidth / tall), glowRise],
    // Under a line that puts the glow above the frame, the path is a field of glints that adds the
    // sun's light, densest down the middle and thinning to the sides with no outline, not a wide
    // blend into the water that reads grey or olive. The seed's sea sets how wide it spreads and the
    // size of its rows, and its depth how fast the water past the far strip mirrors the sky higher
    // up.
    sunGlints: [glints, lerp(GLINT_SEA.spread[0], GLINT_SEA.spread[1], sea), lerp(GLINT_SEA.rows[0], GLINT_SEA.rows[1], sea), lerp(MIRROR_GLINTS.climb[0], MIRROR_GLINTS.climb[1], depth)],
    // The path's middle reaches the glow's paler top at the bottom edge. Toward its sides it
    // mirrors the band part way from the glow up to the low sky's edge, at the seed's own view the
    // light just above the glow.
    // A seed whose water the zenith leads mirrors the sky from LEAD_BLUE higher past the far strip.
    sunLight: [Math.max(0.3, 0.5 * tall - lineAt), skyBand * (ownWater ? OWN_WATER_BAND : 1) + glints * LEAD_BLUE * blueLead],
    // Under a field of glints the water past a strip wider than the lens mirrors the sky above the
    // glow, so the glints lie on the water's blue and not on the glow's mirror image. There the warm
    // strip reaches further on a calm sea, and just past it a calm sea takes more of the low sky's
    // light.
    waterLift: [...(glints > 0 ? [glints * (glowRise + skyBand + 0.05), strip, 1] : [0, 0.05, 1]), glints * lerp(GLINT_SEA.sheen[0], GLINT_SEA.sheen[1], sea)],
    // The strip under the line is thin and bright, so it still shows after the lens. Under a high
    // line the ripples draw the short sky's reflection out over more of the water, so the water
    // carries the sky's colors and not only the zenith's.
    // Under a glow above the frame the reflection climbs past the glow within the water's top half:
    // the warm part is a band near the horizon, and the high sky takes the near water.
    water: [
      lerp(Math.min(1.25, Math.max(0.5, (0.77 * lineY) / Math.max(0.05, 1 - lineY))), Math.min(3, (3 * glowRise) / Math.max(0.2, (1 - lineY) * tall)), waterBehind),
      lerp(design.waterDegrees[0], design.waterDegrees[1], ridgePick) * [0.6, 1.6, 1][variant],
      0.12,
      1.5,
    ],
    waterMirror: water ? design.waterMirror : 1,
    // Under a high line the near water mirrors the sky high above the frame, which is darker.
    // Deep water mirrors more of that darker sky.
    mirrorDeep: water ? lerp(lerp(0.25, 1.4, depth), lerp(MIRROR_GLINTS.dark[0], MIRROR_GLINTS.dark[1], depth), glints) * tall : 0,
    // The water's own light takes the hue of the sky it mirrors under the warm glow.
    waterTint: water ? 0.6 : 0,
    // A tall land area reaches nearer the viewer: the haze over its far ground reaches further
    // down, and its near ground is darker. The light in a dark land's haze has come a longer way
    // through the air and is deeper, as a warm light's tail is.
    groundHaze: [design.landHaze, land ? Math.max(0.1 * tall, 0.25 * landRoom) : 0.05 * tall, dimLand ? LAND_AIR_DEEPER : 0],
    groundVeil: [land ? design.groundVeil * groundGain * level.groundVeil : 0, 0.35 * landRoom],
    // A tall land area carries more of the light, so a high line doesn't leave a dark field. A dark
    // land color takes no more of it than one stop over its own: brighter, Plum turns magenta and
    // Forest green.
    landLit: [ground ? design.landLit * (land ? Math.min(1 + 1.5 * clamp01((landRoom - 0.4 * tall) / (0.4 * tall)), litMost) : 1) : 0, lerp(0.3, 0.5, widthPick) * frameWidth, ground ? 0.6 : 0],
    // A deep seed's ground is darker.
    groundTopGain: level.landTop * groundGain * lerp(1, 0.55, depth),
    // The near ground stays a deep tone of its color, never black.
    groundBottomGain: Math.max(0.35 * level.landTop * groundGain * lerp(1, 0.55, depth), level.landBottom * groundGain * lerp(1, 0.5, depth) * (land ? Math.min(1, ((0.4 * tall) / landRoom) ** 1.5) : 1)),
    waterGain: level.water * groundGain * lerp(1, 0.6, depth),
  }
  return { colors: slots, params, lens: {}, output: { exposure: 0 } }
}
