import { describe, expect, it } from 'vitest'
import { HORIZON_BELOW, horizonScene, placeHorizon } from './horizon'

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1)
const ASPECTS = [16 / 9, 9 / 16, 1, 4 / 5]

describe('placeHorizon', () => {
  it('maps the Horizon control to the shared heights, with a seeded shift of at most 0.05', () => {
    const targets: [number, number][] = [
      [0.25, 0.8625],
      [0.5, 0.665],
      [0.75, 0.4675],
    ]
    for (const [control, y] of targets) {
      const ys = SEEDS.map((seed) => placeHorizon(control, seed, 16 / 9).y)
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(y - 0.05 - 1e-9)
      expect(Math.max(...ys)).toBeLessThanOrEqual(y + 0.05 + 1e-9)
      // the seed does move it
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.05)
    }
  })

  it('keeps Horizon 0 below the frame and Horizon 1 at 27% for every seed', () => {
    for (const seed of SEEDS) {
      expect(placeHorizon(0, seed, 16 / 9).y).toBeCloseTo(1.06, 9)
      expect(placeHorizon(1, seed, 16 / 9).y).toBeCloseTo(0.27, 9)
    }
  })

  it('keeps a water or land line below the whole bottom edge at Horizon 0', () => {
    for (const aspect of ASPECTS) {
      for (const seed of SEEDS) {
        const { y, below, tilt } = placeHorizon(0, seed, aspect)
        if (below === 'open') continue
        const rise = Math.abs(Math.tan((tilt * Math.PI) / 180)) * (aspect / 2)
        expect(y - rise).toBeGreaterThan(1)
      }
    }
  })

  it('keeps water level and lets land and open sky tilt up to 12 degrees', () => {
    let steepest = 0
    for (const aspect of ASPECTS) {
      for (const seed of SEEDS) {
        const { below, tilt } = placeHorizon(0.5, seed, aspect)
        if (below === 'water') expect(Math.abs(tilt)).toBeLessThanOrEqual(0.5)
        else {
          expect(Math.abs(tilt)).toBeLessThanOrEqual(12)
          expect(Math.abs(tilt)).toBeGreaterThanOrEqual(2 - 1e-9)
          // a tilted line rises at most a third of the frame height across the frame
          expect(Math.abs(Math.tan((tilt * Math.PI) / 180)) * aspect).toBeLessThanOrEqual(0.35 + 1e-9)
        }
        steepest = Math.max(steepest, Math.abs(tilt))
      }
    }
    expect(steepest).toBeGreaterThan(10)
  })

  it('shows a horizon (water or land) for 2 seeds in 3 at the default', () => {
    const shown = SEEDS.filter((seed) => placeHorizon(0.5, seed, 16 / 9).below !== 'open').length
    expect(shown / SEEDS.length).toBeCloseTo(2 / 3, 5)
  })

  it('gives the same answer for the same input, and stays in range for any control', () => {
    expect(placeHorizon(0.37, 42, 16 / 9)).toEqual(placeHorizon(0.37, 42, 16 / 9))
    for (const control of [-1, 2, Number.NaN]) {
      const { y } = placeHorizon(control, 7, 16 / 9)
      expect(y).toBeGreaterThanOrEqual(0.27 - 1e-9)
      expect(y).toBeLessThanOrEqual(1.06 + 1e-9)
    }
  })
})

describe('horizonScene', () => {
  it('holds every scene once in each run of three seeds', () => {
    for (let run = 0; run < 100; run++) {
      const scenes = [1, 2, 3].map((k) => horizonScene(run * 3 + k))
      expect([...scenes].sort()).toEqual([...HORIZON_BELOW].sort())
    }
  })

  it('does not repeat the same order in every run', () => {
    const orders = new Set(Array.from({ length: 30 }, (_, run) => [1, 2, 3].map((k) => horizonScene(run * 3 + k)).join(',')))
    expect(orders.size).toBeGreaterThan(3)
  })
})
