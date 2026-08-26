import { describe, expect, it } from 'vitest'
import {
  addColorToMix,
  buildWeightedPalette,
  colorMixForPack,
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
      META_BLUE, '#0288F9', '#006CE1', '#034AE0', '#093AC7', '#132682',
    ])
    expect(PALETTE_PACKS.filter((pack) => pack.tier !== 'extended').every(
      (pack) => pack.colors[0] === META_BLUE,
    )).toBe(true)
    expect(EXTENDED_APPROVED_COLORS).toHaveLength(391)
    expect(PALETTE_PACKS.find((pack) => pack.tier === 'extended')?.colors).toHaveLength(391)
  })

  it('uses one default mix for initial load and pack selection', () => {
    expect(colorMixForPack(PALETTE_PACKS[0]).slice(0, 4)).toEqual([
      { color: META_BLUE, enabled: true, ratio: 60 },
      { color: '#0288F9', enabled: true, ratio: 20 },
      { color: '#006CE1', enabled: true, ratio: 20 },
      { color: '#034AE0', enabled: false, ratio: 0 },
    ])
  })

  it('normalizes enabled ratios to 100', () => {
    const out = normalizeColorRatios([90, 10, 0], [true, true, false])
    expect(Math.round(out.reduce((acc, v) => acc + v, 0))).toBe(100)
    expect(out[2]).toBe(0)
  })

  it('adds approved colors without replacing the existing mix', () => {
    const original = [{ color: '#22C55E', ratio: 100, enabled: true }]
    const next = addColorToMix(original, '#FF5001')

    expect(next).toEqual([
      { color: '#22C55E', ratio: 100, enabled: true },
      { color: '#FF5001', ratio: 50, enabled: true },
    ])
    expect(original).toEqual([{ color: '#22C55E', ratio: 100, enabled: true }])
  })

  it('re-enables an existing color instead of duplicating it', () => {
    const next = addColorToMix([
      { color: '#0064E0', ratio: 100, enabled: true },
      { color: '#ff5001', ratio: 0, enabled: false },
    ], '#FF5001')

    expect(next).toHaveLength(2)
    expect(next).toEqual([
      { color: '#0064E0', ratio: 100, enabled: true },
      { color: '#FF5001', ratio: 50, enabled: true },
    ])
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
