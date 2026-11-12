import type { OutputSettings, UniformMap } from '../../scene'

/** Output settings that hold a filter's strength, 0..1. 0 leaves the stage out of the output pass. */
export type FilterKey = 'grain' | 'pixel' | 'paper'

/** The output frame a filter is drawn for. */
export interface FilterFrame {
  /** Output size in pixels. */
  width: number
  height: number
  /** The scene's seed; also available in GLSL as `uSeed`. */
  seed: number
}

/**
 * A low-resolution copy of the frame for filters that work per cell: the
 * display-linear color after the tone curve and before every filter (alpha:
 * the recipe's grain weight), each texel the mean of `samples` x `samples`
 * samples over its area. Row 0 is the top of the frame. The engine renders it
 * once per frame and binds it to `uniform`.
 */
export interface FilterSource {
  /** Sampler name the stage's GLSL declares (`uniform sampler2D <name>;`). */
  uniform: string
  /**
   * Texels across and down, 1..512 each, for the stage's strength (the chain
   * passes it). Make it depend on the frame's aspect and the strength only
   * (cells sized to the short side), so a preview and an export read the
   * same texels.
   */
  size: (frame: FilterFrame, strength?: number) => { width: number; height: number }
  /** Samples per texel along each axis, 1..8, or a function of the strength like `size`; 4 if not given. */
  samples?: number | ((frame: FilterFrame, strength?: number) => number)
  /**
   * An optional pass over the source into a smaller texture bound to `uniform`, for a value per cell worked out once
   * per frame instead of at every output pixel. `size` gives its texels like the source's. `glsl` declares the
   * uniforms it needs (the stage's are set) and the function named by `apply`, `vec4 <apply>(ivec2 texel)`, which
   * reads the source as `uniform sampler2D uSrc;` and has the chunk library.
   */
  reduce?: {
    uniform: string
    size: (frame: FilterFrame, strength?: number) => { width: number; height: number }
    glsl: string
    apply: string
  }
}

/**
 * One stage of the output filter chain. Stages run in OUTPUT_FILTERS order on
 * every output pixel, after the tone curve and before the sRGB encode and the
 * dither, and only while their strength is above 0.
 */
export interface OutputFilter {
  key: FilterKey
  /**
   * GLSL ES 3.00 added to the output pass: the stage's uniforms and helpers,
   * prefixed with the stage's name, and the function named by `apply`:
   * `vec3 <apply>(vec3 display, ivec2 px, float weight)`. `display` is
   * display-linear color, 0..1 per channel, in and out; `px` the output pixel
   * (x right, y down); `weight` the recipe's 0..1 grain weight at that pixel.
   * The pass also declares `uniform int uSeed;` and has the chunk library
   * (hashes, noise, Oklab, ...).
   */
  glsl: string
  apply: string
  /** The stage's uniforms for a strength above 0 at this output size. */
  uniforms: (strength: number, frame: FilterFrame) => UniformMap
  source?: FilterSource
}

/** Fails to compile if a FilterKey is not a number in OutputSettings. */
export type FilterStrengths = Pick<OutputSettings, FilterKey>
