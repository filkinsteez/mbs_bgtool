import { describe, expect, it } from 'vitest'
import { GRADIENT_LOOKS, looksForVersion } from '../looks'
import { backgroundRecipeToLab, createDefaultBackgroundRecipe, deserializeBackgroundRecipe } from '@/features/background-generator/recipe'
import { parseLookPreset, serializeLookPreset } from '@/features/background-generator/lookPreset'
import { normalizeGradientSettings } from './settings'
import { gradientPalette, gradientPigments, gradientToneProfile } from './render'

describe('gradient recipes', () => {
  it.each(GRADIENT_LOOKS)('preserves $id and its controls through saved looks and the render input', (look) => {
    const recipe = createDefaultBackgroundRecipe(7429)
    recipe.look = { id: look.id, version: 'gradients', detail: 0.7, gradient: { softness: 0.81, distortion: 0.23, grain: 0.16, scale: 0.45, folds: 0.32, bleed: 0.72, depth: 0.3 } }
    const parsed = parseLookPreset(serializeLookPreset(recipe, 'background', 'Gradient'))!
    expect(parsed.recipe.look).toEqual(recipe.look)
    const lab = backgroundRecipeToLab(parsed.recipe)
    expect(lab.look.gradient).toEqual(recipe.look.gradient)
    expect(lab.look.version).toBe('gradients')
    expect(lab.look.id).toBe(look.id)
  })

  it('bounds hand-edited controls without changing the existing catalogs', () => {
    expect(normalizeGradientSettings({ softness: 18, distortion: -2, grain: NaN }))
      .toEqual({ softness: 1, distortion: 0, grain: 0.22, scale: 0.45, folds: 0.32, bleed: 0.6, depth: 0.45 })
    const old = createDefaultBackgroundRecipe(81)
    expect(deserializeBackgroundRecipe(JSON.stringify(old))!.look).toEqual(old.look)
    expect(looksForVersion('v4').map((l) => l.id)).toEqual(['composite', 'plates', 'loom'])
    expect(looksForVersion('gradients')).toEqual(GRADIENT_LOOKS)
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
