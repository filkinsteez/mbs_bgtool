import { describe, expect, it } from 'vitest'
import * as mixes from '@/light/color/mix'
import { getPack } from '@/light/color/packs'
import { mixByName } from '../scripts/light/lib/color-read.mjs'
import { MIX_SET, mixRunArgs, stageArgs, stagesArg, stageText } from '../scripts/light/lib/stage-args.mjs'

describe('the mix set', () => {
  it('is the default, Meta Blue off, an even split and one other color at half', () => {
    expect(MIX_SET).toEqual(['default', 'blue-off', 'even', 'half'])
  })

  it('reads every mix of the set in every pack', () => {
    const round = (shares: readonly number[]) => shares.map((s) => Math.round(s * 100))
    for (const id of ['bold', 'elemental', 'atmospheric'] as const) for (const name of MIX_SET) expect(mixByName(mixes, getPack(id), name), `${id} ${name}`).not.toBeNull()
    expect(round(mixByName(mixes, getPack('bold'), 'even').shares)).toEqual([25, 25, 25, 25])
    const half = (id: 'bold' | 'elemental' | 'atmospheric', color: string) => {
      const pack = getPack(id)
      return mixByName(mixes, pack, 'half').shares[pack.colors.findIndex((c) => c.name === color)]
    }
    expect(half('bold', 'Yellow')).toBeCloseTo(0.5)
    expect(half('elemental', 'Lime')).toBeCloseTo(0.5)
    expect(half('atmospheric', 'Ice')).toBeCloseTo(0.5)
  })

  it('gives each mix its own run: the same arguments, that mix, the stage on and its own folder', () => {
    expect(mixRunArgs(['--look', 'merged', '--mix', 'set', '--seeds', '1-4', '--out', 'x', '--maps'], 'even', '/o/even')).toEqual(['--look', 'merged', '--seeds', '1-4', '--maps', '--mix', 'even', '--stage', 'on', '--out', '/o/even'])
    expect(mixRunArgs(['--mix=set', '--stage', 'off', '--quick'], 'half', '/o/half')).toEqual(['--quick', '--mix', 'half', '--stage', 'on', '--out', '/o/half'])
  })
})

describe('stageArgs', () => {
  it('draws as the app does by default: the stage on at the default mix', () => {
    expect(stageArgs({})).toEqual({ on: true, mix: 'default' })
    expect(stageArgs({ stage: 'on' })).toEqual({ on: true, mix: 'default' })
  })

  it('takes another mix, and the stage off for comparisons', () => {
    expect(stageArgs({ mix: 'blue-off' })).toEqual({ on: true, mix: 'blue-off' })
    expect(stageArgs({ stage: 'off' })).toEqual({ on: false, mix: null })
  })

  it('refuses a mix with the stage off, and anything but on or off', () => {
    expect(() => stageArgs({ stage: 'off', mix: 'default' })).toThrow()
    expect(() => stageArgs({ stage: 'maybe' })).toThrow()
    expect(() => stageArgs({ stage: 'on,off' })).toThrow()
  })
})

describe('stagesArg', () => {
  it('lists the stages asked for, the fallback when none', () => {
    expect(stagesArg({})).toEqual(['on'])
    expect(stagesArg({}, ['on', 'off'])).toEqual(['on', 'off'])
    expect(stagesArg({ stage: 'off,on' })).toEqual(['off', 'on'])
    expect(() => stagesArg({ stage: 'on,maybe' })).toThrow()
  })
})

describe('stageText', () => {
  it('names the stage and the mix', () => {
    expect(stageText(true, 'default')).toBe('stage on, mix default')
    expect(stageText(true, 'Cyan:0.6')).toBe('stage on, mix Cyan:0.6')
    expect(stageText(false, null)).toBe('stage off')
  })
})
