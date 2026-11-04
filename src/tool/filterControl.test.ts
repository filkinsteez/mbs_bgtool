import { describe, expect, it } from 'vitest'
import type { Scene } from '@/light'
import { OUTPUT_FILTERS } from '@/light/engine/filters'
import {
  DEFAULT_FILTER,
  FILTER_DIAL_KEY,
  filterDials,
  filterQuery,
  isFilterOn,
  parseFilterQuery,
  readFilter,
  STRENGTH_DIAL_KEY,
  TOOL_FILTERS,
  withFilter,
} from './filterControl'

const scene: Scene = { recipe: 'sunset.ramp', seed: 4, colors: [], params: {}, lens: {}, output: { grain: 0, exposure: 0.25 } }

describe('filter control', () => {
  it('offers None and the filters that run in the tool, off by default', () => {
    expect(TOOL_FILTERS).toEqual(['grain', 'ascii', 'pixel'])
    for (const key of TOOL_FILTERS) expect(OUTPUT_FILTERS.some((stage) => stage.key === key)).toBe(true)
    expect(DEFAULT_FILTER).toEqual({ filter: 'none', strength: 0.5 })
    const dials = filterDials(DEFAULT_FILTER, false)
    expect(dials[FILTER_DIAL_KEY]).toEqual({
      type: 'select',
      options: [
        { value: 'none', label: 'None' },
        { value: 'grain', label: 'Grain' },
        { value: 'ascii', label: 'ASCII' },
        { value: 'pixel', label: 'Pixel' },
      ],
      default: 'none',
    })
  })

  it('shows the strength slider only while a filter is on', () => {
    expect(Object.keys(filterDials(DEFAULT_FILTER, false))).toEqual([FILTER_DIAL_KEY])
    expect(filterDials({ filter: 'grain', strength: 0.8 }, true)[STRENGTH_DIAL_KEY]).toEqual([0.8, 0, 1, 0.01])
    expect(isFilterOn('grain')).toBe(true)
    expect(isFilterOn('none')).toBe(false)
    expect(isFilterOn('ascii')).toBe(true)
    expect(isFilterOn('pixel')).toBe(true)
    expect(isFilterOn('sepia')).toBe(false)
    expect(isFilterOn(undefined)).toBe(false)
  })

  it('reads the panel values, falling back to no filter at 0.5', () => {
    expect(readFilter({})).toEqual(DEFAULT_FILTER)
    expect(readFilter({ filter: 'grain', strength: 0.734 })).toEqual({ filter: 'grain', strength: 0.73 })
    expect(readFilter({ filter: 'sepia', strength: 3 })).toEqual({ filter: 'none', strength: 1 })
  })

  it('round-trips the filter through the URL and leaves links without one unchanged', () => {
    expect(filterQuery(DEFAULT_FILTER)).toBe('')
    expect(filterQuery({ filter: 'grain', strength: 0.5 })).toBe('filter=grain&strength=0.5')
    expect(parseFilterQuery(new URLSearchParams('filter=grain&strength=0.5'))).toEqual({ filter: 'grain', strength: 0.5 })
    expect(parseFilterQuery({ filter: 'grain', strength: '-2' })).toEqual({ filter: 'grain', strength: 0 })
    expect(parseFilterQuery({})).toEqual(DEFAULT_FILTER)
    expect(parseFilterQuery({ filter: 'pixel' })).toEqual({ filter: 'pixel', strength: 0.5 })
    expect(parseFilterQuery(new URLSearchParams('filter=ascii&strength=0.3'))).toEqual({ filter: 'ascii', strength: 0.3 })
    expect(parseFilterQuery({ filter: 'sepia' })).toEqual(DEFAULT_FILTER)
  })

  it('sets the chosen filter in the scene and turns the others off', () => {
    expect(withFilter(scene, { filter: 'grain', strength: 0.5 }).output).toEqual({ grain: 0.5, ascii: 0, pixel: 0, exposure: 0.25 })
    expect(withFilter({ ...scene, output: { grain: 1 } }, DEFAULT_FILTER).output).toEqual({ grain: 0, ascii: 0, pixel: 0 })
    expect(withFilter(scene, { filter: 'grain', strength: 0.5 }).params).toBe(scene.params)
    expect(scene.output).toEqual({ grain: 0, exposure: 0.25 })
  })
})
