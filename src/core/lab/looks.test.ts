import { describe, expect, it } from 'vitest'
import { LOOKS, lookComplexityPatch } from './looks'

describe('approved looks', () => {
  it('keeps the ten approved look ids', () => {
    expect(LOOKS.map((l) => l.id)).toEqual([
      'frame',
      'pixels',
      'scanlines',
      'streams',
      'brushwork',
      'beads',
      'quilt',
      'weave',
      'marks',
      'trails',
    ])
  })

  it('maps higher complexity to finer, denser Look-specific structure', () => {
    for (const look of LOOKS) {
      const low = lookComplexityPatch(look.id, 0.15)
      const high = lookComplexityPatch(look.id, 0.85)
      expect(high.structure?.baseCell).toBeLessThan(low.structure?.baseCell ?? 0)
      expect(high.structure?.maxLevels ?? 0).toBeGreaterThanOrEqual(
        low.structure?.maxLevels ?? 0,
      )
      expect(high.mark?.occupancy ?? 1).toBeGreaterThanOrEqual(low.mark?.occupancy ?? 0)
    }
  })
})
