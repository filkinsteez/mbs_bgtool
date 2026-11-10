import type { Gpu, Target } from '../engine/gl'
import { lensSpread, levelSigma } from '../engine/lens'
import { toneCurve } from '../engine/output'
import { runPostPasses } from '../engine/passes'
import { NO_PROFILE } from '../engine/profile'
import { buildRecipeShader } from '../engine/recipeShader'
import { lightnessOnlyParams } from '../recipes/sunset/merged'
import { isRecipeId, type ColorMixSettings, type LensSettings, type RecipeContext, type RecipeId, type RecipeProgram, type Scene, type UniformMap } from '../scene'
import { defaultMix, mixFromShares, type ColorMix } from './mix'
import { getPack, isPackId, type ColorPack, type PackId } from './packs'
import { COLOR_STAGE_GLSL } from './stageGlsl'
import { blurGrid, buildFields, COVERAGE_SPLIT, GRID_SHORT, gridSize, lightSlope, lookParts, VISIBLE, type StageField, type StageGrid } from './stageFields'
import { assignFields, colorFields, coloredByParts, farPairs, KIND_TO_NEIGHBOR, softFields, solveWeights, stageColors, STAGE_SHARPNESS, type StageColor } from './stageSolve'

/**
 * The pack every design is drawn in while the color stage is on, so one mood, seed, drag and format give one
 * lightness layout whatever the pack and mix; the stage then gives it the picked pack's colors at that lightness.
 * Atmospheric's designs have Meta Blue's range over much of the frame (deep darks, mid skies, a bright Ice glow), so
 * Meta Blue stays a saturated blue where it leads; Bold's are bright almost everywhere.
 */
export const COLOR_DESIGN_PACK: PackId = 'atmospheric'

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
  /** The scene's lens, so the stage reads the light as the picture shows it, after the lens's spread. */
  lens?: LensSettings
}

interface Design {
  grid: StageGrid
  fields: StageField[]
}

interface Solved {
  colors: StageColor[]
  assignment: number[]
  /**
   * Each color's field on the stage grid, what the shader reads (in a look colored by its parts, its soft share, then
   * the light as the picture shows it).
   */
  values: Float32Array[]
  /** Whether the look's parts say where colors go (a narrower neutral line where far hues meet). */
  byParts: boolean
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
  const softCoverage = new Float32Array(w * h)
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
      softCoverage[i] += litShare(Math.cbrt(v)) / points
    }
  const spread = afterLens(lightness, w, h, input.lens)
  const glow = new Float32Array(w * h)
  const seen = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    glow[i] = Math.max(0, spread[i] - lightness[i])
    seen[i] = Math.cbrt(lightness[i] + glow[i])
    lightness[i] = Math.cbrt(lightness[i])
    peak[i] = Math.cbrt(peak[i])
  }
  return { width: w, height: h, lightness, coverage, softCoverage, peak, seen, glow, slope: lightSlope(seen, w, h) }
}

/**
 * How much a point of light counts as lit for a look colored by its parts: from a little under the visible lightness
 * to a little over it, so a light fading in counts in step with its light, not a grid point at a time.
 */
function litShare(lightness: number): number {
  const t = Math.min(1, Math.max(0, (lightness - (VISIBLE - LIT_SOFT)) / (2 * LIT_SOFT)))
  return t * t * (3 - 2 * t)
}

/** Half the lightness over which a point starts to count as lit (litShare). */
const LIT_SOFT = 0.05

/**
 * Each cell's luminance after the lens spreads part of the light over its levels (its bloom and the camera's glare),
 * as the picture shows it.
 */
function afterLens(luminance: Float32Array, w: number, h: number, lens: LensSettings | undefined): Float32Array {
  const spread = lens ? lensSpread(lens) : { mix: 0, factors: [] }
  const out = Float32Array.from(luminance)
  if (spread.mix > 0) {
    const levels = spread.factors.map((f, i) => ({ weight: 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2], sigma: levelSigma(i) * GRID_SHORT }))
    const total = levels.reduce((a, l) => a + l.weight, 0) || 1
    out.fill(0)
    for (const { weight, sigma } of levels) {
      if (weight <= 0) continue
      const blurred = sigma < 0.3 ? luminance : blurGrid(luminance, w, h, sigma)
      for (let i = 0; i < w * h; i++) out[i] += (spread.mix * weight * blurred[i]) / total
    }
    for (let i = 0; i < w * h; i++) out[i] += (1 - spread.mix) * luminance[i]
  }
  return out
}

function designKey(input: Pick<ColorStageInput, 'program' | 'ctx' | 'exposureScale'>): string {
  const { program, ctx } = input
  return [program.id, ctx.seed, ctx.aspect.toFixed(5), input.exposureScale, ctx.hex.join(','), JSON.stringify(ctx.params)].join('|')
}

/**
 * Whether the stage still has to read this design: false while it keeps it (the same look, seed, drag and format, as
 * when only the mix changes), so the renderer can leave out the scattered light for the design frame.
 */
export function colorStageNeedsDesign(program: RecipeProgram, ctx: RecipeContext, exposureScale: number): boolean {
  return !designs.has(designKey({ program, ctx, exposureScale }))
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
    const byParts = coloredByParts(fields)
    const colors = stageColors(pack, mix, byParts)
    const assignment = assignFields(colors, fields, input.ctx.seed)
    const values = colorFields(fields, assignment, colors)
    const own = values.map((v, k): StageField => ({ name: fields[assignment[k]]?.name ?? 'none', want: fields[assignment[k]]?.want ?? 'any', values: v }))
    const solution = solveWeights(grid, own, colors, colors.map((_, k) => k), STAGE_SHARPNESS, byParts)
    // A look colored by its parts draws the soft blend: each color's share, spread as far as the light changes, then
    // the light as the picture shows it, which its lightness masks key on.
    const soft = byParts ? softFields(grid, values, colors, solution.weights) : []
    const drawn = byParts
      ? {
          values: [
            ...Array.from({ length: 5 }, (_, k) => soft[k] ?? new Float32Array(grid.width * grid.height)),
            grid.glow ?? new Float32Array(grid.width * grid.height),
            grid.slope ?? new Float32Array(grid.width * grid.height),
            grid.seen ?? grid.lightness,
          ],
          weights: colors.map(() => 1),
        }
      : { values, weights: solution.weights }
    solved = remember(solves, solveKey, { colors, assignment, byParts, ...solution, ...drawn })
  }
  lastReport = { hexes: solved.colors.map((c) => c.hex), light: solved.light, reads: solved.reads, fields: solved.assignment.map((f) => fields[f]?.name ?? '') }
  const textures = { ...fieldTextures(input.gpu, grid, solved.values), uMixRamps: rampTexture(input.gpu, solved.colors) }
  return {
    chunk: COLOR_STAGE_GLSL,
    uniforms: stageUniforms(solved),
    textures,
    release() {
      for (const target of Object.values(textures)) input.gpu.release(target)
    },
  }
}

function stageUniforms({ colors, weights, byParts }: Solved): UniformMap {
  const color = new Float32Array(20)
  const turn = new Float32Array(20)
  const field = new Float32Array(20)
  colors.slice(0, 5).forEach((c, k) => {
    color.set([...c.unit, c.kind], 4 * k)
    const range = c.kind === KIND_TO_NEIGHBOR ? c.turn : c.fade
    turn.set([c.neighborIndex, c.edge, range[0], range[1]], 4 * k)
    field.set([k, weights[k], 0, 0], 4 * k)
  })
  return {
    uMixCount: Math.min(5, colors.length),
    uMixColor: color,
    uMixTurn: turn,
    uMixField: field,
    uMixFar: farPairs(colors.slice(0, 5)),
    uMixSharp: byParts ? 1 : STAGE_SHARPNESS,
    uMixBridge: 1,
    uMixNarrow: byParts ? 1 : 0,
    uMixSoft: byParts ? 1 : 0,
  }
}

/** Steps in a color's ramp, evenly spaced in the cube root of luminance from black to white. */
export const RAMP_STEPS = 32

/**
 * How the engine draws a light of the color `unit` from dim to bright: for each step's luminance (cube-root spaced from
 * 0 to 1), the color the tone curve shows for that light at that luminance, scaled to luminance 1. Meta Blue runs
 * navy, Meta Blue, a lighter blue, white; the last step is white.
 */
export function colorRamp(unit: readonly number[]): Float32Array {
  const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  const shown: { y: number; rgb: [number, number, number] }[] = []
  for (let s = 0; s <= 160; s++) {
    const rgb = toneCurve(unit.map((v) => v * 1e-3 * 2 ** (s / 8)))
    shown.push({ y: luma(rgb), rgb })
  }
  const out = new Float32Array(RAMP_STEPS * 3)
  for (let j = 0; j < RAMP_STEPS; j++) {
    const y = (j / (RAMP_STEPS - 1)) ** 3
    let rgb: readonly number[] = [1, 1, 1]
    const at = shown.findIndex((d) => d.y >= y)
    if (at === 0) rgb = shown[0].rgb
    else if (at > 0) {
      const a = shown[at - 1]
      const b = shown[at]
      const t = (y - a.y) / Math.max(b.y - a.y, 1e-9)
      rgb = a.rgb.map((v, i) => v + t * (b.rgb[i] - v))
    }
    const l = Math.max(luma(rgb), 1e-9)
    out.set(rgb.map((v) => v / l), 3 * j)
  }
  return out
}

/** Every color's ramp as one texture: a row per color, a column per step. */
function rampTexture(gpu: Gpu, colors: readonly StageColor[]): Target {
  const gl = gpu.gl
  const data = new Float32Array(RAMP_STEPS * 5 * 4)
  colors.slice(0, 5).forEach((c, k) => {
    const ramp = colorRamp(c.unit)
    for (let j = 0; j < RAMP_STEPS; j++) data.set([ramp[3 * j], ramp[3 * j + 1], ramp[3 * j + 2], 1], 4 * (k * RAMP_STEPS + j))
  })
  const target = gpu.acquire(RAMP_STEPS, 5)
  gl.bindTexture(gl.TEXTURE_2D, target.texture)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, RAMP_STEPS, 5, gl.RGBA, gl.FLOAT, data)
  gl.bindTexture(gl.TEXTURE_2D, null)
  return target
}

/**
 * Each color's field as two four-channel textures on the stage grid (colors 0-3, then 4 and, in a look colored by
 * its parts, the lens's glow, the light's slope and the light as the picture shows it), row 0 at the top like a render.
 */
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
