import { DialStore } from 'dialkit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDialConfig, PACK_DIAL_KEY, SEED_DIAL_KEY } from '../dialConfig'
import { parseQuery } from '../state'
import { applyPanelValues, panelValues } from './panelValues'

const stateOf = (query: string) => parseQuery(new URLSearchParams(query))
const configOf = (query: string) => {
  const state = stateOf(query)
  return buildDialConfig(state, 'Export', state.filter)
}

describe('panel values', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("gives the panel's values for a state, the filter's strength only while a filter is on", () => {
    const values = panelValues(configOf('mood=contour&look=beam&pack=elemental&seed=42&format=9x16&filter=grain&strength=0.7'))
    expect(values).toMatchObject({ [PACK_DIAL_KEY]: 'elemental', mood: 'contour', [SEED_DIAL_KEY]: 42, filter: 'grain', density: 0.7, format: '9:16' })
    expect(values).not.toHaveProperty('export')
    const none = panelValues(configOf('mood=sunset&pack=bold&seed=3&format=1x1'))
    expect(none).toMatchObject({ [PACK_DIAL_KEY]: 'bold', mood: 'sunset', [SEED_DIAL_KEY]: 3, filter: 'none', format: '1:1' })
    expect(none).not.toHaveProperty('density')
  })

  it('sets a control the panel adds a moment later, such as the strength once a filter is on', () => {
    vi.useFakeTimers()
    const id = 'history-panel-values-test'
    DialStore.registerPanel(id, 'Test', configOf('mood=sunset&pack=bold&seed=3&format=16x9'))
    const target = 'mood=contour&look=rim&pack=atmospheric&seed=9&format=16x9&filter=pixel&strength=0.3'
    applyPanelValues(id, panelValues(configOf(target)))
    expect(DialStore.getValues(id)).toMatchObject({ [PACK_DIAL_KEY]: 'atmospheric', mood: 'contour', [SEED_DIAL_KEY]: 9, filter: 'pixel' })
    expect(DialStore.getValues(id)).not.toHaveProperty('density')
    DialStore.updatePanel(id, 'Test', buildDialConfig(stateOf('mood=sunset&pack=bold&seed=3&format=16x9'), 'Export', 'pixel'))
    expect(DialStore.getValue(id, 'density')).toBe(0.3)
    vi.runAllTimers()
    DialStore.updateValue(id, 'density', 0.8)
    DialStore.updatePanel(id, 'Test', buildDialConfig(stateOf('mood=sunset&pack=bold&seed=3&format=16x9'), 'Export', 'grain'))
    expect(DialStore.getValue(id, 'density')).toBe(0.8)
    DialStore.unregisterPanel(id)
  })
})
