import { describe, expect, it } from 'vitest'
import { resolveBank } from './markBank'

describe('mark banks', () => {
  it('uses the fixed built-in brand bank', () => {
    expect(resolveBank('brand').map((mark) => mark.id)).toEqual([
      'lab-meta',
      'lab-ring',
      'lab-half',
      'lab-cross',
      'lab-dot',
      'lab-square',
    ])
  })
})
