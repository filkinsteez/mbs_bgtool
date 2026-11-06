import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PACKS, RECIPE_IDS } from '@/light'
import { FILTER_OPTIONS } from './filterControl'
import { filterPicture, lookPicture } from './panelPictures'
import { optionForKey } from './TilePicker'

describe('panel tiles', () => {
  it('move with the arrow keys, wrap at both ends, and jump with Home and End', () => {
    expect(optionForKey('ArrowRight', 0, 4)).toBe(1)
    expect(optionForKey('ArrowDown', 3, 4)).toBe(0)
    expect(optionForKey('ArrowLeft', 0, 4)).toBe(3)
    expect(optionForKey('ArrowUp', 1, 4)).toBe(0)
    expect(optionForKey('Home', 3, 4)).toBe(0)
    expect(optionForKey('End', 0, 4)).toBe(3)
    expect(optionForKey('Enter', 1, 4)).toBeNull()
  })

  it('have a picture for every look and filter in every pack', () => {
    const pictures = PACKS.flatMap((pack) => [
      ...RECIPE_IDS.map((look) => lookPicture(look, pack.id)),
      ...FILTER_OPTIONS.map((option) => filterPicture(option.value, pack.id)),
    ])
    expect(pictures.filter((src) => !existsSync(path.join(process.cwd(), 'public', src)))).toEqual([])
  })
})
