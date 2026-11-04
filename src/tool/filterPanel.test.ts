import { DialStore } from 'dialkit'
import { describe, expect, it } from 'vitest'
import { buildDialConfig, readToolState } from './dialConfig'
import { FILTER_DIAL_KEY, isFilterOn, withFilter } from './filterControl'
import { buildScene } from './controls'
import { DEFAULT_STATE, parseQuery, toQuery } from './state'
import { getPack } from '@/light'

describe('filter control in the panel', () => {
  it('adds Strength when a filter is picked, keeps the pick, and removes Strength for None', () => {
    const id = 'filter-check'
    const config = (on: boolean) => buildDialConfig('sunset', DEFAULT_STATE, 'Export PNG', on)
    DialStore.registerPanel(id, 'Check', config(false))
    const paths = () => DialStore.getPanel(id)!.controls.map((control) => control.path)
    expect(paths()).toEqual(['mood', 'look', 'colors', 'filter', 'intensity', 'softness', 'horizon', 'seed', 'format', 'export'])
    expect(readToolState(DialStore.getValues(id), 'sunset')).toMatchObject({ filter: 'none', strength: 0.5 })

    DialStore.updateValue(id, FILTER_DIAL_KEY, 'grain')
    DialStore.updatePanel(id, 'Check', config(isFilterOn(DialStore.getValue(id, FILTER_DIAL_KEY))))
    expect(paths()).toEqual(['mood', 'look', 'colors', 'filter', 'strength', 'intensity', 'softness', 'horizon', 'seed', 'format', 'export'])
    expect(DialStore.getValue(id, 'filter')).toBe('grain')
    expect(DialStore.getValue(id, 'strength')).toBe(0.5)

    DialStore.updateValue(id, 'strength', 0.8)
    const state = readToolState(DialStore.getValues(id), 'sunset')
    expect(state).toMatchObject({ filter: 'grain', strength: 0.8 })
    expect(toQuery(state)).toBe('mood=sunset&look=ramp&pack=bold&intensity=0.5&softness=0.5&horizon=0.5&seed=1&format=16x9&filter=grain&strength=0.8')
    const scene = withFilter(buildScene(state.look, getPack(state.pack), state.seed, { intensity: 0.5, softness: 0.5, mood: 0.5 }), state)
    expect(scene.output).toMatchObject({ grain: 0.8, ascii: 0, pixel: 0 })

    DialStore.updateValue(id, FILTER_DIAL_KEY, 'none')
    DialStore.updatePanel(id, 'Check', config(isFilterOn(DialStore.getValue(id, FILTER_DIAL_KEY))))
    expect(paths()).not.toContain('strength')
    const off = readToolState(DialStore.getValues(id), 'sunset')
    expect(off).toMatchObject({ filter: 'none' })
    expect(toQuery(off)).not.toContain('filter')

    const linked = parseQuery(new URLSearchParams('mood=contour&look=rim&filter=grain&strength=0.3'))
    expect(Object.keys(buildDialConfig('contour', linked, 'Export PNG', isFilterOn(linked.filter)))).toContain('strength')
    DialStore.unregisterPanel(id)
  })
})
