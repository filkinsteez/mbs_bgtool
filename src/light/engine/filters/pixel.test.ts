import { describe, expect, it } from 'vitest'
import { EXPORT_SIZES } from '../frame'
import { buildOutputShader } from '../output'
import { OUTPUT_FILTERS } from '.'
import { ledShape, PIXEL_CELLS, PIXEL_FILTER, PIXEL_LED_AREA, PIXEL_TEXELS_PER_CELL, pixelGrid, pixelParams, pixelUniforms } from './pixel'

describe('pixel filter', () => {
  it('is a stage of the output chain, after grain', () => {
    expect(OUTPUT_FILTERS.indexOf(PIXEL_FILTER)).toBeGreaterThan(0)
    expect(PIXEL_FILTER.glsl).toContain('vec3 filterPixel(vec3 display, ivec2 px, float weight)')
    expect(buildOutputShader([PIXEL_FILTER])).toContain('display = filterPixel(display, px, weight);')
  })

  it('fills every export size with whole square cells, 36 on the short side', () => {
    for (const { width, height } of Object.values(EXPORT_SIZES)) {
      const { across, down } = pixelGrid(width, height)
      expect(Math.min(across, down)).toBe(PIXEL_CELLS)
      expect(width / across).toBeCloseTo(height / down, 9)
    }
  })

  it('gives a preview the same cells and frame source as the export of its format', () => {
    for (const { width, height } of Object.values(EXPORT_SIZES)) {
      const exported = PIXEL_FILTER.source!.size({ width, height, seed: 1 })
      for (const scale of [0.13, 0.25, 0.4, 1 / 3]) {
        // Previews are fitted in whole pixels, so their aspect is off by up to a pixel.
        for (const nudge of [-1, 0, 1]) {
          const preview = { width: Math.round(width * scale) + nudge, height: Math.round(height * scale), seed: 1 }
          expect(PIXEL_FILTER.source!.size(preview)).toEqual(exported)
        }
      }
      expect(Math.max(exported.width, exported.height)).toBeLessThanOrEqual(512)
      expect(exported.width).toBe(pixelGrid(width, height).across * PIXEL_TEXELS_PER_CELL)
    }
  })

  it('fades in up to strength 0.5, then raises the LED contrast, with no jumps', () => {
    expect(pixelParams(0)).toEqual({ amount: 0, contrast: 0.1 })
    expect(pixelParams(0.5)).toEqual({ amount: 1, contrast: 0.1 })
    expect(pixelParams(1).amount).toBe(1)
    expect(pixelParams(1).contrast).toBeCloseTo(0.2, 12)
    for (let k = 1; k <= 100; k++) {
      const a = pixelParams((k - 1) / 100)
      const b = pixelParams(k / 100)
      expect(b.amount - a.amount).toBeGreaterThanOrEqual(0)
      expect(b.amount - a.amount).toBeLessThanOrEqual(0.02 + 1e-12)
      expect(b.contrast - a.contrast).toBeLessThanOrEqual(0.004 + 1e-12)
    }
  })

  it('normalizes the LED so it averages 1 over a cell and stays inside its cell', () => {
    expect(PIXEL_LED_AREA).toBeGreaterThan(0.5)
    expect(PIXEL_LED_AREA).toBeLessThan(0.7)
    expect(ledShape(0, 0)).toBe(1)
    expect(ledShape(0.5, 0)).toBe(0)
    expect(ledShape(0.5, 0.5)).toBe(0)
  })

  it('passes the cell grid and output size as uniforms', () => {
    expect(pixelUniforms(0.5, { width: 3840, height: 2160, seed: 3 })).toEqual({
      uPixelCells: [64, 36],
      uPixelFrame: [3840, 2160],
      uPixelAmount: 1,
      uPixelContrast: 0.1,
    })
  })
})
