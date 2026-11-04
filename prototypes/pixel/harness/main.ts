/// <reference types="vite/client" />
// Runs the engine's output pass with the Pixel stage on a frame the engine renders, before the renderer calls the
// filter chain itself. The frame is rendered without filters and without dither and decoded to display-linear
// floats. The Pixel frame source (2 x 2 texels a cell) comes from that frame or, as in the renderer's filter chain,
// from a small render of its own; then the real output shader runs at strengths of choice. Driven by
// prototypes/pixel/gpu.mjs and scale.mjs.
import { getPack, type PackId } from '../../../src/light/color/packs'
import { srgbToLinear } from '../../../src/light/color/srgb'
import { composeScene } from '../../../src/light/compose'
import { PIXEL_FILTER } from '../../../src/light/engine/filters/pixel'
import { buildOutputShader } from '../../../src/light/engine/output'
import { AREA_RESAMPLE_SHADER } from '../../../src/light/engine/passes'
import { ProgramRenderer } from '../../../src/light/engine/programRenderer'
import { isRecipeId, RECIPE_IDS, type ControlValues, type RecipeDefinition, type RecipeId, type Scene } from '../../../src/light/scene'

const RECIPE_FILES = import.meta.glob(['../../../src/light/recipes/*/*.ts', '!../../../src/light/recipes/**/*.test.ts'])
const recipes = new Map<RecipeId, RecipeDefinition>()

async function loadRecipes(): Promise<void> {
  await Promise.all(
    RECIPE_IDS.map(async (id) => {
      const [mood, name] = id.split('.')
      const load = RECIPE_FILES[`../../../src/light/recipes/${mood}/${name}.ts`]
      if (!load) return
      // A recipe that is broken mid-edit only drops its own look.
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

export interface PixelRequest {
  scene: Scene & { recipe: string }
  width: number
  height: number
  strengths: number[]
  /** Uploads go to `<upload>-input` and `<upload>-<strength>`. */
  upload: string
  /**
   * 'frame' averages the output-size frame into the source (8 x 8 taps a texel). 'small' does what the renderer's
   * filter chain does: draws the frame once at 4 x 4 pixels a source texel, one sample a pixel, and averages that.
   */
  source?: 'frame' | 'small'
}

/** Display-linear floats of 8-bit sRGB bytes, uploaded to a new float target. */
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

const api = {
  /** The tool's scene for a look, or null when the look did not load. */
  compose(recipeId: RecipeId, packId: PackId, controls: ControlValues, seed: number, aspect: number): Scene | null {
    const recipe = recipes.get(recipeId)
    return recipe ? composeScene(recipe, { pack: getPack(packId), controls, seed, aspect }) : null
  },

  async render(request: PixelRequest): Promise<{ ms: number }> {
    const { scene, width, height } = request
    if (!isRecipeId(scene.recipe)) throw new Error(`Unknown recipe ${scene.recipe}`)
    const recipe = recipes.get(scene.recipe)
    if (!recipe) throw new Error(`${scene.recipe} did not load`)
    const seed = scene.seed ?? 1
    const plain = { ...scene, output: { ...scene.output, grain: 0, ascii: 0, pixel: 0 } }
    const filterFrame = { width, height, seed }
    const size = PIXEL_FILTER.source!.size(filterFrame)
    const gpu = renderer.gpu
    let small: ReturnType<typeof uploadLinear> | null = null
    if (request.source === 'small') {
      renderer.renderProgram(recipe, plain, { width: size.width * 4, height: size.height * 4, supersample: 1, dither: false })
      small = uploadLinear(gpu, renderer.readPixels(), size.width * 4, size.height * 4)
    }
    renderer.renderProgram(recipe, plain, { width, height, supersample: 2, dither: false })
    const input = renderer.readPixels()
    await upload(`${request.upload}-input`, input)

    const start = performance.now()
    const frame = uploadLinear(gpu, input, width, height)
    const source = gpu.acquire(size.width, size.height)
    gpu.draw(gpu.program(AREA_RESAMPLE_SHADER), source, {
      textures: { uSrc: small ?? frame },
      uniforms: { uDstSize: [size.width, size.height], uTaps: small ? 4 : 8 },
    })
    if (small) gpu.release(small)
    const program = gpu.program(buildOutputShader([PIXEL_FILTER]))
    const out = gpu.acquire(width, height, 'rgba8')
    for (const strength of request.strengths) {
      gpu.draw(program, out, {
        textures: { uSrc: frame, uPixelSource: source },
        uniforms: { uTileOrigin: [0, 0], uFactor: 1, uApron: 0, uSeed: seed, uDither: true, ...PIXEL_FILTER.uniforms(strength, filterFrame) },
      })
      await upload(`${request.upload}-${strength}`, gpu.readPixels(out))
    }
    const ms = performance.now() - start
    gpu.release(out)
    gpu.release(source)
    gpu.release(frame)
    return { ms }
  },
}

declare global {
  interface Window {
    pixelHarness: typeof api
  }
}

await loadRecipes()
window.pixelHarness = api
document.documentElement.dataset.pixel = 'ready'
