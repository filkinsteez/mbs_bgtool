import { describe, expect, it } from 'vitest'
import { PACKS } from '@/light'
import { packForKey } from './PackPicker'

describe('pack swatches', () => {
  it('move with the arrow keys, wrap at both ends, and jump with Home and End', () => {
    const last = PACKS.length - 1
    expect(packForKey('ArrowRight', 0)).toBe(1)
    expect(packForKey('ArrowDown', last)).toBe(0)
    expect(packForKey('ArrowLeft', 0)).toBe(last)
    expect(packForKey('ArrowUp', 1)).toBe(0)
    expect(packForKey('Home', last)).toBe(0)
    expect(packForKey('End', 0)).toBe(last)
    expect(packForKey('Enter', 1)).toBeNull()
  })
})
