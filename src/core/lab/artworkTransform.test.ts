import { describe, expect, it } from 'vitest'
import { constrainArtworkCover } from './artworkTransform'

function expectCovered(
  transform: { x: number; y: number; scale: number; rotation: number },
  width: number,
  height: number,
  bleed: number,
) {
  const angle = (transform.rotation * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const centerX = transform.x * width / 2
  const centerY = transform.y * height / 2
  for (const x of [-width / 2 - bleed, width / 2 + bleed]) {
    for (const y of [-height / 2 - bleed, height / 2 + bleed]) {
      const dx = x - centerX
      const dy = y - centerY
      const sourceX = dx * cos + dy * sin
      const sourceY = -dx * sin + dy * cos
      expect(Math.abs(sourceX)).toBeLessThanOrEqual(width * transform.scale / 2 + 1e-6)
      expect(Math.abs(sourceY)).toBeLessThanOrEqual(height * transform.scale / 2 + 1e-6)
    }
  }
}

describe('cover-constrained artwork transform', () => {
  it('covers the actual raster bounds including bleed', () => {
    const result = constrainArtworkCover(
      { preset: 'free', x: 0.7, y: -0.5, scale: 1, rotation: 27 },
      511,
      287,
      0.2,
    )

    expect(result.preset).toBe('free')
    expectCovered(result, 511, 287, 0.2)
  })

  it('uses the same normalized projection at preview and export sizes', () => {
    const value = { x: 0.4, y: 0.2, scale: 1, rotation: 18 }
    const preview = constrainArtworkCover(value, 960, 540, 0.25)
    const output = constrainArtworkCover(value, 3840, 2160, 1)

    expect(preview.x).toBeCloseTo(output.x, 8)
    expect(preview.y).toBeCloseTo(output.y, 8)
    expect(preview.scale).toBeCloseTo(output.scale, 8)
  })
})
