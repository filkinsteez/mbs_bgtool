import { DialStore } from 'dialkit'
import { describe, expect, it } from 'vitest'
import { buildDialConfig, MOOD_OPTIONS, readToolState, SEED_DIAL_KEY } from './dialConfig'
import { DEFAULT_STATE, parseQuery } from './state'

describe('seed slider in the panel', () => {
  it('sits right after the mood, runs 1 to 100 in steps of 1, and keeps its value when the mood changes', () => {
    const id = 'seed-check'
    const start = parseQuery({ mood: 'sunset', seed: '7976' })
    DialStore.registerPanel(id, 'Check', buildDialConfig(start, 'Export', 'none'))
    const controls = () => DialStore.getPanel(id)!.controls
    const after = (path: string) => controls()[controls().findIndex((control) => control.path === path) + 1]
    expect(after('mood')).toMatchObject({ type: 'slider', path: SEED_DIAL_KEY, label: 'Seed', min: 1, max: 100, step: 1 })
    expect(DialStore.getValue(id, SEED_DIAL_KEY)).toBe(76)
    expect(readToolState(DialStore.getValues(id), 'sunset').seed).toBe(76)

    DialStore.updateValue(id, SEED_DIAL_KEY, 37)
    DialStore.updateValue(id, 'mood', 'contour')
    expect(readToolState(DialStore.getValues(id), 'contour').seed).toBe(37)

    expect(readToolState({}, 'sunset').seed).toBe(DEFAULT_STATE.seed)
    expect(readToolState({ [SEED_DIAL_KEY]: 'abc' }, 'sunset').seed).toBe(DEFAULT_STATE.seed)
    DialStore.unregisterPanel(id)
  })
})

describe('panel controls', () => {
  it('run in step order: the pack, the mood and Shuffle, the filter, the format and Export, with no Look or light Strength', () => {
    const id = 'order-check'
    const paths = () => DialStore.getPanel(id)!.controls.map((control) => control.path)
    DialStore.registerPanel(id, 'Check', buildDialConfig(DEFAULT_STATE, 'Export', 'grain'))
    expect(paths()).toEqual(['colors', 'mood', 'seed', 'filter', 'density', 'format', 'export'])
    DialStore.updatePanel(id, 'Check', buildDialConfig(DEFAULT_STATE, 'Export', 'none'))
    expect(paths()).toEqual(['colors', 'mood', 'seed', 'filter', 'format', 'export'])
    DialStore.unregisterPanel(id)
  })

  it('offer Sunrise and Contour as the moods, with their code ids kept', () => {
    expect(MOOD_OPTIONS).toEqual([
      { value: 'sunset', label: 'Sunrise' },
      { value: 'contour', label: 'Contour' },
    ])
  })
})

describe('the look in the tool state', () => {
  it('is the look the seed picks, and the link look at the link mood and seed', () => {
    expect(readToolState({ seed: 1 }, 'sunset').look).toBe('sunset.bands')
    expect(readToolState({ seed: 2 }, 'sunset').look).toBe('sunset.ramp')
    expect(readToolState({ seed: 6 }, 'contour').look).toBe('contour.rim')
    const link = parseQuery({ mood: 'sunset', look: 'blooms', seed: '7' })
    expect(readToolState({ seed: 7 }, 'sunset', link).look).toBe('sunset.blooms')
    expect(readToolState({ seed: 8 }, 'sunset', link).look).toBe('sunset.ramp')
    expect(readToolState({ seed: 7 }, 'contour', link).look).toBe('contour.beam')
  })
})
