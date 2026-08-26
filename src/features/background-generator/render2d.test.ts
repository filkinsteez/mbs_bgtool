import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultLab } from '@/core/lab/recipe'
import { useLabStore } from '@/core/lab/labStore'
import {
  clearLabSource,
  commitLabSource,
  type LabSource,
} from '@/core/lab/sourceCache'
import {
  clearPaintRuntime,
  ensurePaintRaster,
} from '@/core/lab/paintRuntime'
import { createDefaultBackgroundRecipe } from './recipe'
import { resolveBackground2DInputs } from './render2d'

function poisonedSource(): LabSource {
  const scalar = () => new Float32Array([1])
  return {
    image: {} as CanvasImageSource,
    fullW: 1,
    fullH: 1,
    hash: 'poisoned-source',
    filename: 'poisoned.rgba',
    maps: {
      w: 1,
      h: 1,
      rgba: new Uint8ClampedArray([255, 0, 255, 255]),
      lum: scalar(),
      alpha: scalar(),
      edge: scalar(),
      orientX: scalar(),
      orientY: scalar(),
      detailFine: scalar(),
      detailCoarse: scalar(),
    },
  }
}

afterEach(() => {
  clearLabSource()
  clearPaintRuntime()
  useLabStore.getState().replaceLab(createDefaultLab())
})

describe('background 2D render inputs', () => {
  it('ignores Lab state, source cache, and paint runtime', () => {
    const recipe = createDefaultBackgroundRecipe(42)
    useLabStore.getState().replaceLab(createDefaultLab(999))
    commitLabSource(poisonedSource())
    ensurePaintRaster(320, 180).bytes.fill(0)

    const first = resolveBackground2DInputs(recipe, {
      phase: 'preview',
      maxLongEdge: 320,
      timeMs: 1000,
    })

    useLabStore.getState().replaceLab(createDefaultLab(123))
    ensurePaintRaster(180, 320).bytes.fill(255)
    const second = resolveBackground2DInputs(recipe, {
      phase: 'preview',
      maxLongEdge: 320,
      timeMs: 1000,
    })

    expect(second.lab).toEqual(first.lab)
    expect(second.protos).toEqual(first.protos)
    expect(second.transform).toEqual(first.transform)
    expect(second.source).toBeNull()
    expect(second.paintRaster).toBeNull()
  })
})
