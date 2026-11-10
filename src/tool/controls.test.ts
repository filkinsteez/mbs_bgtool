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
  clampDrag,
  clampPoint,
  CONTROL_MAPPINGS,
  controlsForDrag,
  DEFAULT_CONTROLS,
  FIXED_CONTROLS,
  KEEP_LINE_DISTANCE,
  keepsLine,
  lightPlace,
  moodForPoint,
  moveDragWithMood,
  toolControls,
  type ControlValues,
  type LightDrag,
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
  const length = (drag: LightDrag) => Math.hypot(drag.to[0] - drag.from[0], drag.to[1] - drag.from[1])

  it('keeps line ends within the drag reach, on 0.001 of the frame, and drops lines too short to have a direction', () => {
    expect(clampPoint([-1, 2])).toEqual([-0.5, 1.5])
    expect(clampPoint([-0.45, 1.45])).toEqual([-0.45, 1.45])
    expect(clampPoint([0.12345, 0.5])).toEqual([0.123, 0.5])
    expect(Object.is(clampPoint([-0.0001, 0])[0], 0)).toBe(true)
    expect(clampDrag({ from: [-1, 0.5], to: [2, 0.5] })).toEqual({ from: [-0.5, 0.5], to: [1.5, 0.5] })
    expect(clampDrag({ from: [0.4, 0.4], to: [0.4004, 0.4] })).toBeUndefined()
  })

  it('reads old links the same: no line is the same scene as before', () => {
    for (const id of RECIPE_IDS) {
      for (const pack of PACKS) {
        const before = buildScene(id, pack, 3, DEFAULT_CONTROLS)
        expect(buildScene(id, pack, 3, { ...DEFAULT_CONTROLS, drag: undefined }), id).toEqual(before)
      }
    }
  })

  describe('Sunset: the line start sets the Horizon until a look reads the line', () => {
    it('puts the shared horizon line at the start height, within half a slider step', () => {
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

    it('stops at the ends of the Horizon range', () => {
      for (const seed of SEEDS) {
        expect(moodForPoint('sunset.ramp', PACKS[0], seed, 16 / 9, [0.5, -0.2])).toBe(1)
        expect(moodForPoint('sunset.ramp', PACKS[0], seed, 16 / 9, [0.5, 1.2])).toBe(0)
      }
    })

    it('moves the whole line by the horizon height when Horizon moves, keeping its direction and length, and back', () => {
      const drag: LightDrag = { from: [0.3, 0.55], to: [0.7, 0.25] }
      for (const seed of SEEDS) {
        const from = moodForPoint('sunset.ramp', PACKS[1], seed, 16 / 9, drag.from) ?? 0
        const moved = moveDragWithMood('sunset.ramp', PACKS[1], seed, 16 / 9, drag, from, from + 0.2)
        const shift = placeHorizon(from + 0.2, seed, 16 / 9).y - placeHorizon(from, seed, 16 / 9).y
        expect(moved.from[0]).toBe(0.3)
        expect(moved.to[0]).toBe(0.7)
        expect(moved.from[1]).toBeCloseTo(0.55 + shift, 3)
        expect(moved.to[1]).toBeCloseTo(0.25 + shift, 3)
        expect(moveDragWithMood('sunset.ramp', PACKS[1], seed, 16 / 9, moved, from + 0.2, from)).toEqual(drag)
      }
    })
  })

  describe('Contour: the line start sets Light position, the place along the look path nearest it', () => {
    for (const id of contourLooks) {
      it(`${id}: the light moves along its path, and every place on it gives its own Light position back`, { timeout: 30_000 }, () => {
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

      it(`${id}: Light position after a drag moves the line as far as the light moves along the path, keeping its direction and length`, () => {
        const pack = PACKS[0]
        for (const seed of SEEDS) {
          const place = (mood: number) => lightPlace(buildScene(id, pack, seed, { ...DEFAULT_CONTROLS, mood }, 16 / 9), 16 / 9) ?? [0, 0]
          const start = clampPoint(place(0.3))
          const drag: LightDrag = { from: start, to: clampPoint([start[0] - 0.2, start[1] - 0.15]) }
          const moved = moveDragWithMood(id, pack, seed, 16 / 9, drag, 0.3, 0.6)
          const expected = clampPoint(place(0.6))
          expect(Math.abs(moved.from[0] - expected[0]), `seed ${seed}`).toBeLessThan(0.02)
          expect(Math.abs(moved.from[1] - expected[1]), `seed ${seed}`).toBeLessThan(0.02)
          expect(Math.abs(length(moved) - length(drag)), `seed ${seed}`).toBeLessThan(0.003)
          const middle: LightDrag = { from: [0.45, 0.55], to: [0.6, 0.4] }
          const there = moveDragWithMood(id, pack, seed, 16 / 9, middle, 0.3, 0.6)
          expect(moveDragWithMood(id, pack, seed, 16 / 9, there, 0.6, 0.3), `seed ${seed}`).toEqual(middle)
        }
      })
    }
  })

  it('moves both ends alike on each slider step, equally for equal steps where the path is straight, on the URL steps', () => {
    const onUrlStep = (value: number) => Math.round(value * 1000) / 1000 === value
    for (const id of RECIPE_IDS) {
      for (const seed of [1, 2, 3]) {
        const start: LightDrag = { from: [0.35, 0.7], to: [0.62, 0.36] }
        const first = moodForPoint(id, PACKS[0], seed, 16 / 9, start.from) ?? 0.5
        const direction = first > 0.5 ? -1 : 1
        let line = start
        const moves: number[] = []
        for (let k = 0; k < 12; k++) {
          const from = Math.round((first + direction * k * 0.01) * 100) / 100
          const to = Math.round((first + direction * (k + 1) * 0.01) * 100) / 100
          const next = moveDragWithMood(id, PACKS[0], seed, 16 / 9, line, from, to)
          const shiftFrom = [next.from[0] - line.from[0], next.from[1] - line.from[1]]
          const shiftTo = [next.to[0] - line.to[0], next.to[1] - line.to[1]]
          expect(shiftFrom[0], `${id} seed ${seed} step ${k}`).toBeCloseTo(shiftTo[0], 9)
          expect(shiftFrom[1], `${id} seed ${seed} step ${k}`).toBeCloseTo(shiftTo[1], 9)
          expect([...next.from, ...next.to].every(onUrlStep), `${id} seed ${seed} step ${k}`).toBe(true)
          moves.push(Math.hypot(shiftFrom[0], shiftFrom[1]))
          line = next
        }
        // Beam's light moves along a straight line at an even pace, so every step moves the line the same.
        if (id === 'contour.beam') expect(new Set(moves.map((m) => m.toFixed(6))).size, `seed ${seed}: ${moves.join(' ')}`).toBe(1)
      }
    }
  })

  describe('a new seed, look, pack or format', () => {
    it('keeps a Sunset line wherever it starts', () => {
      const starts: LightPoint[] = [[0.35, 0.7], [-0.25, -0.25], [1.25, 0.5], [0.5, 1.25]]
      for (const id of sunsetLooks) {
        for (const seed of SEEDS) {
          for (const start of starts) expect(keepsLine(id, PACKS[1], seed, 16 / 9, start), `${id} seed ${seed} ${start}`).toBe(true)
        }
      }
    })

    for (const id of contourLooks) {
      it(`${id}: keeps the line when the light can come within ${KEEP_LINE_DISTANCE} of its start, and drops it when it can't`, { timeout: 30_000 }, () => {
        const fine = 48
        for (const aspect of [16 / 9, 9 / 16]) {
          const [fw, fh] = aspect >= 1 ? [aspect, 1] : [1, 1 / aspect]
          for (const seed of [1, 2, 3, 4]) {
            const pack = PACKS[seed % PACKS.length]
            const places = Array.from({ length: fine + 1 }, (_, i) =>
              lightPlace(buildScene(id, pack, seed, { ...DEFAULT_CONTROLS, mood: i / fine }, aspect), aspect),
            ).filter((place) => place !== null)
            expect(places.length).toBe(fine + 1)
            for (const place of places) expect(keepsLine(id, pack, seed, aspect, place), `seed ${seed} ${place}`).toBe(true)
            for (let x = -0.25; x <= 1.25; x += 0.125) {
              for (let y = -0.25; y <= 1.25; y += 0.125) {
                const near = Math.min(...places.map((place) => Math.hypot((place[0] - x) * fw, (place[1] - y) * fh)))
                if (Math.abs(near - KEEP_LINE_DISTANCE) < 0.02) continue
                expect(keepsLine(id, pack, seed, aspect, [x, y]), `${pack.id} seed ${seed} aspect ${aspect.toFixed(2)} start ${x},${y}: ${near.toFixed(3)}`).toBe(
                  near < KEEP_LINE_DISTANCE,
                )
              }
            }
          }
        }
      })
    }
  })

  describe('the controls the tool sends', () => {
    it("are the mood's fixed intensity, softness and mood control without a line", () => {
      for (const id of RECIPE_IDS) {
        expect(toolControls(id, PACKS[0], 5, 16 / 9), id).toEqual(FIXED_CONTROLS[getRecipe(id).mood])
      }
    })

    it('send intensity 0.5 in every mood', () => {
      expect(Object.values(FIXED_CONTROLS).map((fixed) => fixed.intensity)).toEqual([0.5, 0.5])
    })

    it('set the mood control from the start of a line, as controlsForDrag does', () => {
      const drag: LightDrag = { from: [0.3, 0.62], to: [0.75, 0.2] }
      for (const id of RECIPE_IDS) {
        const fixed = FIXED_CONTROLS[getRecipe(id).mood]
        expect(toolControls(id, PACKS[1], 6, 9 / 16, drag), id).toEqual(controlsForDrag(id, PACKS[1], 6, fixed, 9 / 16, drag))
      }
    })
  })

  it('gives the look the line and the mood control set from its start', () => {
    const drag: LightDrag = { from: [0.8, 0.45], to: [0.2, 0.15] }
    for (const id of RECIPE_IDS) {
      for (const aspect of ASPECTS) {
        const controls = controlsForDrag(id, PACKS[2], 4, DEFAULT_CONTROLS, aspect, drag)
        expect(controls).toEqual({ ...DEFAULT_CONTROLS, mood: moodForPoint(id, PACKS[2], 4, aspect, drag.from), drag })
        const scene = buildScene(id, PACKS[2], 4, controls, aspect)
        expect(compositionProblems(getRecipe(id), PACKS[2], scene), id).toEqual([])
        expect(buildScene(id, PACKS[2], 4, controls, aspect), id).toEqual(scene)
      }
    }
  })
})
