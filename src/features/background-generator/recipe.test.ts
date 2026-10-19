import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_RECIPE_VERSION,
  BACKGROUND_RENDER_REVISION,
  backgroundRecipeToLab,
  constrainBackgroundTransform,
  createDefaultBackgroundRecipe,
  deserializeBackgroundRecipe,
  dimensionsFor,
  dimensionsForRatio,
} from './recipe'

describe('background recipe', () => {
  it('starts from the curated 3D gradient baseline', () => {
    const recipe = createDefaultBackgroundRecipe(42)

    expect(recipe).toMatchObject({
      version: BACKGROUND_RECIPE_VERSION,
      renderRevision: BACKGROUND_RENDER_REVISION,
      mode: 'material',
      seed: 42,
      presetId: 'soft-diffusion',
      gradientState: {
        presetId: 'soft-diffusion',
        orientation: 0,
        center: { x: 0.5, y: 0.5 },
      },
      look: {
        id: 'diffusion',
        version: 'gradients',
      },
      materialLookOverlay: { enabled: true },
      backgroundSymbol: { enabled: true },
      paletteState: {
        packId: 'atmospheric',
        boundaries: [70, 85],
      },
    })
  })

  it('round-trips the current recipe exactly', () => {
    const recipe = createDefaultBackgroundRecipe(9027)
    expect(deserializeBackgroundRecipe(JSON.stringify(recipe))).toEqual(recipe)
  })

  it('preserves the 2D Meta symbol toggle', () => {
    const recipe = createDefaultBackgroundRecipe(9027)
    recipe.backgroundSymbol.enabled = false

    expect(deserializeBackgroundRecipe(JSON.stringify(recipe)))
      .toMatchObject({ backgroundSymbol: { enabled: false } })
  })

  it('drops retired 3D material choices from saved recipes', () => {
    const recipe = createDefaultBackgroundRecipe(9027)
    const restored = deserializeBackgroundRecipe(JSON.stringify({
      ...recipe,
      material: { ...recipe.material, id: 'glass' },
    }))

    expect(restored?.material).not.toHaveProperty('id')
  })

  it('resets incompatible saves while preserving only their output format', () => {
    const current = createDefaultBackgroundRecipe(9876)
    const restored = deserializeBackgroundRecipe(JSON.stringify({
      ...current,
      version: 2,
      renderRevision: 1,
      mode: 'background',
      seed: 9876,
      format: { aspect: '4:5', width: 100, height: 100 },
    }))

    expect(restored).toEqual({
      ...createDefaultBackgroundRecipe(),
      format: { aspect: '4:5', width: 3072, height: 3840 },
    })
  })

  it('rejects malformed JSON and objects that are not recipes', () => {
    expect(deserializeBackgroundRecipe('{invalid')).toBeNull()
    expect(deserializeBackgroundRecipe('null')).toBeNull()
    expect(deserializeBackgroundRecipe('{"hello":true}')).toBeNull()
    expect(deserializeBackgroundRecipe('{"version":99}')).toBeNull()
  })

  it('derives render fields from semantic state instead of stale saved fields', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    const restored = deserializeBackgroundRecipe(JSON.stringify({
      ...recipe,
      presetId: 'stale-id',
      gradientState: {
        presetId: 'fine-smear',
        controls: {
          detail: 2,
          blend: -1,
          distortion: Number.NaN,
          position: 0.25,
        },
        orientation: 270,
        center: { x: -1, y: 2 },
      },
      look: {
        id: 'halo',
        version: 'v4',
        detail: 0,
        gradient: { softness: 0 },
      },
      paletteState: {
        packId: 'elemental',
        elementalAccent: '#410840',
        metaBlueShare: 88,
      },
      palette: {
        packId: 'custom',
        mix: [{ color: '#FF0000', enabled: true, ratio: 100 }],
        ink: '#FF0000',
        ground: '#FF0000',
      },
    }))

    expect(restored).toMatchObject({
      presetId: 'fine-smear',
      gradientState: {
        presetId: 'fine-smear',
        controls: {
          detail: 1,
          blend: 0,
          distortion: 0.4,
          position: 0.25,
        },
        orientation: 270,
        center: { x: 0, y: 1 },
      },
      look: {
        id: 'smear',
        version: 'gradients',
        detail: 1,
        gradient: { orientation: 270, centerX: 0, centerY: 1 },
      },
      paletteState: {
        packId: 'elemental',
        elementalAccent: '#410840',
        boundaries: [88, 94],
      },
      palette: {
        packId: 'elemental',
        ink: '#0064E0',
        ground: '#410840',
      },
    })
    expect(restored?.palette.mix.map((item) => item.ratio)).toEqual([88, 12])
  })

  it('uses fixed 4K output dimensions for every supported aspect', () => {
    expect(dimensionsFor('16:9')).toEqual({ width: 3840, height: 2160 })
    expect(dimensionsFor('9:16')).toEqual({ width: 2160, height: 3840 })
    expect(dimensionsFor('1:1')).toEqual({ width: 3840, height: 3840 })
    expect(dimensionsFor('4:5')).toEqual({ width: 3072, height: 3840 })
    expect(dimensionsForRatio(2)).toEqual({ width: 3840, height: 1920 })
    expect(dimensionsForRatio(0.5)).toEqual({ width: 1920, height: 3840 })
  })

  it('repairs inset background transforms without changing material framing', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    const inset = {
      preset: 'free' as const,
      x: 0.25,
      y: -0.2,
      scale: 0.82,
      rotation: 0,
    }
    const restored = deserializeBackgroundRecipe(JSON.stringify({
      ...recipe,
      transforms: {
        background: inset,
        material: inset,
      },
    }))

    expect(restored?.transforms.background).toEqual({
      preset: 'free',
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    })
    expect(restored?.transforms.material).toEqual(inset)
  })

  it('keeps every background transform covering the canvas', () => {
    for (const [width, height] of [[3840, 2160], [2160, 3840], [3840, 3840]]) {
      for (const rotation of [-135, -45, 0, 30, 90, 175]) {
        const transform = constrainBackgroundTransform(
          { preset: 'free', x: -2, y: 2, scale: 0.1, rotation },
          width,
          height,
        )
        const angle = (transform.rotation * Math.PI) / 180
        const cos = Math.abs(Math.cos(angle))
        const sin = Math.abs(Math.sin(angle))
        const centerX = width * (0.5 + transform.x / 2)
        const centerY = height * (0.5 + transform.y / 2)
        const halfWidth = transform.scale * (cos * width / 2 + sin * height / 2)
        const halfHeight = transform.scale * (sin * width / 2 + cos * height / 2)
        expect(centerX - halfWidth).toBeLessThanOrEqual(0.001)
        expect(centerX + halfWidth).toBeGreaterThanOrEqual(width - 0.001)
        expect(centerY - halfHeight).toBeLessThanOrEqual(0.001)
        expect(centerY + halfHeight).toBeGreaterThanOrEqual(height - 0.001)
      }
    }
  })

  it('passes orientation and palette into the gradient render input', () => {
    const recipe = deserializeBackgroundRecipe(JSON.stringify({
      ...createDefaultBackgroundRecipe(42),
      gradientState: {
        ...createDefaultBackgroundRecipe(42).gradientState,
        orientation: 90,
      },
    }))!
    const lab = backgroundRecipeToLab(recipe)

    expect(lab.look).toMatchObject({
      id: 'diffusion',
      version: 'gradients',
      gradient: { orientation: 90 },
    })
    expect(lab.colors.palette).toEqual(recipe.palette.mix.map((item) => item.color))
  })

  it('keeps 3D lighting choices out of the gradient painter', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    const changed = {
      ...recipe,
      material: {
        ...recipe.material,
        intensity: 1,
        light: 0,
        depth: 1,
      },
    }
    expect(backgroundRecipeToLab(changed)).toEqual(backgroundRecipeToLab(recipe))
  })
})
