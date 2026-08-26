import { describe, expect, it } from 'vitest'
import { analyzeRGBA } from './analysis'
import { fieldFromMap, invertField } from './field'
import { buildSourceTrailCarrier } from './trailSourceCarrier'
import { buildTrailPlan } from './trails'

const WIDTH = 320
const HEIGHT = 180

function translatedLFixture(): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = (y * WIDTH + x) * 4
      const vertical = x >= 204 && x <= 232 && y >= 28 && y <= 150
      const foot = x >= 204 && x <= 294 && y >= 120 && y <= 150
      const subject = vertical || foot
      rgba[offset] = subject ? 244 : 17
      rgba[offset + 1] = subject ? 114 + Math.round(y / HEIGHT * 45) : 24
      rgba[offset + 2] = subject ? 38 : 39
      rgba[offset + 3] = 255
    }
  }
  return rgba
}

function bounds(points: Float32Array): { minimumX: number; maximumX: number } {
  let minimumX = Number.POSITIVE_INFINITY
  let maximumX = Number.NEGATIVE_INFINITY
  for (let index = 0; index < points.length; index += 2) {
    minimumX = Math.min(minimumX, points[index])
    maximumX = Math.max(maximumX, points[index])
  }
  return { minimumX, maximumX }
}

describe('source-aware Trails carriers', () => {
  it('follows a translated non-Meta subject instead of the canonical symbol', () => {
    const maps = analyzeRGBA(translatedLFixture(), WIDTH, HEIGHT)
    const rect = { x: 0, y: 0, w: WIDTH, h: HEIGHT }
    const territory = invertField(fieldFromMap(maps.lum, maps.w, maps.h, rect))
    const carrier = buildSourceTrailCarrier({
      maps,
      rect,
      width: WIDTH,
      height: HEIGHT,
      territory,
    })
    const repeated = buildSourceTrailCarrier({
      maps,
      rect,
      width: WIDTH,
      height: HEIGHT,
      territory,
    })

    expect(carrier).toEqual(repeated)
    expect(carrier.method).toBe('source-contour')
    expect(carrier.bounds.x).toBeGreaterThan(WIDTH * 0.58)
    expect(carrier.bounds.centerX).toBeGreaterThan(WIDTH * 0.72)
    expect(carrier.bounds.width).toBeGreaterThan(WIDTH * 0.18)
    expect(carrier.bounds.height).toBeGreaterThan(HEIGHT * 0.55)

    const sourcePlan = buildTrailPlan({
      seed: 1913,
      width: WIDTH,
      height: HEIGHT,
      complexity: 0.72,
      carrier: {
        kind: 'source',
        key: 'translated-l-fixture',
        points: carrier.points,
      },
    })
    const canonicalPlan = buildTrailPlan({
      seed: 1913,
      width: WIDTH,
      height: HEIGHT,
      complexity: 0.72,
    })

    expect(sourcePlan.carrierKind).toBe('source')
    expect(canonicalPlan.carrierKind).toBe('canonical')
    expect(sourcePlan.carrierBounds.centerX).toBeGreaterThan(WIDTH * 0.72)
    expect(canonicalPlan.carrierBounds.centerX).toBeLessThan(WIDTH * 0.57)
    const sourceHero = sourcePlan.paths.find((path) => path.tier === 'hero' && path.primary)!
    const sourceHeroBounds = bounds(sourceHero.points)
    expect((sourceHeroBounds.minimumX + sourceHeroBounds.maximumX) * 0.5)
      .toBeGreaterThan(WIDTH * 0.68)
  })

  it('uses a source-field loop rather than Meta geometry when no contour exists', () => {
    const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
    for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
      rgba[index * 4] = 32
      rgba[index * 4 + 1] = 32
      rgba[index * 4 + 2] = 32
      rgba[index * 4 + 3] = 255
    }
    const maps = analyzeRGBA(rgba, WIDTH, HEIGHT)
    const carrier = buildSourceTrailCarrier({
      maps,
      rect: { x: 48, y: 22, w: 210, h: 130 },
      width: WIDTH,
      height: HEIGHT,
    })
    expect(carrier.kind).toBe('source')
    expect(carrier.method).toBe('source-field-loop')
    expect(carrier.bounds.centerX).toBeCloseTo(153, 0)
    expect(carrier.bounds.centerY).toBeCloseTo(87, 0)
  })
})
