import { describe, expect, it } from 'vitest'
import {
  composeScene,
  compositionProblems,
  DEFAULT_LENS,
  DEFAULT_OUTPUT,
  getRecipe,
  LENS_NUMBERS,
  OUTPUT_NUMBERS,
  PACKS,
  paramProblem,
  RECIPE_IDS,
  recipesForMood,
} from '@/light'
import { placeHorizon } from '@/light/recipes/sunset/horizon'
import {
  buildScene,
  clampPoint,
  CONTROL_MAPPINGS,
  controlsForPoint,
  DEFAULT_CONTROLS,
  lightPlace,
  limitPoint,
  moodForPoint,
  movePointWithMood,
  type ControlValues,
  type LightPoint,
} from './controls'

const STEPS = [0, 0.25, 0.5, 0.75, 1]
const GRID: ControlValues[] = STEPS.flatMap((intensity) =>
  STEPS.flatMap((softness) => STEPS.map((mood) => ({ intensity, softness, mood }))),
)

describe('control mapping', () => {
  it('has compose or a fallback mapping for every recipe', () => {
    for (const id of RECIPE_IDS) expect(Boolean(getRecipe(id).compose || CONTROL_MAPPINGS[id]), id).toBe(true)
  })

  for (const id of RECIPE_IDS) {
    describe(id, () => {
      const recipe = getRecipe(id)

      if (recipe.compose) {
        it('uses the recipe compose, with the frame aspect', () => {
          for (const pack of PACKS) {
            for (const aspect of [16 / 9, 9 / 16]) {
              const scene = buildScene(id, pack, 3, DEFAULT_CONTROLS, aspect)
              expect(scene).toEqual(composeScene(recipe, { pack, controls: DEFAULT_CONTROLS, seed: 3, aspect }))
              expect(compositionProblems(recipe, pack, scene)).toEqual([])
            }
          }
        })
        return
      }

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

describe('dragging the light', () => {
  const ASPECTS = [16 / 9, 9 / 16, 1, 4 / 5]
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]
  const sunsetLooks = recipesForMood('sunset').map((recipe) => recipe.id)
  const contourLooks = recipesForMood('contour').map((recipe) => recipe.id)

  it('keeps points within the drag reach, on 0.001 of the frame', () => {
    expect(clampPoint([-1, 2])).toEqual([-0.25, 1.25])
    expect(clampPoint([0.12345, 0.5])).toEqual([0.123, 0.5])
    expect(Object.is(clampPoint([-0.0001, 0])[0], 0)).toBe(true)
  })

  it('reads old links the same: no point is the same scene as before', () => {
    for (const id of RECIPE_IDS) {
      for (const pack of PACKS) {
        expect(buildScene(id, pack, 3, { ...DEFAULT_CONTROLS, point: undefined }), id).toEqual(buildScene(id, pack, 3, DEFAULT_CONTROLS))
      }
    }
  })

  describe('Sunset: Horizon is the light height', () => {
    it('puts the shared horizon line at the point height, within half a slider step', () => {
      for (const id of sunsetLooks) {
        for (const aspect of ASPECTS) {
          for (const seed of [...SEEDS, 5081]) {
            for (let y = 0.3; y <= 1.04; y += 0.02) {
              const mood = moodForPoint(id, PACKS[0], seed, aspect, [0.5, y])
              expect(mood).not.toBeNull()
              const line = placeHorizon(mood ?? 0, seed, aspect).y
              expect(Math.abs(line - y), `${id} seed ${seed} y ${y.toFixed(2)}`).toBeLessThan(0.0055)
            }
          }
        }
      }
    })

    it('stops at the ends of the Horizon range and keeps the light inside it', () => {
      for (const seed of SEEDS) {
        expect(moodForPoint('sunset.ramp', PACKS[0], seed, 16 / 9, [0.5, -0.2])).toBe(1)
        expect(moodForPoint('sunset.ramp', PACKS[0], seed, 16 / 9, [0.5, 1.2])).toBe(0)
        const top = placeHorizon(1, seed, 16 / 9).y
        const bottom = placeHorizon(0, seed, 16 / 9).y
        expect(limitPoint('sunset.bands', seed, 16 / 9, [1.2, -0.2])).toEqual(clampPoint([1.2, top]))
        expect(limitPoint('sunset.blooms', seed, 16 / 9, [-0.3, 1.3])).toEqual(clampPoint([-0.25, bottom]))
        expect(limitPoint('sunset.ramp', seed, 16 / 9, [0.4, 0.6])).toEqual([0.4, 0.6])
      }
    })

    it('moves the point by the line height when Horizon moves, and back', () => {
      const point: LightPoint = [0.3, 0.55]
      for (const seed of SEEDS) {
        const from = moodForPoint('sunset.ramp', PACKS[1], seed, 16 / 9, point) ?? 0
        const moved = movePointWithMood('sunset.ramp', PACKS[1], seed, 16 / 9, point, from, from + 0.2)
        const shift = placeHorizon(from + 0.2, seed, 16 / 9).y - placeHorizon(from, seed, 16 / 9).y
        expect(moved[0]).toBe(0.3)
        expect(moved[1]).toBeCloseTo(0.55 + shift, 3)
        expect(movePointWithMood('sunset.ramp', PACKS[1], seed, 16 / 9, moved, from + 0.2, from)).toEqual(point)
      }
    })
  })

  describe('Contour: Light position is the place along the look path nearest the point', () => {
    for (const id of contourLooks) {
      it(`${id}: the light moves along its path, and every place on it gives its own Light position back`, () => {
        for (const pack of PACKS) {
          for (const aspect of [16 / 9, 9 / 16]) {
            for (const seed of SEEDS) {
              const place = (mood: number) => lightPlace(buildScene(id, pack, seed, { ...DEFAULT_CONTROLS, mood }, aspect), aspect)
              const first = place(0)
              const last = place(1)
              expect(first, `${pack.id} seed ${seed}`).not.toBeNull()
              expect(last).not.toBeNull()
              if (!first || !last) continue
              expect(Math.hypot(last[0] - first[0], last[1] - first[1]), `${pack.id} seed ${seed}`).toBeGreaterThan(0.05)
              for (const mood of [0, 0.15, 0.4, 0.5, 0.65, 0.9, 1]) {
                const at = place(mood)
                if (at) expect(moodForPoint(id, pack, seed, aspect, at), `${pack.id} seed ${seed} mood ${mood}`).toBe(mood)
              }
            }
          }
        }
      })

      it(`${id}: Light position after a drag moves the point as far as the light moves along the path`, () => {
        const pack = PACKS[0]
        for (const seed of SEEDS) {
          const place = (mood: number) => lightPlace(buildScene(id, pack, seed, { ...DEFAULT_CONTROLS, mood }, 16 / 9), 16 / 9) ?? [0, 0]
          const onPath = clampPoint(place(0.3))
          const moved = movePointWithMood(id, pack, seed, 16 / 9, onPath, 0.3, 0.6)
          const expected = clampPoint(place(0.6))
          expect(Math.abs(moved[0] - expected[0]), `seed ${seed}`).toBeLessThan(0.02)
          expect(Math.abs(moved[1] - expected[1]), `seed ${seed}`).toBeLessThan(0.02)
          const offPath: LightPoint = [0.45, 0.55]
          const there = movePointWithMood(id, pack, seed, 16 / 9, offPath, 0.3, 0.6)
          expect(movePointWithMood(id, pack, seed, 16 / 9, there, 0.6, 0.3), `seed ${seed}`).toEqual(offPath)
        }
      })
    }
  })

  it('gives the look the dragged point and the slider value that shows it', () => {
    for (const id of RECIPE_IDS) {
      for (const aspect of ASPECTS) {
        const controls = controlsForPoint(id, PACKS[2], 4, DEFAULT_CONTROLS, aspect, [0.8, 0.45])
        expect(controls.point, id).toEqual(limitPoint(id, 4, aspect, [0.8, 0.45]))
        expect(controls.mood, id).toBe(moodForPoint(id, PACKS[2], 4, aspect, controls.point))
        const scene = buildScene(id, PACKS[2], 4, controls, aspect)
        expect(compositionProblems(getRecipe(id), PACKS[2], scene), id).toEqual([])
        expect(buildScene(id, PACKS[2], 4, controls, aspect), id).toEqual(scene)
      }
    }
  })
})
