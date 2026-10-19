import { describe, expect, it } from 'vitest'
import { backgroundRecipeToLab, createDefaultBackgroundRecipe, deserializeBackgroundRecipe } from '@/features/background-generator/recipe'
import { CURATED_PRESETS } from '@/features/background-generator/curatedPresets'
import { resolveGradientSettings } from '@/features/background-generator/gradientControls'
import { normalizeGradientSettings } from './settings'
import { gradientPalette, gradientPigments, gradientToneProfile, gradientSourceAxis } from './render'

describe('source focus direction', () => {
  function field(angle: number, polarity = 1) {
    const data = new Float32Array(64 * 64 * 4)
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      data[(y * 64 + x) * 4 + 3] = 2 + polarity * (Math.cos(angle) * x + Math.sin(angle) * y) / 64
    }
    return data
  }
  it('follows the source edge direction and rotates with it', () => {
    for (const angle of [0, .43, 1.9]) {
      const axis = gradientSourceAxis(field(angle), 64, 64, [.5, .5, .1, .1])
      expect(Math.abs(axis[0] * Math.cos(angle) + axis[1] * Math.sin(angle))).toBeCloseTo(1, 5)
    }
  })
  it('keeps the filter axis when the source contrast reverses', () => {
    const a = gradientSourceAxis(field(.8), 64, 64, [.5, .5, .1, .1])
    const b = gradientSourceAxis(field(.8, -1), 64, 64, [.5, .5, .1, .1])
    expect(Math.abs(a[0] * b[0] + a[1] * b[1])).toBeCloseTo(1, 5)
  })
  it('has a finite fallback for uniform source frames', () => {
    expect(gradientSourceAxis(new Float32Array(64 * 64 * 4).fill(1), 64, 64, [.5, .5, .1, .1])).toEqual([1, 0])
  })
})

describe('gradient recipes', () => {
  it.each(CURATED_PRESETS)('preserves $id through serialization and render input', (preset) => {
    const recipe = createDefaultBackgroundRecipe(preset.seed)
    recipe.presetId = preset.id
    recipe.gradientState = {
      presetId: preset.id,
      controls: preset.controls,
      orientation: preset.orientation,
      center: { x: 0.5, y: 0.5 },
      field: preset.field,
    }
    const parsed = deserializeBackgroundRecipe(JSON.stringify(recipe))!
    const lab = backgroundRecipeToLab(parsed)
    expect(lab.look.gradient).toEqual(resolveGradientSettings(
      preset.family,
      preset.controls,
      preset.grain,
      preset.orientation,
      { x: 0.5, y: 0.5 },
      preset.field,
    ))
    expect(lab.look.version).toBe('gradients')
    expect(lab.look.id).toBe(preset.family)
  })

  it('bounds hand-edited render settings and preserves orientation', () => {
    expect(normalizeGradientSettings({ softness: 18, distortion: -2, grain: NaN }))
      .toEqual({
        softness: 1,
        distortion: 0,
        grain: 0.22,
        scale: 0.45,
        folds: 0.32,
        bleed: 0.6,
        depth: 0.45,
        reflow: 0.5,
        orientation: 0,
        centerX: 0.5,
        centerY: 0.5,
        source1X: 0.35,
        source1Y: 0.6,
        source1Spread: 0.55,
        source2X: 0.72,
        source2Y: 0.38,
        source2Spread: 0.48,
        source3X: 0.65,
        source3Y: 0.76,
        source3Spread: 0.42,
        sourceCount: 3,
      })
    expect(normalizeGradientSettings({ orientation: 270 }).orientation).toBe(270)
    const old = createDefaultBackgroundRecipe(81)
    expect(deserializeBackgroundRecipe(JSON.stringify(old))!.look).toEqual(old.look)
  })
})

describe('gradient color ramp', () => {
  it('uses the selected brightness range and detects close hues without affecting single colors', () => {
    const mono = gradientToneProfile({ palette: ['#0064E0', '#0288F9', '#132682'], ink: '#0064E0', plan: undefined })
    const vivid = gradientToneProfile({ palette: ['#0064E0', '#FFD61E', '#FF4F00'], ink: '#0064E0', plan: undefined })
    expect(mono[0]).toBeCloseTo(130 / 255)
    expect(mono[1]).toBeCloseTo(249 / 255)
    expect(mono[3]).toBeGreaterThan(0.95)
    expect(vivid[3]).toBeLessThan(0.1)
    for (const hex of ['#000000', '#FFFFFF', '#0064E0']) {
      const [low, high, mean] = gradientToneProfile({ palette: [hex], ink: hex, plan: undefined })
      expect(low).toBe(high)
      expect(mean).toBe(low)
    }
  })
  it('distributes all selected swatches across the fields, including the lead', () => {
    const pigments = gradientPigments({ palette: ['#0064E0', '#FFD61E', '#FF4F00'], ink: '#0064E0', plan: undefined })
    const seen = new Set<string>()
    for (let i = 0; i < pigments.length; i += 4) {
      seen.add(Array.from(pigments.slice(i, i + 3), (v) => Math.round(v * 255)).join(','))
    }
    expect(seen).toEqual(new Set(['0,100,224', '255,214,30', '255,79,0']))
    const one = gradientPigments({ palette: ['#25C8EE'], ink: '#0064E0', plan: undefined })
    for (let i = 0; i < one.length; i += 4) expect(Array.from(one.slice(i, i + 3), (v) => Math.round(v * 255))).toEqual([37, 200, 238])
  })
  it('renders a one-color mix without introducing other colors', () => {
    const ramp = gradientPalette({ palette: ['#25C8EE'], ink: '#0064E0', plan: undefined })
    for (let i = 0; i < ramp.length; i += 4) expect(Array.from(ramp.slice(i, i + 4))).toEqual([37, 200, 238, 255])
  })

  it('uses palette order and preserves endpoint colors', () => {
    const ramp = gradientPalette({ palette: ['#0064E0', '#FFD61E'], ink: '#0064E0', plan: undefined })
    expect(Array.from(ramp.slice(0, 4))).toEqual([0, 100, 224, 255])
    expect(Array.from(ramp.slice(-4))).toEqual([255, 214, 30, 255])
    expect(ramp[256 * 4]).toBeGreaterThan(0)
    expect(ramp[256 * 4]).toBeLessThan(255)
  })
})
