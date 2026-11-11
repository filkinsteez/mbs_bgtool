import { describe, expect, it } from 'vitest'
import { composeScene } from '../compose'
import { meetBridgeLight, meetDarkLight } from '../engine/meet'
import { buildRecipeShader } from '../engine/recipeShader'
import { getRecipe } from '../recipes'
import { RECIPE_IDS, type RecipeId, type Scene } from '../scene'
import { defaultMix, mixFromShares, setMetaBlue, setShare } from './mix'
import { getPack } from './packs'
import { COLOR_DESIGN_PACK, colorRamp, darkMeetingLines, meetingLift, meetingLines, RAMP_STEPS, withColorMix } from './stage'
import { buildFields, gridSize, lookParts, type StageField, type StageGrid, type StagePart } from './stageFields'
import { COLOR_STAGE_GLSL } from './stageGlsl'
import { hexToLinear } from './srgb'
import { assignFields, colorFields, colorMask, guardedParts, KIND_BRIGHT, KIND_DARK, KIND_PLAIN, KIND_TO_NEIGHBOR, pairedMasks, partWeightsAt, solveWeights, stageColors, stageDimPaths, type StageDimPath } from './stageSolve'

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

/** The field of that name. */
function named(fields: readonly StageField[], name: string): StageField {
  const field = fields.find((f) => f.name === name)
  if (!field) throw new Error(`No field ${name}`)
  return field
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

  it('colors by the parts when they ask: the lead color for the light, one field per color some part asks for, darks left and right', () => {
    const grid = flatGrid()
    const streak = (group: number, y: number, want?: 'cool'): StagePart[] => [
      { kind: 'line', from: [0.1, y], to: [0.5, y], width: 0.05, group, want },
      { kind: 'line', from: [0.5, y], to: [0.9, y], width: 0.05, group, want },
      { kind: 'spot', at: [0.5, y], radius: 0.1, stretch: 3, angle: 0, group, want: want === undefined ? 'bright' : want },
    ]
    // A streak that asks no color is the look's own light (its core too); one that asks a color is in that color's field.
    const fields = buildFields('contour.streaks', [...streak(1, 0.3), ...streak(2, 0.7, 'cool')], grid, 2, 16 / 9)
    expect(fields.map((f) => f.name)).toEqual(['lead', 'cool', 'dark1', 'dark2'])
    expect(fields.some((f) => f.name.startsWith('along') || f.name.startsWith('part'))).toBe(false)
    // No part asks for a dark color, so the dark fields are empty: no seeded dark fields in a look colored by its parts.
    expect(Math.max(...fields[2].values, ...fields[3].values)).toBe(0)
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
    expect(skyFields.map((f) => f.name)).toEqual(['lead', 'warm', 'bright', 'dark1', 'dark2'])
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
      // Orange-red shows where Yellow dims, not on a field of its own.
      expect([nameOf('#FFD61E'), nameOf('#FF4F00'), nameOf('#1FCDF0')]).toEqual(['warm', undefined, 'cool'])
    }
    // A line can ask for the pack's other warm color as a stretch of its own.
    const twoWarm = buildFields('rush.split', [...streaks, { kind: 'line', from: [0.1, 0.5], to: [0.9, 0.5], width: 0.05, want: 'warm2' }], grid, 2, 16 / 9)
    expect(twoWarm.map((f) => f.name)).toEqual(['lead', 'cool', 'warm', 'warm2', 'dark1', 'dark2'])
    const warmOf = (cs: ReturnType<typeof stageColors>, hex: string) => twoWarm[assignFields(cs, twoWarm, 2)[cs.findIndex((c) => c.hex === hex)]]?.name
    expect([warmOf(boldColors, '#FFD61E'), warmOf(boldColors, '#FF4F00')]).toEqual(['warm', 'warm2'])
    expect([warmOf(colors, '#B8996E'), warmOf(colors, '#D6F26C')]).toEqual(['warm', 'warm2'])
    // In a pack with no warm color, warm streaks leave Ice to the bright streaks that ask for it and take Steel.
    const lit = buildFields('rush.split', [
      { kind: 'line', from: [0.1, 0.3], to: [0.9, 0.3], width: 0.05, want: 'warm' },
      { kind: 'line', from: [0.1, 0.7], to: [0.9, 0.7], width: 0.05, want: 'bright' },
    ], grid, 2, 16 / 9)
    expect(lit.map((f) => f.name)).toEqual(['lead', 'warm', 'bright', 'dark1', 'dark2'])
    const atmospheric = getPack('atmospheric')
    const cool = stageColors(atmospheric, defaultMix(atmospheric), true)
    for (let seed = 1; seed <= 4; seed++) {
      const at = assignFields(cool, lit, seed)
      const nameOf = (hex: string) => lit[at[cool.findIndex((c) => c.hex === hex)]]?.name
      expect([nameOf('#F2F4F7'), nameOf('#6A7788')]).toEqual(['bright', 'warm'])
    }
  })

  it('guards the parts that ask for a light color far in hue from Meta Blue, and only those', () => {
    const guarded = (packId: 'bold' | 'elemental' | 'atmospheric') => {
      const colors = stageColors(getPack(packId), defaultMix(getPack(packId)), true)
      const flags = guardedParts(colors, colors.map((c) => (c.kind === KIND_DARK ? 'dark' : 'warm')))
      return colors.filter((_, k) => flags[k]).map((c) => c.hex)
    }
    expect(guarded('bold')).toEqual(['#FFD61E', '#FF4F00'])
    expect(guarded('elemental')).toEqual(['#D6F26C', '#B8996E'])
    expect(guarded('atmospheric')).toEqual([])
    const bold = stageColors(getPack('bold'), defaultMix(getPack('bold')), true)
    expect(guardedParts(bold, bold.map(() => 'lead')).some(Boolean)).toBe(false)
  })

  it("keeps a color's weight from repainting a part that is another color's", () => {
    // Meta Blue (the lead) weighs 1 and Yellow (asked) 0.3. On Yellow's part Meta Blue weighs no more than Yellow; on
    // Meta Blue's own part, in light no part asks for and where the two fields are even, the weights stay, and so does a
    // weight that brings Yellow into Meta Blue's light.
    const asked = [false, true]
    expect(partWeightsAt([1, 0.3], asked, (k) => [0.3, 0.9][k])).toEqual([0.3, 0.3])
    expect(partWeightsAt([1, 0.3], asked, (k) => [0.9, 0.3][k])).toEqual([1, 0.3])
    expect(partWeightsAt([1, 0.3], asked, (k) => [0.3, 0][k])).toEqual([1, 0.3])
    expect(partWeightsAt([1, 0.3], asked, (k) => [0.5, 0.5][k])).toEqual([1, 0.3])
    expect(partWeightsAt([0.4, 1], asked, (k) => [0.9, 0.3][k])).toEqual([0.4, 1])
    // Lime's dome (asked, weight 0.01) holding Tan's band (asked, 0.2): on the dome Tan keeps its weight and Meta Blue
    // weighs no more than Lime.
    expect(partWeightsAt([1, 0.01, 0.2], [false, true, true], (k) => [0.3, 0.9, 0.7][k])).toEqual([0.01, 0.01, 0.2])
    // Where the dome and the band are even, Meta Blue weighs no more than the two weights' blend.
    const even = partWeightsAt([1, 0.01, 0.2], [false, true, true], (k) => [0.3, 0.9, 0.9][k])
    expect(even[0]).toBeCloseTo(0.105, 6)
    expect(even.slice(1)).toEqual([0.01, 0.2])
  })

  it('counts a part by its strength and gives the dark spots to the dark fields in their order', () => {
    const grid = flatGrid()
    const glow = (strength: number): StagePart[] => [{ kind: 'spot', at: [0.5, 0.5], radius: 0.2, want: 'warm', strength }]
    const peakOf = (parts: StagePart[]) => Math.max(...named(buildFields('sunset.merged', parts, grid, 3, 16 / 9), 'warm').values)
    expect(peakOf(glow(0))).toBe(0)
    expect(peakOf(glow(0.5))).toBeCloseTo(0.5 * peakOf(glow(1)), 5)
    const darks = buildFields('sunset.merged', [
      { kind: 'spot', at: [0.15, 0.8], radius: 0.15, want: 'dark' },
      { kind: 'spot', at: [0.85, 0.8], radius: 0.15, want: 'dark' },
    ], grid, 3, 16 / 9)
    const at = (field: string, x: number) => named(darks, field).values[Math.floor(0.8 * grid.height) * grid.width + Math.floor(x * grid.width)]
    expect(at('dark1', 0.15)).toBeGreaterThan(5 * at('dark2', 0.15))
    expect(at('dark2', 0.85)).toBeGreaterThan(5 * at('dark1', 0.85))
  })

  it("gives a hot core inside a ring the ring's color, and outside a ring its own", () => {
    const grid = flatGrid()
    const halo: StagePart = { kind: 'spot', at: [0.5, 0.5], radius: 0.3, inner: 0.15, want: 'warm' }
    const core = (at: readonly [number, number]): StagePart => ({ kind: 'spot', at, radius: 0.08, want: 'bright' })
    const top = (parts: StagePart[], field: string) => Math.max(...named(buildFields('sunset.merged', parts, grid, 3, 16 / 9), field).values)
    expect(top([halo, core([0.5, 0.5])], 'bright')).toBe(0)
    expect(top([halo, core([0.5, 0.5])], 'warm')).toBeGreaterThan(0.8)
    expect(top([halo, core([0.95, 0.5])], 'bright')).toBeGreaterThan(0.8)
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

  it('hands a light color over to a dark color directly where both are present, with no gap between their fades', () => {
    const elemental = getPack('elemental')
    const colors = stageColors(elemental, defaultMix(elemental), true)
    const tan = colors.findIndex((c) => c.hex === '#B8996E')
    const forest = colors.findIndex((c) => c.hex === '#0F3D33')
    expect(colors[tan].kind).toBe(KIND_BRIGHT)
    expect(colors[forest].kind).toBe(KIND_DARK)
    const both = colors.map((_, k) => (k === tan || k === forest ? 1 : 0))
    for (let l = 0.3; l <= 0.5; l += 0.005) {
      const masks = pairedMasks(colors, both, l)
      expect(Math.max(masks[tan], masks[forest])).toBeGreaterThan(0.45)
    }
    // A color's mask reaches past its own fade only where the other one is present.
    const onlyTan = pairedMasks(colors, colors.map((_, k) => (k === tan ? 1 : 0)), 0.4)
    expect(onlyTan[tan]).toBeCloseTo(colorMask(colors[tan], 0.4), 6)
    const onlyForest = pairedMasks(colors, colors.map((_, k) => (k === forest ? 1 : 0)), 0.38)
    expect(onlyForest[forest]).toBeCloseTo(colorMask(colors[forest], 0.38), 6)
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
    // The shader's last step, which alone sets the output's luminance: any blend of colors, at the design's luminance,
    // raised only on a meeting line (meetBridgeLight, which leaves the luminance as it is where there is no line).
    expect(COLOR_STAGE_GLSL).toContain('return m / max(dot(m, LUMA), 1e-6) * y * meetBridgeLight(yE, rise) / max(yE, 1e-8) * yDark / max(yE, 1e-8);')
    for (const y of [0.001, 0.1, 0.6, 1.4]) expect(meetBridgeLight(y, 0)).toBe(y)
    for (const y of [0.001, 0.1, 0.6, 1.4]) expect(meetDarkLight(y, 0)).toBe(y)
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

  it('spills light across a meeting only where far hues trade places quickly: soft, uneven, none between near hues, none in a broad mix', () => {
    const grid = flatGrid(16 / 9)
    const { width: w, height: h } = grid
    const colors = stageColors(getPack('bold'), defaultMix(getPack('bold')), true)
    const blue = colors.findIndex((c) => c.hex === '#0064E0')
    const yellow = colors.findIndex((c) => c.hex === '#FFD61E')
    const cyan = colors.findIndex((c) => c.hex === '#1FCDF0')
    const step = (soft: number) => (x: number) => 1 / (1 + Math.exp((x - w / 2) / soft))
    const shares = (a: number, b: number, soft: number) =>
      colors.map((_, k) => {
        const out = new Float32Array(w * h)
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = k === a ? step(soft)(x) : k === b ? 1 - step(soft)(x) : 0
        return out
      })
    // Meta Blue meeting Yellow over about a cell: a spill that peaks at the meeting, fades into both sides and is gone at
    // the frame's sides; along the meeting its strength drifts, so it is no even band.
    const line = meetingLines(grid, shares(blue, yellow, 1), colors)
    const row = Array.from({ length: w }, (_, x) => line[Math.floor(h / 2) * w + x])
    const peak = row.indexOf(Math.max(...row))
    expect(Math.max(...row)).toBeGreaterThan(0.3)
    expect(Math.abs(peak - w / 2)).toBeLessThanOrEqual(2)
    expect(row[0] + row[w - 1]).toBeLessThan(1e-3)
    const along = Array.from({ length: h }, (_, y) => line[y * w + peak])
    expect(Math.max(...along)).toBeGreaterThan(1.2 * Math.min(...along))
    // Near hues (Meta Blue and Cyan) make no line, and neither does a mix that changes over most of the frame.
    expect(Math.max(...meetingLines(grid, shares(blue, cyan, 1), colors))).toBe(0)
    expect(Math.max(...meetingLines(grid, shares(blue, yellow, 30), colors))).toBeLessThan(0.05)
    // A Yellow streak across Meta Blue: one two cells wide keeps its color (no spill), one ten cells wide gets a spill
    // along each side.
    const streak = (cells: number) =>
      colors.map((_, k) => {
        const out = new Float32Array(w * h)
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const s = step(0.7)(x - cells / 2) * (1 - step(0.7)(x + cells / 2))
            out[y * w + x] = k === yellow ? s : k === blue ? 1 - s : 0
          }
        return out
      })
    expect(Math.max(...meetingLines(grid, streak(2), colors))).toBeLessThan(0.1)
    expect(Math.max(...meetingLines(grid, streak(10), colors))).toBeGreaterThan(0.3)
  })

  it("lifts a bright meeting toward the lighter color's light and leaves a dim one alone", () => {
    const grid = flatGrid(16 / 9)
    const { width: w, height: h } = grid
    const colors = stageColors(getPack('bold'), defaultMix(getPack('bold')), true)
    const blue = colors.findIndex((c) => c.hex === '#0064E0')
    const yellow = colors.findIndex((c) => c.hex === '#FFD61E')
    const shares = colors.map((_, k) => {
      const out = new Float32Array(w * h)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const s = 1 / (1 + Math.exp(x - w / 2))
          out[y * w + x] = k === yellow ? s : k === blue ? 1 - s : 0
        }
      return out
    })
    // Yellow on the left, in the lighter light; Meta Blue on the right.
    const shown = (left: number, right: number) => ({ ...grid, seen: Float32Array.from({ length: w * h }, (_, i) => (i % w < w / 2 ? left : right)) })
    expect(Math.max(...meetingLift(shown(0.85, 0.7), shares, colors))).toBeGreaterThan(0.3)
    expect(Math.max(...meetingLift(shown(0.3, 0.25), shares, colors))).toBe(0)
  })

  it('marks a dark line only where a light color meets a dark color far from it in hue', () => {
    const grid = flatGrid(16 / 9)
    const { width: w, height: h } = grid
    const colors = stageColors(getPack('elemental'), defaultMix(getPack('elemental')), true)
    const at = (hex: string) => colors.findIndex((c) => c.hex === hex)
    const [blue, lime, forest, plum] = ['#0064E0', '#D6F26C', '#0F3D33', '#4A0A3C'].map(at)
    const shares = (a: number, b: number) =>
      colors.map((_, k) => {
        const out = new Float32Array(w * h)
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const s = 1 / (1 + Math.exp(x - w / 2))
            out[y * w + x] = k === a ? s : k === b ? 1 - s : 0
          }
        return out
      })
    // Lime meeting Plum gets a line, and the light spill (meetingLines) leaves it alone; Lime meeting Forest (near in
    // hue), Lime meeting Meta Blue (two light colors) and Meta Blue meeting Plum get no dark line.
    expect(Math.max(...darkMeetingLines(grid, shares(lime, plum), colors))).toBeGreaterThan(0.5)
    expect(Math.max(...meetingLines(grid, shares(lime, plum), colors))).toBe(0)
    expect(Math.max(...darkMeetingLines(grid, shares(lime, forest), colors))).toBe(0)
    expect(Math.max(...darkMeetingLines(grid, shares(lime, blue), colors))).toBe(0)
    expect(Math.max(...darkMeetingLines(grid, shares(blue, plum), colors))).toBe(0)
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

  it('gives the glow the dim path of each color from the turns the stage draws', () => {
    const paths = (packId: 'bold' | 'elemental' | 'atmospheric') => {
      const pack = getPack(packId)
      const colors = stageColors(pack, defaultMix(pack), true)
      return Object.fromEntries(stageDimPaths(colors).map((path, k) => [colors[k].hex, path]))
    }
    const steps = (path: StageDimPath) => path.steps.map((s) => ({ color: s.color.map((v) => v.toFixed(4)).join(','), below: s.below }))
    const linear = (hex: string) => hexToLinear(hex).map((v) => v.toFixed(4)).join(',')
    const bold = paths('bold')
    expect(steps(bold['#FFD61E']).map((s) => s.color)).toEqual([linear('#FF4F00')])
    for (const hex of ['#0064E0', '#1FCDF0', '#FF4F00']) expect(bold[hex].steps).toEqual([])
    const elemental = paths('elemental')
    expect(steps(elemental['#D6F26C']).map((s) => s.color)).toEqual([linear('#0F3D33')])
    for (const hex of ['#0064E0', '#0F3D33', '#B8996E', '#4A0A3C']) expect(elemental[hex].steps).toEqual([])
    const atmospheric = paths('atmospheric')
    expect(steps(atmospheric['#F2F4F7']).map((s) => s.color)).toEqual([linear('#6A7788')])
    for (const hex of ['#0064E0', '#6A7788', '#384753', '#1C2B33']) expect(atmospheric[hex].steps).toEqual([])
    for (const path of [bold['#FFD61E'], elemental['#D6F26C'], atmospheric['#F2F4F7']]) {
      expect(path.steps[0].below).toBeGreaterThan(0.1)
      expect(path.steps[0].below).toBeLessThan(0.6)
    }
    expect(bold['#FFD61E'].color).toEqual(hexToLinear('#FFD61E'))
  })
})
