import { describe, expect, it } from 'vitest'
import { EXPORT_SIZES } from '../frame'
import { buildOutputShader } from '../output'
import { OUTPUT_FILTERS } from '.'
import {
  blendShare,
  ledShape,
  PIXEL_CELLS,
  PIXEL_FILTER,
  PIXEL_LED_AREA,
  PIXEL_MAX_CELLS,
  PIXEL_MIN_CELLS,
  pixelCells,
  pixelGrid,
  pixelSourceSize,
  pixelUniforms,
} from './pixel'

const STEPS = Array.from({ length: 101 }, (_, k) => k / 100)

describe('pixel filter', () => {
  it('is a stage of the output chain, after grain', () => {
    expect(OUTPUT_FILTERS.indexOf(PIXEL_FILTER)).toBeGreaterThan(0)
    expect(PIXEL_FILTER.glsl).toContain('vec3 filterPixel(vec3 display, ivec2 px, float weight)')
    expect(buildOutputShader([PIXEL_FILTER])).toContain('display = filterPixel(display, px, weight);')
  })

  it('sets the density: 18 cells on the short side at 0, 36 at 0.5, 72 at 1, by the same ratio per step', () => {
    expect(pixelCells(0)).toBe(PIXEL_MIN_CELLS)
    expect(pixelCells(0.5)).toBe(PIXEL_CELLS)
    expect(pixelCells(1)).toBe(PIXEL_MAX_CELLS)
    expect(pixelCells(Number.NaN)).toBe(PIXEL_CELLS)
    for (let k = 1; k < STEPS.length; k++) {
      const step = pixelCells(STEPS[k]) - pixelCells(STEPS[k - 1])
      expect(step).toBeGreaterThanOrEqual(0)
      expect(step).toBeLessThanOrEqual(1)
    }
    for (const d of [0, 0.25, 0.5, 0.75]) {
      expect(Math.abs(pixelCells(d + 0.25) / pixelCells(d) / Math.SQRT2 - 1)).toBeLessThan(0.03)
    }
  })

  it('fills every export size with whole cells at every density, square within the long side rounding to whole cells', () => {
    for (const { width, height } of Object.values(EXPORT_SIZES)) {
      for (const d of STEPS) {
        const { across, down } = pixelGrid({ width, height }, d)
        expect(Math.min(across, down)).toBe(pixelCells(d))
        expect(Math.abs(width / across / (height / down) - 1)).toBeLessThan(0.025)
      }
    }
  })

  it('reads one frame source at every density, the same for a preview and the export', () => {
    for (const { width, height } of Object.values(EXPORT_SIZES)) {
      const exported = PIXEL_FILTER.source!.size({ width, height, seed: 1 })
      expect(exported).toEqual(pixelSourceSize({ width, height }))
      expect(Math.max(exported.width, exported.height)).toBeLessThanOrEqual(512)
      for (const scale of [0.13, 0.25, 0.4, 1 / 3]) {
        // Previews are fitted in whole pixels, so their aspect is off by up to a pixel.
        for (const nudge of [-1, 0, 1]) {
          const preview = { width: Math.round(width * scale) + nudge, height: Math.round(height * scale), seed: 1 }
          expect(PIXEL_FILTER.source!.size(preview)).toEqual(exported)
          expect(pixelGrid(preview, 0.37)).toEqual(pixelGrid({ width, height }, 0.37))
        }
      }
      // A cell covers 2 to 9 texels each way at every density, which the shader's 5 reads per axis cover.
      for (const d of STEPS) {
        const { across, down } = pixelGrid({ width, height }, d)
        for (const perCell of [exported.width / across, exported.height / down]) {
          expect(perCell).toBeGreaterThanOrEqual(2)
          expect(perCell).toBeLessThanOrEqual(9)
        }
      }
    }
  })

  it('normalizes the LED so it averages 1 over a cell and stays inside its cell', () => {
    expect(PIXEL_LED_AREA).toBeGreaterThan(0.55)
    expect(PIXEL_LED_AREA).toBeLessThan(0.75)
    expect(ledShape(0, 0)).toBe(1)
    expect(ledShape(0.5, 0)).toBe(0)
    expect(ledShape(0.5, 0.5)).toBe(0)
  })

  it('knows how much light a soft edge hands to a neighbour, to give it back', () => {
    // A linear blend hands over the area of a triangle, 1/8 of the cell; sharper blends hand over less.
    expect(blendShare(1)).toBeCloseTo(0.125, 6)
    expect(blendShare(4)).toBeGreaterThan(0.03)
    expect(blendShare(4)).toBeLessThan(0.05)
    expect(blendShare(8)).toBeLessThan(blendShare(4))
  })

  it('passes the cell grid at the density and the output size as uniforms', () => {
    expect(pixelUniforms(0.5, { width: 3840, height: 2160, seed: 3 })).toEqual({ uPixelCells: [64, 36], uPixelFrame: [3840, 2160] })
    expect(pixelUniforms(0, { width: 1080, height: 1920, seed: 3 })).toEqual({ uPixelCells: [18, 32], uPixelFrame: [1080, 1920] })
    expect(pixelUniforms(1, { width: 1080, height: 1350, seed: 3 })).toEqual({ uPixelCells: [72, 90], uPixelFrame: [1080, 1350] })
  })
})
