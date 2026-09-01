import { describe, expect, it } from 'vitest'
import {
  addColorToMix,
  APPROVED_COLOR_GROUPS,
  buildWeightedPalette,
  colorMixForPack,
  CURATED_APPROVED_COLORS,
  META_BLUE,
  normalizeColorRatios,
  PALETTE_PACKS,
} from './registry'
import { EXTENDED_APPROVED_COLORS } from './extended'
import { perceptualLightness } from './hue'

describe('palette registry', () => {
  it('contains primary and secondary packs', () => {
    expect(PALETTE_PACKS.some((p) => p.tier === 'primary')).toBe(true)
    expect(PALETTE_PACKS.some((p) => p.tier === 'secondary')).toBe(true)
  })

  it('keeps the source archive but exposes a curated 49-color picker', () => {
    expect(META_BLUE).toBe('#0064E0')
    expect(PALETTE_PACKS.find((pack) => pack.id === 'primary-core')?.colors).toEqual([
      META_BLUE, '#0288F9', '#006CE1', '#034AE0', '#093AC7', '#132682',
    ])
    expect(PALETTE_PACKS.filter((pack) => pack.tier !== 'extended').every(
      (pack) => pack.colors[0] === META_BLUE,
    )).toBe(true)
    expect(EXTENDED_APPROVED_COLORS).toHaveLength(391)
    expect(APPROVED_COLOR_GROUPS).toHaveLength(7)
    expect(CURATED_APPROVED_COLORS).toHaveLength(49)
    expect(new Set(CURATED_APPROVED_COLORS)).toHaveLength(49)
    const presetColors = PALETTE_PACKS
      .filter((pack) => pack.tier !== 'extended')
      .flatMap((pack) => pack.colors)
    const approvedSource = new Set<string>([
      ...EXTENDED_APPROVED_COLORS,
      ...presetColors,
    ])
    expect(CURATED_APPROVED_COLORS.every(
      (color) => approvedSource.has(color),
    )).toBe(true)
    expect(presetColors.every((color) => CURATED_APPROVED_COLORS.includes(color))).toBe(true)
    expect(PALETTE_PACKS.find((pack) => pack.tier === 'extended')?.colors).toEqual(
      CURATED_APPROVED_COLORS,
    )
  })

  it('orders every curated family from lightest to darkest', () => {
    for (const group of APPROVED_COLOR_GROUPS) {
      const lightness = group.colors.map(perceptualLightness)
      for (let index = 1; index < lightness.length; index += 1) {
        expect(lightness[index - 1]).toBeGreaterThanOrEqual(lightness[index])
      }
    }
  })

  it('deals every pack color, lead-weighted, summing to 100', () => {
    for (const pack of PALETTE_PACKS) {
      if (pack.tier === 'extended') continue
      const mix = colorMixForPack(pack)
      expect(mix.map((item) => item.color)).toEqual([...pack.colors])
      expect(mix.every((item) => item.enabled)).toBe(true)
      expect(mix[0].ratio).toBe(40)
      expect(mix.reduce((acc, item) => acc + item.ratio, 0)).toBe(100)
    }
    const bold = PALETTE_PACKS.find((pack) => pack.id === 'bold')!
    expect(colorMixForPack(bold)).toEqual([
      { color: META_BLUE, enabled: true, ratio: 40 },
      { color: '#FFD61E', enabled: true, ratio: 20 },
      { color: '#FF4F00', enabled: true, ratio: 20 },
      { color: '#25C8EE', enabled: true, ratio: 20 },
    ])
  })

  it('normalizes enabled ratios to 100', () => {
    const out = normalizeColorRatios([90, 10, 0], [true, true, false])
    expect(Math.round(out.reduce((acc, v) => acc + v, 0))).toBe(100)
    expect(out[2]).toBe(0)
  })

  it('adds approved colors without replacing the existing mix', () => {
    const original = [{ color: '#22C55E', ratio: 100, enabled: true }]
    const next = addColorToMix(original, '#FF4F00')

    expect(next).toEqual([
      { color: '#22C55E', ratio: 100, enabled: true },
      { color: '#FF4F00', ratio: 50, enabled: true },
    ])
    expect(original).toEqual([{ color: '#22C55E', ratio: 100, enabled: true }])
  })

  it('re-enables an existing color instead of duplicating it', () => {
    const next = addColorToMix([
      { color: '#0064E0', ratio: 100, enabled: true },
      { color: '#ff4f00', ratio: 0, enabled: false },
    ], '#FF4F00')

    expect(next).toHaveLength(2)
    expect(next).toEqual([
      { color: '#0064E0', ratio: 100, enabled: true },
      { color: '#FF4F00', ratio: 50, enabled: true },
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
