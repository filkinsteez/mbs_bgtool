import { describe, expect, it } from 'vitest'
import { DEFAULT_STATE, parsePoint, parseQuery, toQuery, type ToolState } from './state'

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
      filter: 'none',
      strength: 0.5,
    }
    const query = toQuery(state)
    expect(query).toBe('mood=contour&look=beam&pack=atmospheric&intensity=0.8&softness=0.25&light=0.1&seed=4321&format=4x5')
    expect(parseQuery(new URLSearchParams(query))).toEqual(state)
  })

  it('writes the filter last, only when one is on', () => {
    const state: ToolState = { ...DEFAULT_STATE, filter: 'grain', strength: 0.35 }
    const query = toQuery(state)
    expect(query).toBe('mood=sunset&look=ramp&pack=bold&intensity=0.5&softness=0.5&horizon=0.5&seed=1&format=16x9&filter=grain&strength=0.35')
    expect(parseQuery(new URLSearchParams(query))).toEqual(state)
    expect(toQuery(DEFAULT_STATE)).not.toContain('filter')
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

describe('dragged point in the URL', () => {
  const dragged: ToolState = {
    mood: 'sunset',
    look: 'sunset.bands',
    pack: 'elemental',
    intensity: 0.5,
    softness: 0.5,
    moodControl: 0.62,
    seed: 77,
    format: '9:16',
    point: [0.312, 0.681],
    filter: 'none',
    strength: 0.5,
  }

  it('round-trips a point, written after the mood control with its comma as it is', () => {
    const query = toQuery(dragged)
    expect(query).toBe('mood=sunset&look=bands&pack=elemental&intensity=0.5&softness=0.5&horizon=0.62&point=0.312,0.681&seed=77&format=9x16')
    expect(parseQuery(new URLSearchParams(query))).toEqual(dragged)
    expect(parseQuery({ ...Object.fromEntries(new URLSearchParams(query)) })).toEqual(dragged)
  })

  it('keeps points past the frame edges within the drag reach', () => {
    const state = { ...dragged, mood: 'contour', look: 'contour.halo', point: [-0.25, 1.25] } as const
    expect(parseQuery(new URLSearchParams(toQuery(state)))).toEqual(state)
    expect(parseQuery({ point: '-3,9' }).point).toEqual([-0.25, 1.25])
    expect(parseQuery({ point: '0.12345,0.98765' }).point).toEqual([0.123, 0.988])
  })

  it('reads old links without a point as before and writes them the same way', () => {
    const old = 'mood=contour&look=beam&pack=atmospheric&intensity=0.8&softness=0.25&light=0.1&seed=4321&format=4x5'
    const state = parseQuery(new URLSearchParams(old))
    expect(state).not.toHaveProperty('point')
    expect(toQuery(state)).toBe(old)
  })

  it('ignores points it cannot read', () => {
    for (const value of ['', 'abc', '0.5', '0.5,', ',0.5', '0.5,0.5,0.5', 'NaN,1', '0.5;0.5', 'Infinity,0']) {
      expect(parsePoint(value), value).toBeUndefined()
      expect(parseQuery({ point: value }), value).toEqual(DEFAULT_STATE)
    }
    expect(parsePoint(undefined)).toBeUndefined()
  })
})
