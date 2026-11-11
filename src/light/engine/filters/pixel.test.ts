import { describe, expect, it } from 'vitest'
import { EXPORT_SIZES } from '../frame'
import { buildOutputShader } from '../output'
import { OUTPUT_FILTERS } from '.'
import {
  PIXEL_FILTER,
  PIXEL_LINE_CONTRAST,
  PIXEL_LINE_MAX,
  PIXEL_LINE_SHARE,
  PIXEL_MAX_CELLS,
  PIXEL_MIN_CELLS,
  pixelCells,
  pixelGrid,
  pixelLineArea,
  pixelLineCoverage,
  pixelLineWidth,
  pixelUniforms,
} from './pixel'

const STEPS = Array.from({ length: 101 }, (_, k) => k / 100)
const source = PIXEL_FILTER.source!
const samplesAt = (frame: { width: number; height: number; seed: number }, density: number) => {
  const samples = source.samples
  return typeof samples === 'function' ? samples(frame, density) : samples
}

describe('pixel filter', () => {
  it('is a stage of the output chain, after grain', () => {
    expect(OUTPUT_FILTERS.indexOf(PIXEL_FILTER)).toBeGreaterThan(0)
    expect(PIXEL_FILTER.glsl).toContain('vec3 filterPixel(vec3 display, ivec2 px, float weight)')
    expect(buildOutputShader([PIXEL_FILTER])).toContain('display = filterPixel(display, px, weight);')
  })

  it('sets the cell size: 8 cells on the short side at 0, 144 at 1, by the same ratio per step', () => {
    expect(pixelCells(0)).toBe(PIXEL_MIN_CELLS)
    expect(pixelCells(1)).toBe(PIXEL_MAX_CELLS)
    expect(PIXEL_MAX_CELLS).toBeGreaterThanOrEqual(144)
    // The biggest cells are more than twice the old biggest (18 cells on the short side).
    expect(PIXEL_MIN_CELLS).toBeLessThanOrEqual(9)
    expect([0.25, 0.5, 0.75].map(pixelCells)).toEqual([16, 34, 70])
    expect(pixelCells(Number.NaN)).toBe(pixelCells(0.5))
    for (let k = 0; k < STEPS.length; k++) {
      expect(Math.abs(pixelCells(STEPS[k]) - PIXEL_MIN_CELLS * (PIXEL_MAX_CELLS / PIXEL_MIN_CELLS) ** STEPS[k])).toBeLessThanOrEqual(0.5)
      if (k > 0) expect(pixelCells(STEPS[k])).toBeGreaterThanOrEqual(pixelCells(STEPS[k - 1]))
      // Each value gives the size 1 - value gave when 0 was the smallest cells, so the range of sizes is the same.
      expect(pixelCells(STEPS[k])).toBe(Math.round(PIXEL_MAX_CELLS * (PIXEL_MIN_CELLS / PIXEL_MAX_CELLS) ** (1 - STEPS[k])))
    }
  })

  it('fills every export size with whole cells at every density, square within the long side rounding to whole cells', () => {
    for (const { width, height } of Object.values(EXPORT_SIZES)) {
      const aspect = Math.max(width, height) / Math.min(width, height)
      for (const d of STEPS) {
        const { across, down } = pixelGrid({ width, height }, d)
        expect(Math.min(across, down)).toBe(pixelCells(d))
        expect(Math.abs(Math.max(across, down) - pixelCells(d) * aspect)).toBeLessThanOrEqual(0.5)
        // Half a cell of rounding on a long side of 12.5 cells (4:5 at 10 cells) is the worst: 4 %.
        expect(Math.abs(width / across / (height / down) - 1)).toBeLessThan(0.045)
      }
    }
  })

  it('reads an even number of source texels a cell, at least 36 on the short side, drawn finely enough, the same for a preview and the export', () => {
    for (const { width, height } of Object.values(EXPORT_SIZES)) {
      const frame = { width, height, seed: 1 }
      for (const d of STEPS) {
        const size = source.size(frame, d)
        const { across, down } = pixelGrid(frame, d)
        const texels = Math.max(2, 2 * Math.ceil(18 / pixelCells(d)))
        expect(size).toEqual({ width: texels * across, height: texels * down })
        expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(36)
        // The shader reads a cell with at most 5 reads a side, two texels each.
        expect(texels).toBeLessThanOrEqual(10)
        expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(512)
        const samples = samplesAt(frame, d)!
        expect(samples).toBeGreaterThanOrEqual(2)
        expect(samples).toBeLessThanOrEqual(8)
        expect(Math.min(size.width, size.height) * samples).toBeGreaterThanOrEqual(288)
      }
      for (const scale of [0.13, 0.25, 0.4, 1 / 3]) {
        // Previews are fitted in whole pixels, so their aspect is off by up to a pixel.
        for (const nudge of [-1, 0, 1]) {
          const preview = { width: Math.round(width * scale) + nudge, height: Math.round(height * scale), seed: 1 }
          for (const d of [0, 0.37, 1]) {
            expect(source.size(preview, d)).toEqual(source.size(frame, d))
            expect(samplesAt(preview, d)).toBe(samplesAt(frame, d))
          }
        }
      }
    }
  })

  it('draws crisp lines 2/24 of a cell wide, at most 2 px at 1080 px on the short side, so a preview shows the grid an export shows', () => {
    expect(PIXEL_LINE_SHARE).toBeCloseTo(2 / 24, 6)
    expect(PIXEL_LINE_MAX).toBeCloseTo(2 / 1080, 9)
    // Line width in a 4K export (2160 px on the short side) at a density.
    const px4k = (d: number) => (pixelLineWidth(d) * 2160) / pixelCells(d)
    expect(pixelLineWidth(1)).toBe(PIXEL_LINE_SHARE)
    expect(px4k(1)).toBeCloseTo(1.25, 6)
    for (const d of [0, 0.25, 0.5]) expect(px4k(d)).toBeCloseTo(4, 6)
    for (let k = 1; k < STEPS.length; k++) {
      expect(px4k(STEPS[k])).toBeLessThanOrEqual(4 + 1e-9)
      expect(px4k(STEPS[k])).toBeLessThanOrEqual(px4k(STEPS[k - 1]) + 1e-9)
    }
    // A pixel on the border is covered, one well inside its cell isn't, and the crossings count once.
    expect(pixelLineCoverage(0, 0.4, 0.06, 0.02)).toBe(1)
    expect(pixelLineCoverage(0.4, 0.4, 0.06, 0.02)).toBe(0)
    expect(pixelLineCoverage(0, 0, 0.06, 0.02)).toBe(1)
    // A line thinner than a pixel covers that pixel by its share.
    expect(pixelLineCoverage(0, 0.4, 0.01, 0.02)).toBeCloseTo(0.5, 6)
  })

  it('keeps every cell its mean: the lines get lighter and the inside darker by the same light', () => {
    // Cells of a few sizes with lines 2/24 of a cell, and the biggest cells with the capped lines: 4 px in a 4K
    // export, 1.12 px in a 606 px tall preview.
    const cases: [number, number][] = [...[6, 12, 42, 120].map((cellPx): [number, number] => [cellPx, PIXEL_LINE_SHARE]), [270, 4 / 270], [76, 1.12 / 76]]
    for (const [cellPx, width] of cases) {
      const pixel = 1 / cellPx
      const area = pixelLineArea(width)
      // The brightness factor at each pixel of a cell, as the shader draws it, averaged over the cell.
      let sum = 0
      let lines = 0
      let n = 0
      for (let j = 0; j < cellPx; j++) {
        for (let i = 0; i < cellPx; i++) {
          const dx = (i + 0.5) / cellPx - 0.5
          const dy = (j + 0.5) / cellPx - 0.5
          const cover = pixelLineCoverage(0.5 - Math.abs(dx), 0.5 - Math.abs(dy), width, pixel)
          sum += 1 + (PIXEL_LINE_CONTRAST * (cover - area)) / (1 - area)
          lines = Math.max(lines, cover)
          n++
        }
      }
      expect(sum / n, `${cellPx} px cells`).toBeCloseTo(1, 2)
      expect(lines).toBeGreaterThan(0.3)
    }
  })

  it('passes the cell grid at the density and the output size as uniforms', () => {
    expect(pixelUniforms(0.5, { width: 3840, height: 2160, seed: 3 })).toEqual({
      uPixelCells: [60, 34],
      uPixelFrame: [3840, 2160],
      uPixelLine: PIXEL_LINE_MAX * 34,
    })
    expect(pixelUniforms(0, { width: 1080, height: 1920, seed: 3 })).toEqual({ uPixelCells: [8, 14], uPixelFrame: [1080, 1920], uPixelLine: PIXEL_LINE_MAX * 8 })
    expect(pixelUniforms(1, { width: 1080, height: 1350, seed: 3 })).toEqual({
      uPixelCells: [144, 180],
      uPixelFrame: [1080, 1350],
      uPixelLine: PIXEL_LINE_SHARE,
    })
  })
})
