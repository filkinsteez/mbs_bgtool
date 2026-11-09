import { describe, expect, it } from 'vitest'
import { exportFileName, type Scene } from '@/light'
import { controlNameParts, type NamedControls } from './exportImage'

const scene = (recipe: Scene['recipe'], seed: number, output: Scene['output'] = {}): Scene => ({ recipe, seed, colors: [], params: {}, lens: {}, output })
const DEFAULTS: NamedControls = { intensity: 0.5 }

describe('export file names', () => {
  it('carry Intensity after the seed, and the filter last', () => {
    const parts = controlNameParts({ intensity: 0.28 })
    expect(exportFileName({ id: 'tool', pack: 'bold', scene: scene('sunset.ramp', 3, { grain: 0.5 }) }, '16x9', parts)).toBe(
      'sunset.ramp-bold-16x9-seed3-i28-grain50.jpg',
    )
  })

  it('leave out Softness and the mood control, which the panel no longer sets', () => {
    expect(controlNameParts(DEFAULTS)).toEqual(['i50'])
    expect(controlNameParts({ intensity: 0 })).toEqual(['i0'])
    expect(controlNameParts({ intensity: 1 })).toEqual(['i100'])
  })

  it('add a dragged line as its ends in percent of the frame', () => {
    expect(controlNameParts({ ...DEFAULTS, drag: { from: [0.2, 0.8], to: [0.75, 0.3] } })).toEqual(['i50', 'from20,80', 'to75,30'])
  })

  it('keep a line to tenths of a percent, past the frame edges too', () => {
    const parts = controlNameParts({ ...DEFAULTS, drag: { from: [-0.25, 0.201], to: [1.25, 0.999] } })
    expect(parts.slice(1)).toEqual(['from-25,20.1', 'to125,99.9'])
  })

  it('leave out a line too short to count, as the URL does', () => {
    expect(controlNameParts({ ...DEFAULTS, drag: { from: [0.5, 0.5], to: [0.5005, 0.5] } })).toEqual(['i50'])
  })

  it('give different settings different names, and the same settings the same name', () => {
    const named = new Map<string, string>()
    const add = (recipe: Scene['recipe'], seed: number, controls: NamedControls) => {
      const name = exportFileName({ id: 'tool', pack: 'bold', scene: scene(recipe, seed) }, '16x9', controlNameParts(controls))
      expect(exportFileName({ id: 'tool', pack: 'bold', scene: scene(recipe, seed) }, '16x9', controlNameParts(controls))).toBe(name)
      named.set(JSON.stringify([recipe, seed, controls]), name)
    }
    for (const recipe of ['sunset.ramp', 'sunset.bands', 'contour.rim'] as const) {
      for (const seed of [1, 2, 3]) {
        for (let step = 0; step <= 100; step++) add(recipe, seed, { intensity: step / 100 })
        const base = { from: [0.2, 0.8], to: [0.75, 0.3] } as const
        add(recipe, seed, { ...DEFAULTS, drag: base })
        for (let end = 0; end < 4; end++) {
          for (const delta of [-0.002, -0.001, 0.001, 0.002]) {
            const ends: number[] = [...base.from, ...base.to]
            ends[end] = Math.round((ends[end] + delta) * 1000) / 1000
            add(recipe, seed, { ...DEFAULTS, drag: { from: [ends[0], ends[1]], to: [ends[2], ends[3]] } })
          }
        }
      }
    }
    expect(new Set(named.values()).size).toBe(named.size)
  })
})
