import { describe, expect, it } from 'vitest'
import {
  backgroundRecipeToLab,
  createDefaultBackgroundRecipe,
  deserializeBackgroundRecipe,
  dimensionsFor,
  dimensionsForRatio,
} from './recipe'

describe('background recipe', () => {
  it('defines the required 4K dimensions by long edge', () => {
    expect(dimensionsFor('4k', '16:9')).toEqual({ width: 3840, height: 2160 })
    expect(dimensionsFor('4k', '9:16')).toEqual({ width: 2160, height: 3840 })
    expect(dimensionsFor('4k', '1:1')).toEqual({ width: 3840, height: 3840 })
    expect(dimensionsFor('4k', '4:5')).toEqual({ width: 3072, height: 3840 })
  })

  it('round-trips a deterministic versioned recipe', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    expect(recipe.materialLookOverlay.enabled).toBe(false)
    expect(recipe.transforms.background.scale).toBe(1)
    expect(recipe.transforms.material.scale).toBe(0.95)
    expect(deserializeBackgroundRecipe(JSON.stringify(recipe))).toEqual(recipe)
    expect(
      deserializeBackgroundRecipe(JSON.stringify({ ...recipe, mode: 'material' })),
    ).toMatchObject({ mode: 'material' })
    expect(
      deserializeBackgroundRecipe(JSON.stringify({ ...recipe, mode: undefined })),
    ).toMatchObject({ mode: 'background' })
    expect(deserializeBackgroundRecipe(JSON.stringify({ ...recipe, version: 3 }))).toBeNull()
    expect(deserializeBackgroundRecipe(JSON.stringify({ ...recipe, mode: 'combined' }))).toBeNull()
  })

  it('round-trips a custom palette without reverting to defaults', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    const mix = [
      { color: '#0288F9', enabled: true, ratio: 75 },
      { color: '#24D366', enabled: true, ratio: 25 },
    ]
    const restored = deserializeBackgroundRecipe(JSON.stringify({
      ...recipe,
      palette: { packId: 'custom', mix },
    }))

    expect(restored?.palette).toEqual({ packId: 'custom', mix })
  })

  it('defaults older recipes to a disabled 3D Look overlay', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    const { materialLookOverlay: _overlay, ...withoutOverlay } = recipe
    void _overlay

    expect(
      deserializeBackgroundRecipe(JSON.stringify(withoutOverlay))
        ?.materialLookOverlay.enabled,
    ).toBe(false)
    expect(
      deserializeBackgroundRecipe(JSON.stringify({
        ...recipe,
        materialLookOverlay: { enabled: true },
      }))?.materialLookOverlay.enabled,
    ).toBe(true)
  })

  it('migrates the legacy shared framing transform into both modes', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    const { transforms: _transforms, version: _version, ...rest } = recipe
    void _transforms
    void _version
    const migrated = deserializeBackgroundRecipe(JSON.stringify({
      ...rest,
      version: 1,
      framing: { mode: 'free', x: 0.2, y: -0.1, zoom: 1.5 },
      crop: { x: 0.1, y: 0.1, zoom: 2 },
    }))
    expect(migrated?.version).toBe(2)
    expect(migrated?.transforms.background.x).toBeCloseTo(0.3)
    expect(migrated?.transforms.background).toMatchObject({
      preset: 'free',
      y: 0,
      scale: 3,
      rotation: 0,
    })
    expect(migrated?.transforms.material).toEqual(migrated?.transforms.background)
  })

  it('derives custom crop dimensions from the selected long edge', () => {
    expect(dimensionsForRatio('4k', 2)).toEqual({ width: 3840, height: 1920 })
    expect(dimensionsForRatio('1080', 0.5)).toEqual({ width: 540, height: 1080 })
  })

  it('creates identical render state from identical recipes', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    expect(backgroundRecipeToLab(recipe)).toEqual(backgroundRecipeToLab(recipe))
  })

  it('preserves no-source Looks and enables photo bands for explicit raster sources', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    const withoutSource = backgroundRecipeToLab(recipe)
    const withSource = backgroundRecipeToLab(recipe, {
      hasSource: true,
      source: {
        filename: 'three-frame.rgba',
        width: 320,
        height: 180,
        contentHash: 'abc123',
        fit: 'contain',
      },
    })
    expect(withoutSource.source).toBeNull()
    expect(withoutSource.territory.bands).not.toContain('photo')
    expect(withSource.source).toMatchObject({
      filename: 'three-frame.rgba',
      width: 320,
      height: 180,
      contentHash: 'abc123',
    })
    expect(withSource.territory.bands).toContain('photo')
  })

  it('keeps canonical Look generation stable across 2D artwork transforms', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    const transformed = {
      ...recipe,
      transforms: {
        ...recipe.transforms,
        background: {
          preset: 'free' as const,
          x: 0.2,
          y: -0.1,
          scale: 1.25,
          rotation: 30,
        },
      },
    }
    const source = backgroundRecipeToLab(recipe).territory.sources.find(
      (item) => item.kind === 'curve',
    )
    expect(source?.curve).toMatchObject({
      amplitudeX: 1,
      amplitudeY: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      silhouette: 'meta-symbol',
    })
    expect(backgroundRecipeToLab(transformed)).toEqual(backgroundRecipeToLab(recipe))
  })

  it('keeps material settings out of the Background/Looks renderer', () => {
    const background = createDefaultBackgroundRecipe(42)
    const changedMaterial = {
      ...background,
      material: {
        ...background.material,
        id: 'glass' as const,
        intensity: 1,
        light: 0,
        depth: 1,
      },
    }
    expect(backgroundRecipeToLab(changedMaterial)).toEqual(backgroundRecipeToLab(background))
  })

  it('keeps the material transform independent from the background transform', () => {
    const background = createDefaultBackgroundRecipe(42)
    const changedMaterial = {
      ...background,
      transforms: {
        ...background.transforms,
        material: {
          ...background.transforms.material,
          x: 0.5,
          scale: 2,
          rotation: 45,
        },
      },
    }
    expect(backgroundRecipeToLab(changedMaterial)).toEqual(backgroundRecipeToLab(background))
  })
})
