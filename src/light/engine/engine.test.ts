import { describe, expect, it } from 'vitest'
import { linearToOklch } from '../color/oklab'
import { PACKS } from '../color/packs'
import { hexToLinear } from '../color/srgb'
import { getRecipe, RECIPE_LIST } from '../recipes'
import { RECIPE_IDS } from '../scene'
import { exportFileName, exportSize } from './export'
import { bloomLevelFactors, halationLevelFactors, lensBaseSize } from './lens'
import { toneCurve } from './output'
import { coerceParam, resolveScene } from './resolve'

const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const packHexes = [...new Set(PACKS.flatMap((pack) => pack.colors.map((c) => c.hex)))]

describe('tone curve', () => {
  it('leaves every color with max channel <= 1 unchanged', () => {
    for (const hex of packHexes) {
      const c = hexToLinear(hex)
      expect(toneCurve(c)).toEqual(c)
      expect(toneCurve(c.map((v) => v * 0.5))).toEqual(c.map((v) => v * 0.5))
    }
  })

  it('keeps the luminance slope at the start of compression and rises toward white', () => {
    for (const hex of [...packHexes, '#FF0000', '#00FF00', '#0000FF']) {
      const c = hexToLinear(hex)
      const m = Math.max(...c)
      const at = (scale: number) => luminance(toneCurve(c.map((v) => (v / m) * scale)))
      const d = 1e-4
      const below = (at(1) - at(1 - d)) / d
      const above = (at(1 + d) - at(1)) / d
      expect(Math.abs(above / below - 1)).toBeLessThan(0.01)
      let previous = at(1)
      for (let scale = 1.05; scale < 64; scale *= 1.1) {
        const value = at(scale)
        expect(value).toBeGreaterThanOrEqual(previous - 1e-9)
        previous = value
      }
      expect(at(1e4)).toBeGreaterThan(0.999)
    }
  })

  it('keeps the Oklab hue while it desaturates', () => {
    for (const hex of packHexes) {
      const c = hexToLinear(hex)
      const nominal = linearToOklch(c)
      if (nominal[1] < 0.03) continue
      for (const scale of [1.2, 2, 4, 8]) {
        const lch = linearToOklch(toneCurve(c.map((v) => v * scale)))
        if (lch[1] < 0.02) continue
        const drift = Math.abs(((lch[2] - nominal[2] + 540) % 360) - 180)
        expect(drift).toBeLessThan(1)
      }
    }
  })
})

describe('scene resolution', () => {
  it('fills defaults, clamps numbers and rejects wrong types', () => {
    const recipe = getRecipe('sunset.ramp')
    const resolved = resolveScene(recipe, { seed: 3.6, colors: ['#123456'], params: { softness: 99, angle: 'x' as unknown as number } })
    expect(resolved.seed).toBe(4)
    expect(resolved.hex[0]).toBe('#123456')
    expect(resolved.hex.length).toBe(recipe.colorSlots.length)
    expect(resolved.params.softness).toBe(0.4)
    expect(resolved.params.angle).toBe(0)
    expect(resolved.lens.bloom).toBe(recipe.lens?.bloom)
  })

  it('coerces vectors by length', () => {
    const spec = { kind: 'vector' as const, key: 'v', label: 'V', min: 0, max: 1, step: 0.1, default: [0.5, 0.5] }
    expect(coerceParam(spec, [2, -1])).toEqual([1, 0])
    expect(coerceParam(spec, [0.2])).toEqual([0.5, 0.5])
  })

  it('has one registered recipe per id, each with matching slots and defaults', () => {
    expect(RECIPE_LIST.map((r) => r.id)).toEqual([...RECIPE_IDS])
    for (const recipe of RECIPE_LIST) {
      expect(recipe.defaultColors.length).toBe(recipe.colorSlots.length)
      for (const pack of PACKS) expect(recipe.fromPack(pack).length).toBe(recipe.colorSlots.length)
      expect(recipe.fragment).toContain('vec3 radiance(vec2 uv, vec2 p)')
    }
  })
})

describe('lens weights', () => {
  it('bloom levels keep total luminance and halation channels sum to 1', () => {
    const lens = { bloom: 0.2, bloomRadius: 0.4, bloomWidth: 1.2, bloomTint: '#FF8040', halation: 1, halationThreshold: 1, halationRadius: 0.05, halationTint: '#FF5A1F', halationSpread: 0.5 }
    const bloom = bloomLevelFactors(lens)
    expect(bloom.reduce((sum, f) => sum + luminance(f), 0)).toBeCloseTo(1, 6)
    const halation = halationLevelFactors(lens)
    for (let channel = 0; channel < 3; channel++) expect(halation.reduce((sum, f) => sum + f[channel], 0)).toBeCloseTo(1, 6)
  })

  it('accepts explicit per-level bloom weights and tints from a scene', () => {
    const recipe = getRecipe('contour.rim')
    const resolved = resolveScene(recipe, { lens: { bloom: 0.3, bloomLevels: [1, 0, 0, 0, 0, 0, 0, 3], bloomLevelTints: ['#ffffff', '#ff0000'] } })
    expect(resolved.lens.bloomLevels).toEqual([1, 0, 0, 0, 0, 0, 0, 3])
    expect(resolved.lens.bloomLevelTints).toEqual(['#FFFFFF', '#FF0000'])
    const factors = bloomLevelFactors(resolved.lens)
    expect(luminance(factors[0])).toBeCloseTo(0.25, 6)
    expect(luminance(factors[7])).toBeCloseTo(0.75, 6)
    expect(factors[1]).toEqual([0, 0, 0])
    expect(resolveScene(recipe, { lens: { bloomLevels: [-1] } }).lens.bloomLevels).toBeUndefined()
  })

  it('works on a 512 px short side at any output size', () => {
    expect(lensBaseSize(925, 1001)).toEqual({ width: 512, height: 554 })
    expect(lensBaseSize(3840, 2160)).toEqual({ width: 910, height: 512 })
  })
})

describe('export', () => {
  it('names files <recipe>-<pack or reference>-<aspect>-seed<seed>.png', () => {
    const scene = { recipe: 'sunset.ramp' as const, seed: 7 }
    expect(exportFileName({ id: 'x', pack: 'bold', scene }, exportSize({ aspect: '16:9' }).label)).toBe('sunset.ramp-bold-16x9-seed7.png')
    expect(exportFileName({ id: 'x', referenceId: 'sunset-sky-peach', scene }, exportSize({ width: 925, height: 1001 }).label)).toBe(
      'sunset.ramp-sunset-sky-peach-925x1001-seed7.png',
    )
    expect(exportSize({ aspect: '4:5' })).toEqual({ width: 3072, height: 3840, label: '4x5' })
  })
})
