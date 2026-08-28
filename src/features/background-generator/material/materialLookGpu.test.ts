import { describe, expect, it } from 'vitest'
import { createDefaultBackgroundRecipe } from '../recipe'
import {
  MATERIAL_GPU_LOOK_INDEX,
  materialLookEnergy,
  materialLookLoopPhase,
  resolveMaterialGpuPalette,
} from './materialLookGpu'

describe('material GPU Looks', () => {
  it('assigns one stable shader identity to every V2 Look', () => {
    expect(Object.keys(MATERIAL_GPU_LOOK_INDEX)).toEqual([
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
    expect(new Set(Object.values(MATERIAL_GPU_LOOK_INDEX)).size).toBe(10)
  })

  it('uses an exact normalized loop seam independent of Energy', () => {
    for (const loopSeconds of [2, 8, 17.5, 30]) {
      expect(materialLookLoopPhase(0, loopSeconds)).toBe(
        materialLookLoopPhase(loopSeconds * 1000, loopSeconds),
      )
      expect(materialLookLoopPhase(1350, loopSeconds)).toBe(
        materialLookLoopPhase(1350 + loopSeconds * 1000, loopSeconds),
      )
    }
    expect(materialLookEnergy(0.1)).toBe(0)
    expect(materialLookEnergy(2)).toBe(1)
    expect(materialLookEnergy(1.05)).toBeCloseTo(0.5)
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
