import { DialStore } from 'dialkit'
import { describe, expect, it } from 'vitest'
import { MOOD_DIAL_KEY } from './controls'
import { buildDialConfig, readToolState, SEED_DIAL_KEY } from './dialConfig'
import { DEFAULT_STATE, parseQuery } from './state'

describe('seed slider in the panel', () => {
  it('sits right after the mood control in both moods, runs 1 to 100 in steps of 1, and keeps its value when the mood changes', () => {
    const id = 'seed-check'
    const start = parseQuery({ mood: 'sunset', seed: '7976' })
    DialStore.registerPanel(id, 'Check', buildDialConfig('sunset', start, 'Export PNG', 'none'))
    const controls = () => DialStore.getPanel(id)!.controls
    const after = (path: string) => controls()[controls().findIndex((control) => control.path === path) + 1]
    expect(after(MOOD_DIAL_KEY.sunset)).toMatchObject({ type: 'slider', path: SEED_DIAL_KEY, label: 'Seed', min: 1, max: 100, step: 1 })
    expect(DialStore.getValue(id, SEED_DIAL_KEY)).toBe(76)
    expect(readToolState(DialStore.getValues(id), 'sunset').seed).toBe(76)

    DialStore.updateValue(id, SEED_DIAL_KEY, 37)
    DialStore.updatePanel(id, 'Check', buildDialConfig('contour', start, 'Export PNG', 'none'))
    expect(after(MOOD_DIAL_KEY.contour)).toMatchObject({ path: SEED_DIAL_KEY, label: 'Seed', min: 1, max: 100, step: 1 })
    expect(readToolState(DialStore.getValues(id), 'contour').seed).toBe(37)

    expect(readToolState({}, 'sunset').seed).toBe(DEFAULT_STATE.seed)
    expect(readToolState({ [SEED_DIAL_KEY]: 'abc' }, 'sunset').seed).toBe(DEFAULT_STATE.seed)
    DialStore.unregisterPanel(id)
  })
})
