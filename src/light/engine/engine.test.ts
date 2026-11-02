import { describe, expect, it } from 'vitest'
import { linearToOklch } from '../color/oklab'
import { PACKS } from '../color/packs'
import { hexToLinear } from '../color/srgb'
import { getRecipe, RECIPE_LIST } from '../recipes'
import { DEFAULT_LENS, RECIPE_IDS, type RecipeProgram } from '../scene'
import { exportFileName, exportSize } from './export'
import { grainAmplitude, grainParams, grainUniforms } from './grain'
import { bloomLevelFactors, halationLevelFactors, lensBaseSize, levelForRadius } from './lens'
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

  const hueAt = (hex: string, scale: number) => {
    const c = hexToLinear(hex)
    const m = Math.max(...c)
    return linearToOklch(toneCurve(c.map((v) => (v / m) * scale)))
  }
  const hueDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180

  it('turns warm light toward yellow as it whitens, never toward pink', () => {
    for (const hex of ['#FF4F00', '#FFD61E', '#B8996E', '#FF0000', '#FFB300']) {
      let previous = hueAt(hex, 1)[2]
      for (let scale = 1.1; scale < 32; scale *= 1.1) {
        const [, chroma, hue] = hueAt(hex, scale)
        if (chroma < 0.03) break
        expect(hueDiff(hue, previous), `${hex} at ${scale.toFixed(2)}x`).toBeGreaterThan(-0.5)
        expect(hue, `${hex} at ${scale.toFixed(2)}x`).toBeLessThan(112)
        previous = hue
      }
    }
    expect(hueAt('#FF4F00', 4)[2]).toBeGreaterThan(85)
  })

  it('keeps blue light blue: toward cyan-white, not violet', () => {
    for (const hex of ['#0064E0', '#0000FF', '#6A7788', '#384753', '#1C2B33']) {
      const nominal = hueAt(hex, 1)[2]
      for (let scale = 1.1; scale < 64; scale *= 1.1) {
        const [, chroma, hue] = hueAt(hex, scale)
        if (chroma < 0.03) break
        expect(hueDiff(hue, nominal), `${hex} at ${scale.toFixed(2)}x`).toBeLessThan(8)
        expect(hue, `${hex} at ${scale.toFixed(2)}x`).toBeGreaterThan(190)
      }
    }
    expect(Math.abs(hueDiff(hueAt('#0064E0', 2)[2], 259))).toBeLessThan(3)
  })

  it('moves hue smoothly for every pack color', () => {
    for (const hex of packHexes) {
      let previous: number | null = null
      for (let scale = 1; scale < 64; scale *= 1.01) {
        const [, chroma, hue] = hueAt(hex, scale)
        if (chroma < 0.05) {
          previous = null
          continue
        }
        if (previous !== null) expect(Math.abs(hueDiff(hue, previous)), `${hex} at ${scale.toFixed(2)}x`).toBeLessThan(1.5)
        previous = hue
      }
    }
  })
})

describe('scene resolution', () => {
  const program: RecipeProgram = {
    id: 'test.resolve',
    colorSlots: [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ],
    defaultColors: ['#000000', '#FFFFFF'],
    params: [
      { kind: 'number', key: 'softness', label: 'Softness', min: 0, max: 0.4, step: 0.01, default: 0.1 },
      { kind: 'number', key: 'angle', label: 'Angle', min: -90, max: 90, step: 1, default: 0 },
    ],
    fragment: 'vec3 radiance(vec2 uv, vec2 p) { return vec3(0.0); }',
    uniforms: () => ({}),
    lens: { bloom: 0.07 },
  }

  it('fills defaults, clamps numbers and rejects wrong types', () => {
    const resolved = resolveScene(program, { seed: 3.6, colors: ['#123456'], params: { softness: 99, angle: 'x' as unknown as number } })
    expect(resolved.seed).toBe(4)
    expect(resolved.hex).toEqual(['#123456', '#FFFFFF'])
    expect(resolved.params.softness).toBe(0.4)
    expect(resolved.params.angle).toBe(0)
    expect(resolved.lens.bloom).toBe(0.07)
    expect(resolved.lens.halation).toBe(DEFAULT_LENS.halation)
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

  it('puts the red halo at the halation radius and green one level narrower by default', () => {
    const factors = halationLevelFactors({ ...DEFAULT_LENS, halation: 1, halationRadius: 0.05 })
    const center = (channel: number) => factors.reduce((sum, f, level) => sum + f[channel] * level, 0)
    expect(center(0)).toBeCloseTo(levelForRadius(0.05), 1)
    expect(center(0) - center(1)).toBeCloseTo(1, 1)
    expect(hexToLinear(DEFAULT_LENS.halationTint).map((v) => Number(v.toFixed(2)))).toEqual([1, 0.3, 0])
  })

  it('works on a 512 px short side at any output size', () => {
    expect(lensBaseSize(925, 1001)).toEqual({ width: 512, height: 554 })
    expect(lensBaseSize(3840, 2160)).toEqual({ width: 910, height: 512 })
  })
})

describe('grain', () => {
  it('maps one strength to the film and riso ends of the grain study', () => {
    expect(grainParams(0.5).amp).toBeCloseTo(0.0125, 6)
    expect(grainParams(0.5).size).toBeCloseTo(0.0005, 8)
    expect(grainParams(1).amp).toBeCloseTo(0.016, 6)
    expect(grainParams(1).size).toBeCloseTo(0.0011, 8)
    expect(grainParams(1).inkBoost).toBeCloseTo(0.9, 6)
    expect(grainParams(0).amp).toBe(0)
  })

  it('fades to 0 at black and eases off toward white', () => {
    const film = grainParams(0.5)
    expect(grainAmplitude(film, 0)).toBe(0)
    expect(grainAmplitude(film, 0.45)).toBeCloseTo(0.0125, 6)
    expect(grainAmplitude(film, 1)).toBeCloseTo(0.00625, 6)
    const riso = grainParams(1)
    expect(grainAmplitude(riso, 0.45)).toBeGreaterThan(grainAmplitude(riso, 0.9))
  })

  it('sizes octaves to the short side and lowers the ones smaller than a pixel', () => {
    const preview = grainUniforms(0.5, 960, 540)
    const exported = grainUniforms(0.5, 3840, 2160)
    expect((exported.uGrainSigmaPx as number[])[1]).toBeCloseTo(4 * (preview.uGrainSigmaPx as number[])[1], 6)
    expect((preview.uGrainWeight as number[])[0]).toBeLessThan((exported.uGrainWeight as number[])[0])
    expect(grainUniforms(0, 960, 540).uGrainAmp).toBe(0)
  })

  it('ignores grain settings from before the strength scale', () => {
    const program: RecipeProgram = {
      id: 'test.grain',
      colorSlots: [],
      defaultColors: [],
      params: [],
      fragment: 'vec3 radiance(vec2 uv, vec2 p) { return vec3(0.0); }',
      uniforms: () => ({}),
    }
    const resolved = resolveScene(program, { output: { grain: 1, grainSize: 1.5, grainChroma: 0.2 } as Record<string, number> })
    expect(resolved.output).toEqual({ exposure: 0, grain: 1 })
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
