import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildCurveField as buildCurrentCurveField, META_CURVE } from '../territory'
import {
  V1_META_SYMBOL_GEOMETRY,
  V1_META_SYMBOL_HEIGHT,
  V1_META_SYMBOL_PATH,
  V1_META_SYMBOL_WIDTH,
} from './metaSymbol'
import { buildCurveField } from './territory'

const SILHOUETTE = {
  ...META_CURVE,
  amplitudeX: 1,
  amplitudeY: 1,
  silhouette: 'meta-symbol' as const,
}

describe('V1 Meta geometry isolation', () => {
  it('pins the exact symbol geometry used by renderer commit 67f7de1', () => {
    expect(V1_META_SYMBOL_WIDTH).toBe(20)
    expect(V1_META_SYMBOL_HEIGHT).toBe(14)
    expect(V1_META_SYMBOL_WIDTH / V1_META_SYMBOL_HEIGHT).toBe(20 / 14)
    expect(V1_META_SYMBOL_GEOMETRY.path).toBe(V1_META_SYMBOL_PATH)
    expect(createHash('sha256').update(V1_META_SYMBOL_PATH).digest('hex'))
      .toBe('0d8c18da76a1c2a6e3507d8f281ad7e57cdd237158dbdb7cf92c9b56525a49c3')
  })

  it('keeps V1 fields on the archived geometry while shared fields use the official shape', () => {
    const legacy = buildCurveField(SILHOUETTE, 400, 280, 0.001)
    const current = buildCurrentCurveField(SILHOUETTE, 400, 280, 0.001)

    expect(legacy(287, 2)).toBeGreaterThan(current(287, 2) + 0.2)
  })
})
