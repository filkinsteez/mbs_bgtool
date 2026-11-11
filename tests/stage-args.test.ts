import { describe, expect, it } from 'vitest'
import { stageArgs, stagesArg, stageText } from '../scripts/light/lib/stage-args.mjs'

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
