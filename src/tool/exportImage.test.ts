import { describe, expect, it } from 'vitest'
import { exportFileName, type Scene } from '@/light'
import { controlNameParts, type NamedControls } from './exportImage'

const scene = (recipe: Scene['recipe'], seed: number, output: Scene['output'] = {}): Scene => ({ recipe, seed, colors: [], params: {}, lens: {}, output })

describe('export file names', () => {
  it('carry the seed and then the filter, with no Intensity', () => {
    expect(exportFileName({ id: 'tool', pack: 'bold', scene: scene('sunset.ramp', 3, { grain: 0.5 }) }, '16x9', controlNameParts({}))).toBe(
      'sunset.ramp-bold-16x9-seed3-grain50.jpg',
    )
  })

  it('leave out Intensity, Softness and the mood control, which the panel no longer sets', () => {
    expect(controlNameParts({})).toEqual([])
  })

  it('add a dragged line as its ends in percent of the frame', () => {
    expect(controlNameParts({ drag: { from: [0.2, 0.8], to: [0.75, 0.3] } })).toEqual(['from20,80', 'to75,30'])
  })

  it('keep a line to tenths of a percent, past the frame edges too', () => {
    expect(controlNameParts({ drag: { from: [-0.25, 0.201], to: [1.25, 0.999] } })).toEqual(['from-25,20.1', 'to125,99.9'])
  })

  it('leave out a line too short to count, as the URL does', () => {
    expect(controlNameParts({ drag: { from: [0.5, 0.5], to: [0.5005, 0.5] } })).toEqual([])
  })

  it('add the color mix, when there is one to name, after the seed and before a line', () => {
    expect(controlNameParts({ mix: 'meta-blue:25,cyan:75' })).toEqual(['mix-meta-blue25,cyan75'])
    expect(controlNameParts({ mix: null })).toEqual([])
    expect(controlNameParts({ mix: 'cyan:34,yellow:33,orange-red:33', drag: { from: [0.2, 0.8], to: [0.75, 0.3] } })).toEqual([
      'mix-cyan34,yellow33,orange-red33',
      'from20,80',
      'to75,30',
    ])
    expect(exportFileName({ id: 'tool', pack: 'bold', scene: scene('contour.beam', 7, { pixel: 0.5 }) }, '16x9', controlNameParts({ mix: 'meta-blue:25,cyan:75' }))).toBe(
      'contour.beam-bold-16x9-seed7-mix-meta-blue25,cyan75-pixel50.jpg',
    )
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
        add(recipe, seed, {})
        add(recipe, seed, { mix: 'meta-blue:25,cyan:75' })
        add(recipe, seed, { mix: 'meta-blue:25,cyan:50,yellow:25' })
        const base = { from: [0.2, 0.8], to: [0.75, 0.3] } as const
        add(recipe, seed, { drag: base })
        add(recipe, seed, { mix: 'meta-blue:25,cyan:75', drag: base })
        for (let end = 0; end < 4; end++) {
          for (const delta of [-0.002, -0.001, 0.001, 0.002]) {
            const ends: number[] = [...base.from, ...base.to]
            ends[end] = Math.round((ends[end] + delta) * 1000) / 1000
            add(recipe, seed, { drag: { from: [ends[0], ends[1]], to: [ends[2], ends[3]] } })
          }
        }
      }
    }
    expect(new Set(named.values()).size).toBe(named.size)
  })
})
