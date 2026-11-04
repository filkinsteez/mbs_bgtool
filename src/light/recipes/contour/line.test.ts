import { describe, expect, it } from 'vitest'
import { getPack } from '../../color/packs'
import type { ControlValues, ParamValue } from '../../scene'
import { contourBeam } from './beam'
import { contourStreaks } from './streaks'

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

const compose = (recipe: typeof contourBeam, pack: string, seed: number, drag?: NonNullable<ControlValues['drag']>) =>
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
  it('leaves the seed scene unturned', () => {
    for (const pack of PACKS) {
      for (const seed of SEEDS) {
        expect(compose(contourBeam, pack, seed)).not.toHaveProperty('turn')
        expect(compose(contourBeam, pack, seed)).not.toHaveProperty('source')
        expect(compose(contourStreaks, pack, seed)).not.toHaveProperty('turn')
        expect(compose(contourStreaks, pack, seed)).not.toHaveProperty('reach')
      }
    }
  })
})
