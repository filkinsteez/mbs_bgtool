import { describe, expect, it } from 'vitest'
import {
  LOOKS,
  V1_LOOK_PATCHES,
  lookComplexityPatch,
  lookPatchFor,
} from './looks'

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

  it('matches every Look preset from commit 67f7de1', () => {
    expect(V1_LOOK_PATCHES).toEqual({
      frame: {
        territory: { bands: ['blocks', 'beads', 'shingle', 'photo'], boundary: 'hard' },
        structure: { baseCell: 30, maxLevels: 1, subdivide: 0.5 },
        finish: { grain: 0.08 },
        sourceVisibility: 0,
      },
      pixels: {
        territory: { bands: ['mosaic', 'mosaic', 'photo'], boundary: 'hard' },
        structure: { baseCell: 40, maxLevels: 1, subdivide: 0.55 },
        finish: { grain: 0.1 },
        sourceVisibility: 0,
      },
      scanlines: {
        territory: { bands: ['scan', 'scan', 'photo'], boundary: 'hard' },
        structure: { baseCell: 24, maxLevels: 0, subdivide: 0 },
        flow: { warp: 1 },
        finish: { grain: 0.12 },
        sourceVisibility: 0,
      },
      streams: {
        territory: { bands: ['streams', 'streams', 'empty', 'photo'], boundary: 'hard' },
        flow: { basis: 'curve', curl: 0.35, scale: 0.5 },
        finish: { grain: 0.1 },
        sourceVisibility: 0,
      },
      brushwork: {
        territory: { bands: ['dabs', 'dabs', 'dabs', 'photo'], boundary: 'hard' },
        structure: { baseCell: 26, maxLevels: 1, subdivide: 0.6 },
        mark: { colorMode: 'source', occupancy: 1 },
        flow: { basis: 'curve', curl: 0.5, scale: 0.35 },
        finish: { grain: 0.18 },
        sourceVisibility: 0,
      },
      beads: {
        territory: { bands: ['beads', 'beads', 'photo'], boundary: 'hard' },
        structure: { baseCell: 40, maxLevels: 0, subdivide: 0 },
        finish: { grain: 0.05 },
        sourceVisibility: 0,
      },
      quilt: {
        territory: { bands: ['blocks', 'blocks', 'photo'], boundary: 'hard' },
        structure: { baseCell: 72, maxLevels: 1, subdivide: 0.35 },
        finish: { grain: 0 },
        sourceVisibility: 0,
      },
      weave: {
        territory: { bands: ['shingle', 'shingle', 'photo'], boundary: 'hard' },
        structure: { baseCell: 84, maxLevels: 1, subdivide: 0.3 },
        finish: { grain: 0.2 },
        sourceVisibility: 0,
      },
      marks: {
        territory: { bands: ['empty', 'marks', 'contours', 'photo'], boundary: 'hard' },
        structure: { baseCell: 28, maxLevels: 2, subdivide: 0.55 },
        mark: { colorMode: 'palette', occupancy: 0.85, echo: 0 },
        finish: { grain: 0.05 },
        sourceVisibility: 0,
      },
      trails: {
        territory: { bands: ['empty', 'marks', 'marks', 'photo'], boundary: 'hard' },
        structure: { baseCell: 34, maxLevels: 0, subdivide: 0 },
        mark: { colorMode: 'palette', echo: 4, bank: 'geo', occupancy: 0.9 },
        flow: { basis: 'angle', angle: 0, curl: 0.15 },
        finish: { grain: 0.1 },
        sourceVisibility: 0,
      },
    })
  })

  it('keeps the V1 cell range but runs it in Complexity direction', () => {
    for (const look of LOOKS) {
      expect(lookComplexityPatch(look.id, 0, 'v1')).toEqual({
        structure: { baseCell: 88 },
      })
      expect(lookComplexityPatch(look.id, 0.5, 'v1')).toEqual({
        structure: { baseCell: 52 },
      })
      expect(lookComplexityPatch(look.id, 1, 'v1')).toEqual({
        structure: { baseCell: 16 },
      })
    }
  })

  it('keeps V1 and V2 presets distinct and preserves V1 empty bands', () => {
    for (const look of LOOKS) {
      expect(lookPatchFor(look, true, 'v1')).toEqual(V1_LOOK_PATCHES[look.id])
    }

    for (const id of ['frame', 'brushwork', 'trails'] as const) {
      const look = LOOKS.find((item) => item.id === id)!
      expect(lookPatchFor(look, true, 'v1')).not.toEqual(lookPatchFor(look, true, 'v2'))
    }
    const trails = LOOKS.find((look) => look.id === 'trails')!
    expect(lookPatchFor(trails, false, 'v1').territory?.bands).toEqual([
      'empty',
      'marks',
      'marks',
      'mosaic',
    ])
  })
})
