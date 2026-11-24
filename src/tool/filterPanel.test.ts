import { DialStore } from 'dialkit'
import { describe, expect, it } from 'vitest'
import { buildDialConfig, readToolState } from './dialConfig'
import { FILTER_DIAL_KEY, readChoice, withFilter } from './filterControl'
import { buildScene } from './controls'
import { DEFAULT_STATE, parseQuery, toQuery } from './state'
import { getPack } from '@/light'

describe('filter control in the panel', () => {
  it('sits right above Format, adds Density for each filter, keeps the pick, and removes the slider for None', () => {
    const id = 'filter-check'
    const config = () => buildDialConfig(DEFAULT_STATE, 'Export', readChoice(DialStore.getValue(id, FILTER_DIAL_KEY)))
    DialStore.registerPanel(id, 'Check', buildDialConfig(DEFAULT_STATE, 'Export', 'none'))
    const paths = () => DialStore.getPanel(id)!.controls.map((control) => control.path)
    const labels = () => DialStore.getPanel(id)!.controls.map((control) => control.label)
    expect(paths()).toEqual(['colors', 'mix', 'mood', 'seed', 'filter', 'format', 'export'])
    expect(readToolState(DialStore.getValues(id), 'sunset')).toMatchObject({ filter: 'none', strength: 0.5 })

    DialStore.updateValue(id, FILTER_DIAL_KEY, 'grain')
    DialStore.updatePanel(id, 'Check', config())
    expect(paths()).toEqual(['colors', 'mix', 'mood', 'seed', 'filter', 'density', 'format', 'export'])
    expect(labels()).toContain('Density')
    expect(DialStore.getValue(id, 'filter')).toBe('grain')
    expect(DialStore.getValue(id, 'density')).toBe(0.5)

    DialStore.updateValue(id, 'density', 0.8)
    const state = readToolState(DialStore.getValues(id), 'sunset')
    expect(state).toMatchObject({ filter: 'grain', strength: 0.8 })
    expect(toQuery(state)).toBe('mood=sunset&look=merged&pack=bold&seed=1&format=16x9&filter=grain&strength=0.8')
    const scene = withFilter(buildScene(state.look, getPack(state.pack), state.seed, { intensity: 0.5, softness: 0.5, mood: 0.5 }), state)
    expect(scene.output).toMatchObject({ grain: 0.8, pixel: 0 })
    expect(scene.output).not.toHaveProperty('ascii')

    DialStore.updateValue(id, FILTER_DIAL_KEY, 'pixel')
    DialStore.updatePanel(id, 'Check', config())
    expect(paths()).toEqual(['colors', 'mix', 'mood', 'seed', 'filter', 'density', 'asymmetrical', 'format', 'export'])
    expect(labels()).toContain('Density')
    DialStore.updateValue(id, 'density', 0.3)
    expect(readToolState(DialStore.getValues(id), 'sunset')).toMatchObject({ filter: 'pixel', strength: 0.3, asymmetrical: true })

    // Pixel's Asymmetrical toggle: DialKit's own Off/On control under Density, on by default.
    const toggle = DialStore.getPanel(id)!.controls.find((control) => control.path === 'asymmetrical')
    expect(toggle).toMatchObject({ type: 'toggle', label: 'Asymmetrical' })
    expect(DialStore.getValue(id, 'asymmetrical')).toBe(true)
    DialStore.updateValue(id, 'asymmetrical', false)
    const even = readToolState(DialStore.getValues(id), 'sunset')
    expect(even).toMatchObject({ filter: 'pixel', strength: 0.3, asymmetrical: false })
    expect(toQuery(even)).toBe('mood=sunset&look=merged&pack=bold&seed=1&format=16x9&filter=pixel&strength=0.3&asymmetrical=off')
    const evenScene = withFilter(buildScene(even.look, getPack(even.pack), even.seed, { intensity: 0.5, softness: 0.5, mood: 0.5 }), even)
    expect(evenScene.output).toMatchObject({ grain: 0, pixel: 0.3, pixelEven: 1 })

    DialStore.updateValue(id, FILTER_DIAL_KEY, 'grain')
    DialStore.updatePanel(id, 'Check', config())
    expect(paths()).not.toContain('asymmetrical')
    expect(readToolState(DialStore.getValues(id), 'sunset')).toMatchObject({ filter: 'grain', strength: 0.3, asymmetrical: true })

    DialStore.updateValue(id, FILTER_DIAL_KEY, 'none')
    DialStore.updatePanel(id, 'Check', config())
    expect(paths()).not.toContain('density')
    expect(paths()).not.toContain('asymmetrical')
    const off = readToolState(DialStore.getValues(id), 'sunset')
    expect(off).toMatchObject({ filter: 'none' })
    expect(toQuery(off)).not.toContain('filter')

    const linked = parseQuery(new URLSearchParams('mood=contour&look=rim&filter=grain&strength=0.3'))
    expect(buildDialConfig(linked, 'Export', readChoice(linked.filter)).density).toEqual([0.3, 0, 1, 0.01])
    const evenLink = parseQuery(new URLSearchParams('mood=contour&look=rim&filter=pixel&strength=0.3&asymmetrical=off'))
    expect(buildDialConfig(evenLink, 'Export', readChoice(evenLink.filter)).asymmetrical).toBe(false)
    const oldLink = parseQuery(new URLSearchParams('mood=contour&look=rim&filter=pixel&strength=0.3'))
    expect(buildDialConfig(oldLink, 'Export', readChoice(oldLink.filter)).asymmetrical).toBe(true)
    DialStore.unregisterPanel(id)
  })
})
