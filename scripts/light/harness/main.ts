/// <reference types="vite/client" />
import {
  buildMask,
  compareImages,
  DEFAULT_FIT_WEIGHTS,
  falloffProfile,
  fitLoss,
  prepareFitTarget,
  type AuditMetrics,
  type FalloffProfile,
  type FitLossParts,
  type FitTarget,
  type FitWeights,
  type RgbaImage,
  type RowProfiles,
} from '../../../src/light/audit'
import { getPack, type PackId } from '../../../src/light/color/packs'
import { composeScene } from '../../../src/light/compose'
import type * as ExportModule from '../../../src/light/engine/export'
import { ProgramRenderer } from '../../../src/light/engine/programRenderer'
import type { SceneInput } from '../../../src/light/engine/resolve'
import type { IgnoreRect } from '../../../src/light/references'
import {
  HIDDEN_RECIPE_IDS,
  isRecipeId,
  RECIPE_IDS,
  type ControlValues,
  type Preset,
  type RecipeDefinition,
  type RecipeId,
  type RecipeProgram,
  type Scene,
} from '../../../src/light/scene'
import { TEST_PROGRAMS } from './testPrograms'

// Each recipe file loads on its own, so a recipe that is broken mid-edit only fails the scenes that use it.
const RECIPE_FILES = import.meta.glob(['../../../src/light/recipes/*/*.ts', '!../../../src/light/recipes/**/*.test.ts'])
// Exports go through the whole recipe registry, so that module loads only when an export is asked for.
const EXPORT_FILES = import.meta.glob('../../../src/light/engine/export.ts')

const recipes = new Map<RecipeId, RecipeDefinition>()
const recipeErrors = new Map<RecipeId, string>()

function isDefinition(value: unknown, id: RecipeId): value is RecipeDefinition {
  return typeof value === 'object' && value !== null && (value as RecipeDefinition).id === id && typeof (value as RecipeDefinition).fragment === 'string'
}

async function loadRecipes(): Promise<void> {
  await Promise.all(
    [...RECIPE_IDS, ...HIDDEN_RECIPE_IDS].map(async (id) => {
      const [mood, name] = id.split('.')
      const file = `src/light/recipes/${mood}/${name}.ts`
      const load = RECIPE_FILES[`../../../${file}`]
      if (!load) {
        recipeErrors.set(id, `no file ${file}`)
        return
      }
      try {
        const definition = Object.values((await load()) as Record<string, unknown>).find((value) => isDefinition(value, id))
        if (definition) recipes.set(id, definition)
        else recipeErrors.set(id, `${file} exports no recipe with id ${id}`)
      } catch (error) {
        recipeErrors.set(id, `${file} failed to load: ${error instanceof Error ? error.message : String(error)}`)
      }
    }),
  )
}

/** A recipe scene (with `recipe`) or a test program scene (with `program`). */
export type HarnessScene = SceneInput & { recipe?: string; program?: string }

export interface RenderRequest {
  scene: HarnessScene
  width: number
  height: number
  supersample?: 1 | 2 | 3 | 4
  dither?: boolean
  tileSize?: number
  /** Upload the RGBA bytes to the Node side under this key. */
  upload?: string
  /** Render the recipe as if it set this radianceScale (for speed and match checks). */
  radianceScale?: number
}

export interface ProfileResult {
  /** Median ms of single renders that wait for the GPU. */
  total: number
  /** Median ms per frame over 10 renders drawn back to back. */
  burst: number
  /** Median ms per stage of renders that wait for the GPU after every stage. */
  stages: Record<string, number>
}

export interface AuditRequest extends RenderRequest {
  targetKey: string
  ignore: IgnoreRect[]
  cornerRadius: number
  heatmapUpload: string
  /** Also measure how the glow falls off outward from the brightest light (Contour references). */
  falloff?: boolean
}

export interface FitSetupRequest {
  targetKey: string
  ignore: IgnoreRect[]
  cornerRadius: number
  width: number
  height: number
}

const canvas = document.createElement('canvas')
const renderer = new ProgramRenderer(canvas)
let fit: { prepared: FitTarget; width: number; height: number } | null = null

function programFor(scene: HarnessScene): RecipeProgram {
  if (scene.program) {
    const program = TEST_PROGRAMS[scene.program]
    if (!program) throw new Error(`Unknown test program: ${scene.program}`)
    return program
  }
  if (!scene.recipe || !isRecipeId(scene.recipe)) throw new Error(`Unknown recipe: ${scene.recipe}`)
  const recipe = recipes.get(scene.recipe)
  if (!recipe) throw new Error(recipeErrors.get(scene.recipe) ?? `${scene.recipe} is not loaded`)
  return recipe
}

/** The same program with every shader function returning a constant: what the engine alone costs for it. */
function stubProgram(program: RecipeProgram): RecipeProgram {
  const blurred = (program.scatter ?? []).map((_, i) => `, vec3 blurred${i}`).join('')
  const fragment = `
vec3 radiance(vec2 uv, vec2 p) { return vec3(0.05, 0.06, 0.08); }
vec3 auxRadiance(vec2 uv, vec2 p) { return vec3(0.05); }
${program.scatter?.length ? `vec3 combine(vec2 uv, vec2 p, vec3 light${blurred}) { return light + 0.1 * blurred0; }` : ''}
${program.grainWeight ? 'float grainWeight(vec2 uv, vec2 p) { return 1.0; }' : ''}
`
  return { ...program, id: `${program.id} stub`, fragment, uniforms: () => ({}) }
}

function requestProgram(request: Pick<RenderRequest, 'scene' | 'radianceScale'>): RecipeProgram {
  const program = programFor(request.scene)
  return request.radianceScale ? { ...program, radianceScale: request.radianceScale } : program
}

function renderImage(request: RenderRequest): { image: RgbaImage; ms: number } {
  const start = performance.now()
  renderer.renderProgram(requestProgram(request), request.scene, {
    width: request.width,
    height: request.height,
    supersample: request.supersample ?? 2,
    dither: request.dither ?? true,
    tileSize: request.tileSize,
  })
  const data = renderer.readPixels()
  return { image: { width: request.width, height: request.height, data }, ms: performance.now() - start }
}

async function upload(key: string, bytes: Uint8Array | Uint8ClampedArray): Promise<void> {
  const body = new Blob([new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength)])
  const response = await fetch(`/__light/upload/${encodeURIComponent(key)}`, { method: 'POST', body })
  if (!response.ok) throw new Error(`Upload ${key} failed: ${response.status}`)
}

async function download(key: string): Promise<RgbaImage> {
  const response = await fetch(`/__light/blob/${encodeURIComponent(key)}`)
  if (!response.ok) throw new Error(`Download ${key} failed: ${response.status}`)
  const width = Number(response.headers.get('x-width'))
  const height = Number(response.headers.get('x-height'))
  return { width, height, data: new Uint8Array(await response.arrayBuffer()) }
}

const api = {
  ready: true,

  info() {
    const gl = renderer.gpu.gl
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
      recipes: RECIPE_IDS.flatMap((id) => {
        const recipe = recipes.get(id)
        if (!recipe) return []
        return [
          {
            id: recipe.id,
            mood: recipe.mood,
            colorSlots: recipe.colorSlots,
            defaultColors: recipe.defaultColors,
            params: recipe.params,
            lens: recipe.lens ?? {},
            output: recipe.output ?? {},
          },
        ]
      }),
      recipeErrors: Object.fromEntries(recipeErrors),
    }
  },

  async render(request: RenderRequest): Promise<{ ms: number; uploadMs: number }> {
    const { image, ms } = renderImage(request)
    const start = performance.now()
    if (request.upload) await upload(request.upload, image.data)
    return { ms, uploadMs: performance.now() - start }
  },

  async audit(request: AuditRequest): Promise<{
    metrics: AuditMetrics
    rows: RowProfiles
    falloff: FalloffProfile | null
    renderMs: number
    metricsMs: number
    downloadMs: number
    uploadMs: number
  }> {
    const downloadStart = performance.now()
    const target = await download(request.targetKey)
    const downloadMs = performance.now() - downloadStart
    if (target.width !== request.width || target.height !== request.height) {
      throw new Error(`Target is ${target.width}x${target.height}, render request is ${request.width}x${request.height}`)
    }
    const { image, ms } = renderImage(request)
    const start = performance.now()
    const mask = buildMask(request.width, request.height, request.ignore, request.cornerRadius)
    const comparison = compareImages(target, image, mask)
    const falloff = request.falloff ? falloffProfile(target, image, mask) : null
    const metricsMs = performance.now() - start
    const uploadStart = performance.now()
    await Promise.all([
      request.upload ? upload(request.upload, image.data) : Promise.resolve(),
      upload(request.heatmapUpload, comparison.heatmap.data),
    ])
    const uploadMs = performance.now() - uploadStart
    return { metrics: comparison.metrics, rows: comparison.rows, falloff, renderMs: ms, metricsMs, downloadMs, uploadMs }
  },

  /** Falloff profiles of a target and a render at chosen distances (for studies). */
  async falloff(request: RenderRequest & { targetKey: string; ignore: IgnoreRect[]; cornerRadius: number; distances: number[] }): Promise<FalloffProfile> {
    const target = await download(request.targetKey)
    const { image } = renderImage(request)
    return falloffProfile(target, image, buildMask(request.width, request.height, request.ignore, request.cornerRadius), request.distances)
  },

  /** Runs the real export path (own offscreen renderer, JPEG encode) and uploads the JPEG bytes. */
  async exportImage(preset: Preset, request: ExportModule.ExportRequest, uploadKey: string): Promise<{ fileName: string; width: number; height: number; ms: number }> {
    const start = performance.now()
    const { exportPreset } = (await EXPORT_FILES['../../../src/light/engine/export.ts']()) as typeof ExportModule
    const result = await exportPreset(preset, request)
    const ms = performance.now() - start
    await upload(uploadKey, new Uint8Array(await result.blob.arrayBuffer()))
    return { fileName: result.fileName, width: result.width, height: result.height, ms }
  },

  /** Loses a context on purpose and reports what each renderer call does afterwards. */
  contextLoss(scene: HarnessScene): Record<string, string> {
    const lostCanvas = document.createElement('canvas')
    const lostRenderer = new ProgramRenderer(lostCanvas)
    lostRenderer.renderProgram(programFor(scene), scene, { width: 64, height: 64 })
    lostRenderer.gpu.gl.getExtension('WEBGL_lose_context')?.loseContext()
    const outcome = (action: () => unknown): string => {
      try {
        action()
        return 'no error'
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }
    return {
      readPixels: outcome(() => lostRenderer.readPixels()),
      render: outcome(() => lostRenderer.renderProgram(programFor(scene), scene, { width: 64, height: 64 })),
      newRenderer: outcome(() => new ProgramRenderer(lostCanvas)),
    }
  },

  /**
   * Per-stage GPU time (median of `runs` profiled renders) for the scene and for a stub of the same program whose
   * shader functions return constants, so each stage splits into engine cost and the recipe's own shader cost.
   * `burst` is the time per frame over 10 renders drawn back to back with one wait at the end: the GPU stays busy,
   * so it is steadier than single renders, which an idle GPU slows down.
   */
  profile(request: RenderRequest & { runs?: number }): ProfileResult & { stub: ProfileResult } {
    const options = { width: request.width, height: request.height, supersample: request.supersample ?? 1 }
    const runs = Math.max(1, request.runs ?? 5)
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
    const measure = (program: RecipeProgram): ProfileResult => {
      renderer.renderProgram(program, request.scene, { ...options, profile: true })
      const totals: number[] = []
      const bursts: number[] = []
      const perStage: Record<string, number[]> = {}
      for (let i = 0; i < runs; i++) {
        const stats = renderer.renderProgram(program, request.scene, { ...options, measure: true })
        totals.push(stats.ms)
        const profiled = renderer.renderProgram(program, request.scene, { ...options, profile: true })
        for (const [stage, ms] of Object.entries(profiled.stages ?? {})) (perStage[stage] ??= []).push(ms)
        const start = performance.now()
        for (let frame = 0; frame < 9; frame++) renderer.renderProgram(program, request.scene, options)
        renderer.renderProgram(program, request.scene, { ...options, measure: true })
        bursts.push((performance.now() - start) / 10)
      }
      return {
        total: median(totals),
        burst: median(bursts),
        stages: Object.fromEntries(Object.entries(perStage).map(([stage, values]) => [stage, median(values)])),
      }
    }
    const program = requestProgram(request)
    return { ...measure(program), stub: measure(stubProgram(program)) }
  },

  /** What a program's uniforms, radianceScale, post pass settings and scatter radius get as ctx.aspect, per frame size. */
  aspectProbe(sizes: { width: number; height: number }[]): Record<string, number[]>[] {
    return sizes.map(({ width, height }) => {
      const seen: Record<string, number[]> = { uniforms: [], radianceScale: [], post: [], scatter: [] }
      const program: RecipeProgram = {
        id: 'test.aspect',
        colorSlots: [],
        defaultColors: [],
        params: [],
        fragment: `
vec3 radiance(vec2 uv, vec2 p) { return vec3(0.1); }
vec3 combine(vec2 uv, vec2 p, vec3 light, vec3 blurred0) { return light; }
`,
        uniforms: (ctx) => {
          seen.uniforms.push(ctx.aspect)
          return {}
        },
        radianceScale: (ctx) => {
          seen.radianceScale.push(ctx.aspect)
          return 1
        },
        post: [{ kind: 'gaussianBlur', settings: (ctx) => (seen.post.push(ctx.aspect), { radius: 0 }) }],
        scatter: [{ source: 'radiance', radius: (ctx) => (seen.scatter.push(ctx.aspect), 0.01) }],
      }
      renderer.renderProgram(program, {}, { width, height, supersample: 1 })
      return seen
    })
  },

  /** The scene a recipe's compose makes for a pack, controls, seed and aspect. */
  compose(recipeId: RecipeId, packId: PackId, controls: ControlValues, seed: number, aspect: number): Scene {
    const recipe = recipes.get(recipeId)
    if (!recipe) throw new Error(recipeErrors.get(recipeId) ?? `${recipeId} is not loaded`)
    const scene = composeScene(recipe, { pack: getPack(packId), controls, seed, aspect })
    if (!scene) throw new Error(`${recipeId} has no compose`)
    return scene
  },

  /** Times one render without and with measure (GPU finished), in ms. */
  measure(request: RenderRequest): { issued: number; measured: number; measuredFlag: boolean } {
    const options = { width: request.width, height: request.height, supersample: request.supersample ?? 1 }
    const program = requestProgram(request)
    renderer.renderProgram(program, request.scene, { ...options, measure: true })
    const issued = renderer.renderProgram(program, request.scene, options)
    renderer.gpu.gl.finish()
    const measured = renderer.renderProgram(program, request.scene, { ...options, measure: true })
    return { issued: issued.ms, measured: measured.ms, measuredFlag: measured.measured }
  },

  async fitSetup(request: FitSetupRequest): Promise<{ width: number; height: number }> {
    const target = await download(request.targetKey)
    const mask = buildMask(target.width, target.height, request.ignore, request.cornerRadius)
    fit = { prepared: prepareFitTarget(target, mask, request.width, request.height), width: request.width, height: request.height }
    return { width: request.width, height: request.height }
  },

  /** Renders each scene at the fit size (1x, no dither, no grain) and returns its loss. */
  fitLoss(scenes: HarnessScene[], weights: FitWeights = DEFAULT_FIT_WEIGHTS): FitLossParts[] {
    const state = fit
    if (!state) throw new Error('Call fitSetup first.')
    return scenes.map((scene) => {
      const output = { ...scene.output, grain: 0 }
      const { image } = renderImage({ scene: { ...scene, output }, width: state.width, height: state.height, supersample: 1, dither: false })
      return fitLoss(state.prepared, image, weights)
    })
  },
}

export type HarnessApi = typeof api

declare global {
  interface Window {
    lightHarness: HarnessApi
  }
}

await loadRecipes()
window.lightHarness = api
document.documentElement.dataset.harness = 'ready'
