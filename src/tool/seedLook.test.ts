import { describe, expect, it } from 'vitest'
import { recipesForMood } from '@/light'
import { lookForSeed } from './seedLook'
import { SEED_MAX, SEED_MIN } from './state'

describe('the look a seed picks', () => {
  it('takes the mood looks in order as the seed rises, starting with the first look at seed 1', () => {
    expect([1, 2, 3, 4, 5, 6].map((seed) => lookForSeed('sunset', seed))).toEqual([
      'sunset.bands',
      'sunset.ramp',
      'sunset.blooms',
      'sunset.bands',
      'sunset.ramp',
      'sunset.blooms',
    ])
    expect([1, 2, 3, 4, 5, 8, 9].map((seed) => lookForSeed('contour', seed))).toEqual([
      'contour.halo',
      'contour.rim',
      'contour.beam',
      'contour.streaks',
      'contour.halo',
      'contour.streaks',
      'contour.halo',
    ])
  })

  it('is look index (seed - 1) mod the number of looks, for every seed Shuffle can pick', () => {
    for (const mood of ['sunset', 'contour'] as const) {
      const looks = recipesForMood(mood).map((recipe) => recipe.id)
      const seen = new Set<string>()
      for (let seed = SEED_MIN; seed <= SEED_MAX; seed++) {
        const look = lookForSeed(mood, seed)
        expect(look, `${mood} seed ${seed}`).toBe(looks[(seed - 1) % looks.length])
        seen.add(look)
      }
      expect([...seen].sort()).toEqual([...looks].sort())
    }
  })
})
