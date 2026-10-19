import { describe, expect, it } from 'vitest'
import { analyzeRGBA } from '@/core/lab/analysis'
import type { LabSource } from '@/core/lab/sourceCache'
import {
  createDefaultBackgroundRecipe,
  deserializeBackgroundRecipe,
} from './recipe'
import { resolveBackground2DInputs } from './render2d'

function metaSymbolSource(): LabSource {
  const rgba = new Uint8ClampedArray([
    0, 0, 0, 255,
    255, 255, 255, 255,
    255, 255, 255, 255,
    0, 0, 0, 255,
  ])
  return {
    image: {} as CanvasImageSource,
    fullW: 2,
    fullH: 2,
    maps: analyzeRGBA(rgba, 2, 2),
    hash: 'canonical-meta-symbol',
    filename: 'canonical-meta-symbol.rgba',
  }
}

describe('background 2D render inputs', () => {
  it('builds a self-contained gradient render without legacy inputs', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    const inputs = resolveBackground2DInputs(recipe, {
      phase: 'preview',
      maxLongEdge: 320,
    })

    expect(inputs.source).toBeNull()
    expect(inputs.view).toBe('composite')
    expect(Math.max(inputs.lab.output.width, inputs.lab.output.height)).toBe(320)
    expect(inputs.lab.look).toMatchObject({
      id: 'diffusion',
      version: 'gradients',
      gradient: { orientation: 0 },
    })
  })

  it('builds deterministic static inputs', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    const first = resolveBackground2DInputs(recipe, {
      phase: 'preview',
      maxLongEdge: 320,
    })
    const second = resolveBackground2DInputs(recipe, {
      phase: 'preview',
      maxLongEdge: 320,
    })

    expect(second).toEqual(first)
  })

  it('uses the canonical Meta symbol source when supplied by the 2D renderer', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    const source = metaSymbolSource()
    const inputs = resolveBackground2DInputs(
      recipe,
      { phase: 'preview', maxLongEdge: 320 },
      source,
    )

    expect(inputs.source).toBe(source)
    expect(inputs.lab.source).toEqual({
      filename: source.filename,
      width: source.fullW,
      height: source.fullH,
      contentHash: source.hash,
      fit: 'cover',
    })
  })

  it('keeps the 3D softness ceiling while giving 2D slightly more range', () => {
    const source = metaSymbolSource()
    const baseline = resolveBackground2DInputs(
      createDefaultBackgroundRecipe(42),
      { phase: 'preview' },
      source,
    )
    const recipe = createDefaultBackgroundRecipe(42)
    const maximum = deserializeBackgroundRecipe(JSON.stringify({
      ...recipe,
      gradientState: {
        ...recipe.gradientState,
        controls: {
          ...recipe.gradientState.controls,
          blend: 1,
        },
      },
    }))!
    const softened = resolveBackground2DInputs(
      maximum,
      { phase: 'preview' },
      source,
    )
    const backgroundMaximum = deserializeBackgroundRecipe(JSON.stringify({
      ...maximum,
      mode: 'background',
    }))!
    const softened2D = resolveBackground2DInputs(
      backgroundMaximum,
      { phase: 'preview' },
      source,
    )

    expect(baseline.lab.look.gradient).toMatchObject({
      softness: 0.68,
      bleed: 0.7,
      depth: 0.45,
    })
    expect(softened.lab.look.gradient.softness).toBeCloseTo(0.779)
    expect(softened.lab.look.gradient.bleed).toBeCloseTo(0.7675)
    expect(softened.lab.look.gradient.depth).toBeCloseTo(0.3375)
    expect(softened2D.lab.look.gradient.softness).toBeCloseTo(0.7944)
    expect(softened2D.lab.look.gradient.bleed).toBeCloseTo(0.778)
    expect(softened2D.lab.look.gradient.depth).toBeCloseTo(0.32)
  })

  it('applies test grain without changing the recipe', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    const originalGrain = recipe.look.gradient?.grain
    const inputs = resolveBackground2DInputs(recipe, {
      phase: 'thumbnail',
      grain: 0,
    })

    expect(inputs.lab.look.gradient.grain).toBe(0)
    expect(recipe.look.gradient?.grain).toBe(originalGrain)
  })
})
