import { describe, expect, it } from 'vitest'
import { DEFAULT_OUTPUT } from '../../scene'
import { activeFilters, filterFileTag } from '.'
import { PAPER_FILTER, paperInkShare, paperUniforms } from './paper'

describe('paper filter', () => {
  it('is off at 0 and runs as its own stage', () => {
    expect(PAPER_FILTER.key).toBe('paper')
    expect(activeFilters(DEFAULT_OUTPUT)).toEqual([])
    expect(activeFilters({ ...DEFAULT_OUTPUT, paper: 0.5 })).toEqual([PAPER_FILTER])
    expect(PAPER_FILTER.glsl).toContain('if (uPaperAmp <= 0.0) return display;')
    expect(filterFileTag({ paper: 0.5 })).toBe('-paper50')
  })

  it('sizes the paper by the short side, so every format and size gets the same paper', () => {
    expect(paperUniforms(0.5, { width: 3840, height: 2160, seed: 1 })).toEqual({ uPaperAmp: 0.5, uPaperShort: 2160 })
    expect(paperUniforms(0.5, { width: 2160, height: 3840, seed: 1 })).toEqual({ uPaperAmp: 0.5, uPaperShort: 2160 })
    expect(PAPER_FILTER.uniforms(1, { width: 960, height: 540, seed: 3 })).toEqual({ uPaperAmp: 1, uPaperShort: 540 })
  })

  it('keeps the strength between 0 and 1', () => {
    expect(paperUniforms(-1, { width: 10, height: 10, seed: 1 }).uPaperAmp).toBe(0)
    expect(paperUniforms(2, { width: 10, height: 10, seed: 1 }).uPaperAmp).toBe(1)
    expect(paperUniforms(Number.NaN, { width: 10, height: 10, seed: 1 }).uPaperAmp).toBe(0)
  })

  it('shows the ink most in the middle tones and not at all at black or white', () => {
    expect(paperInkShare(0)).toBe(0)
    expect(paperInkShare(1)).toBe(0)
    expect(paperInkShare(1 / Math.E)).toBeCloseTo(1, 12)
    for (let L = 0.01; L < 1; L += 0.01) expect(paperInkShare(L)).toBeLessThanOrEqual(1 + 1e-12)
    expect(paperInkShare(0.05)).toBeLessThan(paperInkShare(0.2))
    expect(paperInkShare(0.95)).toBeLessThan(paperInkShare(0.6))
  })
})
