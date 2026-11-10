import { DialStore } from 'dialkit'
import { describe, expect, it } from 'vitest'
import { getPack } from '@/light'
import { defaultMix, mixPercents, setShare, type ColorMix } from '@/light/color/mix'
import { buildDialConfig, MIX_DIAL_KEY, mixPanelValue, MOOD_OPTIONS, readToolState, SEED_DIAL_KEY } from './dialConfig'
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
  it('run in step order: the pack and its mix, the mood and Shuffle, the filter, the format and Export, with no Look or light Strength', () => {
    const id = 'order-check'
    const paths = () => DialStore.getPanel(id)!.controls.map((control) => control.path)
    DialStore.registerPanel(id, 'Check', buildDialConfig(DEFAULT_STATE, 'Export', 'grain'))
    expect(paths()).toEqual(['colors', 'mix', 'mood', 'seed', 'filter', 'density', 'format', 'export'])
    DialStore.updatePanel(id, 'Check', buildDialConfig(DEFAULT_STATE, 'Export', 'none'))
    expect(paths()).toEqual(['colors', 'mix', 'mood', 'seed', 'filter', 'format', 'export'])
    DialStore.unregisterPanel(id)
  })

  it('offer Sunrise, Contour and Rush as the moods, with their code ids kept', () => {
    expect(MOOD_OPTIONS).toEqual([
      { value: 'sunset', label: 'Sunrise' },
      { value: 'contour', label: 'Contour' },
      { value: 'rush', label: 'Rush' },
    ])
  })
})

describe('the color mix in the panel', () => {
  const bold = getPack('bold')
  const elemental = getPack('elemental')
  const near = (mix: ColorMix) => ({ shares: mix.shares.map((share) => expect.closeTo(share, 12)) })

  it("keeps the link's mix with every share in full, and reads it only while the page has the control on", () => {
    const id = 'mix-check'
    const linked = parseQuery({ pack: 'bold', colormix: '1', mix: '20,10,10,60' })
    DialStore.registerPanel(id, 'Check', buildDialConfig(linked, 'Export', 'none'))
    expect(DialStore.getValue(id, MIX_DIAL_KEY)).toBe(mixPanelValue(linked.mix))
    expect(readToolState(DialStore.getValues(id), 'sunset', undefined, true)).toMatchObject({ colormix: true, mix: near(linked.mix) })
    expect(readToolState(DialStore.getValues(id), 'sunset')).toMatchObject({ colormix: false, mix: defaultMix(bold) })

    const moved = setShare(bold, linked.mix, 1, 0.35)
    DialStore.updateValue(id, MIX_DIAL_KEY, mixPanelValue(moved))
    expect(readToolState(DialStore.getValues(id), 'sunset', undefined, true).mix).toEqual(near(moved))
    expect(moved.shares.map((share) => share * 100)).not.toEqual(mixPercents(moved))
    DialStore.unregisterPanel(id)
  })

  it("falls back to the pack's default for a mix that is missing, unreadable or another pack's", () => {
    expect(readToolState({}, 'sunset', undefined, true).mix).toEqual(defaultMix(bold))
    expect(readToolState({ [MIX_DIAL_KEY]: 'abc' }, 'sunset', undefined, true).mix).toEqual(defaultMix(bold))
    expect(readToolState({ [MIX_DIAL_KEY]: 0.4 }, 'sunset', undefined, true).mix).toEqual(defaultMix(bold))
    expect(readToolState({ colors: 'elemental', [MIX_DIAL_KEY]: mixPanelValue(defaultMix(bold)) }, 'sunset', undefined, true).mix).toEqual(defaultMix(elemental))
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
