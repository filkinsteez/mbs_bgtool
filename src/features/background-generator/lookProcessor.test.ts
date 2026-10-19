import { describe, expect, it } from 'vitest'
import type { LabSource } from '@/core/lab/sourceCache'
import { createDefaultBackgroundRecipe } from './recipe'
import { sourceAwareLabForRecipe } from './lookProcessor'

function source(): LabSource {
  return {
    image: {} as CanvasImageSource,
    fullW: 320,
    fullH: 180,
    maps: {} as LabSource['maps'],
    hash: 'frame-hash',
    filename: 'frame.rgba',
  }
}

describe('3D gradient processing', () => {
  it('uses the complete rendered frame and selected palette plan', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    recipe.palette.mix = [
      { color: '#111111', enabled: true, ratio: 28 },
      { color: '#EEEEEE', enabled: true, ratio: 72 },
    ]
    recipe.palette.ground = '#111111'
    recipe.palette.ink = '#EEEEEE'

    const lab = sourceAwareLabForRecipe(recipe, source())

    expect(lab.source).toEqual({
      filename: 'frame.rgba',
      width: 320,
      height: 180,
      contentHash: 'frame-hash',
      fit: 'contain',
    })
    expect(lab.look).toMatchObject({
      id: 'diffusion',
      version: 'gradients',
    })
    expect(lab.colors).toMatchObject({
      paper: '#111111',
      ink: '#EEEEEE',
      palette: ['#111111', '#EEEEEE'],
    })
    expect(lab.colors.plan?.swatches.map((swatch) => swatch.hex)).toEqual([
      '#111111',
      '#EEEEEE',
    ])
    expect(lab.colors.plan?.roles).toMatchObject({
      dominant: 1,
      ground: 0,
      ink: 1,
    })
    expect('motion' in lab).toBe(false)
    expect('territory' in lab).toBe(false)
  })

  it('shares source fitting and output dimensions with export', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    recipe.format = { aspect: '9:16', width: 2160, height: 3840 }

    const lab = sourceAwareLabForRecipe(recipe, source(), 'cover')

    expect(lab.output).toEqual({
      width: 2160,
      height: 3840,
      transparent: false,
    })
    expect(lab.source?.fit).toBe('cover')
  })
})
