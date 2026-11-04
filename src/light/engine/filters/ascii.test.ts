import { describe, expect, it } from 'vitest'
import { EXPORT_SIZES } from '../frame'
import { ASCII_FILTER, ASCII_INK, ASCII_RAMP, ASCII_ROWS_ON_SHORT_SIDE, asciiGrid, asciiUniforms } from './ascii'

describe('ascii filter', () => {
  it('has 26 rows on the short side and the same grid at every size of a format', () => {
    expect(asciiGrid({ width: 1920, height: 1080 })).toMatchObject({ cols: 100, rows: ASCII_ROWS_ON_SHORT_SIDE })
    expect(asciiGrid({ width: 1080, height: 1920 })).toMatchObject({ cols: 56, rows: 46 })
    for (const size of Object.values(EXPORT_SIZES)) {
      const big = asciiGrid(size)
      for (const scale of [0.25, 0.5, 0.2713]) {
        const small = asciiGrid({ width: Math.round(size.width * scale), height: Math.round(size.height * scale) })
        expect([small.cols, small.rows]).toEqual([big.cols, big.rows])
      }
      expect(Math.min(big.cellW, big.cellH) / Math.min(size.width, size.height)).toBeGreaterThan(0.015)
      expect(big.cols).toBeLessThanOrEqual(512)
      expect(big.rows).toBeLessThanOrEqual(512)
    }
  })

  it('keeps cells close to the tile shape, 0.6 x 1.3 em', () => {
    for (const size of Object.values(EXPORT_SIZES)) {
      const { cellW, cellH } = asciiGrid(size)
      expect(cellW / cellH).toBeGreaterThan(0.45)
      expect(cellW / cellH).toBeLessThan(0.48)
    }
  })

  it('sorts the ramp by ink', () => {
    expect([...ASCII_RAMP].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    for (let i = 1; i < ASCII_INK.length; i++) expect(ASCII_INK[i]).toBeGreaterThanOrEqual(ASCII_INK[i - 1])
    expect(ASCII_INK[0]).toBe(0)
  })

  it('asks for a frame source with one texel per cell and declares its sampler', () => {
    const frame = { width: 3840, height: 2160, seed: 3 }
    const grid = asciiGrid(frame)
    expect(ASCII_FILTER.source?.size(frame)).toEqual({ width: grid.cols, height: grid.rows })
    expect(ASCII_FILTER.glsl).toContain(`uniform sampler2D ${ASCII_FILTER.source?.uniform};`)
    expect(ASCII_FILTER.glsl).toContain('vec3 filterAscii(vec3 display, ivec2 px, float weight)')
  })

  it('sizes the glyphs from the cell height and clamps the strength', () => {
    const uniforms = asciiUniforms(1.7, { width: 1920, height: 1080, seed: 1 })
    expect(uniforms.uAsciiStrength).toBe(1)
    expect(uniforms.uAsciiGrid).toEqual([100, 26])
    expect(uniforms.uAsciiEmPx).toBeCloseTo(1080 / 26 / 1.3, 6)
    expect(asciiUniforms(Number.NaN, { width: 1920, height: 1080, seed: 1 }).uAsciiStrength).toBe(0)
  })
})
