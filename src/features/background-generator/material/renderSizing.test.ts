import { describe, expect, it } from 'vitest'
import {
  expectedPreviewBackingSize,
  isNativeTargetSize,
  materialPreviewCssSize,
} from './renderSizing'

describe('material render sizing', () => {
  it('sizes preview CSS to the visible canvas instead of scaling a larger frame', () => {
    const cssSize = materialPreviewCssSize(3840, 2160, 0.25)
    expect(cssSize).toEqual({ width: 960, height: 540 })
    expect(expectedPreviewBackingSize(cssSize, 2)).toEqual({
      width: 1920,
      height: 1080,
    })
  })

  it('caps preview DPR without changing native export dimensions', () => {
    const cssSize = materialPreviewCssSize(1080, 1080, 0.5)
    expect(expectedPreviewBackingSize(cssSize, 3)).toEqual({
      width: 1080,
      height: 1080,
    })
    expect(isNativeTargetSize(
      { width: 7680, height: 4320 },
      { width: 7680, height: 4320 },
    )).toBe(true)
    expect(isNativeTargetSize(
      { width: 4096, height: 2304 },
      { width: 7680, height: 4320 },
    )).toBe(false)
  })
})
