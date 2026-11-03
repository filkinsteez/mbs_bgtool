import { MAX_SCATTER_BLURS, type RecipeContext, type RecipeProgram, type ScatterBlur, type UniformMap } from '../scene'
import { LightEngineError, type Gpu, type Target } from './gl'
import { AREA_RESAMPLE_SHADER, blurLevel, edgeLevel, halve, halvings, LENS_GRID_TEXELS, lensGather, samplingLevel, type Halvings } from './passes'
import { NO_PROFILE, type Profiler } from './profile'
import { buildRecipeShader } from './recipeShader'

/**
 * Scatter sources render at a working size that keeps the smallest blur at
 * least MIN_BLUR_PIXELS wide, within these short sides. The size does not
 * depend on the output size, so previews and exports scatter the same light.
 */
const MIN_BLUR_PIXELS = 4
const MIN_SHORT_SIDE = 256
const MAX_SHORT_SIDE = 1024
/** Short sides a recipe may ask for with ScatterBlur.size. */
const MIN_SIZED_SIDE = 8
const MAX_SIZED_SIDE = 2048

/**
 * A lens source renders this many pixels per grid texel along each axis, one sample each, and is averaged down
 * to the grid: 16 samples per texel for sharp outlines, spread over enough pixels to keep the GPU busy.
 */
const LENS_SOURCE_SCALE = 4

/** One source render: which light, at which short side, with how many samples per texel axis. */
interface SourceSpec {
  key: string
  kind: ScatterBlur['source']
  short: number
  width: number
  height: number
  subsamples: number
  /** For a lens entry: the grid the source is averaged down to before the gather. */
  grid?: { short: number; width: number; height: number }
}

export type EngineUniforms = (width: number, height: number, origin: number[], pixel: number, subsamples: number) => UniformMap

export interface ScatterOutput {
  /** `uScatter<i>` per blur, for the radiance and composite shaders. */
  textures: Record<string, Target>
  /** `uScatterMap<i>` per blur: frame uv to the texture's uv (xy scale, zw offset). */
  uniforms: UniformMap
  release(): void
}

const IDENTITY_MAP = [1, 1, 0, 0] as const

/** Renders the recipe's scatter sources and blurs them; the caller releases the result after its last draw. */
export function runScatter(
  gpu: Gpu,
  program: RecipeProgram,
  ctx: RecipeContext,
  renderWidth: number,
  renderHeight: number,
  engine: EngineUniforms,
  profiler: Profiler = NO_PROFILE,
): ScatterOutput {
  const blurs = program.scatter ?? []
  if (blurs.length === 0) return { textures: {}, uniforms: {}, release: () => {} }
  if (blurs.length > MAX_SCATTER_BLURS) throw new LightEngineError(`${program.id} asks for ${blurs.length} scatter blurs; at most ${MAX_SCATTER_BLURS}.`)
  const radii = blurs.map((blur) => {
    const radius = blur.radius(ctx)
    if (!Number.isFinite(radius) || radius < 0) throw new LightEngineError(`${program.id} scatter radius ${radius} is not a finite number >= 0.`)
    return radius
  })
  const lens = blurs.map((blur, i) => blur.shape === 'lens' && radii[i] > 0)
  const sized = blurs.map((blur, i) => {
    if (lens[i]) return Math.min(MAX_SIZED_SIDE, Math.max(MIN_SIZED_SIDE, Math.ceil(LENS_GRID_TEXELS / radii[i])))
    if (!blur.size) return null
    const asked = blur.size(ctx)
    if (!Number.isFinite(asked) || asked <= 0) throw new LightEngineError(`${program.id} scatter size ${asked} is not a finite number > 0.`)
    return Math.min(MAX_SIZED_SIDE, Math.max(MIN_SIZED_SIDE, Math.round(asked)))
  })
  const shared = radii.filter((radius, i) => sized[i] === null && radius > 0)
  const smallest = shared.length > 0 ? Math.min(...shared) : 1
  const renderShort = Math.min(renderWidth, renderHeight)
  const sharedShort = Math.min(renderShort, Math.min(MAX_SHORT_SIDE, Math.max(MIN_SHORT_SIDE, Math.ceil(MIN_BLUR_PIXELS / smallest))))
  const spec = (kind: ScatterBlur['source'], short: number, subsamples: number): SourceSpec => ({
    key: `${kind} ${short} ${subsamples}`,
    kind,
    short,
    width: Math.max(1, Math.round((renderWidth * short) / renderShort)),
    height: Math.max(1, Math.round((renderHeight * short) / renderShort)),
    subsamples,
  })
  const specs = blurs.map((blur, i): SourceSpec => {
    const size = sized[i]
    if (size === null) return spec(blur.source, sharedShort, renderShort > sharedShort ? 2 : 1)
    if (!lens[i]) return spec(blur.source, size, 1)
    const grid = spec(blur.source, size, 1)
    const s = LENS_SOURCE_SCALE
    return { key: `${blur.source} lens ${size}`, kind: blur.source, short: s * size, width: s * grid.width, height: s * grid.height, subsamples: 1, grid }
  })

  const sources = new Map<string, Target>()
  for (const { key, kind, short, width, height, subsamples } of specs) {
    if (sources.has(key)) continue
    const target = gpu.acquire(width, height)
    gpu.draw(gpu.program(buildRecipeShader(program, kind === 'radiance' ? 'source' : 'aux')), target, {
      uniforms: engine(width, height, [0, 0], 1 / (short * subsamples), subsamples),
    })
    profiler.mark('scatter sources', target)
    sources.set(key, target)
  }

  // Wide blurs run on halvings of the source and keep that size. Past the frame edges each repeats the texels of its
  // edge level: the halvings up to that level are plain, the rest are of a copy extended there. The shaders read
  // the blurred copies through uvMap.
  const plans = radii.map((radius, i) => {
    const { short, width, height } = specs[i]
    const blur = radius * short
    const at = samplingLevel(blur, width, height)
    return { blur, ...at, edge: Math.min(at.level, edgeLevel(blur, width, height)) }
  })
  const owned: Target[] = []
  const textures: Record<string, Target> = {}
  const uniforms: UniformMap = {}
  for (const [key, source] of sources) {
    const plain = [source]
    const plainLevel = (j: number): Target => {
      while (plain.length <= j) plain.push(halve(gpu, plain[plain.length - 1]))
      return plain[j]
    }
    const deepest = new Map<number, number>()
    blurs.forEach((_, i) => {
      const plan = plans[i]
      if (specs[i].key === key && !lens[i] && plan.blur > 0.05 && plan.level > 0) deepest.set(plan.edge, Math.max(deepest.get(plan.edge) ?? 0, plan.level))
    })
    const chains = new Map<number, Halvings>()
    blurs.forEach((_, i) => {
      if (specs[i].key !== key) return
      const plan = plans[i]
      let target = source
      let uvMap: readonly number[] = IDENTITY_MAP
      const grid = specs[i].grid
      if (lens[i] && grid) {
        const averaged = gpu.acquire(grid.width, grid.height)
        gpu.draw(gpu.program(AREA_RESAMPLE_SHADER), averaged, {
          textures: { uSrc: source },
          uniforms: { uDstSize: [grid.width, grid.height], uTaps: LENS_SOURCE_SCALE },
        })
        target = lensGather(gpu, averaged, radii[i] * grid.short)
        gpu.release(averaged)
      } else if (plan.blur > 0.05 && plan.level === 0) {
        target = blurLevel(gpu, source, plan.sigma, false)
      } else if (plan.blur > 0.05) {
        let chain = chains.get(plan.edge)
        if (!chain) {
          chain = halvings(gpu, plainLevel(plan.edge), (deepest.get(plan.edge) ?? plan.level) - plan.edge)
          chains.set(plan.edge, chain)
        }
        target = blurLevel(gpu, chain.level(plan.level - plan.edge), plan.sigma, true)
        uvMap = chain.uvMap
      }
      if (target !== source) owned.push(target)
      textures[`uScatter${i}`] = target
      uniforms[`uScatterMap${i}`] = [...uvMap]
      profiler.mark('scatter blurs', target)
    })
    for (const chain of chains.values()) chain.release()
    for (const level of plain.slice(1)) gpu.release(level)
  }
  return {
    textures,
    uniforms,
    release: () => {
      for (const target of owned) gpu.release(target)
      for (const target of sources.values()) gpu.release(target)
    },
  }
}
