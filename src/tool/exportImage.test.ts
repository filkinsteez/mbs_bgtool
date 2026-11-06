import { describe, expect, it } from 'vitest'
import { exportFileName, type Scene } from '@/light'
import { controlNameParts, type NamedControls } from './exportImage'

const scene = (recipe: Scene['recipe'], seed: number, output: Scene['output'] = {}): Scene => ({ recipe, seed, colors: [], params: {}, lens: {}, output })
const DEFAULTS: NamedControls = { intensity: 0.5, softness: 0.5, mood: 0.5 }

describe('export file names', () => {
  it('carry Intensity, Softness and the mood control after the seed, and the filter last', () => {
    const parts = controlNameParts('sunset', { ...DEFAULTS, mood: 0.28 })
    expect(exportFileName({ id: 'tool', pack: 'bold', scene: scene('sunset.ramp', 3, { grain: 0.5 }) }, '16x9', parts)).toBe(
      'sunset.ramp-bold-16x9-seed3-i50-s50-h28-grain50.jpg',
    )
  })

  it('name the mood control by its URL key: h for Horizon, l for Light position', () => {
    expect(controlNameParts('sunset', DEFAULTS)).toEqual(['i50', 's50', 'h50'])
    expect(controlNameParts('contour', { intensity: 0.7, softness: 0.3, mood: 0.8 })).toEqual(['i70', 's30', 'l80'])
    expect(controlNameParts('contour', { intensity: 0, softness: 1, mood: 0.01 })).toEqual(['i0', 's100', 'l1'])
  })

  it('add a dragged line as its ends in percent of the frame', () => {
    expect(controlNameParts('sunset', { ...DEFAULTS, drag: { from: [0.2, 0.8], to: [0.75, 0.3] } })).toEqual(['i50', 's50', 'h50', 'from20,80', 'to75,30'])
  })

  it('keep a line to tenths of a percent, past the frame edges too', () => {
    const parts = controlNameParts('contour', { ...DEFAULTS, drag: { from: [-0.25, 0.201], to: [1.25, 0.999] } })
    expect(parts.slice(3)).toEqual(['from-25,20.1', 'to125,99.9'])
  })

  it('leave out a line too short to count, as the URL does', () => {
    expect(controlNameParts('sunset', { ...DEFAULTS, drag: { from: [0.5, 0.5], to: [0.5005, 0.5] } })).toEqual(['i50', 's50', 'h50'])
  })

  it('give different settings different names, and the same settings the same name', () => {
    const named = new Map<string, string>()
    const add = (mood: 'sunset' | 'contour', controls: NamedControls) => {
      const name = exportFileName({ id: 'tool', pack: 'bold', scene: scene(mood === 'sunset' ? 'sunset.ramp' : 'contour.rim', 3) }, '16x9', controlNameParts(mood, controls))
      expect(exportFileName({ id: 'tool', pack: 'bold', scene: scene(mood === 'sunset' ? 'sunset.ramp' : 'contour.rim', 3) }, '16x9', controlNameParts(mood, controls))).toBe(name)
      named.set(JSON.stringify([mood, controls]), name)
    }
    for (const mood of ['sunset', 'contour'] as const) {
      for (let step = 0; step <= 100; step++) {
        const value = step / 100
        add(mood, { ...DEFAULTS, intensity: value })
        add(mood, { ...DEFAULTS, softness: value })
        add(mood, { ...DEFAULTS, mood: value })
      }
      const base = { from: [0.2, 0.8], to: [0.75, 0.3] } as const
      add(mood, { ...DEFAULTS, drag: base })
      for (let end = 0; end < 4; end++) {
        for (const delta of [-0.002, -0.001, 0.001, 0.002]) {
          const ends: number[] = [...base.from, ...base.to]
          ends[end] = Math.round((ends[end] + delta) * 1000) / 1000
          add(mood, { ...DEFAULTS, drag: { from: [ends[0], ends[1]], to: [ends[2], ends[3]] } })
        }
      }
    }
    expect(new Set(named.values()).size).toBe(named.size)
  })
})
