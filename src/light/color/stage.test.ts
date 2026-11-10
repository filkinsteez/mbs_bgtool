import { describe, expect, it } from 'vitest'
import { buildRecipeShader } from '../engine/recipeShader'
import type { RecipeProgram, Scene } from '../scene'
import { defaultMix, setMetaBlue, setShare } from './mix'
import { getPack } from './packs'
import { COLOR_DESIGN_PACK, withColorMix } from './stage'
import { COLOR_STAGE_GLSL } from './stageGlsl'
import { buildFields, gridSize, lookParts, type StageField, type StageGrid } from './stageFields'
import { assignFields, KIND_DARK, KIND_PLAIN, KIND_TO_NEIGHBOR, KIND_TO_NEUTRAL, solveWeights, stageColors } from './stageSolve'

const bold = getPack('bold')
const elemental = getPack('elemental')
const atmospheric = getPack('atmospheric')

const program: Pick<RecipeProgram, 'fragment' | 'scatter' | 'grainWeight'> = {
  fragment: 'vec3 radiance(vec2 uv, vec2 p) { return vec3(uv, 0.5); }\n',
}

describe('recipe shaders with the color stage', () => {
  it('builds the same shader as before when the stage is off', () => {
    for (const mode of ['radiance', 'composite', 'source', 'aux'] as const) {
      const off = buildRecipeShader({ ...program, fragment: program.fragment + 'vec3 auxRadiance(vec2 uv, vec2 p) { return vec3(0.0); }\n' }, mode)
      expect(off).not.toContain('colorStage')
      expect(off).not.toContain('designRadiance')
    }
  })

  it('recolors the scene radiance in the radiance and composite modes only', () => {
    for (const mode of ['radiance', 'composite'] as const) {
      const on = buildRecipeShader(program, mode, COLOR_STAGE_GLSL)
      expect(on).toContain('vec3 designRadiance(vec2 uv, vec2 p) { return radiance(uv, p); }')
      expect(on).toContain('return colorStage(uv, designRadiance(uv, p));')
    }
    expect(buildRecipeShader(program, 'source', COLOR_STAGE_GLSL)).not.toContain('colorStage')
  })
})

describe('stage grid', () => {
  it('has 36 cells on the short side', () => {
    expect(gridSize(16 / 9)).toEqual([64, 36])
    expect(gridSize(9 / 16)).toEqual([36, 64])
    expect(gridSize(1)).toEqual([36, 36])
    expect(gridSize(4 / 5)).toEqual([36, 45])
  })
})

describe('stage colors', () => {
  it('dims Yellow through Orange-red, brightens Orange-red toward Yellow, and keeps Meta Blue and Cyan plain', () => {
    const colors = stageColors(bold, defaultMix(bold))
    const byName = (hex: string) => colors.find((c) => c.hex === hex)!
    expect(byName('#FFD61E').kind).toBe(KIND_TO_NEIGHBOR)
    expect(byName('#FFD61E').neighbor).toEqual(byName('#FF4F00').unit)
    expect(byName('#FF4F00').upperFrom).toBeLessThan(1)
    expect(byName('#FF4F00').upper).toEqual(byName('#FFD61E').unit)
    expect(byName('#0064E0').kind).toBe(KIND_PLAIN)
    expect(byName('#1FCDF0').kind).toBe(KIND_PLAIN)
  })

  it('dims Lime through Forest, turns Tan neutral, and keeps Forest and Plum to the dark', () => {
    const colors = stageColors(elemental, defaultMix(elemental))
    const byName = (hex: string) => colors.find((c) => c.hex === hex)!
    expect(byName('#D6F26C').kind).toBe(KIND_TO_NEIGHBOR)
    expect(byName('#D6F26C').neighbor).toEqual(byName('#0F3D33').unit)
    expect(byName('#B8996E').kind).toBe(KIND_TO_NEUTRAL)
    expect(byName('#0F3D33').kind).toBe(KIND_DARK)
    expect(byName('#4A0A3C').kind).toBe(KIND_DARK)
  })

  it('dims Ice through Steel, and leaves out a color that is off', () => {
    const colors = stageColors(atmospheric, setMetaBlue(atmospheric, defaultMix(atmospheric), false))
    expect(colors.map((c) => c.hex)).toEqual(['#F2F4F7', '#6A7788', '#384753', '#1C2B33'])
    expect(colors[0].kind).toBe(KIND_TO_NEIGHBOR)
    expect(colors[0].neighbor).toEqual(colors[1].unit)
  })

  it('scales every color to luminance 1', () => {
    for (const pack of [bold, elemental, atmospheric]) {
      for (const c of stageColors(pack, defaultMix(pack))) expect(0.2126 * c.unit[0] + 0.7152 * c.unit[1] + 0.0722 * c.unit[2]).toBeCloseTo(1, 6)
    }
  })
})

function flatGrid(lightness: number, [w, h] = [64, 36]): StageGrid {
  return { width: w, height: h, lightness: new Float32Array(w * h).fill(lightness) }
}

/** Left-to-right ramps, one per field, so fields lead in different places. */
function rampFields(count: number, w = 64, h = 36): StageField[] {
  return Array.from({ length: count }, (_, f) => ({
    name: `f${f}`,
    want: 'any' as const,
    values: Float32Array.from({ length: w * h }, (_, i) => Math.exp(-0.5 * (((i % w) / w - (f + 0.5) / count) / 0.25) ** 2)),
  }))
}

describe('field assignment', () => {
  it('gives Meta Blue the first field and a warm color the field that asks for warm', () => {
    const colors = stageColors(bold, defaultMix(bold))
    const fields: StageField[] = [
      { name: 'sky', want: 'cool', values: new Float32Array(4) },
      { name: 'glow', want: 'warm', values: new Float32Array(4) },
      { name: 'a', want: 'any', values: new Float32Array(4) },
      { name: 'b', want: 'any', values: new Float32Array(4) },
      { name: 'ground', want: 'dark', values: new Float32Array(4) },
    ]
    const assignment = assignFields(colors, fields, 3)
    expect(assignment[0]).toBe(0)
    const glowColor = colors[assignment.indexOf(1)]
    expect(glowColor.group).toBe('warm')
    expect(assignment).not.toContain(4)
    expect(assignFields(colors, fields, 3)).toEqual(assignment)
  })

  it('puts dark colors on the fields that ask for dark', () => {
    const colors = stageColors(elemental, defaultMix(elemental))
    const fields: StageField[] = ['light', 'a', 'b', 'c', 'dark1', 'dark2'].map((name) => ({ name, want: name.startsWith('dark') ? 'dark' : 'any', values: new Float32Array(4) }))
    const assignment = assignFields(colors, fields, 5)
    colors.forEach((c, k) => expect(fields[assignment[k]].want === 'dark').toBe(c.group === 'dark'))
  })
})

describe('weight solve', () => {
  it('gives each color its asked share of the lit cells', () => {
    const colors = stageColors(bold, defaultMix(bold))
    const fields = rampFields(4)
    const assignment = [0, 1, 2, 3]
    const { light } = solveWeights(flatGrid(0.6), fields, colors, assignment)
    colors.forEach((c, k) => expect(Math.abs(light[k] - c.share)).toBeLessThan(0.02))
  })

  it('moves the weights a little for a small change in a share', () => {
    const fields = rampFields(4)
    const a = solveWeights(flatGrid(0.6), fields, stageColors(bold, setShare(bold, defaultMix(bold), 3, 0.2)), [0, 1, 2, 3])
    const b = solveWeights(flatGrid(0.6), fields, stageColors(bold, setShare(bold, defaultMix(bold), 3, 0.25)), [0, 1, 2, 3])
    for (let k = 0; k < 4; k++) expect(Math.abs(a.light[k] - b.light[k])).toBeLessThan(0.08)
  })

  it('gives a dark color only the dim cells and the rest of its share to the others', () => {
    const colors = stageColors(elemental, defaultMix(elemental))
    const fields = rampFields(5)
    const { light } = solveWeights(flatGrid(0.8), fields, colors, [0, 1, 2, 3, 4])
    colors.forEach((c, k) => {
      if (c.group === 'dark') expect(light[k]).toBeLessThan(0.02)
    })
    expect(light.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 3)
  })
})

describe('stage fields', () => {
  it('are the same for the same design and seed, and at most eight', () => {
    const grid: StageGrid = { width: 64, height: 36, lightness: Float32Array.from({ length: 64 * 36 }, (_, i) => ((i % 64) / 64) * 0.9) }
    for (const recipe of ['sunset.bands', 'contour.beam'] as const) {
      const parts = recipe === 'sunset.bands' ? lookParts(recipe, { stack: [1, 0, 0, 1, 0, 0] }, 16 / 9) : []
      const a = buildFields(recipe, parts, grid, 7, 16 / 9)
      const b = buildFields(recipe, parts, grid, 7, 16 / 9)
      expect(a.length).toBeLessThanOrEqual(8)
      expect(a.map((f) => Array.from(f.values))).toEqual(b.map((f) => Array.from(f.values)))
    }
  })

  it('read each look\'s light from its params', () => {
    expect(lookParts('contour.streaks', { center: [0, 0] }, 16 / 9)).toEqual([{ kind: 'spot', at: [0.5, 0.5], radius: 0.3 }])
    const [ramp] = lookParts('sunset.ramp', { anchor: [0.5, 1], angle: 0 }, 16 / 9)
    expect(ramp.kind).toBe('horizon')
    if (ramp.kind === 'horizon') {
      expect(ramp.light).toEqual([0.5, 1])
      expect(ramp.sky[1]).toBeCloseTo(-1, 6)
    }
    expect(lookParts('contour.beam', {}, 16 / 9)).toEqual([])
  })
})

describe('withColorMix', () => {
  it('adds the pack and shares and leaves the design as it is', () => {
    const design: Scene = { recipe: 'contour.beam', seed: 4, colors: ['#1FCDF0'], params: { power: 0.5 }, lens: {}, output: {} }
    const scene = withColorMix(design, elemental, defaultMix(elemental))
    expect(scene.colorMix).toEqual({ pack: 'elemental', shares: defaultMix(elemental).shares })
    expect({ ...scene, colorMix: undefined }).toEqual({ ...design, colorMix: undefined })
    expect(COLOR_DESIGN_PACK).toBe('atmospheric')
  })
})
