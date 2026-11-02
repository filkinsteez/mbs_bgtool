import { hexToLinear } from '../color/srgb'
import { getRecipe } from '../recipes'
import type { RecipeProgram, Scene, UniformMap } from '../scene'
import { CONTEXT_LOST_MESSAGE, Gpu, LightEngineError, type Target } from './gl'
import { lensBaseSize, runLens, TEXTURE_COMPOSITE_SHADER } from './lens'
import { OUTPUT_SHADER, PRESENT_SHADER, RESOLVE_X_SHADER } from './output'
import { AREA_RESAMPLE_SHADER, POST_MAX_SHORT_SIDE, runPostPasses } from './passes'
import { buildRecipeShader } from './recipeShader'
import { recipeContext, resolveScene, type SceneInput } from './resolve'
import { runScatter } from './scatter'

export interface RenderOptions {
  /** Output size in pixels. */
  width: number
  height: number
  /** Render scale before the resolve filter: 2 by default, 1 for fast previews and fitting. */
  supersample?: 1 | 2 | 3 | 4
  /** Dither before rounding to 8 bits. On by default; only engine checks turn it off. */
  dither?: boolean
  /** Output pixels per tile side. Large frames render tile by tile to bound GPU memory. */
  tileSize?: number
  /** Draw the result on the renderer's canvas, resizing it to the output size. */
  present?: boolean
  /** Wait for the GPU to finish (one 1-pixel read) so `ms` is the real render time. */
  measure?: boolean
}

export interface RenderStats {
  width: number
  height: number
  supersample: number
  tiles: number
  /** Time to issue the passes; with `measure`, until the GPU has finished them. */
  ms: number
  measured: boolean
}

const MAX_OUTPUT_SIDE = 8192

/**
 * Samples per axis for the lens base: 2 x 2 whenever the render is larger than
 * the base, so previews and exports feed the same light to the lens and the
 * cost stays low; 1 for small renders (fits). Scatter sources use the same rule.
 */
function baseSubsamples(renderShort: number, baseShort: number): number {
  return renderShort > baseShort ? 2 : 1
}

/**
 * Renders scenes with the full pipeline: recipe radiance, optional post
 * passes, lens, exposure and tone curve at render resolution, Mitchell
 * resolve to output size, then encode, grain and dither into an RGBA8 image.
 * Preview and export call the same code with different sizes.
 */
export class LightRenderer {
  readonly gpu: Gpu
  private output: Target | null = null
  private readonly black: Target
  private readonly probe = new Uint8Array(4)

  constructor(canvas?: HTMLCanvasElement | OffscreenCanvas) {
    this.gpu = new Gpu(canvas ?? new OffscreenCanvas(1, 1))
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

  render(scene: Scene, options: RenderOptions): RenderStats {
    return this.renderProgram(getRecipe(scene.recipe), scene, options)
  }

  renderProgram(program: RecipeProgram, scene: SceneInput, options: RenderOptions): RenderStats {
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
    const tileSize = Math.max(64, Math.round(options.tileSize ?? 1024))

    const resolved = resolveScene(program, scene)
    const ctx = recipeContext(resolved)
    const recipeUniforms = program.uniforms(ctx)
    const renderWidth = width * factor
    const renderHeight = height * factor
    const short = Math.min(width, height)
    const frameAspect = [width / short, height / short]
    const engine = (w: number, h: number, origin: number[], pixel: number, subsamples: number): UniformMap => ({
      ...recipeUniforms,
      uRenderSize: [w, h],
      uTileOrigin: origin,
      uFrameAspect: frameAspect,
      uPixel: pixel,
      uSeed: resolved.seed,
      uSubsamples: subsamples,
    })

    // Scattered light first: blurred copies of the recipe's light that its combine function reads.
    const scatter = runScatter(gpu, program, ctx, renderWidth, renderHeight, engine)

    // Lens base (512 px short side) and, for recipes with post passes, the processed radiance.
    const baseSize = lensBaseSize(width, height)
    const base = gpu.acquire(baseSize.width, baseSize.height)
    let postScene: Target | null = null
    const radianceProgram = gpu.program(buildRecipeShader(program, 'radiance'))
    if (program.post && program.post.length > 0) {
      const scale = Math.min(1, POST_MAX_SHORT_SIDE / Math.min(renderWidth, renderHeight))
      const pw = Math.max(1, Math.round(renderWidth * scale))
      const ph = Math.max(1, Math.round(renderHeight * scale))
      const raw = gpu.acquire(pw, ph)
      gpu.draw(radianceProgram, raw, { uniforms: engine(pw, ph, [0, 0], 1 / (Math.min(pw, ph) * 2), 2), textures: scatter.textures })
      postScene = runPostPasses(gpu, raw, program.post, ctx)
      if (postScene !== raw) gpu.release(raw)
      gpu.draw(gpu.program(AREA_RESAMPLE_SHADER), base, {
        textures: { uSrc: postScene },
        uniforms: { uDstSize: [base.width, base.height], uTaps: Math.min(8, Math.ceil(pw / base.width)) },
      })
    } else {
      const subsamples = baseSubsamples(Math.min(renderWidth, renderHeight), Math.min(base.width, base.height))
      gpu.draw(radianceProgram, base, {
        uniforms: engine(base.width, base.height, [0, 0], 1 / (Math.min(base.width, base.height) * subsamples), subsamples),
        textures: scatter.textures,
      })
    }
    const lens = runLens(gpu, base, resolved.lens)
    gpu.release(base)

    const lensUniforms: UniformMap = {
      uBloomMix: lens.bloom ? resolved.lens.bloom : 0,
      uHalation: lens.halation ? resolved.lens.halation : 0,
      uHalationTint: hexToLinear(resolved.lens.halationTint),
      uExposure: resolved.output.exposure,
    }
    const lensTextures: Record<string, Target> = {
      uBloomTex: lens.bloom ?? this.black,
      uHalationTex: lens.halation ?? this.black,
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
      : gpu.program(buildRecipeShader(program, 'composite'))
    const resolveX = gpu.program(RESOLVE_X_SHADER)
    const outputProgram = gpu.program(OUTPUT_SHADER)
    const out = resolved.output
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
          uniforms: { ...engine(renderWidth, renderHeight, origin, 1 / Math.min(renderWidth, renderHeight), 1), ...lensUniforms },
          textures: postScene ? { ...lensTextures, uRadianceTex: postScene } : { ...lensTextures, ...scatter.textures },
        })
        let source = sceneTile
        if (resolveTile) {
          gpu.draw(resolveX, resolveTile, {
            viewport: [0, 0, ow, sh],
            textures: { uSrc: sceneTile },
            uniforms: { uFactor: factor, uApron: apron },
          })
          source = resolveTile
        }
        gpu.draw(outputProgram, output, {
          viewport: [tx, ty, ow, oh],
          textures: { uSrc: source },
          uniforms: {
            uTileOrigin: [tx, ty],
            uFactor: factor,
            uApron: apron,
            uSeed: resolved.seed,
            uGrain: out.grain,
            uGrainSize: out.grainSize,
            uGrainChroma: out.grainChroma,
            uDither: dither,
          },
        })
        tiles++
      }
    }
    gpu.release(sceneTile)
    gpu.release(resolveTile)
    gpu.release(lens.bloom)
    gpu.release(lens.halation)
    gpu.release(postScene)
    scatter.release()
    gpu.trimPool()
    if (options.present) this.present()
    if (options.measure) {
      const gl = gpu.gl
      gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.probe)
    }
    if (gpu.isLost) throw new LightEngineError(CONTEXT_LOST_MESSAGE)
    return { width, height, supersample: factor, tiles, ms: performance.now() - start, measured: Boolean(options.measure) }
  }

  /** Draws the last render on the canvas at 1:1. */
  present(): void {
    if (!this.output) return
    const canvas = this.gpu.canvas
    if (canvas.width !== this.output.width) canvas.width = this.output.width
    if (canvas.height !== this.output.height) canvas.height = this.output.height
    this.gpu.draw(this.gpu.program(PRESENT_SHADER), null, {
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
