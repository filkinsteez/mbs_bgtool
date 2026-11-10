import type { ColorMixSettings, RecipeContext, RecipeProgram, UniformMap } from '../scene'
import { frameAspect } from './frame'
import { CONTEXT_LOST_MESSAGE, Gpu, LightEngineError, type Target } from './gl'
import {
  BASE_FROM_RADIANCE_SHADER,
  halationDriftColor,
  halationLevel,
  halationStart,
  LENS_BASE_SHORT_SIDE,
  lensBaseSize,
  lensSpread,
  runLens,
  TEXEL_COMPOSITE_SHADER,
  TEXTURE_COMPOSITE_SHADER,
} from './lens'
import { prepareOutputFilters, PRESENT_SHADER, RESOLVE_X_SHADER } from './output'
import { AREA_RESAMPLE_SHADER, POST_MAX_SHORT_SIDE, runPostPasses } from './passes'
import { createProfiler, NO_PROFILE } from './profile'
import { buildRecipeShader, type RecipeShaderMode } from './recipeShader'
import { recipeContext, resolveScene, type SceneInput } from './resolve'
import { runScatter, type EngineUniforms } from './scatter'
import { prepareColorStage, type PreparedColorStage } from '../color/stage'

export interface RenderOptions {
  /** Output size in pixels. */
  width: number
  height: number
  /** Render scale before the resolve filter: 2 by default, 1 for fast previews and fitting. */
  supersample?: 1 | 2 | 3 | 4
  /** Dither before rounding to 8 bits. On by default; only engine checks turn it off. */
  dither?: boolean
  /** Output pixels per tile side; by default tiles are 2048 render pixels across. Tiles bound GPU memory. */
  tileSize?: number
  /** Draw the result on the renderer's canvas, resizing it to the output size. */
  present?: boolean
  /** Wait for the GPU to finish (one 1-pixel read) so `ms` is the real render time. */
  measure?: boolean
  /** Wait for the GPU after every stage and report each stage's time (slower; for finding costs). */
  profile?: boolean
  /**
   * Don't wait for shader compiles (KHR_parallel_shader_compile). If a program is still compiling, the render draws
   * and presents nothing and says `ready: false`; `gpu.compiled(stats.compiling)` tells when to try again. Without
   * the extension it renders as usual. Anything that reads the pixels leaves this off.
   */
  background?: boolean
}

export interface RenderStats {
  width: number
  height: number
  supersample: number
  tiles: number
  /** Time to issue the passes; with `measure`, until the GPU has finished them. */
  ms: number
  measured: boolean
  /** With `profile`: ms per stage (scatter, radiance, post, lens, composite, resolve, output). */
  stages?: Record<string, number>
  /** False when a `background` render found a program still compiling and drew nothing. */
  ready: boolean
  /** Those programs. */
  compiling: readonly string[]
}

const MAX_OUTPUT_SIDE = 8192
const RENDER_TILE_SIDE = 2048
/** The 1x lens base comes from the composite's samples on frames this large: at least 2 per base pixel, up to 33 MB. */
const REUSE_MIN_SHORT_SIDE = 2 * LENS_BASE_SHORT_SIDE
const REUSE_MAX_PIXELS = 2560 * 1600

/**
 * Samples per axis for the lens base: 2 x 2 whenever the render is larger than
 * the base, so previews and exports feed the same light to the lens and the
 * cost stays low; 1 for small renders (fits). Scatter sources use the same rule.
 */
function baseSubsamples(renderShort: number, baseShort: number): number {
  return renderShort > baseShort ? 2 : 1
}

/** Every recipe shader mode a scene of this program can draw with, whatever its params and the frame size. */
function recipeShaderModes(program: RecipeProgram): RecipeShaderMode[] {
  const sources = new Set((program.scatter ?? []).map((blur) => blur.source))
  return ['composite', 'radiance', ...(sources.has('radiance') ? (['source'] as const) : []), ...(sources.has('aux') ? (['aux'] as const) : [])]
}

/** The recipe's radianceScale for this scene, snapped to 1, 0.5 or 0.25. */
export function radianceScaleFor(program: RecipeProgram, ctx: RecipeContext): number {
  const asked = typeof program.radianceScale === 'function' ? program.radianceScale(ctx) : (program.radianceScale ?? 1)
  if (!Number.isFinite(asked) || asked >= 0.75) return 1
  return asked >= 0.375 ? 0.5 : 0.25
}

/** Short side, in render pixels, of the frame the color stage reads a design from. */
const DESIGN_SHORT_SIDE = 512

/**
 * The frame the color stage reads a design from: the format's own shape (`ctx.aspect`, which `frameAspect` snaps to
 * the nearest export format) at DESIGN_SHORT_SIDE, as [width, height] in render pixels and in short sides.
 */
export function designFrame(aspect: number): { size: [number, number]; inShorts: [number, number] } {
  const inShorts: [number, number] = aspect >= 1 ? [aspect, 1] : [1, 1 / aspect]
  return { size: [Math.round(DESIGN_SHORT_SIDE * inShorts[0]), Math.round(DESIGN_SHORT_SIDE * inShorts[1])], inShorts }
}

/**
 * The color stage for a render. The stage reads the design once per seed, drag and format and keeps it, so it reads
 * it from designFrame, with the scattered light drawn for that frame, never from the output: every size of a format
 * (the preview's canvas, an export, a check) then gets the same colors, whichever size was drawn first.
 */
function prepareStage(gpu: Gpu, program: RecipeProgram, ctx: RecipeContext, settings: ColorMixSettings, engine: EngineUniforms, exposure: number): PreparedColorStage | null {
  const { size, inShorts } = designFrame(ctx.aspect)
  const designEngine: EngineUniforms = (w, h, origin, pixel, subsamples) => ({ ...engine(w, h, origin, pixel, subsamples), uFrameAspect: inShorts })
  const scatter = runScatter(gpu, program, ctx, size[0], size[1], designEngine, NO_PROFILE)
  try {
    return prepareColorStage({ gpu, program, ctx, settings, engine: designEngine, scatterUniforms: scatter.uniforms, scatterTextures: scatter.textures, exposureScale: 2 ** exposure })
  } finally {
    scatter.release()
  }
}

/**
 * Renders recipe programs with the full pipeline: recipe radiance, optional
 * post passes, lens, exposure and tone curve at render resolution, Mitchell
 * resolve to output size, then encode, grain and dither into an RGBA8 image.
 * Preview and export call the same code with different sizes. It does not
 * load the recipe registry; LightRenderer adds scenes by recipe id.
 */
export class ProgramRenderer {
  readonly gpu: Gpu
  private output: Target | null = null
  private readonly black: Target
  private readonly probe = new Uint8Array(4)

  constructor(canvas?: HTMLCanvasElement | OffscreenCanvas) {
    this.gpu = new Gpu(canvas ?? new OffscreenCanvas(1, 1))
    this.gpu.prepare([PRESENT_SHADER])
    this.black = this.gpu.acquire(1, 1)
    const gl = this.gpu.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.black.framebuffer)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  get width(): number {
    return this.output?.width ?? 0
  }

  get height(): number {
    return this.output?.height ?? 0
  }

  renderProgram(program: RecipeProgram, scene: SceneInput, options: RenderOptions): RenderStats {
    if (!options.background) return this.renderNow(program, scene, options)
    const { value, unfinished } = this.gpu.withoutWaiting(() => this.renderNow(program, scene, options))
    return { ...value, ready: unfinished.length === 0, compiling: unfinished }
  }

  /**
   * Starts compiling every program a scene of this recipe can draw with, without waiting; needs
   * KHR_parallel_shader_compile. Returns them, for `gpu.compiled`.
   */
  prepareProgram(program: RecipeProgram): string[] {
    const sources = recipeShaderModes(program).map((mode) => buildRecipeShader(program, mode))
    // Drawn on large 1x frames with the lens on (`reuse` in renderNow).
    if (!program.post?.length) sources.push(TEXEL_COMPOSITE_SHADER, BASE_FROM_RADIANCE_SHADER)
    this.gpu.prepare(sources)
    return sources
  }

  private renderNow(program: RecipeProgram, scene: SceneInput, options: RenderOptions): RenderStats {
    const start = performance.now()
    const gpu = this.gpu
    if (gpu.isLost) throw new LightEngineError(CONTEXT_LOST_MESSAGE)
    const width = Math.round(options.width)
    const height = Math.round(options.height)
    if (!(width >= 1 && height >= 1 && width <= MAX_OUTPUT_SIDE && height <= MAX_OUTPUT_SIDE)) {
      throw new LightEngineError(`Output size ${options.width}x${options.height} is out of range.`)
    }
    const factor = options.supersample ?? 2
    const dither = options.dither ?? true
    const tileSize = Math.max(64, Math.round(options.tileSize ?? Math.floor(RENDER_TILE_SIDE / factor)))

    const resolved = resolveScene(program, scene)
    const ctx = recipeContext(resolved, frameAspect(width, height))
    const recipeUniforms = program.uniforms(ctx)
    const renderWidth = width * factor
    const renderHeight = height * factor
    const short = Math.min(width, height)
    const frameInShorts = [width / short, height / short]
    let stageUniforms: UniformMap = {}
    const engine = (w: number, h: number, origin: number[], pixel: number, subsamples: number): UniformMap => ({
      ...recipeUniforms,
      uRenderSize: [w, h],
      uTileOrigin: origin,
      uFrameAspect: frameInShorts,
      uPixel: pixel,
      uSeed: resolved.seed,
      uSubsamples: subsamples,
      uHalationStart: halationStart(resolved.lens),
      uExposureScale: 2 ** resolved.output.exposure,
      ...stageUniforms,
    })

    const profiler = options.profile ? createProfiler(gpu) : null
    const mark = profiler ?? NO_PROFILE

    // Scattered light first: blurred copies of the recipe's light that its combine function reads.
    const scatter = runScatter(gpu, program, ctx, renderWidth, renderHeight, engine, mark)
    // The shared color stage (scene.colorMix): recolors the scene radiance before post passes and the lens.
    const stage = scene.colorMix ? prepareStage(gpu, program, ctx, scene.colorMix, engine, resolved.output.exposure) : null
    if (stage) stageUniforms = stage.uniforms
    const recipeTextures = stage ? { ...scatter.textures, ...stage.textures } : scatter.textures

    // Lens base (512 px short side; none when bloom and halation are off) and, for recipes with post passes or a
    // reduced radianceScale, the radiance as a texture that the composite samples. Otherwise the base is drawn
    // straight from the recipe, and with halation on its second image takes the per-sample light above nominal;
    // except at 1x on frames with a short side of REUSE_MIN_SHORT_SIDE or more, where the composite's own samples
    // (one per pixel, at least as dense as the base's 2 x 2) are drawn first and also make the base, so the recipe
    // runs once per pixel instead of a second time for the base.
    const usesPost = Boolean(program.post && program.post.length > 0)
    const radianceScale = radianceScaleFor(program, ctx)
    const usesTexture = usesPost || radianceScale < 1
    const baseSize = lensBaseSize(width, height)
    const spreadMix = lensSpread(resolved.lens).mix
    const lensOn = spreadMix > 0 || resolved.lens.halation > 0
    const renderShort = Math.min(renderWidth, renderHeight)
    const reuse = lensOn && !usesTexture && factor === 1 && renderShort >= REUSE_MIN_SHORT_SIDE && renderWidth * renderHeight <= REUSE_MAX_PIXELS
    const base = lensOn ? gpu.acquire(baseSize.width, baseSize.height, 'rgba16f', !usesTexture && resolved.lens.halation > 0 ? 2 : 1) : null
    let postScene: Target | null = null
    let pixelScene: Target | null = null
    // Compiled only when drawn: with the lens off and no radiance texture the render never uses it.
    const radianceProgram = () => gpu.program(buildRecipeShader(program, 'radiance', stage?.chunk))
    if (usesTexture) {
      const scale = Math.min(radianceScale, usesPost ? POST_MAX_SHORT_SIDE / renderShort : 1)
      const pw = Math.max(1, Math.round(renderWidth * scale))
      const ph = Math.max(1, Math.round(renderHeight * scale))
      // A reduced scale is for smooth looks, so one sample per pixel; post-pass input keeps 2 x 2.
      const subsamples = radianceScale < 1 ? 1 : 2
      const raw = gpu.acquire(pw, ph)
      gpu.draw(radianceProgram(), raw, {
        uniforms: { ...engine(pw, ph, [0, 0], 1 / (Math.min(pw, ph) * subsamples), subsamples), ...scatter.uniforms },
        textures: recipeTextures,
      })
      mark.mark('radiance texture', raw)
      postScene = usesPost && program.post ? runPostPasses(gpu, raw, program.post, ctx, mark) : raw
      if (postScene !== raw) gpu.release(raw)
      if (base) {
        gpu.draw(gpu.program(AREA_RESAMPLE_SHADER), base, {
          textures: { uSrc: postScene },
          uniforms: { uDstSize: [base.width, base.height], uTaps: Math.min(8, Math.ceil(pw / base.width)) },
        })
        mark.mark('lens base', base)
      }
    } else if (reuse && base) {
      pixelScene = gpu.acquire(renderWidth, renderHeight)
      gpu.draw(radianceProgram(), pixelScene, {
        uniforms: { ...engine(renderWidth, renderHeight, [0, 0], 1 / renderShort, 1), ...scatter.uniforms },
        textures: recipeTextures,
      })
      mark.mark('radiance texture', pixelScene)
      gpu.draw(gpu.program(BASE_FROM_RADIANCE_SHADER), base, {
        textures: { uSrc: pixelScene },
        uniforms: { uDstSize: [base.width, base.height], uStart: halationStart(resolved.lens), uExposureScale: 2 ** resolved.output.exposure },
      })
      mark.mark('lens base', base)
    } else if (base) {
      const subsamples = baseSubsamples(renderShort, Math.min(base.width, base.height))
      gpu.draw(radianceProgram(), base, {
        uniforms: { ...engine(base.width, base.height, [0, 0], 1 / (Math.min(base.width, base.height) * subsamples), subsamples), ...scatter.uniforms },
        textures: recipeTextures,
      })
      mark.mark('lens base', base)
    }
    const lens = base ? runLens(gpu, base, resolved.lens, resolved.output.exposure, mark) : { bloom: null, halation: null, surround: null }
    gpu.release(base)

    const lensUniforms: UniformMap = {
      uBloomMix: lens.bloom ? spreadMix : 0,
      uHalation: lens.halation ? resolved.lens.halation : 0,
      uHalationLevel: halationLevel(resolved.lens),
      uHalationDriftColor: halationDriftColor(resolved.lens),
      uExposure: resolved.output.exposure,
      uToe: resolved.output.toe,
      uLensVignette: resolved.lens.vignette,
      uLensVignetteAxes: frameInShorts.map((v) => v / Math.hypot(frameInShorts[0], frameInShorts[1])),
    }
    const lensTextures: Record<string, Target> = {
      uBloomTex: lens.bloom ?? this.black,
      uHalationTex: lens.halation ?? this.black,
      uHalationSurround: lens.surround ?? this.black,
    }

    if (!this.output || this.output.width !== width || this.output.height !== height) {
      gpu.release(this.output)
      this.output = gpu.acquire(width, height, 'rgba8')
    }
    const output = this.output

    const apron = factor > 1 ? 2 * factor : 0
    const tileW = Math.min(tileSize, width)
    const tileH = Math.min(tileSize, height)
    const sceneTile = gpu.acquire(tileW * factor + 2 * apron, tileH * factor + 2 * apron)
    const resolveTile = factor > 1 ? gpu.acquire(tileW, tileH * factor + 2 * apron) : null
    const compositeProgram = postScene
      ? gpu.program(TEXTURE_COMPOSITE_SHADER)
      : pixelScene
        ? gpu.program(TEXEL_COMPOSITE_SHADER)
        : gpu.program(buildRecipeShader(program, 'composite', stage?.chunk))
    const sceneTextures = postScene
      ? { ...lensTextures, uRadianceTex: postScene }
      : pixelScene
        ? { ...lensTextures, uRadianceTex: pixelScene }
        : { ...lensTextures, ...recipeTextures }
    const resolveX = gpu.program(RESOLVE_X_SHADER)
    // Filters that work per cell read a small copy of the whole frame, drawn by the same composite.
    const frameProgram = postScene || pixelScene ? gpu.program(TEXTURE_COMPOSITE_SHADER) : compositeProgram
    const filters = prepareOutputFilters(gpu, resolved.output, { width, height, seed: resolved.seed }, (target) =>
      gpu.draw(frameProgram, target, {
        uniforms: { ...engine(target.width, target.height, [0, 0], 1 / Math.min(target.width, target.height), 1), ...scatter.uniforms, ...lensUniforms },
        textures: sceneTextures,
      }),
    )
    const outputProgram = gpu.program(filters.shader)
    let tiles = 0
    for (let ty = 0; ty < height; ty += tileH) {
      for (let tx = 0; tx < width; tx += tileW) {
        const ow = Math.min(tileW, width - tx)
        const oh = Math.min(tileH, height - ty)
        const sw = ow * factor + 2 * apron
        const sh = oh * factor + 2 * apron
        const origin = [tx * factor - apron, ty * factor - apron]
        gpu.draw(compositeProgram, sceneTile, {
          viewport: [0, 0, sw, sh],
          uniforms: { ...engine(renderWidth, renderHeight, origin, 1 / renderShort, 1), ...scatter.uniforms, ...lensUniforms },
          textures: sceneTextures,
        })
        mark.mark('composite', sceneTile)
        let source = sceneTile
        if (resolveTile) {
          gpu.draw(resolveX, resolveTile, {
            viewport: [0, 0, ow, sh],
            textures: { uSrc: sceneTile },
            uniforms: { uFactor: factor, uApron: apron },
          })
          mark.mark('resolve', resolveTile)
          source = resolveTile
        }
        gpu.draw(outputProgram, output, {
          viewport: [tx, ty, ow, oh],
          textures: { uSrc: source, ...filters.textures },
          uniforms: {
            uTileOrigin: [tx, ty],
            uFactor: factor,
            uApron: apron,
            uSeed: resolved.seed,
            uDither: dither,
            ...filters.uniforms,
          },
        })
        mark.mark('output', output)
        tiles++
      }
    }
    gpu.release(sceneTile)
    gpu.release(resolveTile)
    gpu.release(lens.bloom)
    gpu.release(lens.halation)
    gpu.release(lens.surround)
    gpu.release(postScene)
    gpu.release(pixelScene)
    filters.release()
    scatter.release()
    stage?.release()
    gpu.trimPool()
    if (options.present) this.present()
    if (options.measure && !gpu.waiting) {
      const gl = gpu.gl
      gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.probe)
    }
    if (gpu.isLost) throw new LightEngineError(CONTEXT_LOST_MESSAGE)
    return {
      width,
      height,
      supersample: factor,
      tiles,
      ms: performance.now() - start,
      measured: Boolean(options.measure || options.profile),
      ...(profiler ? { stages: profiler.times } : {}),
      ready: true,
      compiling: [],
    }
  }

  /**
   * `present` for a page that must not wait: while the present program is still compiling it leaves the canvas as it
   * is and returns false. Call it after the render's fence has passed: resizing the canvas waits for the GPU.
   */
  presentWithoutWaiting(): boolean {
    return this.gpu.withoutWaiting(() => this.present()).unfinished.length === 0
  }

  /** Draws the last render on the canvas at 1:1. While a `background` render waits for a compile it leaves the canvas as it is. */
  present(): void {
    if (!this.output) return
    const presentProgram = this.gpu.program(PRESENT_SHADER)
    // Resizing clears the canvas, so a render that drew nothing must not resize it.
    if (this.gpu.waiting) return
    const canvas = this.gpu.canvas
    if (canvas.width !== this.output.width) canvas.width = this.output.width
    if (canvas.height !== this.output.height) canvas.height = this.output.height
    this.gpu.draw(presentProgram, null, {
      textures: { uSrc: this.output },
      viewport: [0, 0, this.output.width, this.output.height],
    })
  }

  /** RGBA8 pixels of the last render, top row first. */
  readPixels(): Uint8Array<ArrayBuffer> {
    if (!this.output) throw new LightEngineError('Nothing has been rendered yet.')
    return this.gpu.readPixels(this.output)
  }

  dispose(): void {
    this.gpu.dispose()
    this.output = null
  }
}
