import { describe, expect, it } from 'vitest'
import {
  buildWeightedPalette,
  colorMixForPack,
  ELEMENTAL_ACCENTS,
  META_BLUE,
  migrateLegacyHex,
  PALETTE_PACKS,
} from './registry'

describe('production Color Packs', () => {
  it('contains only the five approved packs with two or three colors', () => {
    expect(PALETTE_PACKS.map((pack) => pack.id)).toEqual([
      'blues',
      'primary',
      'bold',
      'atmospheric',
      'elemental',
    ])
    for (const pack of PALETTE_PACKS) {
      expect(pack.colors.length).toBeGreaterThanOrEqual(2)
      expect(pack.colors.length).toBeLessThanOrEqual(3)
      expect(pack.colors[0]).toBe(META_BLUE)
    }
  })

  it('keeps Elemental to Meta blue plus one approved accent', () => {
    expect(ELEMENTAL_ACCENTS).toEqual([
      '#D5F57A',
      '#174A3A',
      '#B69D74',
      '#410840',
    ])
    const pack = PALETTE_PACKS.find((item) => item.id === 'elemental')!
    expect(pack.colors).toEqual([META_BLUE, ELEMENTAL_ACCENTS[0]])
  })

  it('deals a normalized Meta-blue-led mix', () => {
    for (const pack of PALETTE_PACKS) {
      const mix = colorMixForPack(pack)
      expect(mix[0]).toEqual({
        color: META_BLUE,
        enabled: true,
        ratio: 70,
      })
      expect(mix.reduce((sum, item) => sum + item.ratio, 0)).toBe(100)
      expect(mix.every((item) => item.enabled)).toBe(true)
    }
  })

  it('clamps the Meta blue share to the approved range', () => {
    const pack = PALETTE_PACKS[0]
    expect(colorMixForPack(pack, 0)[0].ratio).toBe(50)
    expect(colorMixForPack(pack, 100)[0].ratio).toBe(95)
  })

  it('migrates corrected brand values and preserves current values', () => {
    expect(migrateLegacyHex('#26C8EE')).toBe('#25C8EE')
    expect(migrateLegacyHex(META_BLUE)).toBe(META_BLUE)
  })

  it('allocates weighted raster palette slots deterministically', () => {
    const palette = buildWeightedPalette([
      { color: META_BLUE, enabled: true, ratio: 70 },
      { color: '#FFFFFF', enabled: true, ratio: 30 },
    ], 10)
    expect(palette.filter((color) => color === META_BLUE)).toHaveLength(7)
    expect(palette.filter((color) => color === '#FFFFFF')).toHaveLength(3)
  })
})
