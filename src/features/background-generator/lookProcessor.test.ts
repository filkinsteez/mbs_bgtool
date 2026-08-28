import { describe, expect, it } from 'vitest'
import type { LabSource } from '@/core/lab/sourceCache'
import { createDefaultBackgroundRecipe } from './recipe'
import { sourceAwareLabForRecipe } from './lookProcessor'

describe('3D Look processing', () => {
  it('uses a source mask with the selected Look palette', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    recipe.palette.mix = [
      { color: '#111111', enabled: true, ratio: 28 },
      { color: '#EEEEEE', enabled: true, ratio: 72 },
    ]
    recipe.palette.ground = '#111111'
    recipe.palette.ink = '#EEEEEE'
    const source = {
      image: {} as CanvasImageSource,
      fullW: 320,
      fullH: 180,
      maps: {},
      hash: 'frame',
      filename: 'frame.rgba',
    } as LabSource

    const lab = sourceAwareLabForRecipe(recipe, source)

    expect(lab.territory.sources).toHaveLength(1)
    expect(lab.territory.sources[0].kind).toBe('tone')
    expect(lab.territory.sources[0].invert).toBe(false)
    expect(lab.territory.sources.some((item) => item.kind === 'curve')).toBe(false)
    expect(lab.sourceMask).toBe('border-distance')
    expect(lab.sourceVisibility).toBe(0)
    expect(lab.motion).toMatchObject({ enabled: false, amount: 0 })
    expect(lab.paint).toBeNull()
    expect(lab.colors).toMatchObject({
      paper: '#111111',
      ink: '#EEEEEE',
      palette: ['#111111', '#EEEEEE'],
    })
    expect(lab.colors.distinct).toEqual(['#111111', '#EEEEEE'])
    expect(lab.colors.plan?.swatches.map((swatch) => swatch.hex)).toEqual([
      '#111111',
      '#EEEEEE',
    ])
    expect(lab.colors.plan?.roles).toMatchObject({
      dominant: 1,
      ground: 0,
      ink: 1,
    })
  })

  it('keeps V1 material state free of V2 composition and color plans', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    recipe.look.version = 'v1'
    recipe.palette.mix = [
      { color: '#111111', enabled: true, ratio: 28 },
      { color: '#EEEEEE', enabled: true, ratio: 72 },
    ]
    recipe.palette.ground = '#111111'
    recipe.palette.ink = '#EEEEEE'
    const source = {
      image: {} as CanvasImageSource,
      fullW: 320,
      fullH: 180,
      maps: {},
      hash: 'frame',
      filename: 'frame.rgba',
    } as LabSource

    const lab = sourceAwareLabForRecipe(recipe, source)

    expect(lab.composition).toBeUndefined()
    expect(lab.colors.plan).toBeUndefined()
    expect(lab.colors.palette).toHaveLength(100)
    expect(lab.colors.palette.filter((color) => color === '#111111')).toHaveLength(28)
    expect(lab.colors.palette.filter((color) => color === '#EEEEEE')).toHaveLength(72)
    // the run-length palette deduplicated in mix order, for slot
    // arithmetic that degenerates on 100 same-color runs
    expect(lab.colors.distinct).toEqual(['#111111', '#EEEEEE'])
    expect(lab.sourceMask).toBe('border-distance')
    expect(lab.territory.sources.map((item) => item.kind)).toEqual(['tone'])
  })
})
