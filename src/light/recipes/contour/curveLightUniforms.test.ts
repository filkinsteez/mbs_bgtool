import { describe, expect, it } from 'vitest'
import { curveLightUniforms, outlinePieces, type CurveLightLayout, type EmitterSettings, type LightSettings } from './curveLight'
import { segment } from './shapes'

const layout: CurveLightLayout = { emitters: 2, primitives: 8, near: 1, far: 1 }
const anchor = [0.25, 0.75]
const none: LightSettings = { kind: 0, at: [0, 0], radius: 0.1, length: 1, power: 2, stretch: 1, angle: 0 }
const lit: EmitterSettings = {
  shape: { contours: [{ primitives: [segment([-0.2, 0], [0.2, 0])], closed: false }] },
  anchor,
  stops: [{ t: 0, color: [1, 1, 1], gain: 1 }],
  near: [],
  far: [],
  maskShift: [0, 0],
  maskGrow: 0,
}
const unlit: EmitterSettings = { shape: null, anchor, stops: [], near: [], far: [], maskShift: [0, 0], maskGrow: 0 }

describe('curveLightUniforms', () => {
  it('gives an emitter with no outline its anchor, which the light fields sit from, and no pieces', () => {
    const emit = curveLightUniforms(layout, [unlit, lit], [none, none], [0, 0, 0], 0.01, 2).uClEmit as Float32Array
    const row = 5 * 4
    expect(emit[0]).toBeCloseTo(0.25, 6)
    expect(emit[1]).toBeCloseTo(0.75, 6)
    expect(emit[2]).toBe(0)
    expect(emit[row + 2]).toBeGreaterThan(0)
  })

  it('lets a fade take away only part of the light (its depth); without one it goes fully dark', () => {
    const darkest = (depth?: number) => {
      const pieces = outlinePieces({
        shape: { contours: [{ primitives: [segment([-1, 0], [1, 0])], closed: false }] },
        stops: [{ t: 0, color: [1, 1, 1], gain: 1 }],
        fades: [{ contour: 0, t: 0.5, dark: 0.2, fade: 0.1, ...(depth === undefined ? {} : { depth }) }],
      })
      return Math.min(...pieces.filter((p) => p.kind !== 3).flatMap((p) => [p.e0[0], p.e1[0]]))
    }
    expect(darkest()).toBeCloseTo(0, 6)
    expect(darkest(0.5)).toBeCloseTo(0.5, 6)
    expect(darkest(0)).toBeCloseTo(1, 6)
  })
})
