import type { ColorPack, PackId } from './color/packs'
import type { Rgb } from './color/srgb'

/** `rush` has one look, `rush.split`, on the panel's third mood tile. */
export type MoodId = 'sunset' | 'contour' | 'rush'

/**
 * In panel order. Each mood's first look is the one picking the mood switches to, and the picture on its Mood
 * button (owner, 2026-11-06).
 */
export const RECIPE_IDS = [
  'sunset.bands',
  'sunset.ramp',
  'sunset.blooms',
  'contour.halo',
  'contour.rim',
  'contour.beam',
  'contour.streaks',
] as const

/**
 * Looks that render but aren't in the panel: the tool shows one only behind its URL switch (`sunrise=merged`,
 * `contour=merged`, `rush=split`).
 */
export const HIDDEN_RECIPE_IDS = ['sunset.merged', 'contour.merged', 'rush.split'] as const

export type RecipeId = (typeof RECIPE_IDS)[number] | (typeof HIDDEN_RECIPE_IDS)[number]

export function isRecipeId(value: string): value is RecipeId {
  return (RECIPE_IDS as readonly string[]).includes(value) || (HIDDEN_RECIPE_IDS as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Params

export type ParamValue = number | boolean | number[]

interface ParamSpecBase {
  key: string
  label: string
}

export interface NumberParam extends ParamSpecBase {
  kind: 'number'
  min: number
  max: number
  step: number
  default: number
}

export interface BooleanParam extends ParamSpecBase {
  kind: 'boolean'
  default: boolean
}

/** A small vector (2 to 4 numbers) sharing one range, e.g. a position in frame coordinates. */
export interface VectorParam extends ParamSpecBase {
  kind: 'vector'
  min: number
  max: number
  step: number
  default: readonly number[]
}

export type ParamSpec = NumberParam | BooleanParam | VectorParam

export interface ColorSlot {
  key: string
  label: string
}

// ---------------------------------------------------------------------------
// Lens and output

export interface LensSettings {
  /** Share of the image replaced by the bloom blur, 0..1. Energy-conserving: it spreads light, it does not add it. */
  bloom: number
  /** Which pyramid levels carry the bloom, 0 (tight) .. 1 (frame-wide). */
  bloomRadius: number
  /** Spread of the level weights, in pyramid levels. */
  bloomWidth: number
  /** Tint of the widest level; levels in between blend from white to this tint. */
  bloomTint: string
  /** Optional explicit weight per pyramid level (8 values, finest first); replaces bloomRadius and bloomWidth. */
  bloomLevels?: number[]
  /** Optional explicit tint per pyramid level (up to 8 hexes, finest first); replaces bloomTint. */
  bloomLevelTints?: string[]
  /**
   * Strength of the film halation glow: each light's own light where it is
   * brighter than halationTint, blurred and added back in its own color (and
   * halationDriftTint for the drift part). So the halo's place and size follow
   * the light's brightness, and its color is the light's, also after the
   * color stage has recolored it. 0 turns it off.
   */
  halation: number
  /**
   * Brightness, in multiples of halationTint's after exposure (luminance or
   * largest channel, whichever ratio is more), where light starts to feed the
   * halation; it ramps in fully by twice this. Values below 1 act as 1, so
   * light no brighter than the tint never makes halation.
   */
  halationThreshold: number
  /** Blur radius of the halo as a fraction of the frame's short side. */
  halationRadius: number
  /**
   * The light the halo counts in, as a hex: set it to the light's own hex. Its
   * luminance and largest channel are the level 1, so a light of any color k
   * times brighter than its hex makes the same halo, and the color stage, which
   * keeps each pixel's luminance or largest channel, leaves the halo's place and
   * size alone. It doesn't color the halo. Default white.
   */
  halationTint: string
  /**
   * A pack color the halo's outer part drifts to (Yellow's to Orange-red, as
   * fire does), as a hex; it takes the halo's own luminance, so only its hue
   * counts.
   */
  halationDriftTint: string
  /** Share of the halo in halationDriftTint, 0..1; 0 keeps the whole halo in halationTint. */
  halationDrift: number
  /** The drift part sits wider than halationRadius by this x 1.5 pyramid levels (0.67 is one level). 0..1. */
  halationSpread: number
  /**
   * Share of all light the camera's own lens moves out of the sharp core, 0..1: half into a near spread of
   * length glareLength, half into a veil that falls as the inverse cube of the distance. It acts on every
   * light with no threshold and keeps the total light, on top of the recipe's bloom.
   */
  glare: number
  /** Length of the glare's near spread, as a fraction of the short side; 0.0025 to 0.016. */
  glareLength: number
  /**
   * Soft darkening toward the frame corners, 0..1, in linear light before
   * the tone curve: light is multiplied by (1 + d^2)^(-2 vignette), with d
   * the distance from the center that is 1 at the corners (a lens's cos^4
   * falloff). 1 is two stops darker in the corners, 0.5 one stop; 0 is off.
   */
  vignette: number
}

export interface OutputSettings {
  /** Stops applied before the tone curve. */
  exposure: number
  /**
   * Grain density 0..1: fine specks on Oklab L, one pixel at 1080 px on the
   * short side; 0 off, 1 a speck in every cell (engine/grain.ts).
   * Presets from before this change may carry grainSize (px) and grainChroma;
   * those keys are ignored.
   */
  grain: number
  /** Pixel filter strength 0..1; 0 off. Output filters run in the order of OUTPUT_FILTERS (engine/filters). */
  pixel: number
  /**
   * Paper toe 0..1 below nominal: dim light gets purer, so dim warm light
   * reads amber and red instead of olive and brown, and dim blue reads navy.
   * Light at and above nominal is unchanged, and slot colors (ctx.colors) are
   * pre-inverted so that flat pack colors still print their exact hex.
   * Colors a recipe converts from ctx.hex itself are not. 0 is off.
   */
  toe: number
}

export const DEFAULT_LENS: LensSettings = {
  bloom: 0,
  bloomRadius: 0.5,
  bloomWidth: 1.5,
  bloomTint: '#FFFFFF',
  halation: 0,
  halationThreshold: 1,
  halationRadius: 0.06,
  halationTint: '#FFFFFF',
  halationDriftTint: '#FF4F00',
  halationDrift: 0,
  halationSpread: 0.67,
  glare: 0.06,
  glareLength: 0.0025,
  vignette: 0,
}

export const DEFAULT_OUTPUT: OutputSettings = {
  exposure: 0,
  grain: 0,
  pixel: 0,
  toe: 0,
}

type NumericKeys<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T]
type StringKeys<T> = { [K in keyof T]-?: T[K] extends string ? K : never }[keyof T]

export interface NumericSetting<K extends string> {
  key: K
  label: string
  min: number
  max: number
  step: number
}

export const LENS_NUMBERS: readonly NumericSetting<NumericKeys<LensSettings>>[] = [
  { key: 'bloom', label: 'Bloom', min: 0, max: 1, step: 0.005 },
  { key: 'bloomRadius', label: 'Bloom radius', min: 0, max: 1, step: 0.01 },
  { key: 'bloomWidth', label: 'Bloom width', min: 0.3, max: 4, step: 0.05 },
  { key: 'halation', label: 'Halation', min: 0, max: 2, step: 0.01 },
  { key: 'halationThreshold', label: 'Halation threshold', min: 0, max: 4, step: 0.01 },
  { key: 'halationRadius', label: 'Halation radius', min: 0.005, max: 0.4, step: 0.005 },
  { key: 'halationDrift', label: 'Halation drift', min: 0, max: 1, step: 0.01 },
  { key: 'halationSpread', label: 'Halation spread', min: 0, max: 1, step: 0.01 },
  { key: 'glare', label: 'Glare', min: 0, max: 0.5, step: 0.005 },
  { key: 'glareLength', label: 'Glare length', min: 0.0025, max: 0.016, step: 0.0005 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01 },
]

export const LENS_COLORS: readonly { key: StringKeys<LensSettings>; label: string }[] = [
  { key: 'bloomTint', label: 'Bloom tint' },
  { key: 'halationTint', label: 'Halation tint' },
  { key: 'halationDriftTint', label: 'Halation drift tint' },
]

export const OUTPUT_NUMBERS: readonly NumericSetting<NumericKeys<OutputSettings>>[] = [
  { key: 'exposure', label: 'Exposure', min: -4, max: 4, step: 0.01 },
  { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.01 },
  { key: 'pixel', label: 'Pixel', min: 0, max: 1, step: 0.01 },
  { key: 'toe', label: 'Paper toe', min: 0, max: 1, step: 0.01 },
]

// ---------------------------------------------------------------------------
// Scene and preset (the preset JSON shape is shared with other tools; keep it)

/** The shared color stage (src/light/color/stage.ts): the picked pack and one share per pack color, in pack order. */
export interface ColorMixSettings {
  pack: PackId
  shares: readonly number[]
}

export interface Scene {
  recipe: RecipeId
  seed: number
  /** Hexes in the recipe's slot order. Missing slots take the recipe defaults. */
  colors: string[]
  /** Missing keys take the recipe defaults. */
  params: Record<string, ParamValue>
  lens: Partial<LensSettings>
  output: Partial<OutputSettings>
  /** Set by `withColorMix`: the color stage gives the design these colors before the lens. Without it nothing changes. */
  colorMix?: ColorMixSettings
}

export interface Preset {
  id: string
  /** Set on 1:1 reference matches. */
  referenceId?: string
  /** Set on production presets, which use only this pack's colors. */
  pack?: PackId
  scene: Scene
}

// ---------------------------------------------------------------------------
// Recipes

export type UniformValue = number | boolean | readonly number[] | Float32Array | Int32Array
export type UniformMap = Record<string, UniformValue>

export interface RecipeContext {
  /** Every declared param, with defaults filled in. */
  params: Readonly<Record<string, ParamValue>>
  /** Linear sRGB per color slot. */
  colors: readonly Rgb[]
  hex: readonly string[]
  seed: number
  /**
   * The frame's width / height. A preview and an export of the same format
   * get the same value (frames within 2 % of a format's aspect get exactly
   * the number compose gets), so the same scene gives the same picture at
   * every size.
   */
  aspect: number
  num(key: string): number
  bool(key: string): boolean
  vec(key: string): number[]
  /** Linear color of a slot by key. */
  color(key: string): Rgb
}

/**
 * Post passes run on the recipe's radiance before the lens, at a working
 * resolution capped at 2048 px on the short side. Lengths and radii are
 * fractions of the frame's short side; positions are frame coordinates
 * (0..1, y down).
 */
export type PostPass =
  | { kind: 'gaussianBlur'; settings: (ctx: RecipeContext) => { radius: number } }
  | { kind: 'directionalBlur'; settings: (ctx: RecipeContext) => { angle: number; length: number } }
  | { kind: 'radialBlur'; settings: (ctx: RecipeContext) => { center: readonly number[]; amount: number } }

/**
 * One blur of the recipe's light, handed to its `combine` function. `radius`
 * is the gaussian sigma in short-side units. Source 'radiance' blurs
 * `radiance(uv, p)`; 'aux' blurs the fragment's `vec3 auxRadiance(vec2 uv, vec2 p)`,
 * a second output that can hold any part of the light (or other non-negative
 * data, one value per channel).
 */
export interface ScatterBlur {
  source: 'radiance' | 'aux'
  radius: (ctx: RecipeContext) => number
  /**
   * Short side in pixels for this entry's source, instead of the working size
   * the other entries share. Like that size it does not depend on the output
   * size, so previews and exports read the same light. A sized source takes
   * one sample per texel, so it suits layers that are smooth at that size;
   * with radius 0 it is not blurred at all: an expensive layer (a sky, a haze)
   * rendered once at low resolution and read back in `combine`, with a cubic
   * filter. 8 to 2048.
   */
  size?: (ctx: RecipeContext) => number
  /**
   * 'gaussian' (the default) blurs with a gaussian of sigma `radius`.
   * 'lens' is one out-of-focus lens: `radius` is the disc radius R in
   * short-side units (Sunset uses 0.045 to 0.12), and the kernel is 65 % a
   * disc of radius R plus 35 % a gaussian of sigma R / 2, 10 % wider than
   * tall, in linear light. It is gathered on a grid where R is about 6
   * texels, 16 samples per texel so sharp outlines do not alias, and read
   * back with a cubic filter. Edges come out about 1.37 R wide (10 to 90 %,
   * across a horizontal edge), and a band needs about 3 R to keep its exact
   * color in the middle. The grid follows R, not the output size. `size` does
   * not apply.
   */
  shape?: 'gaussian' | 'lens'
}

export const MAX_SCATTER_BLURS = 4

/** What the renderer needs to draw a scene. Test programs implement only this. */
export interface RecipeProgram {
  id: string
  colorSlots: readonly ColorSlot[]
  defaultColors: readonly string[]
  params: readonly ParamSpec[]
  /**
   * GLSL ES 3.00 source that defines `vec3 radiance(vec2 uv, vec2 p)` and
   * any uniforms and helpers it uses. It returns scene-linear radiance
   * (values may exceed 1). `uv` is the frame position (0..1, y down); `p`
   * is the position from the frame center in short-side units, y down.
   * The engine prepends the chunk library and its own uniforms.
   */
  fragment: string
  uniforms: (ctx: RecipeContext) => UniformMap
  /**
   * Scattered light, before post passes and the lens. The engine blurs the
   * light once per entry (up to MAX_SCATTER_BLURS) and calls the fragment's
   * `vec3 combine(vec2 uv, vec2 p, vec3 radiance, vec3 blurred0, ...)`, with
   * one blurred argument per entry in order; what it returns is the radiance
   * the rest of the pipeline sees.
   */
  scatter?: readonly ScatterBlur[]
  /**
   * Set when the fragment defines `float grainWeight(vec2 uv, vec2 p)`, a
   * 0..1 multiplier on the grain at each point (for example riso ink: strong
   * in dense dark ink, weak in thin ink and on paper). Without it every pixel
   * gets weight 1.
   */
  grainWeight?: boolean
  /**
   * For smooth looks: render the radiance at this share of the render
   * resolution (0.5 or 0.25; one sample per pixel) and upsample it with a
   * cubic B-spline before the lens and grain. Features narrower than about
   * 2 / scale render pixels get soft. A function can pick it per scene.
   */
  radianceScale?: number | ((ctx: RecipeContext) => number)
  post?: readonly PostPass[]
  lens?: Partial<LensSettings>
  output?: Partial<OutputSettings>
}

// ---------------------------------------------------------------------------
// Tool controls

/**
 * The three tool controls, each 0..1. `mood` is the mood's own control:
 * Horizon for Sunset (the height of the light), Light for Contour (where the
 * light is strongest).
 */
export interface ControlValues {
  intensity: number
  softness: number
  mood: number
  /**
   * The line the user dragged on the image, in frame units: x from the left
   * edge, y from the top edge, 0..1 inside the frame and up to 0.5 past each
   * edge (-0.5..1.5). `from` is where the light is strongest; the light runs
   * from there in the line's direction, and at `to` it has reached the look's
   * far end. A longer line gives a longer, slower gradient. Undefined: the
   * seed sets the direction and reach.
   */
  drag?: {
    from: readonly [number, number]
    to: readonly [number, number]
  }
}

export const DEFAULT_CONTROLS: ControlValues = { intensity: 0.5, softness: 0.5, mood: 0.5 }

export interface ComposeInput {
  pack: ColorPack
  controls: ControlValues
  seed: number
  /** Frame width / height: 16:9 is 1.78, 9:16 is 0.56. */
  aspect: number
}

/** Everything in a scene except the recipe id and the seed. */
export interface Composition {
  /** One hex per color slot, each an exact color of the input pack or #000000. */
  colors: string[]
  params: Record<string, ParamValue>
  lens: Partial<LensSettings>
  output: Partial<OutputSettings>
}

export interface RecipeDefinition extends RecipeProgram {
  id: RecipeId
  mood: MoodId
  label: string
  /** Picks this recipe's slot colors from a pack, by role. */
  fromPack: (pack: ColorPack) => string[]
  /**
   * What the tool shows for a pack, the three controls, a seed and a frame
   * aspect. Recipes without it use the tool's fallback mapping in
   * src/tool/controls.ts.
   */
  compose?: (input: ComposeInput) => Composition
}
