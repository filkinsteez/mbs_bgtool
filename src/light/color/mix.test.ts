import { describe, expect, it } from 'vitest'
import {
  DEFAULT_META_BLUE_SHARE,
  MAX_SHARE,
  MIN_COLORS_ON,
  MIX_STEPS,
  canTurnOff,
  colorsOn,
  defaultMix,
  formatMix,
  isColorOn,
  isMetaBlueOn,
  linkMix,
  metaBlueIndex,
  mixColors,
  mixForPack,
  mixFromShares,
  mixKey,
  mixPercents,
  mixStep,
  neighbourMixes,
  parseMix,
  setColorOn,
  setMetaBlue,
  setShare,
  setStep,
  stepForKey,
  stepRange,
} from './mix'
import { HUE_ORDER, PACKS, getPack, hueOrder, type ColorPack } from './packs'

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

  it('shows as whole percents that sum to 100: thirds and eighths of the rest round by largest remainder, ties first in hue order', () => {
    const inHueOrder = (pack: ColorPack) => hueOrder(pack).map((i) => mixPercents(pack, defaultMix(pack))[i])
    expect(inHueOrder(bold)).toEqual([50, 17, 17, 16])
    expect(inHueOrder(elemental)).toEqual([13, 13, 12, 50, 12])
    expect(inHueOrder(atmospheric)).toEqual([50, 13, 13, 12, 12])
  })

  it('keeps a color that is on at 1% or more, so the rounding never turns it off', () => {
    const lime = elemental.colors.findIndex((color) => color.name === 'Lime')
    const limeUp = linkMix(elemental, setShare(elemental, defaultMix(elemental), lime, 0.8))
    const both = setShare(elemental, limeUp, metaBlueIndex(elemental), 0.8)
    expect(Math.min(...both.shares)).toBeLessThan(0.01)
    const percents = mixPercents(elemental, both)
    expect(Math.min(...percents)).toBe(1)
    expect(percents.reduce((total, percent) => total + percent, 0)).toBe(100)
    expect(linkMix(elemental, both).shares.every((share) => share > 0)).toBe(true)
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
    const percents = mixPercents(bold, mix)
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

  it("keeps Meta Blue's share, and the new pack's other colors share the rest evenly, in whole percents", () => {
    const next = mixForPack(bold, setShare(bold, defaultMix(bold), metaBlueIndex(bold), 0.3), elemental)
    const blue = metaBlueIndex(elemental)
    expect(next.shares[blue]).toBeCloseTo(0.3, 12)
    expect(mixPercents(elemental, next).filter((_, i) => i !== blue).sort((a, b) => a - b)).toEqual([17, 17, 18, 18])
    expect(linkMix(elemental, next)).toEqual(next)
    const back = mixForPack(elemental, next, bold)
    expect(mixPercents(bold, back)[metaBlueIndex(bold)]).toBe(30)
    expect([...mixPercents(bold, back)].sort((a, b) => a - b)).toEqual([23, 23, 24, 30])
  })

  it('keeps Meta Blue off, with the other colors even', () => {
    const next = mixForPack(bold, setMetaBlue(bold, defaultMix(bold), false), elemental)
    expect(next.shares[metaBlueIndex(elemental)]).toBe(0)
    expect(mixPercents(elemental, next).filter((percent) => percent !== 0)).toEqual([25, 25, 25, 25])
    expect([...mixPercents(bold, mixForPack(elemental, next, bold))].sort((a, b) => a - b)).toEqual([0, 33, 33, 34])
    expect(mixForPack(elemental, setShare(elemental, next, at(elemental, 'Lime'), 0.6), atmospheric).shares[metaBlueIndex(atmospheric)]).toBe(0)
  })
})

describe('hue order', () => {
  it('names every pack color once, puts Elemental as Tan, Lime, Forest, Meta Blue, Plum, and leaves the pack lists as they are', () => {
    for (const pack of PACKS) {
      expect([...HUE_ORDER[pack.id]].sort()).toEqual(pack.colors.map((color) => color.name).sort())
      expect([...hueOrder(pack)].sort()).toEqual(pack.colors.map((_, i) => i))
    }
    expect(HUE_ORDER.elemental).toEqual(['Tan', 'Lime', 'Forest', 'Meta Blue', 'Plum'])
    expect(HUE_ORDER.bold).toEqual(['Meta Blue', 'Cyan', 'Yellow', 'Orange-red'])
    expect(HUE_ORDER.atmospheric).toEqual(['Meta Blue', 'Ice', 'Steel', 'Slate', 'Near-black'])
  })
})

describe('steps', () => {
  it('are one Nth of the picture in a pack of N colors: a quarter in Bold, a fifth in Elemental and Atmospheric', () => {
    expect(MIX_STEPS).toEqual({ bold: 0.25, elemental: 0.2, atmospheric: 0.2 })
    for (const pack of PACKS) expect(mixStep(pack)).toBeCloseTo(1 / pack.colors.length, 12)
  })

  it('set a color to the nearest step, up to one step short of the whole picture, the others keeping their ratios', () => {
    const cyan = at(bold, 'Cyan')
    const mix = setStep(bold, defaultMix(bold), cyan, 0.3)
    expect(mix.shares[cyan]).toBeCloseTo(0.25, 12)
    expect(mixPercents(bold, mix)).toEqual([45, 25, 15, 15])
    expect(setStep(bold, mix, cyan, 1).shares[cyan]).toBeCloseTo(0.75, 12)
    expect(setStep(bold, mix, cyan, 0.1).shares[cyan]).toBe(0)
    const lime = at(elemental, 'Lime')
    expect(setStep(elemental, defaultMix(elemental), lime, 0.95).shares[lime]).toBeCloseTo(0.8, 12)
  })

  it('keep the last two colors on at a step or more', () => {
    const [blue, cyan, yellow, red] = ['Meta Blue', 'Cyan', 'Yellow', 'Orange-red'].map((name) => at(bold, name))
    let sketch = setColorOn(bold, defaultMix(bold), yellow, false)
    sketch = setStep(bold, setColorOn(bold, sketch, red, false), cyan, 0.75)
    expect(mixPercents(bold, sketch)[blue]).toBe(25)
    expect(stepRange(bold, sketch, blue)).toEqual([0.25, 0.75])
    expect(stepForKey(bold, sketch, blue, 'ArrowLeft')).toBeCloseTo(0.25, 12)
    expect(stepForKey(bold, sketch, blue, 'Home')).toBeCloseTo(0.25, 12)
    expect(setStep(bold, sketch, blue, 0).shares[blue]).toBeCloseTo(0.25, 12)
    expect(stepRange(bold, sketch, yellow)[0]).toBe(0)
  })

  it("move one step per arrow key from the step at or past the share, so a five-color pack's default Meta Blue goes from 50% to 60 or 40%", () => {
    const blue = metaBlueIndex(elemental)
    expect(stepForKey(elemental, defaultMix(elemental), blue, 'ArrowRight')).toBeCloseTo(0.6, 12)
    expect(stepForKey(elemental, defaultMix(elemental), blue, 'ArrowLeft')).toBeCloseTo(0.4, 12)
    const lime = at(elemental, 'Lime')
    expect(stepForKey(elemental, defaultMix(elemental), lime, 'ArrowRight')).toBeCloseTo(0.2, 12)
    expect(stepForKey(elemental, defaultMix(elemental), lime, 'ArrowLeft')).toBe(0)
    const boldBlue = metaBlueIndex(bold)
    expect(stepForKey(bold, defaultMix(bold), boldBlue, 'ArrowUp')).toBeCloseTo(0.75, 12)
    expect(stepForKey(bold, defaultMix(bold), boldBlue, 'PageDown')).toBeCloseTo(0.25, 12)
    expect(stepForKey(bold, defaultMix(bold), boldBlue, 'End')).toBeCloseTo(0.75, 12)
    expect(stepForKey(bold, defaultMix(bold), boldBlue, 'Home')).toBe(0)
    expect(stepForKey(bold, defaultMix(bold), boldBlue, 'Enter')).toBeNull()
  })
})

describe('the mixes one slider move away', () => {
  const key = (mix: { shares: readonly number[] }) => mix.shares.map((share) => share.toFixed(9)).join(',')

  it('hold every other step of every color, the others keeping their ratios, nearest first', () => {
    const near = neighbourMixes(bold, defaultMix(bold))
    expect(near).toHaveLength(15)
    expect(new Set(near.map(key)).size).toBe(15)
    for (const mix of near) {
      const moved = mix.shares.map((share, i) => Math.abs(share - defaultMix(bold).shares[i]) > 1e-9)
      expect(mix.shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
      expect(moved.filter(Boolean).length).toBeGreaterThanOrEqual(1)
    }
    expect(mixPercents(bold, near[0])[at(bold, 'Cyan')]).toBe(25)
    const distances = near.map((mix) => Math.max(...mix.shares.map((share, i) => Math.abs(share - defaultMix(bold).shares[i]))))
    expect(distances[0]).toBeLessThan(distances.at(-1)!)
  })

  it('are each the mix its own link carries, in whole percents', () => {
    for (const pack of PACKS) {
      for (const mix of neighbourMixes(pack, defaultMix(pack))) {
        expect(key(linkMix(pack, mix)), pack.id).toBe(key(mix))
        expect(mix.shares.every((share) => Math.abs(share * 100 - Math.round(share * 100)) < 1e-9), pack.id).toBe(true)
      }
    }
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
  it('writes each color that is on by name, in hue order, in whole percents that sum to 100', () => {
    const mix = setShare(bold, defaultMix(bold), at(bold, 'Orange-red'), 0.6)
    expect(formatMix(bold, mix)).toBe('meta-blue:24,cyan:8,yellow:8,orange-red:60')
    const thirds = setMetaBlue(bold, defaultMix(bold), false)
    expect(total(mixPercents(bold, thirds))).toBe(100)
    expect(formatMix(bold, thirds)).toBe('cyan:34,yellow:33,orange-red:33')
    const tanUp = setShare(elemental, defaultMix(elemental), at(elemental, 'Tan'), 0.4)
    expect(formatMix(elemental, tanUp)).toBe('tan:40,lime:9,forest:9,meta-blue:34,plum:8')
  })

  it('keys each color by its name in lower case with hyphens', () => {
    expect(PACKS.flatMap((pack) => pack.colors.map(mixKey))).toEqual(
      expect.arrayContaining(['meta-blue', 'cyan', 'yellow', 'orange-red', 'lime', 'forest', 'tan', 'plum', 'ice', 'steel', 'slate', 'near-black']),
    )
  })

  it('writes nothing for the default mix, and reads a missing mix= as the default', () => {
    for (const pack of PACKS) {
      expect(formatMix(pack, defaultMix(pack))).toBeNull()
      expect(parseMix(pack, null).shares).toEqual(defaultMix(pack).shares)
      expect(parseMix(pack, '').shares).toEqual(defaultMix(pack).shares)
      expect(parseMix(pack, undefined).shares).toEqual(defaultMix(pack).shares)
    }
  })

  it('round trips a written mix, and reads the colors in any order', () => {
    const mix = setShare(elemental, setMetaBlue(elemental, defaultMix(elemental), false), at(elemental, 'Lime'), 0.4)
    const text = formatMix(elemental, mix)
    expect(text).toBe('tan:20,lime:40,forest:20,plum:20')
    expect(formatMix(elemental, parseMix(elemental, text))).toBe(text)
    expect(formatMix(elemental, parseMix(elemental, 'plum:20,forest:20,lime:40,tan:20'))).toBe(text)
  })

  it('gives the default for a mix= that does not fit the pack, and for the old positional mix=', () => {
    for (const bad of ['40,20,20,20', '0,34,33,33', 'a,b,c,d', 'cyan:100', 'meta-blue:95,cyan:5', 'cyan:0,yellow:0', 'cyan:40,cyan:60', 'lime:50,cyan:50', 'Cyan:50,Yellow:50', 'cyan:-5,yellow:50', 'cyan;50,yellow;50', 'cyan:50,,yellow:50']) {
      expect(parseMix(bold, bad).shares, bad).toEqual(defaultMix(bold).shares)
    }
  })

  it('accepts a mix= whose percents add up to a little more or less than 100', () => {
    const mix = parseMix(bold, 'meta-blue:20,cyan:10,yellow:10,orange-red:61')
    expect(total(mix.shares)).toBeCloseTo(1, 12)
    expect(mix.shares[at(bold, 'Orange-red')]).toBeCloseTo(61 / 101, 12)
  })

  it('checks shares from code the same way', () => {
    expect(mixFromShares(bold, [0.4, 0.2, 0.2, 0.2])?.shares[0]).toBeCloseTo(0.4, 12)
    expect(mixFromShares(bold, [1, 0, 0, 0])).toBeNull()
    expect(mixFromShares(bold, [0.5, 0.5])).toBeNull()
    expect(mixFromShares(bold, [Number.NaN, 0.5, 0.25, 0.25])).toBeNull()
  })
})
