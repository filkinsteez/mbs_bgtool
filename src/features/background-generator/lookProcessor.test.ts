import { describe, expect, it } from 'vitest'
import type { LabSource } from '@/core/lab/sourceCache'
import { createDefaultBackgroundRecipe } from './recipe'
import { sourceAwareLabForRecipe } from './lookProcessor'

describe('3D Look processing', () => {
  it('uses source tone without injecting the fixed Meta territory or 2D palette', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    recipe.material.backgroundColor = '#111111'
    recipe.material.highlightColor = '#EEEEEE'
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
    expect(lab.territory.sources.some((item) => item.kind === 'curve')).toBe(false)
    expect(lab.colors).toEqual({
      paper: '#111111',
      ink: '#EEEEEE',
      palette: ['#111111', '#EEEEEE'],
    })
  })
})
