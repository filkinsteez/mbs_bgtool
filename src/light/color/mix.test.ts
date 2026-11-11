import { describe, expect, it } from 'vitest'
import {
  DEFAULT_META_BLUE_SHARE,
  MAX_SHARE,
  MIN_COLORS_ON,
  canTurnOff,
  colorsOn,
  defaultMix,
  formatMix,
  isColorOn,
  isMetaBlueOn,
  metaBlueIndex,
  mixColors,
  mixForPack,
  mixFromShares,
  mixPercents,
  parseMix,
  setColorOn,
  setMetaBlue,
  setShare,
} from './mix'
import { PACKS, getPack, type ColorPack } from './packs'

const bold = getPack('bold')
const elemental = getPack('elemental')
const atmospheric = getPack('atmospheric')
const total = (shares: readonly number[]) => shares.reduce((a, b) => a + b, 0)

describe('default mix', () => {
  it('gives Meta Blue 50% and the other colors the rest evenly, in every pack', () => {
    for (const pack of PACKS) {
      const { shares } = defaultMix(pack)
      expect(shares).toHaveLength(pack.colors.length)
      expect(total(shares)).toBeCloseTo(1, 12)
      const blue = metaBlueIndex(pack)
      expect(pack.colors[blue].name).toBe('Meta Blue')
      expect(DEFAULT_META_BLUE_SHARE).toBe(0.5)
      expect(shares[blue]).toBeCloseTo(0.5, 12)
      const others = shares.filter((_, i) => i !== blue)
      for (const share of others) expect(share).toBeCloseTo(0.5 / others.length, 12)
    }
  })

  it('shows as whole percents that sum to 100: thirds and eighths of the rest round by largest remainder', () => {
    expect(mixPercents(defaultMix(bold))).toEqual([50, 17, 17, 16])
    expect(mixPercents(defaultMix(elemental))).toEqual([50, 13, 13, 12, 12])
    expect(mixPercents(defaultMix(getPack('atmospheric')))).toEqual([50, 13, 13, 12, 12])
  })

  it('finds Meta Blue by its hex, not its place in the pack', () => {
    const moved = { ...bold, colors: [...bold.colors.slice(1), bold.colors[0]] }
    expect(metaBlueIndex(moved)).toBe(3)
    expect(defaultMix(moved).shares[3]).toBeCloseTo(0.5, 12)
  })
})

describe('setShare', () => {
  it('keeps the other colors in their ratios to each other', () => {
    const mix = setShare(bold, defaultMix(bold), 3, 0.9)
    expect(mix.shares[3]).toBeCloseTo(0.9, 12)
    expect(mix.shares[0]).toBeCloseTo(0.06, 12)
    expect(mix.shares[1]).toBeCloseTo(0.02, 12)
    expect(mix.shares[2]).toBeCloseTo(0.02, 12)
    expect(total(mix.shares)).toBeCloseTo(1, 12)
  })

  it('holds one color at 90% at most', () => {
    const mix = setShare(bold, defaultMix(bold), 1, 1)
    expect(mix.shares[1]).toBeCloseTo(MAX_SHARE, 12)
    expect(total(mix.shares)).toBeCloseTo(1, 12)
  })

  it('turns a color off at 0% and on again from 0% with the others still in their ratios', () => {
    const off = setShare(elemental, defaultMix(elemental), 2, 0)
    expect(off.shares[2]).toBe(0)
    expect(off.shares[1] / off.shares[3]).toBeCloseTo(1, 12)
    expect(off.shares[0] / off.shares[1]).toBeCloseTo(0.5 / 0.125, 12)
    const on = setShare(elemental, off, 2, 0.2)
    expect(on.shares[2]).toBeCloseTo(0.2, 12)
    expect(on.shares[0] / on.shares[1]).toBeCloseTo(0.5 / 0.125, 12)
  })

  it('keeps at least two colors on: the last two never go below 10%', () => {
    let mix = defaultMix(bold)
    mix = setShare(bold, mix, 0, 0)
    mix = setShare(bold, mix, 1, 0)
    expect(mixColors(bold, mix).map((entry) => entry.color.name)).toEqual(['Yellow', 'Orange-red'])
    mix = setShare(bold, mix, 2, 0)
    expect(mix.shares[2]).toBeCloseTo(0.1, 12)
    expect(mix.shares[3]).toBeCloseTo(0.9, 12)
  })

  it('brings the other colors back in the default ratios if all of them were off', () => {
    const lone = { shares: [0, 0, 0, 1] }
    const mix = setShare(bold, lone, 3, 0.6)
    expect(mix.shares[3]).toBeCloseTo(0.6, 12)
    expect(mix.shares[0]).toBeCloseTo(0.24, 12)
    expect(mix.shares[1]).toBeCloseTo(0.08, 12)
    expect(mix.shares[2]).toBeCloseTo(0.08, 12)
  })

  it('moves every share by a small amount for a small slider step', () => {
    let previous = setShare(bold, defaultMix(bold), 3, 0)
    for (let value = 0.05; value <= MAX_SHARE + 1e-9; value += 0.05) {
      const next = setShare(bold, previous, 3, value)
      for (let i = 0; i < 4; i++) expect(Math.abs(next.shares[i] - previous.shares[i])).toBeLessThanOrEqual(0.05 + 1e-9)
      previous = next
    }
  })

  it('rejects a color the pack does not have', () => {
    expect(() => setShare(bold, defaultMix(bold), 4, 0.5)).toThrow()
  })
})

describe('Meta Blue switch', () => {
  it('is Meta Blue at 0%, and on again brings back the share it had', () => {
    const off = setMetaBlue(bold, defaultMix(bold), false)
    expect(isMetaBlueOn(bold, off)).toBe(false)
    expect(off.shares[0]).toBe(0)
    for (const share of off.shares.slice(1)) expect(share).toBeCloseTo(1 / 3, 12)
    const on = setMetaBlue(bold, off, true, 0.25)
    expect(isMetaBlueOn(bold, on)).toBe(true)
    expect(on.shares[0]).toBeCloseTo(0.25, 12)
    expect(on.shares[1]).toBeCloseTo(0.25, 12)
  })

  it('turned on with no remembered share gives Meta Blue its default 50%', () => {
    const on = setMetaBlue(bold, setMetaBlue(bold, defaultMix(bold), false), true)
    expect(on.shares[0]).toBeCloseTo(0.5, 12)
    for (const share of on.shares.slice(1)) expect(share).toBeCloseTo(0.5 / 3, 12)
  })

  it('leaves the mix as it is when the switch already matches', () => {
    const mix = defaultMix(bold)
    expect(setMetaBlue(bold, mix, true)).toBe(mix)
  })
})

/** A color's place in its pack, by name, so the tests hold in any pack order. */
const at = (pack: ColorPack, name: string) => pack.colors.findIndex((color) => color.name === name)

describe("each color's switch", () => {
  it('turns a color off at 0% with the others keeping their ratios, and on again at the share it had', () => {
    const tan = at(elemental, 'Tan')
    const blue = metaBlueIndex(elemental)
    const off = setColorOn(elemental, defaultMix(elemental), tan, false)
    expect(isColorOn(off, tan)).toBe(false)
    expect(off.shares[tan]).toBe(0)
    expect(colorsOn(off)).toBe(4)
    expect(off.shares[blue] / off.shares[at(elemental, 'Lime')]).toBeCloseTo(4, 12)
    expect(off.shares[at(elemental, 'Lime')] / off.shares[at(elemental, 'Plum')]).toBeCloseTo(1, 12)
    const on = setColorOn(elemental, off, tan, true, 0.125)
    for (let i = 0; i < 5; i++) expect(on.shares[i]).toBeCloseTo(defaultMix(elemental).shares[i], 12)
  })

  it('turned on with no remembered share gives the color its default mix share', () => {
    const yellow = at(bold, 'Yellow')
    const off = setColorOn(bold, defaultMix(bold), yellow, false)
    expect(setColorOn(bold, off, yellow, true).shares[yellow]).toBeCloseTo(0.5 / 3, 12)
  })

  it("keeps the last two colors on: their switches don't turn them off", () => {
    const [blue, cyan, yellow, red] = ['Meta Blue', 'Cyan', 'Yellow', 'Orange-red'].map((name) => at(bold, name))
    let mix = setColorOn(bold, defaultMix(bold), yellow, false)
    expect(canTurnOff(mix, red)).toBe(true)
    mix = setColorOn(bold, mix, red, false)
    expect(colorsOn(mix)).toBe(MIN_COLORS_ON)
    expect(canTurnOff(mix, blue)).toBe(false)
    expect(canTurnOff(mix, cyan)).toBe(false)
    expect(canTurnOff(mix, yellow)).toBe(false)
    expect(setColorOn(bold, mix, blue, false)).toBe(mix)
    expect(setColorOn(bold, mix, cyan, false)).toBe(mix)
    expect(MIN_COLORS_ON).toBe(2)
  })

  it("gives the owner's sketch: Meta Blue 25% and Cyan 75%, with Yellow and Orange-red off", () => {
    const [blue, cyan, yellow, red] = ['Meta Blue', 'Cyan', 'Yellow', 'Orange-red'].map((name) => at(bold, name))
    let mix = setColorOn(bold, defaultMix(bold), yellow, false)
    mix = setColorOn(bold, mix, red, false)
    mix = setShare(bold, mix, cyan, 0.75)
    const percents = mixPercents(mix)
    expect([blue, cyan, yellow, red].map((i) => percents[i])).toEqual([25, 75, 0, 0])
  })

  it('leaves the mix as it is when the switch already matches', () => {
    const mix = defaultMix(elemental)
    expect(setColorOn(elemental, mix, at(elemental, 'Plum'), true)).toBe(mix)
  })
})

describe('a new pack', () => {
  it('starts at its default mix when Meta Blue is at its default share', () => {
    const shares = bold.colors.map((color) => (color.name === 'Meta Blue' ? 50 : color.name === 'Cyan' ? 30 : 10))
    expect(mixForPack(bold, mixFromShares(bold, shares)!, elemental)).toEqual(defaultMix(elemental))
    expect(mixForPack(elemental, defaultMix(elemental), atmospheric)).toEqual(defaultMix(atmospheric))
  })

  it("keeps Meta Blue's share, and the new pack's other colors share the rest evenly", () => {
    const next = mixForPack(bold, setShare(bold, defaultMix(bold), metaBlueIndex(bold), 0.3), elemental)
    const blue = metaBlueIndex(elemental)
    expect(next.shares[blue]).toBeCloseTo(0.3, 12)
    next.shares.forEach((share, i) => i !== blue && expect(share).toBeCloseTo(0.7 / 4, 12))
    const back = mixForPack(elemental, next, bold)
    expect(mixPercents(back)[metaBlueIndex(bold)]).toBe(30)
    expect([...mixPercents(back)].sort((a, b) => a - b)).toEqual([23, 23, 24, 30])
  })

  it('keeps Meta Blue off, with the other colors even', () => {
    const next = mixForPack(bold, setMetaBlue(bold, defaultMix(bold), false), elemental)
    expect(next.shares[metaBlueIndex(elemental)]).toBe(0)
    expect(mixPercents(next).filter((percent) => percent !== 0)).toEqual([25, 25, 25, 25])
    expect([...mixPercents(mixForPack(elemental, next, bold))].sort((a, b) => a - b)).toEqual([0, 33, 33, 34])
    expect(mixForPack(elemental, setShare(elemental, next, at(elemental, 'Lime'), 0.6), atmospheric).shares[metaBlueIndex(atmospheric)]).toBe(0)
  })
})

describe('mixColors', () => {
  it('lists the colors that are on in pack order with shares summing to 1', () => {
    const mix = setMetaBlue(elemental, defaultMix(elemental), false)
    const list = mixColors(elemental, mix)
    expect(list.map((entry) => entry.color.name)).toEqual(['Lime', 'Forest', 'Tan', 'Plum'])
    expect(total(list.map((entry) => entry.share))).toBeCloseTo(1, 12)
  })
})

describe('mix in the URL', () => {
  it('writes whole percents in pack order that sum to 100', () => {
    const mix = setShare(bold, defaultMix(bold), 3, 0.6)
    expect(formatMix(bold, mix)).toBe('24,8,8,60')
    const thirds = setMetaBlue(bold, defaultMix(bold), false)
    expect(total(mixPercents(thirds))).toBe(100)
    expect(formatMix(bold, thirds)).toBe('0,34,33,33')
  })

  it('writes nothing for the default mix, and reads a missing mix= as the default', () => {
    for (const pack of PACKS) {
      expect(formatMix(pack, defaultMix(pack))).toBeNull()
      expect(parseMix(pack, null).shares).toEqual(defaultMix(pack).shares)
      expect(parseMix(pack, '').shares).toEqual(defaultMix(pack).shares)
      expect(parseMix(pack, undefined).shares).toEqual(defaultMix(pack).shares)
    }
  })

  it('round trips a written mix', () => {
    const mix = setShare(elemental, setMetaBlue(elemental, defaultMix(elemental), false), 1, 0.45)
    const text = formatMix(elemental, mix)
    expect(text).not.toBeNull()
    expect(formatMix(elemental, parseMix(elemental, text))).toBe(text)
  })

  it('gives the default for a mix= that does not fit the pack', () => {
    for (const bad of ['40,20,20', '40,20,20,20,0', 'a,b,c,d', '100,0,0,0', '95,5,0,0', '0,0,0,0', '-5,35,35,35', '40;20;20;20', '40,20,,40']) {
      expect(parseMix(bold, bad).shares).toEqual(defaultMix(bold).shares)
    }
  })

  it('accepts a mix= whose percents add up to a little more or less than 100', () => {
    const mix = parseMix(bold, '20,10,10,61')
    expect(total(mix.shares)).toBeCloseTo(1, 12)
    expect(mix.shares[3]).toBeCloseTo(61 / 101, 12)
  })

  it('checks shares from code the same way', () => {
    expect(mixFromShares(bold, [0.4, 0.2, 0.2, 0.2])?.shares[0]).toBeCloseTo(0.4, 12)
    expect(mixFromShares(bold, [1, 0, 0, 0])).toBeNull()
    expect(mixFromShares(bold, [0.5, 0.5])).toBeNull()
    expect(mixFromShares(bold, [Number.NaN, 0.5, 0.25, 0.25])).toBeNull()
  })
})
