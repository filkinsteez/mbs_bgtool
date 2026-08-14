import { describe, expect, it } from 'vitest'
import { contourAtLevel } from '@/core/cloner/contours'
import { sampleCurve } from '@/core/lissajous/sampler'
import { constantField } from './field'
import {
  META_CURVE,
  bandAt,
  buildCurveField,
  compileTerritory,
  createFieldSource,
  territoryGrid,
} from './territory'
import type { TerritoryDeps } from './territory'

const DEPS: TerritoryDeps = {
  rect: { x: 0, y: 0, w: 400, h: 400 },
  outW: 400,
  outH: 400,
  maps: null,
  paintField: null,
}

describe('field sources', () => {
  it('linear ramps along its axis around the offset midpoint', () => {
    const src = { ...createFieldSource('linear', 'l'), angle: 0, offset: 0.5, softness: 0.3 }
    const T = compileTerritory({ sources: [src], bands: [], boundary: 'hard', gain: 1 }, DEPS)
    expect(T(10, 200)).toBeLessThan(0.1)
    expect(T(390, 200)).toBeGreaterThan(0.55) // weight 0.8 caps the top
    expect(T(200, 200)).toBeCloseTo(0.4, 1) // midpoint = 0.5 * weight
    // vertical position does not matter for angle 0
    expect(T(300, 50)).toBeCloseTo(T(300, 350), 5)
  })

  it('radial peaks at its center and dies past the radius', () => {
    const src = {
      ...createFieldSource('radial', 'r'),
      weight: 1,
      centerX: 0.5,
      centerY: 0.5,
      radius: 0.25,
      softness: 0.4,
    }
    const T = compileTerritory({ sources: [src], bands: [], boundary: 'hard', gain: 1 }, DEPS)
    expect(T(200, 200)).toBeGreaterThan(0.9)
    expect(T(10, 10)).toBe(0)
    // on the falloff ramp, past the plateau (radius 100px, ramp 40px)
    expect(T(200, 200)).toBeGreaterThan(T(299, 200))
    expect(T(299, 200)).toBeGreaterThan(0)
  })

  it('the curve field is 1 on the curve and 0 far away', () => {
    const f = buildCurveField(META_CURVE, 400, 400, 0.25)
    // any sampled curve point is ON the curve by construction
    const s = sampleCurve({ ...META_CURVE, sampleDensity: 96, curve: META_CURVE.curve }, 400, 400, 64)[0]
    expect(f(s.x, s.y)).toBeGreaterThan(0.9)
    expect(f(2, 2)).toBeLessThan(0.05)
  })

  it('uses the canonical filled Meta silhouette for background subjects', () => {
    const f = buildCurveField(
      { ...META_CURVE, amplitudeX: 1, amplitudeY: 1, silhouette: 'meta-symbol' },
      400,
      280,
      0.05,
    )
    expect(f(20, 180)).toBeGreaterThan(0.9)
    expect(f(200, 120)).toBeGreaterThan(0.9)
    expect(f(100, 140)).toBeLessThan(0.1)
    expect(f(300, 140)).toBeLessThan(0.1)
    expect(f(200, 10)).toBeLessThan(0.1)
  })

  it('invert and combine modes compose', () => {
    const a = { ...createFieldSource('linear', 'a'), angle: 0, weight: 1, softness: 0.05 }
    const b = { ...createFieldSource('linear', 'b'), angle: 0, weight: 1, softness: 0.05, invert: true, combine: 'multiply' as const }
    const T = compileTerritory({ sources: [a, b], bands: [], boundary: 'hard', gain: 1 }, DEPS)
    // a rises to 1 on the right, b (inverted) falls to 0 there — product ~0 both ends
    expect(T(395, 200)).toBeLessThan(0.05)
    expect(T(5, 200)).toBeLessThan(0.05)
    const c = { ...b, combine: 'max' as const }
    const Tm = compileTerritory({ sources: [a, c], bands: [], boundary: 'hard', gain: 1 }, DEPS)
    expect(Tm(5, 200)).toBeGreaterThan(0.9) // max keeps the inverted side
  })

  it('disabled and zero-weight sources contribute nothing', () => {
    const src = { ...createFieldSource('radial', 'r'), enabled: false }
    const T = compileTerritory({ sources: [src], bands: [], boundary: 'hard', gain: 1 }, DEPS)
    expect(T(200, 200)).toBe(0)
  })

  it('subtract carves territory down, and a leading subtract carves nothing', () => {
    const a = { ...createFieldSource('linear', 'a'), angle: 0, weight: 1, softness: 0.05 }
    const carve = { ...createFieldSource('paint', 'p'), weight: 1, combine: 'subtract' as const }
    const T = compileTerritory(
      { sources: [a, carve], bands: [], boundary: 'hard', gain: 1 },
      { ...DEPS, paintField: constantField(0.6) },
    )
    // right edge: linear ≈ 1, minus 0.6 of paint
    expect(T(395, 200)).toBeCloseTo(0.4, 1)
    // subtract folding against nothing stays at zero
    const Tlead = compileTerritory(
      { sources: [carve], bands: [], boundary: 'hard', gain: 1 },
      { ...DEPS, paintField: constantField(0.6) },
    )
    expect(Tlead(200, 200)).toBe(0)
  })

  it('a signed paint field carves down with the brush and restores up with erase', () => {
    const a = { ...createFieldSource('linear', 'a'), angle: 0, weight: 1, softness: 0.05 }
    const paint = createFieldSource('paint', 'p') // add, weight 1
    expect(paint.combine).toBe('add')
    expect(paint.weight).toBe(1)
    const brushed = compileTerritory(
      { sources: [a, paint], bands: [], boundary: 'hard', gain: 1 },
      { ...DEPS, paintField: constantField(-0.45) },
    )
    expect(brushed(395, 200)).toBeCloseTo(0.55, 1) // photo zone pushed into glitch bands
    const erased = compileTerritory(
      { sources: [a, paint], bands: [], boundary: 'hard', gain: 1 },
      { ...DEPS, paintField: constantField(1) },
    )
    expect(erased(5, 200)).toBe(1) // even the empty zone overrides to photo
    const neutral = compileTerritory(
      { sources: [a, paint], bands: [], boundary: 'hard', gain: 1 },
      { ...DEPS, paintField: constantField(0) },
    )
    expect(neutral(395, 200)).toBeCloseTo(1, 1) // untouched mask changes nothing
  })

  it('field overrides keep the source position and combine semantics', () => {
    // regression: the render cache once re-added overridden curve
    // sources with forced 'add', contradicting the tested engine
    const a = { ...createFieldSource('curve', 'a'), weight: 1 }
    const b = {
      ...createFieldSource('linear', 'b'),
      angle: 0,
      weight: 1,
      softness: 0.05,
      combine: 'multiply' as const,
    }
    const overrides = new Map([['a', constantField(0.5)]])
    const T = compileTerritory(
      { sources: [a, b], bands: [], boundary: 'hard', gain: 1 },
      { ...DEPS, fieldOverrides: overrides },
    )
    // left edge: linear ≈ 0 → product ≈ 0 (add semantics would read 0.5)
    expect(T(5, 200)).toBeLessThan(0.05)
    // right edge: linear ≈ 1 → product ≈ 0.5
    expect(T(395, 200)).toBeCloseTo(0.5, 1)
  })
})

describe('bandAt', () => {
  it('hard mode floors cleanly and clamps t=1', () => {
    expect(bandAt(0.1, 4, 'hard', 0, 0, 1, 1)).toBe(0)
    expect(bandAt(0.6, 4, 'hard', 0, 0, 1, 1)).toBe(2)
    expect(bandAt(1, 4, 'hard', 0, 0, 1, 1)).toBe(3)
  })

  it('dither varies with cell coords, porous with the seeded channel', () => {
    const dither = new Set<number>()
    const porous = new Set<number>()
    for (let i = 0; i < 64; i++) {
      dither.add(bandAt(0.5, 2, 'dither', i & 7, i >> 3, 1, i))
      porous.add(bandAt(0.5, 2, 'porous', 0, 0, 1, i))
    }
    expect(dither.size).toBe(2)
    expect(porous.size).toBe(2)
    // deterministic per address
    expect(bandAt(0.5, 2, 'porous', 0, 0, 1, 9)).toBe(bandAt(0.5, 2, 'porous', 0, 0, 1, 9))
  })
})

describe('territory contours', () => {
  it('marching squares finds a level set of the composed field', () => {
    const grid = territoryGrid(constantFieldRadial(), 400, 400, 64)
    const d = contourAtLevel(grid, 0.5)
    expect(d.length).toBeGreaterThan(50)
    expect(d.startsWith('M')).toBe(true)
  })
})

function constantFieldRadial() {
  const c = constantField(0)
  void c
  return (x: number, y: number) => Math.max(0, 1 - Math.hypot(x - 200, y - 200) / 150)
}
