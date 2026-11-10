import { describe, expect, it } from 'vitest'
import { PACKS, type ColorPack } from '../../color/packs'
import { compositionProblems } from '../../compose'
import { recipeContext, resolveScene, type SceneInput } from '../../engine/resolve'
import iridescentRings from '../../presets/references/contour-iridescent-rings.json'
import lightLine from '../../presets/references/contour-light-line.json'
import rimEdge from '../../presets/references/contour-rim-edge.json'
import yellowHalo from '../../presets/references/contour-yellow-halo.json'
import type { ControlValues, ParamValue, RecipeContext, RecipeDefinition } from '../../scene'
import { buildShape, outlinePieces, SHAPE_KINDS, type CurveLightLayout, type EmitterSettings, type PackedPrimitive } from './curveLight'
import { contourHalo, HALO_LAYOUT, haloEmitters } from './halo'
import { contourRim, RIM_LAYOUT, rimEmitters } from './rim'
import { primitiveLength, primitivePoint } from './shapes'

const ASPECTS = [16 / 9, 9 / 16, 1, 4 / 5]
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1)
const CONTROLS: ControlValues[] = [
  { intensity: 0, softness: 0, mood: 0 },
  { intensity: 0.5, softness: 0.5, mood: 0.5 },
  { intensity: 1, softness: 1, mood: 1 },
]

interface Case {
  recipe: RecipeDefinition
  layout: CurveLightLayout
  emitters: (ctx: RecipeContext) => EmitterSettings[]
}
const CASES: Case[] = [
  { recipe: contourRim, layout: RIM_LAYOUT, emitters: rimEmitters },
  { recipe: contourHalo, layout: HALO_LAYOUT, emitters: haloEmitters },
]

/** Pieces whose end is not where the next piece of the same contour starts (the last one wraps to the first). */
function openJoins(pieces: readonly PackedPrimitive[]): number {
  let open = 0
  for (let i = 0; i < pieces.length; ) {
    let j = i
    while (j < pieces.length && pieces[j].contour === pieces[i].contour) j++
    for (let k = i; k < j; k++) {
      const end = primitivePoint(pieces[k].primitive, 1)
      const next = primitivePoint(pieces[k + 1 < j ? k + 1 : i].primitive, 0)
      if (Math.hypot(end[0] - next[0], end[1] - next[1]) > 1e-6) open++
    }
    i = j
  }
  return open
}

/** Problems with the outlines a scene sends to the shader: too many pieces for the layout, or an open contour. */
function outlineProblems({ recipe, layout, emitters }: Case, scene: SceneInput, aspect: number): string[] {
  const ctx = recipeContext(resolveScene(recipe, scene), aspect)
  return emitters(ctx).flatMap((emitter, e) => {
    if (!emitter.shape) return []
    const pieces = outlinePieces(emitter)
    const problems: string[] = []
    if (pieces.length > layout.primitives) problems.push(`emitter ${e}: ${pieces.length} pieces, room for ${layout.primitives}`)
    const open = openJoins(pieces)
    if (open > 0) problems.push(`emitter ${e}: ${open} open joins`)
    return problems
  })
}

describe('contour outlines fit their layout and stay closed', () => {
  for (const item of CASES) {
    it(`${item.recipe.id}: every composed scene`, () => {
      const problems: string[] = []
      for (const pack of PACKS)
        for (const aspect of ASPECTS)
          for (const controls of CONTROLS)
            for (const seed of SEEDS) {
              const composition = item.recipe.compose?.({ pack, controls, seed, aspect })
              if (!composition) continue
              const scene: SceneInput = { seed, ...composition }
              for (const problem of outlineProblems(item, scene, aspect)) problems.push(`${pack.id} ${aspect.toFixed(3)} seed ${seed}: ${problem}`)
            }
      expect(problems).toEqual([])
    }, 60_000)
  }

  it('the reference presets', () => {
    const problems: string[] = []
    for (const preset of [rimEdge, lightLine, yellowHalo, iridescentRings]) {
      const item = CASES.find((c) => c.recipe.id === preset.scene.recipe)
      if (!item) throw new Error(`no case for ${preset.scene.recipe}`)
      for (const problem of outlineProblems(item, preset.scene as SceneInput, 925 / 1309)) problems.push(`${preset.scene.recipe}: ${problem}`)
    }
    expect(problems).toEqual([])
  })

  it('every shape kind with the most emission stops', () => {
    const problems: string[] = []
    const rimStops: Record<string, ParamValue> = { stops: 6, stopAt: [0.12, 0.31, 0.47], stopAt2: [0.62, 0.79, 0.93] }
    for (let shape = 1; shape <= 6; shape++) {
      const scene: SceneInput = { seed: 1, params: { ...rimStops, shape, angle: 70 } }
      for (const problem of outlineProblems(CASES[0], scene, 16 / 9)) problems.push(`rim shape ${shape}: ${problem}`)
    }
    for (let shape = 1; shape <= SHAPE_KINDS.length; shape++) {
      for (const sweep of [120, 360]) {
        const rings = Object.fromEntries([1, 2, 3].flatMap((i) => [[`ring${i}On`, true], [`ring${i}Shape`, shape], [`ring${i}Sweep`, sweep], [`ring${i}Aspect`, 0.6]]))
        const scene: SceneInput = { seed: 1, params: rings }
        for (const problem of outlineProblems(CASES[1], scene, 16 / 9)) problems.push(`halo shape ${shape} sweep ${sweep}: ${problem}`)
      }
    }
    expect(problems).toEqual([])
  })
})

describe('a sharp tip of an outline', () => {
  it('sends no light of its own within the dark stretch, and full light past the fade', () => {
    const shape = buildShape({ kind: 'corner', size: 0.03, angle: 70, aspect: 1, rotate: 0, flip: false })
    const contour = shape.contours[0]
    const total = contour.primitives.reduce((sum, p) => sum + primitiveLength(p), 0)
    // The corner's vertex is halfway along its contour.
    let left = total / 2
    let tip = primitivePoint(contour.primitives[0], 0)
    for (const p of contour.primitives) {
      const l = primitiveLength(p)
      if (left <= l) {
        tip = primitivePoint(p, l > 0 ? left / l : 0)
        break
      }
      left -= l
    }
    const stops = [{ t: 0, color: [1, 1, 1], gain: 1 }]
    const pieces = outlinePieces({ shape, stops, fades: [{ contour: 0, t: 0.5, dark: 0.04, fade: 0.12 }] }).filter((p) => p.contour === 0 && p.kind !== 3)
    const ends = pieces.flatMap((p) => [
      { at: primitivePoint(p.primitive, 0), light: Math.max(...p.e0) },
      { at: primitivePoint(p.primitive, 1), light: Math.max(...p.e1) },
    ])
    const from = (at: readonly number[]) => Math.hypot(at[0] - tip[0], at[1] - tip[1])
    const near = ends.filter((e) => from(e.at) < 0.035)
    const far = ends.filter((e) => from(e.at) > 0.17)
    expect(near.length).toBeGreaterThan(0)
    expect(far.length).toBeGreaterThan(0)
    for (const e of near) expect(e.light).toBe(0)
    for (const e of far) expect(e.light).toBeCloseTo(1, 6)
  })
})

/** The params that place the shape and its light: the design, which no color may change (owner, 2026-11-09). */
const DESIGN_KEYS = /^(shape|at|size|angle|aspect|rotate|flip|ring\dOn|ring\d(Shape|At|Radius|Aspect|Sweep|Rotate|Flip)|light\d\w+|facing\w*|gain|soften|air1(Line|Level|Falloff|Power))$/

/** Each pack's colors as given, without Meta Blue, in reverse order, and two of them. */
const COLOR_LISTS: ColorPack[] = PACKS.flatMap((pack) => [
  pack,
  { ...pack, colors: pack.colors.filter((c) => c.hex !== '#0064E0') },
  { ...pack, colors: [...pack.colors].reverse() },
  { ...pack, colors: [pack.colors[1], pack.colors[pack.colors.length - 1]] },
])

describe('Rim and Halo keep their design whatever colors fill it', () => {
  const owner = { from: [1.011, 1.224] as [number, number], to: [-0.078, -0.067] as [number, number] }
  for (const { recipe } of CASES) {
    it(`${recipe.id}: the same shape, place and light for every color list, and only the colors given`, () => {
      const problems: string[] = []
      for (const aspect of [16 / 9, 9 / 16])
        for (const drag of [undefined, owner])
          for (const seed of SEEDS.slice(0, 16)) {
            const designs = COLOR_LISTS.map((pack) => {
              const composition = recipe.compose!({ pack, controls: { intensity: 0.5, softness: 0.5, mood: 0.5, ...(drag ? { drag } : {}) }, seed, aspect })
              for (const problem of compositionProblems(recipe, pack, composition)) problems.push(`${pack.id} ${pack.colors.length} colors seed ${seed}: ${problem}`)
              return JSON.stringify(Object.entries(composition.params).filter(([key]) => DESIGN_KEYS.test(key)).sort(([a], [b]) => a.localeCompare(b)))
            })
            designs.forEach((design, i) => {
              if (design !== designs[0]) problems.push(`${COLOR_LISTS[i].id} ${COLOR_LISTS[i].colors.map((c) => c.name).join(', ')}: seed ${seed} ${aspect.toFixed(3)}${drag ? ' dragged' : ''}`)
            })
          }
      expect(problems.slice(0, 20)).toEqual([])
    }, 60_000)
  }
})
