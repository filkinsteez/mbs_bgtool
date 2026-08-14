import { describe, expect, it } from 'vitest'
import {
  buildWeightedPalette,
  META_BLUE,
  normalizeColorRatios,
  PALETTE_PACKS,
} from './registry'
import { EXTENDED_APPROVED_COLORS } from './extended'

describe('palette registry', () => {
  it('contains primary and secondary packs', () => {
    expect(PALETTE_PACKS.some((p) => p.tier === 'primary')).toBe(true)
    expect(PALETTE_PACKS.some((p) => p.tier === 'secondary')).toBe(true)
  })

  it('keeps the approved values and all 391 extended swatches', () => {
    expect(META_BLUE).toBe('#0064E0')
    expect(PALETTE_PACKS.find((pack) => pack.id === 'primary-core')?.colors).toEqual([
      '#0288F9', '#006CE1', '#034AE0', '#093AC7', '#132682',
    ])
    expect(EXTENDED_APPROVED_COLORS).toHaveLength(391)
    expect(PALETTE_PACKS.find((pack) => pack.tier === 'extended')?.colors).toHaveLength(391)
  })

  it('normalizes enabled ratios to 100', () => {
    const out = normalizeColorRatios([90, 10, 0], [true, true, false])
    expect(Math.round(out.reduce((acc, v) => acc + v, 0))).toBe(100)
    expect(out[2]).toBe(0)
  })

  it('builds a weighted palette from mix ratios', () => {
    const palette = buildWeightedPalette(
      [
        { color: '#000000', ratio: 80, enabled: true },
        { color: '#ffffff', ratio: 20, enabled: true },
      ],
      10,
    )
    expect(palette.length).toBe(10)
    expect(palette.filter((c) => c === '#000000').length).toBeGreaterThan(
      palette.filter((c) => c === '#ffffff').length,
    )
  })

  it('uses deterministic largest-remainder allocation', () => {
    const palette = buildWeightedPalette(
      [
        { color: '#111111', ratio: 34, enabled: true },
        { color: '#222222', ratio: 33, enabled: true },
        { color: '#333333', ratio: 33, enabled: true },
      ],
      10,
    )
    expect(palette).toHaveLength(10)
    expect(palette.filter((color) => color === '#111111')).toHaveLength(4)
    expect(palette.filter((color) => color === '#222222')).toHaveLength(3)
    expect(palette.filter((color) => color === '#333333')).toHaveLength(3)
  })
})
