import { describe, expect, it } from 'vitest'
import { LOOKS } from './looks'

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
})
