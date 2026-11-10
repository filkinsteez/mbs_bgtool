import type { Gpu, Target } from '../engine/gl'
import { runPostPasses } from '../engine/passes'
import { NO_PROFILE } from '../engine/profile'
import { buildRecipeShader } from '../engine/recipeShader'
import { isRecipeId, type ColorMixSettings, type RecipeContext, type RecipeProgram, type Scene, type UniformMap } from '../scene'
import { defaultMix, mixFromShares, type ColorMix } from './mix'
import { getPack, isPackId, type ColorPack, type PackId } from './packs'
import { COLOR_STAGE_GLSL } from './stageGlsl'
import { buildFields, gridSize, lookParts, type StageField, type StageGrid } from './stageFields'
import { assignFields, farPairs, solveWeights, stageColors, STAGE_SHARPNESS } from './stageSolve'

/**
 * The pack every design is drawn in while the color stage is on, so one mood, seed, drag and format give one
 * lightness layout whatever the pack and mix; the stage then gives it the picked pack's colors. Atmospheric's designs
 * have deep darks and mid-bright light, where Meta Blue can stay saturated; Bold's are bright almost everywhere,
 * which only a pale Meta Blue can match.
 */
export const COLOR_DESIGN_PACK: PackId = 'atmospheric'

/**
 * Turns the shared color stage on for a scene. Build `scene` from COLOR_DESIGN_PACK (the design); `pack` and `mix`
 * are what the user picked. Without this the scene draws exactly as before.
 */
export function withColorMix(scene: Scene, pack: ColorPack, mix: ColorMix): Scene {
  return { ...scene, colorMix: { pack: pack.id, shares: [...mix.shares] } }
}

/** What the renderer adds to a scene's recipe shaders and draws while the stage is on. */
export interface PreparedColorStage {
  chunk: string
  uniforms: UniformMap
  textures: Record<string, Target>
  release(): void
}

export interface ColorStageInput {
  gpu: Gpu
  program: RecipeProgram
  ctx: RecipeContext
  settings: ColorMixSettings
  /** The renderer's engine uniforms for a draw of this size. */
  engine: (width: number, height: number, origin: number[], pixel: number, subsamples: number) => UniformMap
  scatterUniforms: UniformMap
  scatterTextures: Record<string, Target>
  exposureScale: number
}

interface Design {
  grid: StageGrid
  fields: StageField[]
}

const designs = new Map<string, Design>()
const KEEP = 8

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > KEEP) cache.delete(cache.keys().next().value as string)
  return value
}

/** The design's light before the lens on the stage grid (16 samples a cell, post passes included), or null while compiling. */
function readDesign(input: ColorStageInput): StageGrid | null {
  const { gpu, program, ctx } = input
  const [w, h] = gridSize(ctx.aspect)
  const raw = gpu.acquire(w, h)
  gpu.draw(gpu.program(buildRecipeShader(program, 'radiance')), raw, {
    uniforms: { ...input.engine(w, h, [0, 0], 1 / (Math.min(w, h) * 4), 4), ...input.scatterUniforms },
    textures: input.scatterTextures,
  })
  let light = raw
  if (program.post?.length) {
    light = runPostPasses(gpu, raw, program.post, ctx, NO_PROFILE)
    if (light !== raw) gpu.release(raw)
  }
  if (gpu.waiting) {
    gpu.release(light)
    return null
  }
  const data = gpu.readFloatPixels(light)
  gpu.release(light)
  const lightness = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const y = (0.2126 * data[4 * i] + 0.7152 * data[4 * i + 1] + 0.0722 * data[4 * i + 2]) * input.exposureScale
    lightness[i] = y > 0 && Number.isFinite(y) ? Math.cbrt(y) : 0
  }
  return { width: w, height: h, lightness }
}

function designKey(input: ColorStageInput): string {
  const { program, ctx } = input
  return [program.id, ctx.seed, ctx.aspect.toFixed(5), input.exposureScale, ctx.hex.join(','), JSON.stringify(ctx.params)].join('|')
}

/** The stage for one render: reads the design once per seed, drag and format, solves the weights for the mix. */
export function prepareColorStage(input: ColorStageInput): PreparedColorStage | null {
  const key = designKey(input)
  let design = designs.get(key)
  if (!design) {
    const grid = readDesign(input)
    if (!grid) return null
    const recipe = isRecipeId(input.program.id) ? input.program.id : 'contour.rim'
    const parts = isRecipeId(input.program.id) ? lookParts(recipe, input.ctx.params, input.ctx.aspect) : []
    design = remember(designs, key, { grid, fields: buildFields(recipe, parts, grid, input.ctx.seed, input.ctx.aspect) })
  }
  const pack = getPack(isPackId(input.settings.pack) ? input.settings.pack : COLOR_DESIGN_PACK)
  const mix = mixFromShares(pack, input.settings.shares) ?? defaultMix(pack)
  const colors = stageColors(pack, mix)
  const assignment = assignFields(colors, design.fields, input.ctx.seed)
  const { weights } = solveWeights(design.grid, design.fields, colors, assignment)
  return {
    chunk: COLOR_STAGE_GLSL,
    uniforms: stageUniforms(colors, assignment, weights),
    textures: fieldTextures(input.gpu, design),
    release() {
      for (const target of Object.values(this.textures)) input.gpu.release(target)
    },
  }
}

function stageUniforms(colors: ReturnType<typeof stageColors>, assignment: readonly number[], weights: readonly number[]): UniformMap {
  const color = new Float32Array(20)
  const neighbor = new Float32Array(20)
  const field = new Float32Array(20)
  const upper = new Float32Array(20)
  colors.slice(0, 5).forEach((c, k) => {
    color.set([...c.unit, c.kind], 4 * k)
    neighbor.set([...c.neighbor, c.edge], 4 * k)
    field.set([assignment[k], weights[k], c.turn[0], c.turn[1]], 4 * k)
    upper.set([...c.upper, c.upperFrom], 4 * k)
  })
  return {
    uMixCount: Math.min(5, colors.length),
    uMixColor: color,
    uMixNeighbor: neighbor,
    uMixField: field,
    uMixUpper: upper,
    uMixFar: farPairs(colors.slice(0, 5)),
    uMixSharp: STAGE_SHARPNESS,
    uMixBridge: 1,
    uMixLift: 0.05,
  }
}

/**
 * The fields (0..1) as two 8-bit four-channel textures on the stage grid (fields 0-3 and 4-7), row 0 at the top.
 * Stored as square roots for precision near 0; the GLSL squares them back.
 */
function fieldTextures(gpu: Gpu, design: Design): Record<string, Target> {
  const { width: w, height: h } = design.grid
  const gl = gpu.gl
  const out: Record<string, Target> = {}
  for (const [t, name] of ['uMixFieldsA', 'uMixFieldsB'].entries()) {
    const data = new Uint8Array(w * h * 4)
    for (let c = 0; c < 4; c++) {
      const values = design.fields[4 * t + c]?.values
      if (!values) continue
      for (let i = 0; i < w * h; i++) data[4 * i + c] = Math.round(Math.sqrt(Math.min(1, Math.max(0, values[i]))) * 255)
    }
    const target = gpu.acquire(w, h, 'rgba8')
    gl.bindTexture(gl.TEXTURE_2D, target.texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data)
    gl.bindTexture(gl.TEXTURE_2D, null)
    out[name] = target
  }
  return out
}
