import { dimPathColor, type DimPoint } from '../engine/dimPath'
import type { Gpu, Target } from '../engine/gl'
import { glowDimUniforms, lensSpread, levelSigma } from '../engine/lens'
import { MEET_BRIDGE_MOST, MEET_BRIDGE_PRESENT, MEET_BRIDGE_TO } from '../engine/meet'
import { toneCurve } from '../engine/output'
import { runPostPasses } from '../engine/passes'
import { NO_PROFILE } from '../engine/profile'
import { buildRecipeShader } from '../engine/recipeShader'
import { lightnessOnlyParams } from '../recipes/sunset/merged'
import { isRecipeId, type ColorMixSettings, type LensSettings, type RecipeContext, type RecipeId, type RecipeProgram, type Scene, type UniformMap } from '../scene'
import { defaultMix, META_BLUE_HEX, mixFromShares, type ColorMix } from './mix'
import { oklchToLinear } from './oklab'
import { getPack, isPackId, type ColorPack, type PackId } from './packs'
import { COLOR_STAGE_GLSL } from './stageGlsl'
import { blurGrid, buildFields, COVERAGE_SPLIT, GRID_SHORT, gridSize, lightSlope, lookParts, makeNoise, mulberry32, VISIBLE, type StageField, type StageGrid } from './stageFields'
import { assignFields, colorFields, coloredByParts, farPairs, guardedParts, KIND_DARK, KIND_TO_NEIGHBOR, lightPartHolds, neighbourPairs, softFields, solveWeights, stageColors, stageDimPaths, STAGE_SHARPNESS, type StageColor } from './stageSolve'

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
  /** Where two of this pack's far hues meet, the spill whose light rises (meetingLines); 0 elsewhere. */
  bridge: Float32Array
  /** Where a light color meets a dark color far from it in hue, the line that dims (darkMeetingLines); 0 elsewhere. */
  darkBridge: Float32Array
  /** Where a bright meeting's light lifts to at least the lighter color's (meetingLift); 0 elsewhere. */
  lift: Float32Array
}

/**
 * How fast two colors' shares must trade places (per short side) for their meeting to count as a line: from the first
 * (none) to the second (all). A soft hand-over over the stage's blur is 14 to 28; two colors sharing a broad area
 * change far slower, so no broad area brightens.
 */
const LINE_SLOPE = [4, 8] as const

/**
 * A meeting counts as a line only between two areas: LINE_REACH (short sides) to either side of it, across it, each
 * color must lead the other by the first value (none) to the second (all). A streak of one color thinner than about
 * twice LINE_REACH fails on its far side, so it keeps its own color instead of turning white along its middle.
 */
const LINE_REACH = 0.06
const LINE_HOLD = [0.2, 0.5] as const

/**
 * How far the spill reaches into the two colors' hand-over: how evenly a cell splits between them (4 sa sc / (sa + sc)²,
 * 1 where they are equal) to this power, times 1 to 1 + SPILL_NARROWS as it drifts along the meeting.
 */
const SPILL_OVERLAP = 0.75
const SPILL_NARROWS = 2
/** How much of the spill drops away on the lighter color's own side of a meeting. */
const SPILL_LIGHT_SIDE = 0.8
/**
 * The light's change per grid cell (grid.slope) over which a falloff already separates the two colors, as round a
 * blob's own edge: there the spill goes from all of it to SPILL_ON_FALLOFF of it.
 */
const SPILL_FALLOFF = [0.015, 0.05] as const
const SPILL_ON_FALLOFF = 0.6
/** How much the spill's strength drifts along a meeting (1 down to 1 - SPILL_DRIFT), per SPILL_DRIFT_SIZE short sides. */
const SPILL_DRIFT = 0.25
const SPILL_DRIFT_SIZE = 0.25
/**
 * The spill's blur, in grid cells (a Gaussian's sigma), so its light fades into both sides of the meeting, and the gain
 * after it, so a wide meeting keeps its full spill while a narrow one gets less.
 */
const SPILL_SOFT = 1.5
const SPILL_GAIN = 2

/**
 * Where two of the pack's light colors far apart in hue (farPairs, not the dark colors) meet in a look colored by its
 * parts, the light spills across the meeting (owner, 2026-11-10: the meeting reads lighter instead of grey, by an
 * amount that may differ by pack; coordinator 11:24 PM: light spilling across a meeting, not an outline round a shape).
 * The spill follows the two colors' hand-over (SPILL_OVERLAP), only where their shares trade places quickly (LINE_SLOPE)
 * and each holds its own side (LINE_REACH); the strongest of every pair, per grid cell. It lies mostly over the darker
 * color (SPILL_LIGHT_SIDE), so the lighter shape keeps its color up to the meeting and its light fades out over its
 * neighbor; it is weaker where the light's own falloff already separates the colors (SPILL_FALLOFF); its reach and
 * strength drift along the meeting (seeded by the design, so every pack drifts alike); and it is blurred (SPILL_SOFT),
 * so it never makes an even ring round a shape. The light rises with it in the shader; elsewhere the design's light
 * stays.
 */
/** The spill's drift for a design seed: its reach into the hand-over per cell, and the noise that weakens it. */
function spillDrift(grid: StageGrid, seed: number): { power: Float32Array; weakens: (x: number, y: number) => number } {
  const { width: w, height: h } = grid
  // makeNoise has a bump every 0.6 of its units, so the frame is scaled to put one every SPILL_DRIFT_SIZE short sides.
  const scale = 0.6 / SPILL_DRIFT_SIZE / Math.min(w, h)
  const rng = mulberry32(Math.imul(seed, 7919) + 11)
  const narrows = makeNoise(rng, w * scale, h * scale)
  const weakens = makeNoise(rng, w * scale, h * scale)
  const power = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) power[y * w + x] = SPILL_OVERLAP * (1 + SPILL_NARROWS * (0.5 + 0.5 * narrows((x + 0.5) * scale, (y + 0.5) * scale)))
  return { power, weakens: (x, y) => weakens((x + 0.5) * scale, (y + 0.5) * scale) }
}

export function meetingLines(grid: StageGrid, shares: readonly Float32Array[], colors: readonly StageColor[], seed = 1): Float32Array {
  const { width: w, height: h } = grid
  const { power, weakens } = spillDrift(grid, seed)
  const out = farMeetings(grid, shares, colors, (a, c) => colors[a].kind !== KIND_DARK && colors[c].kind !== KIND_DARK, power, (a, c, lead) => {
    // The lighter color's light spills over the darker one: on the lighter color's own side the spill drops away, so
    // the lighter shape keeps its color up to the meeting and its light fades out over its neighbor.
    const lighterLeads = colors[a].lightness >= colors[c].lightness ? lead : -lead
    return 1 - SPILL_LIGHT_SIDE * smoothRange(lighterLeads, [0, 0.5])
  })
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (out[i] <= 0) continue
      const falloff = smoothRange(grid.slope?.[i] ?? 0, SPILL_FALLOFF)
      const along = 1 - SPILL_DRIFT * (0.5 - 0.5 * weakens(x, y))
      out[i] *= (1 - (1 - SPILL_ON_FALLOFF) * falloff) * along
    }
  return blurGrid(out, w, h, SPILL_SOFT).map((v) => Math.min(1, SPILL_GAIN * v))
}

/**
 * In bright light a meeting of two far-apart light colors is at least as light as the lighter color (coordinator,
 * 2026-11-11 12:05 AM), so it reads as light and not as pale grey: per grid cell, the share of the rise
 * (meetBridgeLight) that takes the middle's light up to the light LINE_REACH into the lighter color's side, plus
 * LIFT_MARGIN, on the spill's own hand-over and reach. The shader lifts the light by it without whitening the colors
 * further, so the meeting's colors stay as the spill makes them.
 */
export function meetingLift(grid: StageGrid, shares: readonly Float32Array[], colors: readonly StageColor[], seed = 1): Float32Array {
  const { width: w, height: h } = grid
  const { power } = spillDrift(grid, seed)
  const shown = grid.seen ?? grid.lightness
  const reach = LINE_REACH * Math.min(w, h)
  const lift = farMeetings(grid, shares, colors, (a, c) => colors[a].kind !== KIND_DARK && colors[c].kind !== KIND_DARK, power, (a, c, _lead, at) => {
    const toLighter = colors[a].lightness >= colors[c].lightness ? reach : -reach
    const middle = sampleGrid(shown, w, h, at.x, at.y)
    const lighter = sampleGrid(shown, w, h, at.x + toLighter * at.nx, at.y + toLighter * at.ny)
    const ym = middle ** 3
    const most = Math.min(Math.max(MEET_BRIDGE_TO - ym, 0), MEET_BRIDGE_MOST * ym)
    const need = most > 1e-6 ? Math.min(1, Math.max(0, (lighter + LIFT_MARGIN) ** 3 - ym) / most) : 0
    return need * smoothRange(middle, LIFT_BRIGHT)
  })
  return blurGrid(lift, w, h, LIFT_SOFT).map((v) => Math.min(1, LIFT_GAIN * v))
}

/** The light (as shown) over which a meeting counts as bright for the lift, and the lift's blur (cells) and gain. */
const LIFT_BRIGHT = [0.5, 0.65] as const
const LIFT_SOFT = 1
const LIFT_GAIN = 2.5
/** How much lighter than the lighter color's side the lifted middle aims to be (OKLab L). */
const LIFT_MARGIN = 0.06

/** A cell on a meeting and the unit direction across it, toward the first color of the pair. */
interface MeetingPoint {
  x: number
  y: number
  nx: number
  ny: number
}

/** A grid's value at a point in cells, bilinear, edges clamped. */
function sampleGrid(src: Float32Array, w: number, h: number, fx: number, fy: number): number {
  const cx = Math.min(w - 1, Math.max(0, fx))
  const cy = Math.min(h - 1, Math.max(0, fy))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const u = cx - x0
  const v = cy - y0
  return (src[y0 * w + x0] * (1 - u) + src[y0 * w + x1] * u) * (1 - v) + (src[y1 * w + x0] * (1 - u) + src[y1 * w + x1] * u) * v
}

/** How sharply a dark meeting line follows the even split of its two colors, its blur (grid cells) and its gain. */
const DARK_LINE_POWER = 1.5
const DARK_LINE_SOFT = 1
const DARK_LINE_GAIN = 1.5

/**
 * Where a light color other than Meta Blue meets a dark color far from it in hue (Lime and Plum, Tan and Plum, Tan and
 * Forest) in a look colored by its parts: a soft line along their meeting, by the same test as meetingLines (the shares
 * trade places quickly and each color holds its own side). The shader dims it as a dark bridge (meetDarkLight), so the
 * two colors meet near black instead of through a thin violet or magenta line; it never lifts the light. Meta Blue's
 * meetings with Plum and Forest keep the plain blend: dimmed, they took Plum under 5% in five more frames.
 */
export function darkMeetingLines(grid: StageGrid, shares: readonly Float32Array[], colors: readonly StageColor[]): Float32Array {
  const { width: w, height: h } = grid
  const lit = (k: number) => colors[k].kind !== KIND_DARK && colors[k].hex !== META_BLUE_HEX
  const out = farMeetings(grid, shares, colors, (a, c) => (lit(a) && colors[c].kind === KIND_DARK) || (lit(c) && colors[a].kind === KIND_DARK), new Float32Array(w * h).fill(DARK_LINE_POWER), () => 1)
  return blurGrid(out, w, h, DARK_LINE_SOFT).map((v) => Math.min(1, DARK_LINE_GAIN * v))
}

function smoothRange(v: number, [lo, hi]: readonly [number, number]): number {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}

/**
 * For every pair of the first five colors that are far apart in hue (farPairs) and that `accept` takes, where their
 * soft shares trade places quickly (LINE_SLOPE) and each holds its own side (LINE_REACH): how evenly the cell splits
 * between the two, to `power` (per cell), at the shares' presence, times `side(a, c, sa - sc)`. The strongest pair per
 * grid cell.
 */
function farMeetings(grid: StageGrid, shares: readonly Float32Array[], colors: readonly StageColor[], accept: (a: number, c: number) => boolean, power: Float32Array, side: (a: number, c: number, lead: number, at: MeetingPoint) => number): Float32Array {
  const { width: w, height: h } = grid
  const perShort = Math.min(w, h)
  const reach = LINE_REACH * perShort
  const out = new Float32Array(w * h)
  const n = Math.min(5, colors.length, shares.length)
  const far = farPairs(colors.slice(0, 5))
  for (let a = 0; a < n; a++)
    for (let c = a + 1; c < n; c++) {
      if (((far >> (a * 5 + c)) & 1) === 0 || !accept(a, c)) continue
      const sa = shares[a]
      const sc = shares[c]
      const d = (x: number, y: number) => sa[y * w + x] - sc[y * w + x]
      const dAt = (fx: number, fy: number) => {
        const cx = Math.min(w - 1, Math.max(0, fx))
        const cy = Math.min(h - 1, Math.max(0, fy))
        const x0 = Math.floor(cx)
        const y0 = Math.floor(cy)
        const x1 = Math.min(w - 1, x0 + 1)
        const y1 = Math.min(h - 1, y0 + 1)
        const u = cx - x0
        const v = cy - y0
        return (d(x0, y0) * (1 - u) + d(x1, y0) * u) * (1 - v) + (d(x0, y1) * (1 - u) + d(x1, y1) * u) * v
      }
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const x0 = Math.max(0, x - 1)
          const x1 = Math.min(w - 1, x + 1)
          const y0 = Math.max(0, y - 1)
          const y1 = Math.min(h - 1, y + 1)
          const gx = (d(x1, y) - d(x0, y)) / Math.max(x1 - x0, 1)
          const gy = (d(x, y1) - d(x, y0)) / Math.max(y1 - y0, 1)
          const g = Math.hypot(gx, gy)
          const slope = g * perShort
          const t = Math.min(1, Math.max(0, (slope - LINE_SLOPE[0]) / (LINE_SLOPE[1] - LINE_SLOPE[0])))
          if (t <= 0) continue
          const nx = gx / g
          const ny = gy / g
          const held = Math.min(dAt(x + reach * nx, y + reach * ny), -dAt(x - reach * nx, y - reach * ny))
          const i = y * w + x
          const pair = sa[i] + sc[i]
          const balance = pair > 1e-6 ? (4 * sa[i] * sc[i]) / (pair * pair) : 0
          const present = smoothRange(Math.min(sa[i], sc[i]), MEET_BRIDGE_PRESENT)
          out[i] = Math.max(out[i], balance ** power[i] * present * side(a, c, sa[i] - sc[i], { x, y, nx, ny }) * t * t * (3 - 2 * t) * smoothRange(held, LINE_HOLD))
        }
    }
  return out
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

/** Designs and solves kept: room for the preview's solves made ahead of time for every mix one slider move away. */
const KEEP = 40
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
  // Shares to nine places, so a mix that differs from one solved ahead of time only in rounding finds that solve.
  const solveKey = `${key}|${pack.id}|${mix.shares.map((share) => share.toFixed(9)).join(',')}`
  const { fields, grid } = design
  let solved = solves.get(solveKey)
  if (!solved) {
    const byParts = coloredByParts(fields)
    const colors = stageColors(pack, mix, byParts)
    const assignment = assignFields(colors, fields, input.ctx.seed)
    const values = colorFields(fields, assignment, colors, byParts ? (grid.seen ?? grid.lightness) : undefined)
    const own = values.map((v, k): StageField => ({ name: fields[assignment[k]]?.name ?? 'none', want: fields[assignment[k]]?.want ?? 'any', values: v }))
    const solution = solveWeights(grid, own, colors, colors.map((_, k) => k), STAGE_SHARPNESS, byParts)
    // A look colored by its parts draws the soft blend: each color's share, spread as far as the light changes, then
    // the light as the picture shows it, which its lightness masks key on.
    const wants = colors.map((_, k) => fields[assignment[k]]?.want)
    const soft = byParts ? softFields(grid, values, colors, solution.weights, STAGE_SHARPNESS, guardedParts(colors, wants), lightPartHolds(colors, wants)) : []
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
    const bridge = byParts ? meetingLines(grid, soft, colors, input.ctx.seed) : new Float32Array(grid.width * grid.height)
    const darkBridge = byParts ? darkMeetingLines(grid, soft, colors) : new Float32Array(grid.width * grid.height)
    const lift = byParts ? meetingLift(grid, soft, colors, input.ctx.seed) : new Float32Array(grid.width * grid.height)
    solved = remember(solves, solveKey, { colors, assignment, byParts, ...solution, ...drawn, bridge, darkBridge, lift })
  }
  lastReport = { hexes: solved.colors.map((c) => c.hex), light: solved.light, reads: solved.reads, fields: solved.assignment.map((f) => fields[f]?.name ?? '') }
  const textures = { ...fieldTextures(input.gpu, grid, solved.values), uMixRamps: rampTexture(input.gpu, solved.colors, grid, solved.bridge, solved.darkBridge, solved.lift) }
  return {
    chunk: COLOR_STAGE_GLSL,
    // The engine's glow reads the colors' dim paths with these, so a glow fades through the same colors as its light.
    uniforms: { ...stageUniforms(solved), uMixBridgeSize: [grid.width, grid.height], ...glowDimUniforms(stageDimPaths(solved.colors)) },
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
    field.set([k, weights[k], c.lightness ** 3, 0], 4 * k)
  })
  return {
    uMixCount: Math.min(5, colors.length),
    uMixColor: color,
    uMixTurn: turn,
    uMixField: field,
    uMixFar: farPairs(colors.slice(0, 5)),
    uMixNbr: neighbourPairs(colors.slice(0, 5)),
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
 * navy, Meta Blue, a lighter blue, white; the last step is white. Under the color's own luminance it follows its dim
 * path (`path`, the engine's dimPaths, for the colors that dim like fire), so Yellow turns orange and red as it dims
 * instead of mustard.
 */
export function colorRamp(unit: readonly number[], path: readonly DimPoint[] = []): Float32Array {
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
  if (path.length > 1) {
    const own = luma(oklchToLinear(path[0]))
    for (let j = 0; j < RAMP_STEPS; j++) {
      const y = (j / (RAMP_STEPS - 1)) ** 3
      if (y >= own) break
      const rgb = dimPathColor(path, y / own)
      const l = Math.max(luma(rgb), 1e-9)
      out.set(rgb.map((v) => v / l), 3 * j)
    }
  }
  return out
}

/**
 * Every color's ramp as one texture: a row per color, a column per step; below the five ramp rows, the meeting lines
 * on the stage grid (the spill in red, the dark lines in green, row 5 the grid's top row). They share the texture
 * because one more would take a look's shader past WebGL's 16 texture units.
 */
function rampTexture(gpu: Gpu, colors: readonly StageColor[], grid: StageGrid, bridge: Float32Array, darkBridge: Float32Array, lift: Float32Array): Target {
  const gl = gpu.gl
  const width = Math.max(RAMP_STEPS, grid.width)
  const height = 5 + grid.height
  const data = new Float32Array(width * height * 4)
  colors.slice(0, 5).forEach((c, k) => {
    const ramp = colorRamp(c.unit, c.path)
    for (let j = 0; j < RAMP_STEPS; j++) data.set([ramp[3 * j], ramp[3 * j + 1], ramp[3 * j + 2], 1], 4 * (k * width + j))
  })
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      data[4 * ((5 + y) * width + x)] = bridge[y * grid.width + x]
      data[4 * ((5 + y) * width + x) + 1] = darkBridge[y * grid.width + x]
      data[4 * ((5 + y) * width + x) + 2] = lift[y * grid.width + x]
    }
  const target = gpu.acquire(width, height)
  gl.bindTexture(gl.TEXTURE_2D, target.texture)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.FLOAT, data)
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
