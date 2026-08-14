import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createDefaultBackgroundRecipe,
  deserializeBackgroundRecipe,
} from '../recipe'
import { materialPresetFor, materialRenderModel, META_SDF } from './renderModel'
import { MATERIAL_BY_ID, type MaterialId } from './shadersCatalog'
import { STAINLESS_STEEL_PRESET } from './stainlessSteel'

describe('material render model', () => {
  it('ships the SDF required by preview and target-size export', () => {
    const path = resolve(process.cwd(), 'public/meta-symbol.sdf.bin')
    expect(existsSync(path)).toBe(true)
    expect([
      512 * 512 * 2,
      512 * 512 * 4,
    ]).toContain(statSync(path).size)
  })

  it('uses the independent material transform for preview and export props', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    recipe.material.id = 'metal'
    recipe.transforms.background.x = -0.5
    recipe.transforms.material = {
      preset: 'free',
      x: 0.5,
      y: -0.25,
      scale: 1.75,
      rotation: 30,
    }
    const model = materialRenderModel(recipe)
    expect(model.stainlessSteel.glass).toMatchObject({
      center: { x: 0.75, y: 0.375 },
      scale: 1.75,
      rotation: 30,
      shapeSdfUrl: META_SDF,
    })
  })

  it('uses explicit opaque material colors instead of background ratios', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    recipe.material.id = 'metal'
    recipe.material.backgroundColor = '#000000'
    recipe.material.highlightColor = '#FFFFFF'
    recipe.material.intensity = 0
    recipe.palette.mix = [{ color: '#FF5001', enabled: true, ratio: 100 }]
    const model = materialRenderModel(recipe)
    expect(model.solid.color).toBe('#000000')
    expect(model.stainlessSteel.background.color).toBe('#000000')
    expect(model.stainlessSteel.swirl).toMatchObject({
      colorA: '#000000',
      colorB: '#FFFFFF',
    })
    expect(model.stainlessSteel.glass).toMatchObject({
      highlightColor: '#FFFFFF',
      fresnelColor: '#FFFFFF',
      opacity: 1,
    })
  })

  it('uses the MCP preset graph and exact source defaults at baseline controls', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    recipe.material.id = 'metal'
    const model = materialRenderModel(recipe)

    expect(model.stainlessSteel.background).toEqual({
      ...STAINLESS_STEEL_PRESET.source.studioBackground,
      color: recipe.material.backgroundColor,
    })
    expect(model.stainlessSteel.glass).toEqual({
      ...STAINLESS_STEEL_PRESET.source.glass,
      center: { x: 0.5, y: 0.5 },
      scale: 0.95,
      rotation: 0,
      shapeSdfUrl: META_SDF,
      lightAngle: 300,
      highlightColor: recipe.material.highlightColor,
      fresnelColor: recipe.material.highlightColor,
      opacity: 1,
    })
    expect(model.stainlessSteel.swirl).toEqual({
      ...STAINLESS_STEEL_PRESET.source.swirl,
      colorA: recipe.material.backgroundColor,
      colorB: recipe.material.highlightColor,
    })
    expect(model.stainlessSteel.grain).toEqual(
      STAINLESS_STEEL_PRESET.source.filmGrain,
    )

    const preset = materialPresetFor(recipe)
    expect(preset?.components.map((component) => component.type)).toEqual([
      'StudioBackground',
      'Glass',
      'FilmGrain',
    ])
    expect(preset?.components[1].children?.map((component) => component.type)).toEqual([
      'Swirl',
    ])
  })

  it('keeps the metal persisted id with Stainless Steel 1 provenance', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    recipe.material.id = 'metal'

    expect(deserializeBackgroundRecipe(JSON.stringify(recipe))?.material.id).toBe('metal')
    expect(MATERIAL_BY_ID.metal).toMatchObject({
      id: 'metal',
      label: 'Stainless Steel 1',
      shaderPrimitives: ['StudioBackground', 'Glass', 'Swirl', 'FilmGrain'],
      preset: {
        id: 'a92be03a-7df7-4f54-91f3-a87ba40bd320',
        mcpTitle: 'Stainless Steel',
      },
    })
  })

  it('builds the same component graph used by each material treatment', () => {
    const expected: Record<Exclude<MaterialId, 'clean'>, string> = {
      liquid: 'SolidColor',
      glass: 'SolidColor',
      metal: 'StudioBackground',
      film: 'FilmStock',
      pixel: 'Pixelate',
      crt: 'CRTScreen',
    }
    for (const [id, rootType] of Object.entries(expected)) {
      const recipe = createDefaultBackgroundRecipe(42)
      recipe.material.id = id as Exclude<MaterialId, 'clean'>
      expect(materialPresetFor(recipe)?.components[0].type).toBe(rootType)
    }
    expect(materialPresetFor(createDefaultBackgroundRecipe(42))).toBeNull()
  })
})
