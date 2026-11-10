import { describe, expect, it } from 'vitest'
import { getPack } from '@/light'
import { defaultMix, isMetaBlueOn, MAX_SHARE, mixFromShares, setMetaBlue, setShare, SHARE_STEP } from '@/light/color/mix'
import { isOff, shareAt, shareForKey } from './MixControl'

/** A share in percent to a tenth, so float error doesn't hide which step a key gave. */
const percent = (share: number | null) => (share === null ? null : Math.round(share * 1000) / 10)

describe('the mix slider', () => {
  it('steps 5% with the arrows and 10% with Shift or the Page keys, from the step at or past the share', () => {
    expect(percent(shareForKey('ArrowRight', false, 0.4))).toBe(45)
    expect(percent(shareForKey('ArrowUp', false, 0.4))).toBe(45)
    expect(percent(shareForKey('ArrowLeft', false, 0.4))).toBe(35)
    expect(percent(shareForKey('ArrowDown', false, 0.4))).toBe(35)
    expect(percent(shareForKey('ArrowRight', true, 0.4))).toBe(50)
    expect(percent(shareForKey('PageUp', false, 0.4))).toBe(50)
    expect(percent(shareForKey('PageDown', false, 0.4))).toBe(30)
    expect(percent(shareForKey('ArrowRight', false, 1 / 6))).toBe(20)
    expect(percent(shareForKey('ArrowLeft', false, 1 / 6))).toBe(15)
    expect(percent(shareForKey('ArrowRight', false, 0.6 - 1e-12))).toBe(65)
    expect(percent(shareForKey('ArrowLeft', false, 0.6 + 1e-12))).toBe(55)
  })

  it('stays within 0 and 90%, where Home and End go, and leaves other keys alone', () => {
    expect(shareForKey('Home', false, 0.4)).toBe(0)
    expect(shareForKey('End', false, 0.4)).toBe(MAX_SHARE)
    expect(shareForKey('ArrowLeft', false, 0)).toBe(0)
    expect(shareForKey('ArrowRight', true, 0.85)).toBe(MAX_SHARE)
    expect(shareForKey('Enter', false, 0.4)).toBeNull()
    expect(shareForKey(' ', false, 0.4)).toBeNull()
  })

  it('takes the 5% step nearest the pointer, from the left edge to the right', () => {
    expect(shareAt(0)).toBe(0)
    expect(shareAt(-0.2)).toBe(0)
    expect(shareAt(1)).toBeCloseTo(MAX_SHARE, 12)
    expect(shareAt(1.3)).toBeCloseTo(MAX_SHARE, 12)
    expect(percent(shareAt(0.5))).toBe(45)
    expect(percent(shareAt(0.52))).toBe(45)
    expect(percent(shareAt(0.53))).toBe(50)
    for (let i = 0; i <= 100; i++) {
      const steps = shareAt(i / 100) / SHARE_STEP
      expect(Math.abs(steps - Math.round(steps)), String(i)).toBeLessThan(1e-9)
    }
  })
})

describe('the mix bar', () => {
  const bold = getPack('bold')

  it('draws a color as off exactly when the Meta Blue switch would count it off', () => {
    const blueOff = setMetaBlue(bold, defaultMix(bold), false)
    const blueLow = setShare(bold, defaultMix(bold), 0, SHARE_STEP)
    for (const mix of [defaultMix(bold), blueOff, blueLow, mixFromShares(bold, [0, 30, 30, 40])!]) {
      expect(isOff(mix.shares[0]), mix.shares.join(',')).toBe(!isMetaBlueOn(bold, mix))
    }
    expect(mixFromShares(bold, [50, 0, 25, 25])!.shares.map(isOff)).toEqual([false, true, false, false])
  })
})
