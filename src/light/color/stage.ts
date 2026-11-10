import type { Gpu, Target } from '../engine/gl'
import { runPostPasses } from '../engine/passes'
import { NO_PROFILE } from '../engine/profile'
import { buildRecipeShader } from '../engine/recipeShader'
import { lightnessOnlyParams } from '../recipes/sunset/merged'
import { isRecipeId, type ColorMixSettings, type RecipeContext, type RecipeId, type RecipeProgram, type Scene, type UniformMap } from '../scene'
import { defaultMix, mixFromShares, type ColorMix } from './mix'
import { getPack, isPackId, type ColorPack, type PackId } from './packs'
import { COLOR_STAGE_GLSL } from './stageGlsl'
import { buildFields, COVERAGE_SPLIT, gridSize, lookParts, VISIBLE, type StageField, type StageGrid } from './stageFields'
import { assignFields, colorFields, farPairs, solveWeights, stageColors, STAGE_SHARPNESS, type StageColor } from './stageSolve'

/**
 * The pack every design is drawn in while the color stage is on, so one mood, seed, drag and format give one
 * lightness layout whatever the pack and mix; the stage then gives it the picked pack's colors.
 */
export const COLOR_DESIGN_PACK: PackId = 'bold'

/**
 * Turns the shared color stage on for a scene. Build `scene` from COLOR_DESIGN_PACK (the design); `pack` and `mix`
 * are what the user picked. A look that renders its own design lightness (LIGHTNESS_ONLY) draws that instead. Without
 * this the scene draws exactly as before.
 */
export function withColorMix(scene: Scene, pack: ColorPack, mix: ColorMix): Scene {
  const ownLightness = LIGHTNESS_ONLY[scene.recipe]
  return { ...scene, ...(ownLightness ? { params: ownLightness(scene.params) } : {}), colorMix: { pack: pack.id, shares: [...mix.shares] } }
}

/** Looks that render their design lightness alone (grey) for the stage, in place of a design drawn in a pack. */
const LIGHTNESS_ONLY: Partial<Record<RecipeId, (params: Scene['params']) => Scene['params']>> = {
  'sunset.merged': lightnessOnlyParams,
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

interface Solved {
  colors: StageColor[]
  assignment: number[]
  /** Each color's field on the stage grid (`colorFields`), what the shader reads. */
  values: Float32Array[]
  weights: number[]
  light: number[]
  reads: number[]
}

/**
 * The last solve, for checks: each color on, its share of the light its field leads, its share of the light that
 * reads as it, and the field it leads.
 */
export interface ColorStageReport {
  hexes: string[]
  light: number[]
  reads: number[]
  fields: string[]
}

const KEEP = 8
const designs = new Map<string, Design>()
const solves = new Map<string, Solved>()
let lastReport: ColorStageReport | null = null

export function colorStageReport(): ColorStageReport | null {
  return lastReport
}

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > KEEP) cache.delete(cache.keys().next().value as string)
  return value
}

/** The design's light before the lens on the stage grid (post passes included), or null while compiling. */
function readDesign(input: ColorStageInput): StageGrid | null {
  const { gpu, program, ctx } = input
  const [w, h] = gridSize(ctx.aspect)
  const pw = w * COVERAGE_SPLIT
  const ph = h * COVERAGE_SPLIT
  const raw = gpu.acquire(pw, ph)
  gpu.draw(gpu.program(buildRecipeShader(program, 'radiance')), raw, {
    uniforms: { ...input.engine(pw, ph, [0, 0], 1 / (Math.min(pw, ph) * 2), 2), ...input.scatterUniforms },
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
  const coverage = new Float32Array(w * h)
  const peak = new Float32Array(w * h)
  const points = COVERAGE_SPLIT * COVERAGE_SPLIT
  for (let py = 0; py < ph; py++)
    for (let px = 0; px < pw; px++) {
      const q = 4 * (py * pw + px)
      const v = (0.2126 * data[q] + 0.7152 * data[q + 1] + 0.0722 * data[q + 2]) * input.exposureScale
      if (!(v > 0) || !Number.isFinite(v)) continue
      const i = Math.floor(py / COVERAGE_SPLIT) * w + Math.floor(px / COVERAGE_SPLIT)
      lightness[i] += v / points
      peak[i] = Math.max(peak[i], v)
      if (Math.cbrt(v) >= VISIBLE) coverage[i] += 1 / points
    }
  for (let i = 0; i < w * h; i++) {
    lightness[i] = Math.cbrt(lightness[i])
    peak[i] = Math.cbrt(peak[i])
  }
  return { width: w, height: h, lightness, coverage, peak }
}

function designKey(input: ColorStageInput): string {
  const { program, ctx } = input
  return [program.id, ctx.seed, ctx.aspect.toFixed(5), input.exposureScale, ctx.hex.join(','), JSON.stringify(ctx.params)].join('|')
}

/** The stage for one render: reads the design once per seed, drag and format, and solves the weights once per mix. */
export function prepareColorStage(input: ColorStageInput): PreparedColorStage | null {
  const key = designKey(input)
  let design = designs.get(key)
  if (!design) {
    const grid = readDesign(input)
    if (!grid) return null
    const id = input.program.id
    const recipe = isRecipeId(id) ? id : 'contour.rim'
    const parts = isRecipeId(id) ? lookParts(id, input.ctx.params, input.ctx.aspect) : []
    design = remember(designs, key, { grid, fields: buildFields(recipe, parts, grid, input.ctx.seed, input.ctx.aspect) })
  }
  const pack = getPack(isPackId(input.settings.pack) ? input.settings.pack : COLOR_DESIGN_PACK)
  const mix = mixFromShares(pack, input.settings.shares) ?? defaultMix(pack)
  const solveKey = `${key}|${pack.id}|${mix.shares.join(',')}`
  const { fields, grid } = design
  let solved = solves.get(solveKey)
  if (!solved) {
    const colors = stageColors(pack, mix)
    const assignment = assignFields(colors, fields, input.ctx.seed)
    const values = colorFields(fields, assignment, colors)
    const own = values.map((v, k): StageField => ({ ...fields[assignment[k]], values: v }))
    solved = remember(solves, solveKey, { colors, assignment, values, ...solveWeights(grid, own, colors, colors.map((_, k) => k)) })
  }
  lastReport = { hexes: solved.colors.map((c) => c.hex), light: solved.light, reads: solved.reads, fields: solved.assignment.map((f) => fields[f]?.name ?? '') }
  const textures = fieldTextures(input.gpu, grid, solved.values)
  return {
    chunk: COLOR_STAGE_GLSL,
    uniforms: { ...stageUniforms(solved), uMixKeepLuminance: input.ctx.params.lightnessOnly === true ? 1 : 0 },
    textures,
    release() {
      for (const target of Object.values(textures)) input.gpu.release(target)
    },
  }
}

function stageUniforms({ colors, weights }: Solved): UniformMap {
  const color = new Float32Array(20)
  const neighbor = new Float32Array(20)
  const upper = new Float32Array(20)
  const field = new Float32Array(20)
  colors.slice(0, 5).forEach((c, k) => {
    color.set([...c.unit, c.kind], 4 * k)
    neighbor.set([...c.neighbor, c.edge], 4 * k)
    upper.set([...c.upper, c.upperFrom], 4 * k)
    field.set([k, weights[k], c.turn[0], c.turn[1]], 4 * k)
  })
  return {
    uMixCount: Math.min(5, colors.length),
    uMixColor: color,
    uMixNeighbor: neighbor,
    uMixUpper: upper,
    uMixField: field,
    uMixFar: farPairs(colors.slice(0, 5)),
    uMixSharp: STAGE_SHARPNESS,
    uMixBridge: 1,
    uMixLift: 0.05,
    uMixDip: 0.85,
  }
}

/** Each color's field as two four-channel textures on the stage grid (colors 0-3 and 4), row 0 at the top like a render. */
function fieldTextures(gpu: Gpu, grid: StageGrid, fields: readonly Float32Array[]): Record<string, Target> {
  const { width: w, height: h } = grid
  const gl = gpu.gl
  const out: Record<string, Target> = {}
  for (const [t, name] of ['uMixFieldsA', 'uMixFieldsB'].entries()) {
    const data = new Float32Array(w * h * 4)
    for (let c = 0; c < 4; c++) {
      const values = fields[4 * t + c]
      if (!values) continue
      for (let i = 0; i < w * h; i++) data[4 * i + c] = values[i]
    }
    const target = gpu.acquire(w, h)
    gl.bindTexture(gl.TEXTURE_2D, target.texture)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data)
    gl.bindTexture(gl.TEXTURE_2D, null)
    out[name] = target
  }
  return out
}
