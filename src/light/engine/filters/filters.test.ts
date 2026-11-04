import { describe, expect, it } from 'vitest'
import { DEFAULT_OUTPUT, OUTPUT_NUMBERS } from '../../scene'
import { GRAIN_FILTER, grainUniforms } from '../grain'
import { buildOutputShader, OUTPUT_FILTER_SHADERS, OUTPUT_SHADER } from '../output'
import { activeFilters, FILTER_KEYS, filterFileTag, OUTPUT_FILTERS } from '.'

describe('output filter chain', () => {
  it('starts with grain, and every stage has a strength setting', () => {
    expect(OUTPUT_FILTERS[0]).toBe(GRAIN_FILTER)
    const numbers = new Set(OUTPUT_NUMBERS.map((setting) => setting.key))
    for (const stage of OUTPUT_FILTERS) {
      expect(DEFAULT_OUTPUT[stage.key]).toBe(0)
      expect(numbers.has(stage.key)).toBe(true)
      expect(stage.glsl).toContain(`vec3 ${stage.apply}(vec3 display, ivec2 px, float weight)`)
    }
    expect(new Set(OUTPUT_FILTERS.map((stage) => stage.key)).size).toBe(OUTPUT_FILTERS.length)
  })

  it('runs only the stages whose strength is above 0', () => {
    expect(activeFilters(DEFAULT_OUTPUT)).toEqual([])
    expect(activeFilters({ ...DEFAULT_OUTPUT, grain: 0.5 })).toEqual([GRAIN_FILTER])
  })

  it('chains the stages in order between the resolve and the encode', () => {
    const none = buildOutputShader([])
    expect(none).not.toContain('uGrainAmp')
    expect(none).toContain('vec3 outputFilters(vec3 display, ivec2 px, float weight) {\n  return display;\n}')
    expect(OUTPUT_SHADER).toContain('display = filterGrain(display, px, weight);')
    expect(OUTPUT_SHADER.indexOf('vec3 filterGrain(')).toBeLessThan(OUTPUT_SHADER.indexOf('vec3 outputFilters('))
    expect(OUTPUT_SHADER.indexOf('linearToSrgb(saturate(outputFilters(')).toBeLessThan(OUTPUT_SHADER.indexOf('dither(saturate(encoded)'))
    expect(buildOutputShader([GRAIN_FILTER])).toBe(OUTPUT_SHADER)
    expect(OUTPUT_FILTER_SHADERS).toEqual([none, ...OUTPUT_FILTERS.map((stage) => buildOutputShader([stage]))])
  })

  it('gives the grain stage the grain uniforms at the output size', () => {
    expect(GRAIN_FILTER.uniforms(0.5, { width: 3840, height: 2160, seed: 7 })).toEqual(grainUniforms(0.5, 3840, 2160))
  })

  it('lists every filter strength, registered or not', () => {
    for (const stage of OUTPUT_FILTERS) expect(FILTER_KEYS).toContain(stage.key)
    for (const key of FILTER_KEYS) expect(DEFAULT_OUTPUT[key]).toBe(0)
  })

  it('names the filters that are on for export file names', () => {
    expect(filterFileTag(undefined)).toBe('')
    expect(filterFileTag({})).toBe('')
    expect(filterFileTag({ grain: 0 })).toBe('')
    expect(filterFileTag({ grain: 0.5 })).toBe('-grain50')
    expect(filterFileTag({ grain: 1 })).toBe('-grain100')
    expect(filterFileTag({ grain: 0.004 })).toBe('-grain1')
  })
})
