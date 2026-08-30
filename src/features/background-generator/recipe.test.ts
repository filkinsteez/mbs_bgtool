import { describe, expect, it } from 'vitest'
import { CANONICAL_META_SAFE_AREA } from '@/core/lab/metaInfluence'
import {
  backgroundRecipeToLab,
  constrainBackgroundTransform,
  createDefaultBackgroundRecipe,
  deserializeBackgroundRecipe,
  dimensionsFor,
  dimensionsForRatio,
} from './recipe'

describe('background recipe', () => {
  it('defines the required 4K dimensions by long edge', () => {
    expect(dimensionsFor('16:9')).toEqual({ width: 3840, height: 2160 })
    expect(dimensionsFor('9:16')).toEqual({ width: 2160, height: 3840 })
    expect(dimensionsFor('1:1')).toEqual({ width: 3840, height: 3840 })
    expect(dimensionsFor('4:5')).toEqual({ width: 3072, height: 3840 })
  })

  it('keeps generated backgrounds covering the full canvas', () => {
    for (const [width, height] of [[3840, 2160], [2160, 3840], [3840, 3840]]) {
      for (const rotation of [-135, -45, 0, 30, 90, 175]) {
        for (const [x, y, scale] of [[-2, 2, 0.1], [0.8, -0.7, 1], [0, 0, 4]]) {
          const transform = constrainBackgroundTransform(
            { preset: 'free', x, y, scale, rotation },
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
          const bounds = {
            left: centerX - halfWidth,
            right: centerX + halfWidth,
            top: centerY - halfHeight,
            bottom: centerY + halfHeight,
          }
          expect(bounds.left).toBeLessThanOrEqual(0.001)
          expect(bounds.right).toBeGreaterThanOrEqual(width - 0.001)
          expect(bounds.top).toBeLessThanOrEqual(0.001)
          expect(bounds.bottom).toBeGreaterThanOrEqual(height - 0.001)
        }
      }
    }
  })

  it('round-trips a deterministic versioned recipe', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    expect(recipe.look.version).toBe('v2')
    expect(recipe.materialLookOverlay.enabled).toBe(false)
    expect(recipe.format).not.toHaveProperty('resolution')
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

  it('repairs saved inset background transforms without changing material framing', () => {
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

  it('keeps recipes saved before Look tabs on V1', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    const withoutLookVersion = {
      ...recipe,
      look: { id: recipe.look.id, detail: recipe.look.detail },
    }

    expect(
      deserializeBackgroundRecipe(JSON.stringify(withoutLookVersion))?.look.version,
    ).toBe('v1')
    expect(
      deserializeBackgroundRecipe(JSON.stringify(recipe))?.look.version,
    ).toBe('v2')
  })

  it('loads obsolete resolution values and dimensions as fixed 4K output', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    const cases = [
      {
        format: { aspect: '16:9', resolution: '1080', width: 1920, height: 1080 },
        expected: { aspect: '16:9', width: 3840, height: 2160 },
      },
      {
        format: { aspect: '9:16', resolution: '2k', width: 999, height: 1 },
        expected: { aspect: '9:16', width: 2160, height: 3840 },
      },
      {
        format: { aspect: '1:1', resolution: '8k', width: 1, height: 999 },
        expected: { aspect: '1:1', width: 3840, height: 3840 },
      },
      {
        format: { aspect: 'custom', resolution: '1080', width: 100, height: 200 },
        expected: { aspect: '9:16', width: 2160, height: 3840 },
      },
      {
        format: { aspect: 'custom', resolution: '8k', width: 100, height: 0 },
        expected: { aspect: '16:9', width: 3840, height: 2160 },
      },
      {
        format: { aspect: 'custom', resolution: 'unknown', width: -100, height: 200 },
        expected: { aspect: '16:9', width: 3840, height: 2160 },
      },
      {
        format: { aspect: '4:5', width: 2, height: 9 },
        expected: { aspect: '4:5', width: 3072, height: 3840 },
      },
    ]

    for (const { format, expected } of cases) {
      const restored = deserializeBackgroundRecipe(JSON.stringify({ ...recipe, format }))
      expect(restored?.format).toEqual(expected)
    }
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

    expect(restored?.palette).toEqual({
      packId: 'custom',
      mix,
      ink: '#0288F9',
      ground: '#24D366',
    })
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
      format: { aspect: '16:9', resolution: '8k', width: 7680, height: 4320 },
      framing: { mode: 'free', x: 0.2, y: -0.1, zoom: 1.5 },
      crop: { x: 0.1, y: 0.1, zoom: 2 },
    }))
    expect(migrated?.version).toBe(2)
    expect(migrated?.look.version).toBe('v1')
    expect(migrated?.format).toEqual({ aspect: '16:9', width: 3840, height: 2160 })
    expect(migrated?.transforms.background.x).toBeCloseTo(0.3)
    expect(migrated?.transforms.background).toMatchObject({
      preset: 'free',
      y: 0,
      scale: 3,
      rotation: 0,
    })
    expect(migrated?.transforms.material).toEqual(migrated?.transforms.background)
  })

  it('derives custom aspect dimensions from the selected long edge', () => {
    expect(dimensionsForRatio(2)).toEqual({ width: 3840, height: 1920 })
    expect(dimensionsForRatio(0.5)).toEqual({ width: 1920, height: 3840 })
    expect(dimensionsForRatio(0)).toEqual({ width: 3840, height: 2160 })
    expect(dimensionsForRatio(Number.NaN)).toEqual({ width: 3840, height: 2160 })
  })

  it('creates identical render state from identical recipes', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    expect(backgroundRecipeToLab(recipe)).toEqual(backgroundRecipeToLab(recipe))
  })

  it('round-trips V4 recipes and heals foreign look ids into the V4 catalog', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    const v4 = {
      ...recipe,
      look: { id: 'plates' as const, detail: 0.5, version: 'v4' as const },
    }
    expect(deserializeBackgroundRecipe(JSON.stringify(v4))).toEqual(v4)

    // a look from another catalog heals to the V4 catalog's first slot
    const alien = {
      ...recipe,
      look: { id: 'pattern' as const, detail: 0.5, version: 'v4' as const },
    }
    expect(deserializeBackgroundRecipe(JSON.stringify(alien))?.look).toEqual({
      id: 'composite',
      detail: 0.5,
      version: 'v4',
    })

    // and a V4 id on another tab heals into THAT catalog
    const strayed = {
      ...recipe,
      look: { id: 'loom' as const, detail: 0.5, version: 'v2' as const },
    }
    expect(deserializeBackgroundRecipe(JSON.stringify(strayed))?.look).toEqual({
      id: 'pattern',
      detail: 0.5,
      version: 'v2',
    })
  })

  it('routes V4 looks through the V2-shaped lab environment', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    const v4 = {
      ...recipe,
      look: { id: 'loom' as const, detail: 0.7, version: 'v4' as const },
    }
    const lab = backgroundRecipeToLab(v4)
    expect(lab.look).toMatchObject({
      id: 'loom',
      version: 'v4',
      complexity: 0.7,
    })
    // V4 systems read complexity from the env, so the minimal patch must
    // not disturb the default carrier the way band looks do
    expect(lab.sourceVisibility).toBe(0)
    expect(lab.composition).toBeDefined()
    expect(lab.colors.plan).toBeDefined()
    // canonical centered mark placement, never reoriented
    const curve = lab.territory.sources.find((source) => source.curve)
    expect(curve?.curve).toMatchObject({
      amplitudeX: CANONICAL_META_SAFE_AREA.width,
      amplitudeY: CANONICAL_META_SAFE_AREA.height,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      silhouette: 'meta-symbol',
    })
  })

  it('routes V1 and V2 through their matching Look recipes', () => {
    const current = createDefaultBackgroundRecipe(42)
    const v1 = {
      ...current,
      look: { id: 'brushwork' as const, detail: 0.5, version: 'v1' as const },
    }
    const v2 = {
      ...current,
      look: { id: 'brushwork' as const, detail: 0.5, version: 'v2' as const },
    }
    const v1Lab = backgroundRecipeToLab(v1)
    const v2Lab = backgroundRecipeToLab(v2)

    expect(v1Lab.look.version).toBe('v1')
    expect(v1Lab.look.complexity).toBeUndefined()
    expect(v2Lab.look.version).toBe('v2')
    expect(v1Lab.structure).toMatchObject({
      baseCell: 52,
      maxLevels: 1,
      subdivide: 0.6,
    })
    expect(v1Lab.mark.colorMode).toBe('source')
    expect(v1Lab.composition).toBeUndefined()
    expect(v1Lab.colors.plan).toBeUndefined()
    expect(v2Lab.structure).toMatchObject({
      baseCell: 224,
      maxLevels: 0,
    })
    expect(v2Lab.mark.colorMode).toBe('palette')
    expect(v2Lab.composition).toBeDefined()
    expect(v2Lab.colors.plan).toBeDefined()
  })

  it('preserves each Look carrier when an explicit raster source is present', () => {
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
    expect(withSource.territory.bands).toEqual(withoutSource.territory.bands)
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
      amplitudeX: CANONICAL_META_SAFE_AREA.width,
      amplitudeY: CANONICAL_META_SAFE_AREA.height,
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
