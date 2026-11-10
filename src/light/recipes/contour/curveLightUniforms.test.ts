import { describe, expect, it } from 'vitest'
import { curveLightUniforms, type CurveLightLayout, type EmitterSettings, type LightSettings } from './curveLight'
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
})
