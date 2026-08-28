import { describe, expect, it } from 'vitest'
import { V2_SYSTEM_IDS } from '@/core/lab/looks'
import { createDefaultBackgroundRecipe } from '../recipe'
import {
  MATERIAL_GPU_LOOK_INDEX,
  MATERIAL_STATIC_ENERGY,
  materialLookEnergy,
  resolveMaterialGpuPalette,
} from './materialLookGpu'

describe('material GPU Looks', () => {
  it('maps every V2 Look onto one of the five stable GPU systems', () => {
    for (const id of V2_SYSTEM_IDS) {
      expect(MATERIAL_GPU_LOOK_INDEX[id], `missing GPU system for ${id}`).not.toBeUndefined()
    }
    expect(Object.keys(MATERIAL_GPU_LOOK_INDEX)).toEqual([
      'pattern',
      'mandala',
      'stitch',
      'dither',
      'frame',
      'pixels',
      'scanlines',
      'streams',
      'brushwork',
      'beads',
      'quilt',
      'weave',
      'marks',
      'trails',
    ])
    expect(new Set(Object.values(MATERIAL_GPU_LOOK_INDEX)).size).toBe(5)
  })

  it('maps Energy speed onto the normalized shader range', () => {
    expect(materialLookEnergy(0.1)).toBe(0)
    expect(materialLookEnergy(2)).toBe(1)
    expect(materialLookEnergy(1.05)).toBeCloseTo(0.5)
  })

  it('pins the static material energy to the default speed', () => {
    expect(MATERIAL_STATIC_ENERGY).toBe(materialLookEnergy(0.5))
    expect(MATERIAL_STATIC_ENERGY).toBeCloseTo(0.4 / 1.9)
  })

  it('keeps selected palette roles and avoids an all-black fallback', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    recipe.palette.mix = [
      { color: '#000000', enabled: true, ratio: 100 },
    ]
    recipe.palette.ground = '#000000'
    recipe.palette.ink = '#000000'
    recipe.material.highlightColor = '#FFFFFF'

    const palette = resolveMaterialGpuPalette(recipe)

    expect(palette.ground).toBe('#000000')
    expect(palette.ink).toBe('#000000')
    expect(palette.colors).toContain('#000000')
    expect(palette.colors).toContain('#FFFFFF')
    expect(palette.weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1)
  })
})
