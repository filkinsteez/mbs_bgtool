import { DialStore } from 'dialkit'
import { describe, expect, it } from 'vitest'
import { buildDialConfig, readToolState } from './dialConfig'
import { FILTER_DIAL_KEY, readChoice, withFilter } from './filterControl'
import { buildScene } from './controls'
import { DEFAULT_STATE, parseQuery, toQuery } from './state'
import { getPack } from '@/light'

describe('filter control in the panel', () => {
  it('sits right above Format, adds Density for every filter, keeps the pick, and removes the slider for None', () => {
    const id = 'filter-check'
    const config = () => buildDialConfig('sunset', DEFAULT_STATE, 'Export', readChoice(DialStore.getValue(id, FILTER_DIAL_KEY)))
    DialStore.registerPanel(id, 'Check', buildDialConfig('sunset', DEFAULT_STATE, 'Export', 'none'))
    const paths = () => DialStore.getPanel(id)!.controls.map((control) => control.path)
    const labels = () => DialStore.getPanel(id)!.controls.map((control) => control.label)
    expect(paths()).toEqual(['mood', 'look', 'colors', 'intensity', 'softness', 'horizon', 'seed', 'filter', 'format', 'export'])
    expect(readToolState(DialStore.getValues(id), 'sunset')).toMatchObject({ filter: 'none', strength: 0.5 })

    DialStore.updateValue(id, FILTER_DIAL_KEY, 'grain')
    DialStore.updatePanel(id, 'Check', config())
    expect(paths()).toEqual(['mood', 'look', 'colors', 'intensity', 'softness', 'horizon', 'seed', 'filter', 'density', 'format', 'export'])
    expect(labels()).toContain('Density')
    expect(DialStore.getValue(id, 'filter')).toBe('grain')
    expect(DialStore.getValue(id, 'density')).toBe(0.5)

    DialStore.updateValue(id, 'density', 0.8)
    const state = readToolState(DialStore.getValues(id), 'sunset')
    expect(state).toMatchObject({ filter: 'grain', strength: 0.8 })
    expect(toQuery(state)).toBe('mood=sunset&look=bands&pack=bold&intensity=0.5&softness=0.5&horizon=0.5&seed=1&format=16x9&filter=grain&strength=0.8')
    const scene = withFilter(buildScene(state.look, getPack(state.pack), state.seed, { intensity: 0.5, softness: 0.5, mood: 0.5 }), state)
    expect(scene.output).toMatchObject({ grain: 0.8, ascii: 0, pixel: 0 })

    DialStore.updateValue(id, FILTER_DIAL_KEY, 'ascii')
    DialStore.updatePanel(id, 'Check', config())
    expect(paths()).toEqual(['mood', 'look', 'colors', 'intensity', 'softness', 'horizon', 'seed', 'filter', 'density', 'format', 'export'])
    expect(labels()).toContain('Density')
    DialStore.updateValue(id, 'density', 0.3)
    expect(readToolState(DialStore.getValues(id), 'sunset')).toMatchObject({ filter: 'ascii', strength: 0.3 })

    DialStore.updateValue(id, FILTER_DIAL_KEY, 'none')
    DialStore.updatePanel(id, 'Check', config())
    expect(paths()).not.toContain('density')
    const off = readToolState(DialStore.getValues(id), 'sunset')
    expect(off).toMatchObject({ filter: 'none' })
    expect(toQuery(off)).not.toContain('filter')

    const linked = parseQuery(new URLSearchParams('mood=contour&look=rim&filter=grain&strength=0.3'))
    expect(buildDialConfig('contour', linked, 'Export', readChoice(linked.filter)).density).toEqual([0.3, 0, 1, 0.01])
    DialStore.unregisterPanel(id)
  })
})
