import { describe, expect, it } from 'vitest'
import { DEFAULT_STATE, parseQuery, toQuery, type ToolState } from './state'

describe('tool state in the URL', () => {
  it('uses the defaults for an empty query', () => {
    expect(parseQuery({})).toEqual(DEFAULT_STATE)
    expect(parseQuery(new URLSearchParams(''))).toEqual(DEFAULT_STATE)
  })

  it('round-trips a state through the query', () => {
    const state: ToolState = {
      mood: 'contour',
      look: 'contour.beam',
      pack: 'atmospheric',
      intensity: 0.8,
      softness: 0.25,
      moodControl: 0.1,
      seed: 4321,
      format: '4:5',
    }
    const query = toQuery(state)
    expect(query).toBe('mood=contour&look=beam&pack=atmospheric&intensity=0.8&softness=0.25&light=0.1&seed=4321&format=4x5')
    expect(parseQuery(new URLSearchParams(query))).toEqual(state)
  })

  it('writes the mood control under the mood name', () => {
    expect(toQuery(DEFAULT_STATE)).toContain('horizon=0.5')
    expect(parseQuery({ mood: 'sunset', horizon: '0.2', light: '0.9' }).moodControl).toBe(0.2)
  })

  it('fixes looks from another mood and clamps values', () => {
    const state = parseQuery({ mood: 'sunset', look: 'rim', intensity: '7', softness: '-1', seed: '0', format: '2:1', pack: 'neon' })
    expect(state.look).toBe('sunset.ramp')
    expect(state.intensity).toBe(1)
    expect(state.softness).toBe(0)
    expect(state.seed).toBe(1)
    expect(state.format).toBe('16:9')
    expect(state.pack).toBe('bold')
  })
})
