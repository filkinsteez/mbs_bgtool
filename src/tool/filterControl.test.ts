import { describe, expect, it } from 'vitest'
import type { Scene } from '@/light'
import { OUTPUT_FILTERS } from '@/light/engine/filters'
import {
  ASYMMETRICAL_DIAL_KEY,
  DEFAULT_FILTER,
  FILTER_DIAL_KEY,
  filterDials,
  filterQuery,
  isFilterOn,
  parseFilterQuery,
  readChoice,
  readFilter,
  STRENGTH_DIAL_KEYS,
  TOOL_FILTERS,
  withFilter,
} from './filterControl'

const scene: Scene = { recipe: 'sunset.ramp', seed: 4, colors: [], params: {}, lens: {}, output: { grain: 0, exposure: 0.25 } }

describe('filter control', () => {
  it('offers None, Grain and Pixel, off by default', () => {
    expect(TOOL_FILTERS).toEqual(['grain', 'pixel'])
    for (const key of TOOL_FILTERS) expect(OUTPUT_FILTERS.some((stage) => stage.key === key)).toBe(true)
    expect(OUTPUT_FILTERS.map((stage) => stage.key)).toEqual(['grain', 'pixel'])
    expect(DEFAULT_FILTER).toEqual({ filter: 'none', strength: 0.5, asymmetrical: true })
    const dials = filterDials(DEFAULT_FILTER, 'none')
    expect(dials[FILTER_DIAL_KEY]).toEqual({
      type: 'select',
      options: [
        { value: 'none', label: 'None' },
        { value: 'grain', label: 'Grain' },
        { value: 'pixel', label: 'Pixel' },
      ],
      default: 'none',
    })
  })

  it('shows the slider only while a filter is chosen, named for what it sets: Density for every filter', () => {
    expect(Object.keys(filterDials(DEFAULT_FILTER, 'none'))).toEqual([FILTER_DIAL_KEY])
    expect(STRENGTH_DIAL_KEYS).toEqual({ grain: 'density', pixel: 'density' })
    const grain = { ...DEFAULT_FILTER, filter: 'grain', strength: 0.8 } as const
    expect(filterDials(grain, 'grain').density).toEqual([0.8, 0, 1, 0.01])
    expect(Object.keys(filterDials(grain, 'grain'))).toEqual([FILTER_DIAL_KEY, 'density'])
    expect(Object.keys(filterDials(grain, 'pixel'))).toEqual([FILTER_DIAL_KEY, 'density', ASYMMETRICAL_DIAL_KEY])
    expect(Object.keys(filterDials(DEFAULT_FILTER, 'pixel'))).toEqual([FILTER_DIAL_KEY, 'density', ASYMMETRICAL_DIAL_KEY])
    expect(readChoice('pixel')).toBe('pixel')
    expect(readChoice('ascii')).toBe('none')
    expect(readChoice('sepia')).toBe('none')
    expect(isFilterOn('grain')).toBe(true)
    expect(isFilterOn('none')).toBe(false)
    expect(isFilterOn('ascii')).toBe(false)
    expect(isFilterOn('pixel')).toBe(true)
    expect(isFilterOn('sepia')).toBe(false)
    expect(isFilterOn(undefined)).toBe(false)
  })

  it('reads the panel values, falling back to no filter at 0.5', () => {
    expect(readFilter({})).toEqual(DEFAULT_FILTER)
    expect(readFilter({ filter: 'grain', density: 0.734 })).toEqual({ filter: 'grain', strength: 0.73, asymmetrical: true })
    expect(readFilter({ filter: 'grain', amount: 0.9 })).toEqual({ filter: 'grain', strength: 0.5, asymmetrical: true })
    expect(readFilter({ filter: 'pixel', density: 1.4 })).toEqual({ filter: 'pixel', strength: 1, asymmetrical: true })
    expect(readFilter({ filter: 'pixel', amount: 0.9 })).toEqual({ filter: 'pixel', strength: 0.5, asymmetrical: true })
    expect(readFilter({ filter: 'ascii', density: 0.3 })).toEqual(DEFAULT_FILTER)
    expect(readFilter({ filter: 'sepia', density: 0.3 })).toEqual(DEFAULT_FILTER)
  })

  it("adds Pixel's Asymmetrical toggle under Density, on unless the state has it off, and reads it back", () => {
    expect(filterDials(DEFAULT_FILTER, 'pixel')[ASYMMETRICAL_DIAL_KEY]).toBe(true)
    expect(filterDials({ filter: 'pixel', strength: 0.3, asymmetrical: false }, 'pixel')[ASYMMETRICAL_DIAL_KEY]).toBe(false)
    expect(filterDials({ filter: 'pixel', strength: 0.3, asymmetrical: false }, 'grain')).not.toHaveProperty(ASYMMETRICAL_DIAL_KEY)
    expect(filterDials(DEFAULT_FILTER, 'none')).not.toHaveProperty(ASYMMETRICAL_DIAL_KEY)
    expect(readFilter({ filter: 'pixel', density: 0.4, asymmetrical: false })).toEqual({ filter: 'pixel', strength: 0.4, asymmetrical: false })
    expect(readFilter({ filter: 'pixel', density: 0.4, asymmetrical: true }).asymmetrical).toBe(true)
    // Missing (before the panel adds the toggle) is on, and only Pixel has the toggle.
    expect(readFilter({ filter: 'pixel', density: 0.4 }).asymmetrical).toBe(true)
    expect(readFilter({ filter: 'grain', density: 0.4, asymmetrical: false }).asymmetrical).toBe(true)
  })

  it('round-trips the filter through the URL and leaves links without one unchanged', () => {
    expect(filterQuery(DEFAULT_FILTER)).toBe('')
    expect(filterQuery({ ...DEFAULT_FILTER, filter: 'grain', strength: 0.5 })).toBe('filter=grain&strength=0.5')
    expect(parseFilterQuery(new URLSearchParams('filter=grain&strength=0.5'))).toEqual({ filter: 'grain', strength: 0.5, asymmetrical: true })
    expect(parseFilterQuery({ filter: 'grain', strength: '-2' })).toEqual({ filter: 'grain', strength: 0, asymmetrical: true })
    expect(parseFilterQuery({})).toEqual(DEFAULT_FILTER)
    expect(parseFilterQuery({ filter: 'pixel' })).toEqual({ filter: 'pixel', strength: 0.5, asymmetrical: true })
    expect(parseFilterQuery({ filter: 'sepia' })).toEqual(DEFAULT_FILTER)
  })

  it("writes Pixel's toggle as asymmetrical=off only while it is off, and reads links without it as on", () => {
    const off = { filter: 'pixel', strength: 0.5, asymmetrical: false } as const
    expect(filterQuery(off)).toBe('filter=pixel&strength=0.5&asymmetrical=off')
    expect(parseFilterQuery(new URLSearchParams(filterQuery(off)))).toEqual(off)
    expect(filterQuery({ ...off, asymmetrical: true })).toBe('filter=pixel&strength=0.5')
    expect(filterQuery({ ...off, filter: 'grain' })).toBe('filter=grain&strength=0.5')
    for (const value of ['off', 'OFF', '0', 'false']) expect(parseFilterQuery({ filter: 'pixel', asymmetrical: value }).asymmetrical, value).toBe(false)
    for (const value of ['on', '1', 'true', '', 'sideways']) expect(parseFilterQuery({ filter: 'pixel', asymmetrical: value }).asymmetrical, value).toBe(true)
    expect(parseFilterQuery(new URLSearchParams('filter=pixel&strength=0.3')).asymmetrical).toBe(true)
    // Only Pixel has the toggle.
    expect(parseFilterQuery({ filter: 'grain', asymmetrical: 'off' }).asymmetrical).toBe(true)
    expect(parseFilterQuery({ asymmetrical: 'off' })).toEqual(DEFAULT_FILTER)
  })

  it('opens an old link with the ASCII filter, which is gone, with no filter', () => {
    expect(parseFilterQuery(new URLSearchParams('filter=ascii&strength=0.3')).filter).toBe('none')
    expect(parseFilterQuery({ filter: 'ascii' })).toEqual(DEFAULT_FILTER)
    expect(filterQuery(parseFilterQuery(new URLSearchParams('filter=ascii&strength=0.3')))).toBe('')
  })

  it('sets the chosen filter in the scene and turns the others off', () => {
    expect(withFilter(scene, { ...DEFAULT_FILTER, filter: 'grain', strength: 0.5 }).output).toEqual({ grain: 0.5, pixel: 0, exposure: 0.25 })
    expect(withFilter({ ...scene, output: { grain: 1 } }, DEFAULT_FILTER).output).toEqual({ grain: 0, pixel: 0 })
    expect(withFilter(scene, { ...DEFAULT_FILTER, filter: 'grain', strength: 0.5 }).params).toBe(scene.params)
    expect(scene.output).toEqual({ grain: 0, exposure: 0.25 })
  })

  it('keeps Pixel on at Density 0, its biggest cells, while Grain at Strength 0 is off', () => {
    expect(withFilter(scene, { ...DEFAULT_FILTER, filter: 'pixel', strength: 0 }).output.pixel).toBeGreaterThan(0)
    expect(withFilter(scene, { ...DEFAULT_FILTER, filter: 'pixel', strength: 0 }).output.pixel).toBeLessThan(0.005)
    expect(withFilter(scene, { ...DEFAULT_FILTER, filter: 'pixel', strength: 0.3 }).output.pixel).toBe(0.3)
    expect(withFilter(scene, { ...DEFAULT_FILTER, filter: 'grain', strength: 0 }).output.grain).toBe(0)
  })

  it("sets Pixel's even grid only with Asymmetrical off, and leaves the scene as before the toggle with it on", () => {
    const pixel = { filter: 'pixel', strength: 0.3, asymmetrical: true } as const
    expect(withFilter(scene, pixel).output).toEqual({ grain: 0, pixel: 0.3, exposure: 0.25 })
    expect(withFilter(scene, { ...pixel, asymmetrical: false }).output).toEqual({ grain: 0, pixel: 0.3, pixelEven: 1, exposure: 0.25 })
    // A scene that had the even grid loses it with the toggle on or another filter.
    const even = { ...scene, output: { ...scene.output, pixelEven: 1 } }
    expect(withFilter(even, pixel).output).not.toHaveProperty('pixelEven')
    expect(withFilter(even, { ...pixel, filter: 'grain', asymmetrical: false }).output).not.toHaveProperty('pixelEven')
    expect(withFilter(even, { ...DEFAULT_FILTER, asymmetrical: false }).output).not.toHaveProperty('pixelEven')
  })
})
