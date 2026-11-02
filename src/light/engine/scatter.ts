import { MAX_SCATTER_BLURS, type RecipeContext, type RecipeProgram, type ScatterBlur, type UniformMap } from '../scene'
import { LightEngineError, type Gpu, type Target } from './gl'
import { gaussianBlur } from './passes'
import { buildRecipeShader } from './recipeShader'

/**
 * Scatter sources render at a working size that keeps the smallest blur at
 * least MIN_BLUR_PIXELS wide, within these short sides. The size does not
 * depend on the output size, so previews and exports scatter the same light.
 */
const MIN_BLUR_PIXELS = 4
const MIN_SHORT_SIDE = 256
const MAX_SHORT_SIDE = 1024

export type EngineUniforms = (width: number, height: number, origin: number[], pixel: number, subsamples: number) => UniformMap

export interface ScatterOutput {
  /** `uScatter<i>` per blur, for the radiance and composite shaders. */
  textures: Record<string, Target>
  release(): void
}

/** Renders the recipe's scatter sources and blurs them; the caller releases the result after its last draw. */
export function runScatter(
  gpu: Gpu,
  program: RecipeProgram,
  ctx: RecipeContext,
  renderWidth: number,
  renderHeight: number,
  engine: EngineUniforms,
): ScatterOutput {
  const blurs = program.scatter ?? []
  if (blurs.length === 0) return { textures: {}, release: () => {} }
  if (blurs.length > MAX_SCATTER_BLURS) throw new LightEngineError(`${program.id} asks for ${blurs.length} scatter blurs; at most ${MAX_SCATTER_BLURS}.`)
  const radii = blurs.map((blur) => {
    const radius = blur.radius(ctx)
    if (!Number.isFinite(radius) || radius < 0) throw new LightEngineError(`${program.id} scatter radius ${radius} is not a finite number >= 0.`)
    return radius
  })
  const positive = radii.filter((r) => r > 0)
  const smallest = positive.length > 0 ? Math.min(...positive) : 1
  const renderShort = Math.min(renderWidth, renderHeight)
  const short = Math.min(renderShort, Math.min(MAX_SHORT_SIDE, Math.max(MIN_SHORT_SIDE, Math.ceil(MIN_BLUR_PIXELS / smallest))))
  const width = Math.max(1, Math.round((renderWidth * short) / renderShort))
  const height = Math.max(1, Math.round((renderHeight * short) / renderShort))
  const subsamples = renderShort > short ? 2 : 1

  const sources = new Map<ScatterBlur['source'], Target>()
  for (const { source } of blurs) {
    if (sources.has(source)) continue
    const target = gpu.acquire(width, height)
    gpu.draw(gpu.program(buildRecipeShader(program, source === 'radiance' ? 'source' : 'aux')), target, {
      uniforms: engine(width, height, [0, 0], 1 / (short * subsamples), subsamples),
    })
    sources.set(source, target)
  }

  const blurred: Target[] = []
  const textures: Record<string, Target> = {}
  blurs.forEach((blur, i) => {
    const source = sources.get(blur.source) as Target
    const sigma = radii[i] * short
    const target = sigma > 0.05 ? gaussianBlur(gpu, source, sigma) : source
    if (target !== source) blurred.push(target)
    textures[`uScatter${i}`] = target
  })
  return {
    textures,
    release: () => {
      for (const target of blurred) gpu.release(target)
      for (const target of sources.values()) gpu.release(target)
    },
  }
}
