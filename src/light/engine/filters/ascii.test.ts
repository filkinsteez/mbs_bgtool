import { describe, expect, it } from 'vitest'
import { EXPORT_SIZES } from '../frame'
import {
  ASCII_FILTER,
  ASCII_INK,
  ASCII_MAX_ROWS,
  ASCII_MIN_ROWS,
  ASCII_RAMP,
  ASCII_ROWS_ON_SHORT_SIDE,
  asciiGrid,
  asciiRows,
  asciiSourceGrid,
  asciiUniforms,
} from './ascii'

const DENSITIES = [0, 0.25, 0.5, 0.75, 1]

describe('ascii filter', () => {
  it('sets the rows on the short side from the density: 13 at 0, the tile 26 at 0.5, 52 at 1', () => {
    expect(asciiRows(0)).toBe(ASCII_MIN_ROWS)
    expect(asciiRows(0.5)).toBe(ASCII_ROWS_ON_SHORT_SIDE)
    expect(asciiRows(1)).toBe(ASCII_MAX_ROWS)
    expect(asciiRows(-1)).toBe(ASCII_MIN_ROWS)
    expect(asciiRows(7)).toBe(ASCII_MAX_ROWS)
    expect(asciiRows(Number.NaN)).toBe(ASCII_ROWS_ON_SHORT_SIDE)
  })

  it('steps one whole row at a time across a 0..1 sweep, by the same ratio of rows per step', () => {
    const rows = Array.from({ length: 101 }, (_, i) => asciiRows(i / 100))
    for (let i = 1; i < rows.length; i++) expect(rows[i] - rows[i - 1]).toBeGreaterThanOrEqual(0)
    for (let i = 1; i < rows.length; i++) expect(rows[i] - rows[i - 1]).toBeLessThanOrEqual(1)
    expect(new Set(rows).size).toBe(ASCII_MAX_ROWS - ASCII_MIN_ROWS + 1)
    // Log scale: where each row count starts, in density, is log(rows) spread evenly.
    const where = (n: number) => rows.findIndex((r) => r >= n) / 100
    const expected = (n: number) => Math.log((n - 0.5) / ASCII_MIN_ROWS) / Math.log(ASCII_MAX_ROWS / ASCII_MIN_ROWS)
    for (const n of [14, 20, 26, 40, 52]) expect(Math.abs(where(n) - expected(n))).toBeLessThanOrEqual(0.01)
  })

  it('gives the same grid at every size of a format, at every density', () => {
    expect(asciiGrid({ width: 1920, height: 1080 })).toMatchObject({ cols: 100, rows: 26 })
    expect(asciiGrid({ width: 1080, height: 1920 })).toMatchObject({ cols: 56, rows: 46 })
    expect(asciiGrid({ width: 1920, height: 1080 }, 0)).toMatchObject({ cols: 50, rows: 13 })
    expect(asciiGrid({ width: 1920, height: 1080 }, 1)).toMatchObject({ cols: 200, rows: 52 })
    for (const size of Object.values(EXPORT_SIZES)) {
      for (const density of DENSITIES) {
        const big = asciiGrid(size, density)
        for (const scale of [0.25, 0.5, 0.2713]) {
          const small = asciiGrid({ width: Math.round(size.width * scale), height: Math.round(size.height * scale) }, density)
          expect([small.cols, small.rows]).toEqual([big.cols, big.rows])
        }
        expect(big.cellW / big.cellH).toBeGreaterThan(0.45)
        expect(big.cellW / big.cellH).toBeLessThan(0.48)
      }
    }
  })

  it('reads one frame source at every density, sized by the aspect only', () => {
    for (const size of Object.values(EXPORT_SIZES)) {
      const source = asciiSourceGrid(size)
      expect(ASCII_FILTER.source?.size({ ...size, seed: 1 })).toEqual({ width: source.cols, height: source.rows })
      expect(source.cols).toBeLessThanOrEqual(512)
      expect(source.rows).toBeLessThanOrEqual(512)
      // At least two texels per cell each way at the densest setting, so a cell's mean comes from whole texels.
      const densest = asciiGrid(size, 1)
      expect(source.rows / densest.rows).toBeGreaterThanOrEqual(1.99)
      expect(source.cols / densest.cols).toBeGreaterThanOrEqual(1.99)
    }
    expect(ASCII_FILTER.glsl).toContain(`uniform sampler2D ${ASCII_FILTER.source?.uniform};`)
    expect(ASCII_FILTER.glsl).toContain('vec3 filterAscii(vec3 display, ivec2 px, float weight)')
  })

  it('sizes glyphs from the cell and reads enough of the source to cover each cell', () => {
    const frame = { width: 1920, height: 1080, seed: 1 }
    for (const density of DENSITIES) {
      const uniforms = asciiUniforms(density, frame)
      const grid = asciiGrid(frame, density)
      const source = asciiSourceGrid(frame)
      expect(uniforms.uAsciiGrid).toEqual([grid.cols, grid.rows])
      expect(uniforms.uAsciiEmPx).toBeCloseTo(grid.cellH / 1.3, 6)
      const taps = uniforms.uAsciiTaps as number
      expect(Number.isInteger(taps) && taps >= 1 && taps <= 8).toBe(true)
      expect(2 * taps).toBeGreaterThanOrEqual(Math.max(source.cols / grid.cols, source.rows / grid.rows) - 1e-6)
    }
    expect(asciiUniforms(0.5, frame).uAsciiTaps).toBe(2)
    expect(asciiUniforms(1, frame).uAsciiTaps).toBe(1)
    expect(asciiUniforms(0, frame).uAsciiTaps).toBe(4)
  })

  it('sorts the ramp by ink', () => {
    expect([...ASCII_RAMP].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    for (let i = 1; i < ASCII_INK.length; i++) expect(ASCII_INK[i]).toBeGreaterThanOrEqual(ASCII_INK[i - 1])
    expect(ASCII_INK[0]).toBe(0)
  })
})
