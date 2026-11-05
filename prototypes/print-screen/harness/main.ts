/// <reference types="vite/client" />
// Runs the engine's output pass with the print screen stage (../stage.mjs) on a frame the engine renders without
// filters and without dither, decoded to display-linear floats, as the Pixel prototype does. The stage is not
// registered in the engine; the page builds the output shader with it directly. Driven by ../gpu-check.mjs.
import { getPack, type PackId } from '../../../src/light/color/packs'
import { srgbToLinear } from '../../../src/light/color/srgb'
import { composeScene } from '../../../src/light/compose'
import type { OutputFilter } from '../../../src/light/engine/filters/types'
import { GRAIN_FILTER } from '../../../src/light/engine/grain'
import { buildOutputShader } from '../../../src/light/engine/output'
import { ProgramRenderer } from '../../../src/light/engine/programRenderer'
import { isRecipeId, RECIPE_IDS, type ControlValues, type RecipeDefinition, type RecipeId, type Scene } from '../../../src/light/scene'
import { PRINT_SCREEN_FILTER, printScreenUniforms } from '../stage.mjs'

const RECIPE_FILES = import.meta.glob(['../../../src/light/recipes/*/*.ts', '!../../../src/light/recipes/**/*.test.ts'])
const recipes = new Map<RecipeId, RecipeDefinition>()

async function loadRecipes(): Promise<void> {
  await Promise.all(
    RECIPE_IDS.map(async (id) => {
      const [mood, name] = id.split('.')
      const load = RECIPE_FILES[`../../../src/light/recipes/${mood}/${name}.ts`]
      if (!load) return
      const module = (await load().catch(() => ({}))) as Record<string, unknown>
      const definition = Object.values(module).find(
        (value): value is RecipeDefinition => typeof value === 'object' && value !== null && (value as RecipeDefinition).id === id,
      )
      if (definition) recipes.set(id, definition)
    }),
  )
}

async function upload(key: string, bytes: Uint8Array): Promise<void> {
  const response = await fetch(`/__light/upload/${encodeURIComponent(key)}`, { method: 'POST', body: new Blob([bytes as BlobPart]) })
  if (!response.ok) throw new Error(`Upload ${key} failed: ${response.status}`)
}

const canvas = document.createElement('canvas')
const renderer = new ProgramRenderer(canvas)
const DECODE = Float32Array.from({ length: 256 }, (_, v) => srgbToLinear(v / 255))

function uploadLinear(gpu: ProgramRenderer['gpu'], bytes: Uint8Array, width: number, height: number) {
  const linear = new Float32Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    linear[i * 4] = DECODE[bytes[i * 4]]
    linear[i * 4 + 1] = DECODE[bytes[i * 4 + 1]]
    linear[i * 4 + 2] = DECODE[bytes[i * 4 + 2]]
    linear[i * 4 + 3] = 1
  }
  const target = gpu.acquire(width, height)
  gpu.gl.bindTexture(gpu.gl.TEXTURE_2D, target.texture)
  gpu.gl.texSubImage2D(gpu.gl.TEXTURE_2D, 0, 0, 0, width, height, gpu.gl.RGBA, gpu.gl.FLOAT, linear)
  return target
}

export interface ScreenRequest {
  scene: Scene & { recipe: string }
  width: number
  height: number
  strengths: number[]
  dither: boolean
  /** Uploads go to `<upload>-input` and `<upload>-<strength>`. */
  upload: string
}

export interface TimeRequest {
  scene: Scene & { recipe: string }
  sizes: { width: number; height: number }[]
  repeats: number
}

/** Median GPU time (timer query; null without the extension) and wall time to finished pixels, in ms. */
export interface PassTime {
  width: number
  height: number
  stage: 'none' | 'grain' | 'print'
  gpuMs: number | null
  wallMs: number
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

function renderInput(request: { scene: Scene & { recipe: string }; width: number; height: number }) {
  const { scene, width, height } = request
  if (!isRecipeId(scene.recipe)) throw new Error(`Unknown recipe ${scene.recipe}`)
  const recipe = recipes.get(scene.recipe)
  if (!recipe) throw new Error(`${scene.recipe} did not load`)
  const plain = { ...scene, output: { ...scene.output, grain: 0, ascii: 0, pixel: 0 } }
  renderer.renderProgram(recipe, plain, { width, height, supersample: 2, dither: false })
  return renderer.readPixels()
}

const api = {
  compose(recipeId: RecipeId, packId: PackId, controls: ControlValues, seed: number, aspect: number): Scene | null {
    const recipe = recipes.get(recipeId)
    return recipe ? composeScene(recipe, { pack: getPack(packId), controls, seed, aspect }) : null
  },

  async render(request: ScreenRequest): Promise<{ ms: number }> {
    const { scene, width, height } = request
    const seed = scene.seed ?? 1
    const input = renderInput(request)
    await upload(`${request.upload}-input`, input)
    const gpu = renderer.gpu
    const start = performance.now()
    const frame = uploadLinear(gpu, input, width, height)
    const program = gpu.program(buildOutputShader([PRINT_SCREEN_FILTER as unknown as OutputFilter]))
    const out = gpu.acquire(width, height, 'rgba8')
    for (const strength of request.strengths) {
      gpu.draw(program, out, {
        textures: { uSrc: frame },
        uniforms: { uTileOrigin: [0, 0], uFactor: 1, uApron: 0, uSeed: seed, uDither: request.dither, ...printScreenUniforms(strength, { width, height, seed }) },
      })
      await upload(`${request.upload}-${strength}`, gpu.readPixels(out))
    }
    const ms = performance.now() - start
    gpu.release(out)
    gpu.release(frame)
    return { ms }
  },

  /** Times the output pass at full strength with no filter, with Grain and with the print screen, at each size. */
  async time(request: TimeRequest): Promise<PassTime[]> {
    const gpu = renderer.gpu
    const seed = request.scene.seed ?? 1
    const stages = { none: null, grain: GRAIN_FILTER, print: PRINT_SCREEN_FILTER as unknown as OutputFilter } as const
    const results: PassTime[] = []
    for (const { width, height } of request.sizes) {
      const frame = uploadLinear(gpu, renderInput({ scene: request.scene, width, height }), width, height)
      const out = gpu.acquire(width, height, 'rgba8')
      for (const [name, stage] of Object.entries(stages) as [PassTime['stage'], OutputFilter | null][]) {
        const program = gpu.program(buildOutputShader(stage ? [stage] : []))
        const options = {
          textures: { uSrc: frame },
          uniforms: { uTileOrigin: [0, 0], uFactor: 1, uApron: 0, uSeed: seed, uDither: true, ...(stage ? stage.uniforms(1, { width, height, seed }) : {}) },
        }
        gpu.draw(program, out, options)
        gpu.readPixels(out, 0, 0, 1, 1)
        const gpuTimes: number[] = []
        const wallTimes: number[] = []
        for (let r = 0; r < request.repeats; r++) {
          const start = performance.now()
          const timer = gpu.beginTimer()
          gpu.draw(program, out, options)
          gpu.endTimer(timer)
          gpu.readPixels(out, 0, 0, 1, 1)
          wallTimes.push(performance.now() - start)
          if (!timer) continue
          const deadline = performance.now() + 2000
          let ms = gpu.timerMs(timer)
          while (ms === undefined && performance.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 5))
            ms = gpu.timerMs(timer)
          }
          if (typeof ms === 'number') gpuTimes.push(ms)
        }
        results.push({ width, height, stage: name, gpuMs: gpuTimes.length ? median(gpuTimes) : null, wallMs: median(wallTimes) })
      }
      gpu.release(out)
      gpu.release(frame)
    }
    return results
  },
}

declare global {
  interface Window {
    screenHarness: typeof api
  }
}

await loadRecipes()
window.screenHarness = api
document.documentElement.dataset.screen = 'ready'
