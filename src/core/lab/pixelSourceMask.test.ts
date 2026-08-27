import { describe, expect, it } from 'vitest'
import { analyzeRGBA } from './analysis'
import { planPixelField } from './pixelField'
import { createPixelSourceMask } from './pixelSourceMask'

const WIDTH = 120
const HEIGHT = 80

function translatedFixture(): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = (y * WIDTH + x) * 4
      const inCircle = Math.hypot(x - 92, y - 27) <= 15
      const inStem = x >= 84 && x <= 106 && y >= 25 && y <= 65
      const foreground = inCircle || inStem
      rgba[offset] = foreground ? 242 : 9
      rgba[offset + 1] = foreground ? 96 : 17
      rgba[offset + 2] = foreground ? 38 : 31
      rgba[offset + 3] = 255
    }
  }
  return rgba
}

function sourceMask(rgba: Uint8ClampedArray, key: string) {
  return createPixelSourceMask({
    maps: analyzeRGBA(rgba, WIDTH, HEIGHT),
    sourceHash: key,
    rect: { x: 0, y: 0, w: WIDTH, h: HEIGHT },
    outputWidth: WIDTH,
    outputHeight: HEIGHT,
  })
}

describe('Pixels source protection', () => {
  it('tracks a translated non-Meta source silhouette', () => {
    const mask = sourceMask(translatedFixture(), 'translated-non-meta')
    const plan = planPixelField({
      seed: 1913,
      complexity: 0.5,
      aspect: WIDTH / HEIGHT,
      paletteSize: 4,
      protectedKey: mask.key,
      protectedSample: mask.sample,
    })
    let protectedX = 0
    let protectedCount = 0
    let protectedOnLeft = 0
    for (let index = 0; index < plan.masks.protected.length; index += 1) {
      if (!plan.masks.protected[index]) continue
      const column = index % plan.columns
      protectedX += (column + 0.5) / plan.columns
      protectedCount += 1
      if (column < plan.columns * 0.5) protectedOnLeft += 1
    }

    expect(mask.coverage).toBeGreaterThan(0.08)
    expect(mask.coverage).toBeLessThan(0.3)
    expect(mask.sample(0.25, 0.5)).toBe(0)
    expect(mask.sample(0.78, 0.45)).toBe(1)
    expect(plan.protectedMode).toBe('source')
    expect(protectedCount).toBeGreaterThan(20)
    expect(protectedX / protectedCount).toBeGreaterThan(0.68)
    expect(protectedOnLeft).toBe(0)
  })

  it('never falls back to the canonical Meta mask for an empty source', () => {
    const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
    for (let offset = 0; offset < rgba.length; offset += 4) {
      rgba[offset] = 9
      rgba[offset + 1] = 17
      rgba[offset + 2] = 31
      rgba[offset + 3] = 255
    }
    const mask = sourceMask(rgba, 'empty-source')
    const plan = planPixelField({
      seed: 42,
      complexity: 0.85,
      aspect: WIDTH / HEIGHT,
      paletteSize: 4,
      protectedKey: mask.key,
      protectedSample: mask.sample,
    })

    expect(mask.coverage).toBe(0)
    expect(plan.protectedMode).toBe('source')
    expect(plan.diagnostics.protectedCellCount).toBe(0)
    expect(plan.diagnostics.activeCellCount).toBe(0)
  })
})
