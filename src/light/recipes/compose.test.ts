import { describe, expect, it } from 'vitest'
import { getPack, PACKS } from '../color/packs'
import { compositionProblems } from '../compose'
import type { ComposeInput, ControlValues, RecipeDefinition } from '../scene'
import { RECIPE_LIST } from './index'

const SEEDS = [1, 2, 7, 42, 1234]
const ASPECTS = [16 / 9, 9 / 16, 1, 4 / 5]
const STEPS = [0, 0.5, 1]
const GRID: ControlValues[] = STEPS.flatMap((intensity) => STEPS.flatMap((softness) => STEPS.map((mood) => ({ intensity, softness, mood }))))
const MIDDLE: ControlValues = { intensity: 0.5, softness: 0.5, mood: 0.5 }

describe('compositionProblems', () => {
  const recipe: RecipeDefinition = {
    id: 'sunset.ramp',
    mood: 'sunset',
    label: 'Test',
    colorSlots: [
      { key: 'sky', label: 'Sky' },
      { key: 'light', label: 'Light' },
    ],
    defaultColors: ['#0064E0', '#FFD61E'],
    params: [
      { kind: 'number', key: 'horizon', label: 'Horizon', min: 0, max: 1, step: 0.01, default: 0.5 },
      { kind: 'vector', key: 'at', label: 'At', min: 0, max: 1, step: 0.01, default: [0.5, 0.5] },
    ],
    fragment: 'vec3 radiance(vec2 uv, vec2 p) { return vec3(0.0); }',
    uniforms: () => ({}),
    fromPack: () => ['#0064E0', '#FFD61E'],
  }
  const bold = getPack('bold')

  it('accepts pack colors, black, declared params and known settings in range', () => {
    const problems = compositionProblems(recipe, bold, {
      colors: ['#0064E0', '#000000'],
      params: { horizon: 0.4, at: [0.2, 0.9] },
      lens: { bloom: 0.1, bloomLevels: [1, 0.5], halationTint: '#FF4F00' },
      output: { exposure: 0.5 },
    })
    expect(problems).toEqual([])
  })

  it('reports colors from another pack, unknown keys, wrong kinds and values out of range', () => {
    const problems = compositionProblems(recipe, bold, {
      colors: ['#0064E0', '#D6F26C'],
      params: { horizon: 2, at: [0.5], glow: 1 },
      lens: { bloom: -1, flare: 1 } as Record<string, number>,
      output: { exposure: 'x' } as unknown as Record<string, number>,
    })
    expect(problems).toEqual([
      'color 1 (light) = #D6F26C is not a bold color',
      'param horizon 2 is outside 0..1',
      'param at is not a vector of 2',
      'param glow is not in the recipe params',
      'lens.bloom = -1 is outside 0..1',
      'lens.flare does not exist',
      'output.exposure = x is not a finite number',
    ])
  })
})

describe('recipe compose', () => {
  const composers = RECIPE_LIST.filter((recipe) => recipe.compose)

  it('runs on the recipes that define it', () => {
    expect(composers.every((recipe) => typeof recipe.compose === 'function')).toBe(true)
  })

  for (const recipe of composers) {
    const compose = (input: ComposeInput) => (recipe.compose as NonNullable<RecipeDefinition['compose']>)(input)

    describe(recipe.id, () => {
      it('writes declared params, known lens and output settings in range, and only exact hexes of the pack', () => {
        const problems = new Set<string>()
        for (const pack of PACKS) {
          for (const seed of SEEDS) {
            for (const aspect of ASPECTS) {
              for (const controls of GRID) {
                for (const problem of compositionProblems(recipe, pack, compose({ pack, controls, seed, aspect }))) {
                  problems.add(`${pack.id}: ${problem}`)
                }
              }
            }
          }
        }
        expect([...problems].slice(0, 20)).toEqual([])
      })

      it('gives the same composition for the same input', () => {
        for (const pack of PACKS) {
          const input = { pack, controls: MIDDLE, seed: 7, aspect: 16 / 9 }
          expect(JSON.stringify(compose(input))).toEqual(JSON.stringify(compose(input)))
        }
      })

      it('changes with the seed and with each control', () => {
        for (const pack of PACKS) {
          const base = { pack, controls: MIDDLE, seed: 1, aspect: 16 / 9 }
          const first = JSON.stringify(compose(base))
          expect(
            SEEDS.slice(1).some((seed) => JSON.stringify(compose({ ...base, seed })) !== first),
            `${pack.id}: every seed gives the same composition`,
          ).toBe(true)
          for (const control of ['intensity', 'softness', 'mood'] as const) {
            const low = JSON.stringify(compose({ ...base, controls: { ...MIDDLE, [control]: 0 } }))
            const high = JSON.stringify(compose({ ...base, controls: { ...MIDDLE, [control]: 1 } }))
            expect(low, `${pack.id}: ${control} 0 and 1 give the same composition`).not.toEqual(high)
          }
        }
      })
    })
  }
})
