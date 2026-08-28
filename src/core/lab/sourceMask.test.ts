import { describe, expect, it } from 'vitest'
import type { AnalysisMaps } from './analysis'
import { analyzeRGBA } from './analysis'
import { buildBorderDistanceMask } from './sourceMask'

function solidFrame(
  width: number,
  height: number,
  background: readonly [number, number, number],
  subject?: {
    bounds: readonly [number, number, number, number]
    color: readonly [number, number, number]
  },
): AnalysisMaps {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const inside = subject
        && x >= subject.bounds[0]
        && y >= subject.bounds[1]
        && x < subject.bounds[2]
        && y < subject.bounds[3]
      const color = inside ? subject.color : background
      rgba[offset] = color[0]
      rgba[offset + 1] = color[1]
      rgba[offset + 2] = color[2]
      rgba[offset + 3] = 255
    }
  }
  return analyzeRGBA(rgba, width, height)
}

describe('border-distance source mask', () => {
  it('prefers a captured alpha silhouette when color matches the background', () => {
    const width = 20
    const height = 12
    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        rgba[offset] = 0
        rgba[offset + 1] = 100
        rgba[offset + 2] = 224
        rgba[offset + 3] = x >= 5 && x < 15 && y >= 2 && y < 10 ? 255 : 0
      }
    }
    const maps = analyzeRGBA(rgba, width, height)
    const mask = buildBorderDistanceMask(maps)

    expect(mask[6 * maps.w + 10]).toBeGreaterThan(0.9)
    expect(mask[0]).toBeLessThan(0.02)
  })

  it('isolates a bright subject from an opaque colored scene', () => {
    const maps = solidFrame(20, 12, [0, 80, 190], {
      bounds: [6, 3, 14, 9],
      color: [238, 244, 255],
    })
    const mask = buildBorderDistanceMask(maps)

    expect(mask[6 * maps.w + 10]).toBeGreaterThan(0.9)
    expect(mask[0]).toBeLessThan(0.02)
    expect(mask[11 * maps.w + 19]).toBeLessThan(0.02)
  })

  it('isolates a similarly hued subject by color distance', () => {
    const maps = solidFrame(20, 12, [0, 72, 168], {
      bounds: [5, 2, 15, 10],
      color: [36, 148, 246],
    })
    const mask = buildBorderDistanceMask(maps)

    expect(mask[6 * maps.w + 10]).toBeGreaterThan(0.9)
    expect(mask[6 * maps.w + 1]).toBeLessThan(0.02)
  })

  it('keeps a uniform frame empty', () => {
    const maps = solidFrame(12, 8, [40, 40, 40])
    const mask = buildBorderDistanceMask(maps)

    expect(Math.max(...mask)).toBeLessThan(0.001)
  })
})
