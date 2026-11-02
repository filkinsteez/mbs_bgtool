import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LENS,
  DEFAULT_OUTPUT,
  getRecipe,
  LENS_NUMBERS,
  OUTPUT_NUMBERS,
  PACKS,
  RECIPE_IDS,
  type ParamSpec,
  type ParamValue,
} from '@/light'
import { buildScene, CONTROL_MAPPINGS, DEFAULT_CONTROLS, type ControlValues } from './controls'

const STEPS = [0, 0.25, 0.5, 0.75, 1]
const GRID: ControlValues[] = STEPS.flatMap((intensity) =>
  STEPS.flatMap((softness) => STEPS.map((mood) => ({ intensity, softness, mood }))),
)

function paramProblem(spec: ParamSpec, value: ParamValue): string | null {
  switch (spec.kind) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'is not a finite number'
      if (value < spec.min || value > spec.max) return `${value} is outside ${spec.min}..${spec.max}`
      return null
    case 'boolean':
      return typeof value === 'boolean' ? null : 'is not a boolean'
    case 'vector': {
      if (!Array.isArray(value) || value.length !== spec.default.length) return `is not a vector of ${spec.default.length}`
      const bad = value.find((v) => !Number.isFinite(v) || v < spec.min || v > spec.max)
      return bad === undefined ? null : `component ${bad} is outside ${spec.min}..${spec.max}`
    }
    default: {
      const unknown: never = spec
      return `has an unknown kind: ${JSON.stringify(unknown)}`
    }
  }
}

describe('control mapping', () => {
  it('maps every recipe', () => {
    for (const id of RECIPE_IDS) expect(CONTROL_MAPPINGS[id], id).toBeDefined()
  })

  for (const id of RECIPE_IDS) {
    describe(id, () => {
      const recipe = getRecipe(id)
      const specs = new Map(recipe.params.map((spec) => [spec.key, spec]))

      it('writes only declared params, in range, for every pack and control value', () => {
        const problems = new Set<string>()
        for (const pack of PACKS) {
          for (const controls of GRID) {
            const scene = buildScene(id, pack, 1, controls)
            for (const [key, value] of Object.entries(scene.params)) {
              const spec = specs.get(key)
              const problem = spec ? paramProblem(spec, value) : 'is not in the recipe ParamSpec'
              if (problem) problems.add(`param "${key}" ${problem}`)
            }
          }
        }
        expect([...problems]).toEqual([])
      })

      it('writes only known lens and output settings, in range', () => {
        const ranges = new Map([...LENS_NUMBERS, ...OUTPUT_NUMBERS].map((setting) => [setting.key as string, setting]))
        const problems = new Set<string>()
        for (const controls of GRID) {
          const scene = buildScene(id, PACKS[0], 1, controls)
          const settings = [
            ...Object.entries(scene.lens).map(([key, value]) => ({ key, value, known: key in DEFAULT_LENS })),
            ...Object.entries(scene.output).map(([key, value]) => ({ key, value, known: key in DEFAULT_OUTPUT })),
          ]
          for (const { key, value, known } of settings) {
            if (!known) {
              problems.add(`setting "${key}" does not exist`)
              continue
            }
            const range = ranges.get(key)
            if (range && (typeof value !== 'number' || value < range.min || value > range.max)) {
              problems.add(`setting "${key}" = ${String(value)} is outside ${range.min}..${range.max}`)
            }
          }
        }
        expect([...problems]).toEqual([])
      })

      it('uses the recipe colors for the pack', () => {
        for (const pack of PACKS) expect(buildScene(id, pack, 1, DEFAULT_CONTROLS).colors).toEqual(recipe.fromPack(pack))
      })

      it('changes the scene with each control', () => {
        for (const control of ['intensity', 'softness', 'mood'] as const) {
          const low = buildScene(id, PACKS[0], 1, { ...DEFAULT_CONTROLS, [control]: 0 })
          const high = buildScene(id, PACKS[0], 1, { ...DEFAULT_CONTROLS, [control]: 1 })
          expect(JSON.stringify(low), control).not.toEqual(JSON.stringify(high))
        }
      })
    })
  }
})
