import { describe, expect, it } from 'vitest'
import { getPack, type PackId } from '../../color/packs'
import { compositionProblems } from '../../compose'
import type { ControlValues, ParamValue } from '../../scene'
import { contourBeam } from './beam'
import { airGlowAt, pickContourLight, seededRandom } from './beam-compose'
import { contourStreaks, whiteLevelOf } from './streaks'

const MIDDLE = { intensity: 0.5, softness: 0.5, mood: 0.5 }
const ASPECT = 16 / 9
const PACKS = ['bold', 'elemental', 'atmospheric'] as const
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]

/** A line from (x, y) in frame units, at an angle in degrees (0 right, -90 up), `length` short sides long. */
function lineAt(x: number, y: number, degrees: number, length: number): NonNullable<ControlValues['drag']> {
  const a = (degrees * Math.PI) / 180
  return { from: [x, y], to: [x + (length * Math.cos(a)) / ASPECT, y + length * Math.sin(a)] }
}

const LINES = [lineAt(0.5, 0.3, 90, 0.6), lineAt(0.3, 0.2, 60, 0.7), lineAt(0.5, 0.55, 0, 0.5), lineAt(0.5, 0.85, -90, 0.6), lineAt(0.8, 0.6, -150, 0.3), lineAt(1.1, -0.2, 120, 1.1)]

/** Frame units to short-side units from the frame's center (16:9). */
const shorts = (point: readonly number[]) => [(point[0] - 0.5) * ASPECT, point[1] - 0.5]

/** The scene point a screen point shows under a turn param. */
const toScene = (turn: number[], p: number[]) => [p[0] * turn[0] + p[1] * turn[1] + turn[2], -p[0] * turn[1] + p[1] * turn[0] + turn[3]]

/** The scene direction a screen direction shows under a turn param. */
const turnBack = (turn: number[], d: number[]) => [d[0] * turn[0] + d[1] * turn[1], -d[0] * turn[1] + d[1] * turn[0]]

const unit = (d: number[]) => {
  const length = Math.hypot(d[0], d[1])
  return [d[0] / length, d[1] / length]
}

function beamPool(params: Record<string, ParamValue>) {
  const num = (key: string) => params[key] as number
  const horizon = num('horizon')
  const focal = num('focal')
  const edgeY = Math.max(num('floorY'), horizon + 0.01)
  const k = Math.min(0.9, (num('landing') * num('beamWidth')) / focal)
  const landingZ = focal / (edgeY - horizon) / (1 - k)
  return { at: [num('beamAt'), horizon + (edgeY - horizon) * (1 - k)], landingZ, landingX: (num('beamAt') * landingZ) / focal }
}

const compose = (recipe: typeof contourBeam, pack: PackId, seed: number, drag?: NonNullable<ControlValues['drag']>) =>
  recipe.compose!({ pack: getPack(pack), controls: { ...MIDDLE, ...(drag ? { drag } : {}) }, seed, aspect: ASPECT }).params

describe('a dragged line on Beam', () => {
  it('lands the beam at the line end, along the line', () => {
    for (const pack of PACKS) {
      for (const seed of SEEDS) {
        for (const drag of LINES) {
          const params = compose(contourBeam, pack, seed, drag)
          const turn = params.turn as number[]
          const pool = beamPool(params)
          const landed = toScene(turn, shorts(drag.to))
          expect(Math.hypot(landed[0] - pool.at[0], landed[1] - pool.at[1]), `${pack} ${seed}`).toBeLessThan(2e-3)
          // The beam's direction toward its pool on the unturned stage.
          const [tiltX, tiltZ] = params.tilt as number[]
          const beam = unit([tiltX * pool.landingZ - pool.landingX * tiltZ, pool.landingZ - tiltZ])
          const along = unit(turnBack(turn, unit([shorts(drag.to)[0] - shorts(drag.from)[0], shorts(drag.to)[1] - shorts(drag.from)[1]])))
          expect(Math.hypot(along[0] - beam[0], along[1] - beam[1]), `${pack} ${seed}`).toBeLessThan(2e-3)
        }
      }
    }
  })

  it('does not flip the beam when the line turns through straight up', () => {
    for (const seed of SEEDS) {
      const left = compose(contourBeam, 'bold', seed, lineAt(0.5, 0.8, -90.2, 0.5))
      const right = compose(contourBeam, 'bold', seed, lineAt(0.5, 0.8, -89.8, 0.5))
      for (const key of ['tilt', 'turn', 'source']) {
        const a = left[key] as number[]
        const b = right[key] as number[]
        a.forEach((v, i) => expect(Math.abs(v - b[i]), `${seed} ${key}`).toBeLessThan(0.02))
      }
    }
  })
})

describe('a dragged line on Streaks', () => {
  it('meets the shafts at the line start and points the lit sky along the line', () => {
    for (const pack of PACKS) {
      for (const seed of SEEDS) {
        for (const drag of LINES) {
          const params = compose(contourStreaks, pack, seed, drag)
          const turn = params.turn as number[]
          const center = params.center as number[]
          const from = shorts(drag.from)
          expect(Math.hypot(center[0] - from[0], center[1] - from[1])).toBeLessThan(1e-3)
          const fixed = toScene(turn, from)
          expect(Math.hypot(fixed[0] - from[0], fixed[1] - from[1])).toBeLessThan(2e-3)
          const along = turnBack(turn, [shorts(drag.to)[0] - from[0], shorts(drag.to)[1] - from[1]])
          const angle = Math.atan2(along[1], along[0])
          const sky = params.sky as number[]
          expect(angle, `${pack} ${seed}`).toBeGreaterThanOrEqual(Math.min(sky[0], sky[1]) - 1e-3)
          expect(angle, `${pack} ${seed}`).toBeLessThanOrEqual(Math.max(sky[0], sky[1]) + 1e-3)
        }
      }
    }
  })

  it('does not flip the scene when the line turns through straight down', () => {
    for (const seed of SEEDS) {
      const left = compose(contourStreaks, 'bold', seed, lineAt(0.5, 0.3, 90.2, 0.5))
      const right = compose(contourStreaks, 'bold', seed, lineAt(0.5, 0.3, 89.8, 0.5))
      for (const key of ['sky', 'turn']) {
        const a = left[key] as number[]
        const b = right[key] as number[]
        a.forEach((v, i) => expect(Math.abs(v - b[i]), `${seed} ${key}`).toBeLessThan(0.02))
      }
    }
  })
})

describe('without a line', () => {
  it("leaves the seed scene unturned, but for a Streaks sun above the frame, whose shafts land on a floor", () => {
    for (const pack of PACKS) {
      for (const seed of SEEDS) {
        const beam = compose(contourBeam, pack, seed)
        expect(beam).not.toHaveProperty('turn')
        // A hanging lamp's beam starts inside the frame, out of its mouth's glow.
        if (beam.source) expect((beam.mouth as number[])[0], `${pack} ${seed}`).toBeGreaterThan(0)
        const streaks = compose(contourStreaks, pack, seed)
        if (streaks.turn) expect((streaks.downFloor as number[])[0], `${pack} ${seed}`).toBeGreaterThan(0.5)
        else expect(streaks).not.toHaveProperty('reach')
      }
    }
  })
})

/** The SHARED.md test line high above the frame, pointing up. */
const HIGH_ABOVE = { from: [0.5, -0.3] as [number, number], to: [0.5, -0.5] as [number, number] }

describe('a light outside the frame', () => {
  it('lights the frame edge nearest it at least as light as its own color, and only then', () => {
    for (const recipe of [contourBeam, contourStreaks]) {
      for (const pack of PACKS) {
        for (const seed of SEEDS) {
          const [level, falloff, sharpness, scale] = compose(recipe, pack, seed, HIGH_ABOVE).airGlow as number[]
          const glowLine = compose(recipe, pack, seed, HIGH_ABOVE).glowLine as number[]
          // The glow's brightest point on the top edge, the edge nearest the light; one scattered unit has the haze's own luminance.
          const brightest = Math.max(...Array.from({ length: 97 }, (_, i) => airGlowAt([(i / 96 - 0.5) * ASPECT, -0.5], glowLine, falloff)))
          expect(level * (scale * brightest) ** sharpness, `${recipe.id} ${pack} ${seed}`).toBeGreaterThan(0.999)
          // Beam's light is its whole beam, which these lines put in the frame; Streaks' is the point where its shafts meet.
          const inFrame = LINES.filter((d) => recipe === contourBeam || d.from.every((v) => v >= 0 && v <= 1))
          for (const drag of inFrame) expect((compose(recipe, pack, seed, drag).airGlow as number[])[0], `${recipe.id} ${pack} ${seed}`).toBe(0)
        }
      }
    }
  })
})

describe('every dragged composition', () => {
  it('fits the recipe params, the test lines and a light as far outside the frame as a line reaches', () => {
    const lines = [
      HIGH_ABOVE,
      { from: [1.011, 1.224] as [number, number], to: [-0.078, -0.067] as [number, number] },
      { from: [-0.011, 1.224] as [number, number], to: [1.078, -0.067] as [number, number] },
      { from: [0.9, 0.5] as [number, number], to: [0.1, 0.5] as [number, number] },
      { from: [1.5, 1.5] as [number, number], to: [1.45, 1.4] as [number, number] },
      { from: [-0.5, 0.5] as [number, number], to: [-0.5, 0.4] as [number, number] },
      { from: [0.5, -0.3] as [number, number], to: [0.5, 0.5] as [number, number] },
    ]
    for (const recipe of [contourBeam, contourStreaks]) {
      for (const pack of PACKS) {
        for (const seed of SEEDS) {
          for (const aspect of [16 / 9, 9 / 16]) {
            for (const drag of lines) {
              const composition = recipe.compose!({ pack: getPack(pack), controls: { ...MIDDLE, drag }, seed, aspect })
              expect(compositionProblems(recipe, getPack(pack), composition), `${recipe.id} ${pack} ${seed} ${aspect}`).toEqual([])
            }
          }
        }
      }
    }
  })
})

describe('Streaks seeds under the same line', () => {
  it('keep their own composition: two seeds with one light differ in at least two choices', () => {
    const owner = { from: [1.011, 1.224] as [number, number], to: [-0.078, -0.067] as [number, number] }
    for (const drag of [owner, HIGH_ABOVE]) {
      for (const pack of PACKS) {
        const frames = SEEDS.map((seed) => contourStreaks.compose!({ pack: getPack(pack), controls: { ...MIDDLE, drag }, seed, aspect: ASPECT }))
        const choices = frames.map(({ params }) => {
          const sky = params.sky as number[]
          return [Math.sign(sky[1] - sky[0]), (params.clouds as number[])[3], sky[2], (params.floor as number[])[2], Math.round(Math.abs(sky[1] - sky[0]) * 2)]
        })
        for (let a = 0; a < SEEDS.length; a++) {
          for (let b = a + 1; b < SEEDS.length; b++) {
            if (frames[a].colors[1] !== frames[b].colors[1]) continue
            const differ = choices[a].filter((v, i) => Math.abs(v - choices[b][i]) > 1e-3).length
            expect(differ, `${pack} s${SEEDS[a]}/s${SEEDS[b]}`).toBeGreaterThanOrEqual(2)
          }
        }
      }
    }
  })
})

describe("Streaks' sky, floor pool and horizon band", () => {
  it('stay under the level where the light turns flat white, at every seed, format and test line', () => {
    const lines = [
      undefined,
      HIGH_ABOVE,
      { from: [1.011, 1.224] as [number, number], to: [-0.078, -0.067] as [number, number] },
      { from: [-0.011, 1.224] as [number, number], to: [1.078, -0.067] as [number, number] },
      { from: [0.9, 0.5] as [number, number], to: [0.1, 0.5] as [number, number] },
      { from: [0.5, -0.3] as [number, number], to: [0.5, 0.5] as [number, number] },
    ]
    for (const pack of PACKS) {
      for (let seed = 1; seed <= 40; seed++) {
        const light = pickContourLight(getPack(pack), seed, seededRandom(seed, 0x57e4))
        for (const aspect of [16 / 9, 9 / 16]) {
          for (const drag of lines) {
            for (const intensity of [0.5, 1]) {
              const { params, colors } = contourStreaks.compose!({ pack: getPack(pack), controls: { ...MIDDLE, intensity, ...(drag ? { drag } : {}) }, seed, aspect })
              expect(colors.slice(0, 2)).toEqual([light.light, light.haze])
              const white = whiteLevelOf(light, params)
              const levels = [(params.skyLevel as number[])[0], (params.floor as number[])[1], (params.band as number[])[0], ((params.downPool as number[] | undefined) ?? [0, 0, 0, 0])[3]]
              for (const level of levels) expect(level, `${pack} s${seed} ${aspect} ${drag ? drag.from : 'default'} ${intensity}`).toBeLessThan(white)
            }
          }
        }
      }
    }
  })
})

describe('the packs that share Meta Blue', () => {
  it("keep Bold's Meta Blue saturated and turning Cyan, and veil Atmospheric's", () => {
    const hex = (pack: PackId, name: string) => getPack(pack).colors.find((c) => c.name === name)!.hex
    /** The first seed whose haze is Meta Blue in a pack. */
    const blueSeed = (pack: PackId) => SEEDS.find((seed) => pickContourLight(getPack(pack), seed, seededRandom(seed, 0)).haze === hex(pack, 'Meta Blue'))!
    for (const recipe of [contourBeam, contourStreaks]) {
      const bold = recipe.compose!({ pack: getPack('bold'), controls: MIDDLE, seed: blueSeed('bold'), aspect: ASPECT })
      const atmospheric = recipe.compose!({ pack: getPack('atmospheric'), controls: MIDDLE, seed: blueSeed('atmospheric'), aspect: ASPECT })
      expect(bold.colors.slice(0, 2), recipe.id).toEqual([hex('bold', 'Cyan'), hex('bold', 'Meta Blue')])
      expect((bold.params.veil as number[])[0], recipe.id).toBe(1)
      expect(atmospheric.colors[1], recipe.id).toBe(hex('atmospheric', 'Meta Blue'))
      expect((atmospheric.params.veil as number[])[0], recipe.id).toBeLessThan(0.5)
    }
  })
})

describe("Beam's haze light under a line", () => {
  it('is the seed own without a line or under a short one, and grows with a long line for an unlifted light', () => {
    const short = lineAt(0.5, 0.3, 90, 0.6)
    const owner = { from: [1.011, 1.224] as [number, number], to: [-0.078, -0.067] as [number, number] }
    for (const pack of PACKS) {
      for (const seed of SEEDS) {
        const light = pickContourLight(getPack(pack), seed, seededRandom(seed, 0xbea))
        expect(compose(contourBeam, pack, seed).beamHaze ?? 1, `${pack} ${seed}`).toBe(1)
        expect(compose(contourBeam, pack, seed, short).beamHaze, `${pack} ${seed}`).toBe(1)
        const long = compose(contourBeam, pack, seed, owner).beamHaze as number
        if (light.lift === 1) expect(long, `${pack} ${seed}`).toBeGreaterThan(1.2)
        else expect(long, `${pack} ${seed}`).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe("Beam under a line longer than the frame's short side", () => {
  it('thickens its haze layers with the line, so the beam shows along it', () => {
    const owner = { from: [1.011, 1.224] as [number, number], to: [-0.078, -0.067] as [number, number] }
    for (const pack of PACKS) {
      for (const seed of SEEDS) {
        const own = compose(contourBeam, pack, seed)
        const dragged = compose(contourBeam, pack, seed, owner)
        // The seed's dense layer (at the source or at the pool) is far deeper, the other no thinner.
        const ratios = [(dragged.ceiling as number[])[1] / (own.ceiling as number[])[1], (dragged.floorHaze as number[])[1] / (own.floorHaze as number[])[1]]
        expect(Math.max(...ratios), `${pack} ${seed}`).toBeGreaterThan(2)
        expect(Math.min(...ratios), `${pack} ${seed}`).toBeGreaterThan(1)
      }
    }
  })
})
