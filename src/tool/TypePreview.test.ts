import { describe, expect, it } from 'vitest'
import { meanLuminance, typeColor } from './TypePreview'

const pixels = (...rgba: number[][]) => Uint8ClampedArray.from(rgba.flat())

describe('sample headline color', () => {
  it('measures the mean relative luminance of opaque pixels, and nothing when none is opaque', () => {
    expect(meanLuminance(pixels([255, 255, 255, 255]))).toBeCloseTo(1, 6)
    expect(meanLuminance(pixels([0, 0, 0, 255]))).toBe(0)
    expect(meanLuminance(pixels([255, 255, 255, 255], [0, 0, 0, 255]))).toBeCloseTo(0.5, 6)
    expect(meanLuminance(pixels([255, 255, 255, 255], [9, 9, 9, 0]))).toBeCloseTo(1, 6)
    expect(meanLuminance(pixels([0, 0, 0, 0]))).toBeNull()
  })

  it('is white on dark backgrounds and unreadable images, near-black on light ones', () => {
    expect(typeColor(null)).toBe('#FFFFFF')
    expect(typeColor(0)).toBe('#FFFFFF')
    expect(typeColor(meanLuminance(pixels([0x00, 0x64, 0xe0, 255])))).toBe('#FFFFFF')
    expect(typeColor(meanLuminance(pixels([0xf2, 0xf4, 0xf7, 255])))).toBe('#1C2B33')
    expect(typeColor(meanLuminance(pixels([0xff, 0xd6, 0x1e, 255])))).toBe('#1C2B33')
    expect(typeColor(meanLuminance(pixels([0x1c, 0x2b, 0x33, 255])))).toBe('#FFFFFF')
  })
})
