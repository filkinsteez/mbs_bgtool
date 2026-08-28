import { describe, expect, it } from 'vitest'
import {
  META_SYMBOL_ASPECT_RATIO,
  META_SYMBOL_PATH,
} from '@/core/metaSymbol'
import { resolveBank } from './markBank'

describe('mark banks', () => {
  it('uses the exact official symbol in the V2 brand bank', () => {
    const bank = resolveBank('brand', 'v2')
    expect(bank.map((mark) => mark.id)).toEqual([
      'lab-meta',
      'lab-ring',
      'lab-half',
      'lab-cross',
      'lab-dot',
      'lab-square',
    ])
    expect(bank[0]).toMatchObject({
      kind: 'path',
      d: META_SYMBOL_PATH,
    })
    if (bank[0].kind !== 'path' || !bank[0].pathBounds) {
      throw new Error('Official Meta mark bounds are missing')
    }
    expect(bank[0].pathBounds.width / bank[0].pathBounds.height)
      .toBe(META_SYMBOL_ASPECT_RATIO)
  })

  it('keeps the fitted commit-era mark isolated in V1', () => {
    const current = resolveBank('brand', 'v2')[0]
    const legacy = resolveBank('brand', 'v1')[0]
    expect(legacy.id).toBe(current.id)
    expect(legacy.kind).toBe('path')
    expect(current.kind).toBe('path')
    if (legacy.kind !== 'path' || current.kind !== 'path') return
    expect(legacy.d).not.toBe(current.d)
    expect(legacy.pathBounds).toBeUndefined()
  })
})
