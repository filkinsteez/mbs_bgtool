import { describe, expect, it } from 'vitest'
import { META_SYMBOL_HEIGHT, META_SYMBOL_WIDTH } from '@/core/metaSymbol'
import {
  CANONICAL_META_SAFE_AREA,
  canonicalMetaPlacement,
} from './metaInfluence'

describe('canonical Meta influence placement', () => {
  it('keeps intentional internal margins without changing symbol proportions', () => {
    for (const [width, height] of [
      [3840, 2160],
      [2160, 3840],
      [3840, 3840],
      [3072, 3840],
    ]) {
      const placement = canonicalMetaPlacement(width, height)
      const right = width - placement.x - placement.width
      const bottom = height - placement.y - placement.height

      expect(placement.width / placement.height).toBeCloseTo(
        META_SYMBOL_WIDTH / META_SYMBOL_HEIGHT,
        12,
      )
      expect(placement.x).toBeCloseTo(right, 8)
      expect(placement.y).toBeCloseTo(bottom, 8)
      expect(placement.x).toBeGreaterThanOrEqual(
        width * (1 - CANONICAL_META_SAFE_AREA.width) / 2 - 1e-8,
      )
      expect(placement.y).toBeGreaterThanOrEqual(
        height * (1 - CANONICAL_META_SAFE_AREA.height) / 2 - 1e-8,
      )
    }
  })
})
