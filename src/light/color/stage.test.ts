import { describe, expect, it } from 'vitest'
import { composeScene } from '../compose'
import { buildRecipeShader } from '../engine/recipeShader'
import { getRecipe } from '../recipes'
import { RECIPE_IDS, type RecipeId, type Scene } from '../scene'
import { defaultMix, mixFromShares, setMetaBlue, setShare } from './mix'
import { getPack } from './packs'
import { COLOR_DESIGN_PACK, colorRamp, RAMP_STEPS, withColorMix } from './stage'
import { buildFields, gridSize, lookParts, type StageField, type StageGrid, type StagePart } from './stageFields'
import { COLOR_STAGE_GLSL } from './stageGlsl'
import { assignFields, colorFields, KIND_BRIGHT, KIND_DARK, KIND_PLAIN, KIND_TO_NEIGHBOR, solveWeights, stageColors } from './stageSolve'

const CONTROLS = { intensity: 0.5, softness: 0.5, mood: 0.5 }

function designScene(recipe: RecipeId, seed: number, aspect = 16 / 9): Scene {
  const scene = composeScene(getRecipe(recipe), { pack: getPack(COLOR_DESIGN_PACK), controls: CONTROLS, seed, aspect })
  if (!scene) throw new Error(`${recipe} has no compose`)
  return scene
}

function flatGrid(aspect = 16 / 9, lightness = 0.6): StageGrid {
  const [width, height] = gridSize(aspect)
  const fill = (v: number) => new Float32Array(width * height).fill(v)
  return { width, height, lightness: fill(lightness), coverage: fill(1), peak: fill(lightness) }
}

/** Two fields meeting softly down the middle of the grid. */
function halves(grid: StageGrid): StageField[] {
  const left = new Float32Array(grid.width * grid.height)
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) left[y * grid.width + x] = 1 / (1 + Math.exp(((x + 0.5) / grid.width - 0.5) / 0.05))
  return [
    { name: 'left', want: 'any', values: left },
    { name: 'right', want: 'any', values: left.map((v) => 1 - v) },
  ]
}

describe('color stage', () => {
  it('names each color by how it dims', () => {
    const kinds = (packId: 'bold' | 'elemental' | 'atmospheric') =>
      Object.fromEntries(stageColors(getPack(packId), defaultMix(getPack(packId))).map((c) => [c.hex, c.kind]))
    expect(kinds('bold')).toEqual({ '#0064E0': KIND_PLAIN, '#1FCDF0': KIND_BRIGHT, '#FFD61E': KIND_TO_NEIGHBOR, '#FF4F00': KIND_PLAIN })
    expect(kinds('elemental')).toEqual({ '#0064E0': KIND_PLAIN, '#D6F26C': KIND_BRIGHT, '#0F3D33': KIND_DARK, '#B8996E': KIND_BRIGHT, '#4A0A3C': KIND_DARK })
    expect(kinds('atmospheric')).toEqual({ '#0064E0': KIND_PLAIN, '#F2F4F7': KIND_BRIGHT, '#6A7788': KIND_PLAIN, '#384753': KIND_DARK, '#1C2B33': KIND_DARK })
  })

  it('keeps every color its own hue, except Yellow, which dims like fire into Orange-red', () => {
    for (const packId of ['bold', 'elemental', 'atmospheric'] as const) {
      const colors = stageColors(getPack(packId), defaultMix(getPack(packId)))
      for (const c of colors) expect(colors[c.neighborIndex]?.hex ?? null).toBe(c.hex === '#FFD61E' ? '#FF4F00' : null)
    }
  })

  it('measures each color from the engine, dim to bright: Meta Blue stays blue up to white', () => {
    const luma = (c: ArrayLike<number>, j: number) => 0.2126 * c[3 * j] + 0.7152 * c[3 * j + 1] + 0.0722 * c[3 * j + 2]
    const ramp = colorRamp(stageColors(getPack('bold'), defaultMix(getPack('bold')))[0].unit)
    for (let j = 0; j < RAMP_STEPS; j++) {
      expect(luma(ramp, j)).toBeCloseTo(1, 5)
      expect(ramp[3 * j + 2]).toBeGreaterThanOrEqual(ramp[3 * j + 1] - 1e-6)
      expect(ramp[3 * j + 1]).toBeGreaterThanOrEqual(ramp[3 * j] - 1e-6)
    }
    const last = RAMP_STEPS - 1
    expect([ramp[3 * last], ramp[3 * last + 1], ramp[3 * last + 2]].map((v) => Math.round(v * 100) / 100)).toEqual([1, 1, 1])
  })

  it('gives Meta Blue the sky, warm colors the glow and dark colors the ground in a sunrise', () => {
    const grid = flatGrid()
    const field = (name: string, want: StageField['want']): StageField => ({ name, want, values: new Float32Array(grid.width * grid.height) })
    const fields = [field('sky', 'cool'), field('glow', 'warm'), field('low', 'warm'), field('high', 'cool'), field('ground', 'dark'), field('dark1', 'dark'), field('dark2', 'dark')]
    const names = (packId: 'bold' | 'elemental' | 'atmospheric') => {
      const pack = getPack(packId)
      const colors = stageColors(pack, defaultMix(pack))
      return Object.fromEntries(assignFields(colors, fields, 3).map((f, k) => [colors[k].hex, fields[f].name]))
    }
    expect(names('bold')).toEqual({ '#0064E0': 'sky', '#1FCDF0': 'high', '#FFD61E': 'glow', '#FF4F00': 'low' })
    expect(names('elemental')).toMatchObject({ '#0064E0': 'sky', '#D6F26C': 'glow', '#B8996E': 'low' })
    expect(['ground', 'dark1']).toContain(names('elemental')['#0F3D33'])
    expect(names('atmospheric')).toMatchObject({ '#0064E0': 'sky', '#F2F4F7': 'glow', '#6A7788': 'low' })
  })

  it('colors by the parts when they ask: the lead color for the light, one color per group or want, one per dark spot', () => {
    const grid = flatGrid()
    const streak = (group: number, y: number, want?: 'cool'): StagePart[] => [
      { kind: 'line', from: [0.1, y], to: [0.5, y], width: 0.05, group, want },
      { kind: 'line', from: [0.5, y], to: [0.9, y], width: 0.05, group, want },
      { kind: 'spot', at: [0.5, y], radius: 0.1, stretch: 3, angle: 0, group, want },
    ]
    // A streak that asks no color is the look's own light; one that asks a color is one field.
    const fields = buildFields('contour.streaks', [...streak(1, 0.3), ...streak(2, 0.7, 'cool')], grid, 2, 16 / 9)
    expect(fields.map((f) => f.name)).toEqual(['lead', 'group2', 'cool', 'warm', 'bright', 'pale', 'dark1', 'dark2'])
    expect(fields.some((f) => f.name.startsWith('along') || f.name.startsWith('part'))).toBe(false)
    const bold = getPack('bold')
    const boldColors = stageColors(bold, defaultMix(bold))
    expect(assignFields(boldColors, fields, 2)[boldColors.findIndex((c) => c.hex === '#0064E0')]).toBe(0)
    const sky: StagePart[] = [
      { kind: 'horizon', light: [0.5, 0.8], sky: [0, -1] },
      { kind: 'spot', at: [0.5, 0.8], radius: 0.2, want: 'bright' },
      { kind: 'spot', at: [0.5, 0.8], radius: 0.4, inner: 0.25, want: 'warm' },
      { kind: 'spot', at: [0.2, 0.95], radius: 0.2, want: 'dark' },
      { kind: 'spot', at: [0.8, 0.95], radius: 0.2, want: 'dark' },
    ]
    const skyFields = buildFields('sunset.merged', sky, grid, 2, 16 / 9)
    expect(skyFields.map((f) => f.name)).toEqual(['lead', 'cool', 'warm', 'bright', 'pale', 'dark1', 'dark2'])
    const elemental = getPack('elemental')
    const colors = stageColors(elemental, defaultMix(elemental))
    const named = Object.fromEntries(assignFields(colors, skyFields, 2).map((f, k) => [colors[k].hex, skyFields[f]?.name]))
    expect(named).toEqual({ '#0064E0': 'lead', '#D6F26C': 'bright', '#B8996E': 'warm', '#0F3D33': 'dark1', '#4A0A3C': 'dark2' })
    const streaks: StagePart[] = [
      { kind: 'line', from: [0.1, 0.3], to: [0.9, 0.3], width: 0.05, want: 'warm' },
      { kind: 'line', from: [0.1, 0.7], to: [0.9, 0.7], width: 0.05, want: 'cool' },
    ]
    const streakFields = buildFields('rush.split', streaks, grid, 2, 16 / 9)
    for (let seed = 1; seed <= 4; seed++) {
      const at = assignFields(boldColors, streakFields, seed)
      const nameOf = (hex: string) => streakFields[at[boldColors.findIndex((c) => c.hex === hex)]]?.name
      expect([nameOf('#FFD61E'), nameOf('#FF4F00'), nameOf('#1FCDF0')]).toEqual(['warm', 'warm', 'cool'])
    }
  })

  it('gives Meta Blue the dark fields no color takes in a pack with no dark color', () => {
    const grid = flatGrid()
    const field = (name: string, want: StageField['want'], v: number): StageField => ({ name, want, values: new Float32Array(grid.width * grid.height).fill(v) })
    const fields = [field('sky', 'cool', 0.2), field('glow', 'warm', 0), field('low', 'warm', 0), field('high', 'cool', 0), field('ground', 'dark', 0.9)]
    for (const packId of ['bold', 'elemental'] as const) {
      const pack = getPack(packId)
      const colors = stageColors(pack, defaultMix(pack))
      const values = colorFields(fields, assignFields(colors, fields, 3), colors)
      expect(values[colors.findIndex((c) => c.hex === '#0064E0')][0]).toBeCloseTo(packId === 'bold' ? 0.9 : 0.2)
    }
  })

  it('solves the weights so each color leads its share of the lit area, the same way every time', () => {
    const pack = getPack('bold')
    const grid = flatGrid()
    const fields = halves(grid)
    for (const [blue, red] of [
      [0.5, 0.5],
      [0.7, 0.3],
      [0.2, 0.8],
    ]) {
      const mix = mixFromShares(pack, [blue, 0, 0, red])
      expect(mix).not.toBeNull()
      const colors = stageColors(pack, mix!)
      const solved = solveWeights(grid, fields, colors, [0, 1])
      expect(solved.light[0]).toBeCloseTo(blue, 1)
      expect(solved.light[1]).toBeCloseTo(red, 1)
      expect(solveWeights(grid, fields, colors, [0, 1])).toEqual(solved)
    }
  })

  it('moves each color by about as much lit area as its share moves', () => {
    const pack = getPack('bold')
    const grid = flatGrid()
    const fields = halves(grid)
    const at = (blue: number) => solveWeights(grid, fields, stageColors(pack, mixFromShares(pack, [blue, 0, 0, 1 - blue])!), [0, 1])
    let last = at(0.4)
    for (let blue = 0.42; blue <= 0.6; blue += 0.02) {
      const next = at(blue)
      const moved = next.light[0] - last.light[0]
      expect(moved).toBeGreaterThan(0)
      expect(moved).toBeLessThan(0.04)
      expect(next.weights[0] / next.weights[1]).toBeGreaterThan(last.weights[0] / last.weights[1])
      last = next
    }
  })

  it('gives a dark color only the dim cells and the rest of its share to the others', () => {
    const pack = getPack('elemental')
    const grid = flatGrid(16 / 9, 0.8)
    const strips = Array.from({ length: 5 }, (_, s): StageField => {
      const values = new Float32Array(grid.width * grid.height)
      for (let y = 0; y < grid.height; y++)
        for (let x = 0; x < grid.width; x++) values[y * grid.width + x] = Math.exp(-0.5 * (((x + 0.5) / grid.width - (s + 0.5) / 5) / 0.12) ** 2)
      return { name: `strip${s + 1}`, want: 'any', values }
    })
    const colors = stageColors(pack, defaultMix(pack))
    const { light } = solveWeights(grid, strips, colors, [0, 1, 2, 3, 4])
    colors.forEach((c, k) => {
      if (c.kind === KIND_DARK) expect(light[k]).toBeLessThan(0.02)
    })
    expect(light.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3)
  })

  it('reads parts for every look and builds the same fields for the same design', () => {
    for (const recipe of RECIPE_IDS) {
      for (const aspect of [16 / 9, 9 / 16]) {
        const scene = designScene(recipe, 2, aspect)
        const parts = lookParts(recipe, scene.params, aspect)
        if (recipe.startsWith('sunset.')) expect(parts.map((p) => p.kind)).toEqual(['horizon'])
        if (recipe === 'contour.beam') expect(parts).toEqual([])
        const grid = flatGrid(aspect)
        const fields = buildFields(recipe, parts, grid, 2, aspect)
        expect(fields.length).toBeLessThanOrEqual(8)
        for (const f of fields) for (const v of f.values) expect(v >= 0 && v <= 1.000001).toBe(true)
        expect(buildFields(recipe, parts, grid, 2, aspect)).toEqual(fields)
      }
    }
  })

  it('keeps the design lightness under any mix: the default, Meta Blue off and one color at 60%', () => {
    // The shader's last step, which alone sets the output's luminance: any blend of colors, at the design's luminance.
    expect(COLOR_STAGE_GLSL).toContain('return m / max(dot(m, LUMA), 1e-6) * y;')
    const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    const atLuminance = (m: readonly number[], y: number) => m.map((v) => (v / Math.max(luma(m), 1e-6)) * y)
    for (const packId of ['bold', 'elemental', 'atmospheric'] as const) {
      const pack = getPack(packId)
      const cyanOrFirst = pack.colors.findIndex((c) => c.hex !== '#0064E0')
      for (const mix of [defaultMix(pack), setMetaBlue(pack, defaultMix(pack), false), setShare(pack, defaultMix(pack), cyanOrFirst, 0.6)]) {
        const steps = stageColors(pack, mix).flatMap((c) => {
          const ramp = colorRamp(c.unit)
          return Array.from({ length: RAMP_STEPS }, (_, j) => [ramp[3 * j], ramp[3 * j + 1], ramp[3 * j + 2]])
        })
        const blends = steps.flatMap((a, i) => (i % 7 === 0 ? steps.filter((_, k) => k % 5 === 0).map((b) => a.map((v, n) => 0.5 * (v + b[n]))) : []))
        for (const m of [...steps, ...blends, ...blends.map((b) => b.map((v) => 0.5 * (v + 1)))])
          for (const y of [0.001, 0.02, 0.1, 0.3, 0.6, 0.95, 1.4]) expect(luma(atLuminance(m, y))).toBeCloseTo(y, 6)
      }
    }
  })

  it('turns on only through withColorMix, and leaves the recipe shaders as they were without it', () => {
    const scene = designScene('sunset.bands', 1)
    expect(scene.colorMix).toBeUndefined()
    const pack = getPack('elemental')
    expect(withColorMix(scene, pack, defaultMix(pack)).colorMix).toEqual({ pack: 'elemental', shares: defaultMix(pack).shares })
    expect(withColorMix(scene, pack, defaultMix(pack)).params).toBe(scene.params)
    const merged: Scene = { ...scene, recipe: 'sunset.merged' }
    expect(withColorMix(merged, pack, defaultMix(pack)).params.lightnessOnly).toBe(true)
    const program = { fragment: 'vec3 radiance(vec2 uv, vec2 p) { return vec3(uv, 0.0); }\n' }
    for (const mode of ['radiance', 'composite'] as const) {
      const plain = buildRecipeShader(program, mode)
      expect(buildRecipeShader(program, mode, undefined)).toBe(plain)
      expect(plain).not.toContain('colorStage')
      const staged = buildRecipeShader(program, mode, COLOR_STAGE_GLSL)
      expect(staged).toContain('vec3 designRadiance(vec2 uv, vec2 p) { return radiance(uv, p); }')
      expect(staged).toContain('vec3 sceneRadiance(vec2 uv, vec2 p) { return colorStage(uv, designRadiance(uv, p)); }')
    }
    const withAux = { fragment: program.fragment + 'vec3 auxRadiance(vec2 uv, vec2 p) { return vec3(0.0); }\n' }
    for (const mode of ['source', 'aux'] as const) expect(buildRecipeShader(withAux, mode, COLOR_STAGE_GLSL)).toBe(buildRecipeShader(withAux, mode))
  })
})
