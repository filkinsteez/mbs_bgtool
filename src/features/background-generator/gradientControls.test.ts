import { describe, expect, it } from 'vitest'
import type { GradientSettings } from '@/core/lab/types'
import {
  CURATED_PRESETS,
  DEFAULT_PRESET_ID,
  ELEMENTAL_ACCENTS,
  PRODUCTION_COLOR_PACKS,
  type GradientFamily,
  type SemanticGradientControls,
} from './curatedPresets'
import {
  applyStructureControl,
  normalizeGradientState,
  normalizePaletteState,
  paletteBoundaryLimits,
  PRODUCTION_PRESET_COUNT,
  resolveGradientSettings,
  resolvePaletteMix,
  resolvePresetGradientState,
  setPaletteBoundary,
  structureControlValue,
  transferVisibleGradientControls,
  type ProductionGradientState,
  type ProductionPaletteState,
} from './gradientControls'
import { META_BLUE } from './palette/registry'

const FAMILIES: readonly GradientFamily[] = ['diffusion', 'smear']
const BASE_CONTROLS: SemanticGradientControls = {
  detail: 0.5,
  blend: 0.5,
  distortion: 0.5,
  position: 0.5,
}
const SETTING_KEYS: readonly (keyof Required<GradientSettings>)[] = [
  'softness',
  'distortion',
  'grain',
  'scale',
  'folds',
  'bleed',
  'depth',
  'reflow',
  'orientation',
  'centerX',
  'centerY',
  'source1X',
  'source1Y',
  'source1Spread',
  'source2X',
  'source2Y',
  'source2Spread',
  'source3X',
  'source3Y',
  'source3Spread',
  'sourceCount',
]

function expectValidSettings(settings: Required<GradientSettings>) {
  expect(Object.keys(settings).sort()).toEqual([...SETTING_KEYS].sort())
  for (const key of SETTING_KEYS) {
    expect(Number.isFinite(settings[key])).toBe(true)
  }
  for (const key of SETTING_KEYS.filter((key) => key !== 'orientation' && key !== 'sourceCount')) {
    expect(settings[key]).toBeGreaterThanOrEqual(0)
    expect(settings[key]).toBeLessThanOrEqual(1)
  }
  expect([0, 90, 180, 270]).toContain(settings.orientation)
  expect(settings.sourceCount).toBeGreaterThanOrEqual(1)
  expect(settings.sourceCount).toBeLessThanOrEqual(3)
}

describe('curated gradient presets', () => {
  it('contains exactly three diffusion and three smear presets with unique IDs', () => {
    expect(CURATED_PRESETS).toHaveLength(6)
    expect(PRODUCTION_PRESET_COUNT).toBe(6)
    expect(CURATED_PRESETS.filter((preset) => preset.family === 'diffusion')).toHaveLength(3)
    expect(CURATED_PRESETS.filter((preset) => preset.family === 'smear')).toHaveLength(3)
    expect(new Set(CURATED_PRESETS.map((preset) => preset.id)).size).toBe(6)
  })

  it.each(CURATED_PRESETS)(
    'includes the $id orientation in resolved settings',
    (preset) => {
      const resolved = resolvePresetGradientState(preset.id)

      expect(resolved.orientation).toBe(preset.orientation)
      expect(resolved.settings.orientation).toBe(preset.orientation)
    },
  )
})

describe.each(FAMILIES)('%s semantic controls', (family) => {
  it.each([
    { control: 'detail', fields: ['scale'] },
    { control: 'blend', fields: ['softness', 'bleed', 'depth'] },
    { control: 'distortion', fields: ['distortion', 'folds'] },
    { control: 'position', fields: ['reflow'] },
  ] as const)('$control maps deterministically to valid settings', ({ control, fields }) => {
    const lowControls = { ...BASE_CONTROLS, [control]: 0 }
    const highControls = { ...BASE_CONTROLS, [control]: 1 }
    const low = resolveGradientSettings(family, lowControls, 0.35, 270)
    const repeated = resolveGradientSettings(family, lowControls, 0.35, 270)
    const high = resolveGradientSettings(family, highControls, 0.35, 270)

    expect(low).toEqual(repeated)
    expectValidSettings(low)
    expectValidSettings(high)
    for (const field of fields) {
      expect(low[field]).not.toBe(high[field])
    }
  })

  it('keeps useful family detail at the maximum softness', () => {
    const presetCeiling = resolveGradientSettings(
      family,
      { ...BASE_CONTROLS, blend: 0.8 },
      0.35,
    )
    const maximum = resolveGradientSettings(
      family,
      { ...BASE_CONTROLS, blend: 1 },
      0.35,
    )

    const expected = family === 'smear'
      ? { softness: 0.82, bleed: 0.68, depth: 0.3 }
      : { softness: 0.9, bleed: 0.85, depth: 0.2 }
    expect(maximum.softness).toBeCloseTo(expected.softness)
    expect(maximum.bleed).toBeCloseTo(expected.bleed)
    expect(maximum.depth).toBeCloseTo(expected.depth)
    expect(maximum.softness).toBeGreaterThan(presetCeiling.softness)
    expect(maximum.depth).toBeLessThan(presetCeiling.depth)
  })
})

describe('combined structure control', () => {
  it.each(CURATED_PRESETS)(
    'preserves $id at its baseline and reaches both useful extremes',
    (preset) => {
      const baselineValue = structureControlValue(
        preset.controls,
        preset.controls,
      )
      const baseline = applyStructureControl(
        preset.controls,
        preset.controls,
        baselineValue,
      )
      const low = applyStructureControl(
        preset.controls,
        preset.controls,
        0,
      )
      const high = applyStructureControl(
        preset.controls,
        preset.controls,
        1,
      )

      expect(baseline).toEqual(preset.controls)
      expect(low).toMatchObject({ detail: 0, distortion: 0 })
      expect(high).toMatchObject({ detail: 1, distortion: 1 })
      expect(low.blend).toBe(preset.controls.blend)
      expect(high.position).toBe(preset.controls.position)
    },
  )

  it('round-trips values produced by the combined control', () => {
    const preset = CURATED_PRESETS[2]
    const controls = applyStructureControl(
      preset.controls,
      preset.controls,
      0.73,
    )

    expect(structureControlValue(controls, preset.controls)).toBeCloseTo(0.73)
  })

  it('keeps visible Detail and Softness values when the preset changes', () => {
    const currentPreset = CURATED_PRESETS[0]
    const nextPreset = CURATED_PRESETS[4]
    const current = {
      ...applyStructureControl(
        currentPreset.controls,
        currentPreset.controls,
        0.92,
      ),
      blend: 0.65,
    }
    const transferred = transferVisibleGradientControls(
      current,
      currentPreset.controls,
      nextPreset.controls,
    )

    expect(structureControlValue(transferred, nextPreset.controls))
      .toBeCloseTo(0.92)
    expect(transferred.blend).toBe(0.65)
    expect(transferred.position).toBe(nextPreset.controls.position)
  })
})

describe('production color packs', () => {
  it.each(PRODUCTION_COLOR_PACKS)('$id resolves to only two or three colors', (pack) => {
    const resolved = resolvePaletteMix({
      packId: pack.id,
      elementalAccent: ELEMENTAL_ACCENTS[0],
      boundaries: [70, 85],
    })

    expect(resolved.mix.length).toBeGreaterThanOrEqual(2)
    expect(resolved.mix.length).toBeLessThanOrEqual(3)
  })

  it('maps two or three ordered color boundaries to ratios totaling 100', () => {
    const twoColor = resolvePaletteMix({
      packId: 'blues',
      elementalAccent: ELEMENTAL_ACCENTS[0],
      boundaries: [64, 82],
    })
    const threeColor = resolvePaletteMix({
      packId: 'atmospheric',
      elementalAccent: ELEMENTAL_ACCENTS[0],
      boundaries: [64, 82],
    })

    expect(twoColor.mix.map((entry) => entry.ratio)).toEqual([64, 36])
    expect(threeColor.mix.map((entry) => entry.ratio)).toEqual([64, 18, 18])
    expect(threeColor.mix[0]).toMatchObject({ color: META_BLUE, enabled: true })
    expect(threeColor.mix.reduce((sum, entry) => sum + entry.ratio, 0)).toBe(100)
  })

  it('allows boundaries to reach either endpoint without a forced blue share', () => {
    const normalized = normalizePaletteState({
      packId: 'atmospheric',
      elementalAccent: ELEMENTAL_ACCENTS[0],
      boundaries: [500, -500],
    })

    expect(normalized.boundaries).toEqual([100, 100])
    expect(resolvePaletteMix(normalized).mix.map((entry) => entry.ratio))
      .toEqual([100, 0, 0])
    expect(paletteBoundaryLimits(normalized, 0)).toEqual({ min: 0, max: 100 })
    expect(paletteBoundaryLimits(normalized, 1)).toEqual({ min: 100, max: 100 })

    const withoutBlue = setPaletteBoundary({
      packId: 'blues',
      elementalAccent: ELEMENTAL_ACCENTS[0],
      boundaries: [70, 85],
    }, 0, 0)
    expect(resolvePaletteMix(withoutBlue).mix.map((entry) => entry.ratio))
      .toEqual([0, 100])
  })

  it('moves one boundary without crossing its neighbor', () => {
    const initial = normalizePaletteState({
      packId: 'atmospheric',
      elementalAccent: ELEMENTAL_ACCENTS[0],
      boundaries: [60, 80],
    })
    const firstMoved = setPaletteBoundary(initial, 0, 78)
    const secondMoved = setPaletteBoundary(firstMoved, 1, 92)

    expect(firstMoved.boundaries).toEqual([78, 80])
    expect(secondMoved.boundaries).toEqual([78, 92])
    expect(resolvePaletteMix(secondMoved).mix.map((entry) => entry.ratio))
      .toEqual([78, 14, 8])
  })

  it.each(ELEMENTAL_ACCENTS)(
    'uses the selected Elemental accent %s after normalization',
    (accent) => {
      const state = normalizePaletteState({
        packId: 'elemental',
        elementalAccent: accent,
        boundaries: [70, 85],
      })
      const resolved = resolvePaletteMix(state)

      expect(state.elementalAccent).toBe(accent)
      expect(resolved.mix.map(({ color }) => color)).toEqual([META_BLUE, accent])
      expect(resolved.ground).toBe(accent)
    },
  )

  it('falls back from an invalid Elemental accent', () => {
    const state = normalizePaletteState({
      packId: 'elemental',
      elementalAccent: 'not-an-accent',
      boundaries: [70, 85],
    })
    const resolved = resolvePaletteMix(state)

    expect(state.elementalAccent).toBe(ELEMENTAL_ACCENTS[0])
    expect(resolved.mix[1].color).toBe(ELEMENTAL_ACCENTS[0])
  })
})

describe('state normalization', () => {
  it('normalizes malformed and out-of-range semantic state safely', () => {
    const normalized = normalizeGradientState({
      presetId: 'not-a-preset',
      controls: {
        detail: -10,
        blend: 10,
        distortion: Number.NEGATIVE_INFINITY,
        position: Number.POSITIVE_INFINITY,
      },
      orientation: 45,
      center: { x: -10, y: 10 },
    } as unknown as ProductionGradientState)

    expect(normalized).toMatchObject({
      presetId: DEFAULT_PRESET_ID,
      controls: {
        detail: 0,
        blend: 1,
        distortion: 0.2,
        position: 0.5,
      },
      orientation: 0,
      center: { x: 0, y: 1 },
    })
    expect(Object.values(normalized.controls).every(Number.isFinite)).toBe(true)
  })

  it('normalizes malformed and out-of-range palette state safely', () => {
    const high = normalizePaletteState({
      packId: 'not-a-pack',
      elementalAccent: 'not-an-accent',
      boundaries: [1_000, -1_000],
    } as unknown as ProductionPaletteState)
    const low = normalizePaletteState({
      packId: 'blues',
      elementalAccent: ELEMENTAL_ACCENTS[0],
      boundaries: [-1_000, 1_000],
    })

    expect(high).toEqual({
      packId: 'atmospheric',
      elementalAccent: ELEMENTAL_ACCENTS[0],
      boundaries: [100, 100],
    })
    expect(low.boundaries).toEqual([0, 100])
    expect(resolvePaletteMix(high).mix.reduce((sum, entry) => sum + entry.ratio, 0)).toBe(100)
  })

  it('migrates the old Meta-blue share into equivalent boundaries', () => {
    const migrated = normalizePaletteState({
      packId: 'atmospheric',
      elementalAccent: ELEMENTAL_ACCENTS[0],
      metaBlueShare: 71,
    })

    expect(migrated.boundaries).toEqual([71, 86])
    expect(resolvePaletteMix(migrated).mix.map((entry) => entry.ratio))
      .toEqual([71, 15, 14])
  })
})
