/// <reference types="vite/client" />
// Runs the engine's output pass with the print screen stage (../stage.mjs) on a frame the engine renders without
// filters and without dither, decoded to display-linear floats, as the Pixel prototype does. The stage is not
// registered in the engine; the page builds the output shader with it directly. Driven by ../gpu-check.mjs.
import { getPack, type PackId } from '../../../src/light/color/packs'
import { srgbToLinear } from '../../../src/light/color/srgb'
import { composeScene } from '../../../src/light/compose'
import type { OutputFilter } from '../../../src/light/engine/filters/types'
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

const api = {
  compose(recipeId: RecipeId, packId: PackId, controls: ControlValues, seed: number, aspect: number): Scene | null {
    const recipe = recipes.get(recipeId)
    return recipe ? composeScene(recipe, { pack: getPack(packId), controls, seed, aspect }) : null
  },

  async render(request: ScreenRequest): Promise<{ ms: number }> {
    const { scene, width, height } = request
    if (!isRecipeId(scene.recipe)) throw new Error(`Unknown recipe ${scene.recipe}`)
    const recipe = recipes.get(scene.recipe)
    if (!recipe) throw new Error(`${scene.recipe} did not load`)
    const seed = scene.seed ?? 1
    const plain = { ...scene, output: { ...scene.output, grain: 0, ascii: 0, pixel: 0 } }
    renderer.renderProgram(recipe, plain, { width, height, supersample: 2, dither: false })
    const input = renderer.readPixels()
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
}

declare global {
  interface Window {
    screenHarness: typeof api
  }
}

await loadRecipes()
window.screenHarness = api
document.documentElement.dataset.screen = 'ready'
