import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { getPack, PACKS, type ColorPack } from '@/light'
import { defaultMix, MAX_SHARE, mixPercents, setColorOn, setShare, SHARE_STEP, type ColorMix } from '@/light/color/mix'
import { MixControl, shareAt, shareForKey } from './MixControl'

/** A share in percent to a tenth, so float error doesn't hide which step a key gave. */
const percent = (share: number | null) => (share === null ? null : Math.round(share * 1000) / 10)

describe('a color slider', () => {
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

  it('runs from 0 to 100% across its width on the 5% steps, so its quarter lines are 25, 50 and 75%, and stops at 90%', () => {
    expect(shareAt(0)).toBe(0)
    expect(shareAt(-0.2)).toBe(0)
    expect(percent(shareAt(0.25))).toBe(25)
    expect(percent(shareAt(0.5))).toBe(50)
    expect(percent(shareAt(0.52))).toBe(50)
    expect(percent(shareAt(0.53))).toBe(55)
    expect(percent(shareAt(0.75))).toBe(75)
    expect(shareAt(0.95)).toBe(MAX_SHARE)
    expect(shareAt(1.3)).toBe(MAX_SHARE)
    for (let i = 0; i <= 100; i++) {
      const steps = shareAt(i / 100) / SHARE_STEP
      expect(Math.abs(steps - Math.round(steps)), String(i)).toBeLessThan(1e-9)
    }
  })
})

/** The control's markup for a pack and mix, as the server draws it. */
const markup = (pack: ColorPack, mix: ColorMix) => renderToStaticMarkup(createElement(MixControl, { pack, mix, onChange: () => {} }))
const all = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].map((match) => match[1])

describe('the color percentages control', () => {
  it('has one row per pack color in pack order, with its exact hex, for the four- and five-color packs', () => {
    for (const pack of PACKS) {
      const html = markup(pack, defaultMix(pack))
      expect(all(html, /--mix-color:(#[0-9A-Fa-f]{6})/g), pack.id).toEqual(pack.colors.map((color) => color.hex))
      expect(all(html, /role="slider"[^>]*aria-label="([^"]+)"/g), pack.id).toEqual(pack.colors.map((color) => color.name))
    }
    expect(getPack('bold').colors).toHaveLength(4)
    expect(getPack('elemental').colors).toHaveLength(5)
  })

  it('shows each share in whole percents adding up to 100, on the slider and as its value', () => {
    for (const pack of PACKS) {
      const mix = setShare(pack, defaultMix(pack), 1, 0.35)
      const html = markup(pack, mix)
      const shown = all(html, /aria-valuenow="(\d+)"/g).map(Number)
      expect(shown, pack.id).toEqual(mixPercents(mix))
      expect(shown.reduce((a, b) => a + b, 0)).toBe(100)
      expect(all(html, /class="dialkit-slider-value">(\d+)%</g).map(Number)).toEqual(shown)
    }
  })

  it('draws a switch per color, On while its share is above 0, and Off at 0%', () => {
    const bold = getPack('bold')
    const mix = setColorOn(bold, defaultMix(bold), 2, false)
    const html = markup(bold, mix)
    expect(all(html, /role="switch"[^>]*aria-checked="(true|false)"/g)).toEqual(['true', 'true', 'false', 'true'])
    expect(all(html, /class="tool-mix-switch-knob"[^>]*>(On|Off)</g)).toEqual(['On', 'On', 'Off', 'On'])
  })

  it("can't turn off either of the last two colors on", () => {
    const bold = getPack('bold')
    let mix = setColorOn(bold, defaultMix(bold), 2, false)
    expect(markup(bold, mix)).not.toContain('aria-disabled')
    mix = setColorOn(bold, mix, 3, false)
    const locked = [...markup(bold, mix).matchAll(/<button[^>]*role="switch"[^>]*>/g)].map((match) => match[0].includes('aria-disabled="true"'))
    expect(locked).toEqual([true, true, false, false])
  })

  it('marks each slider at its quarters', () => {
    const html = markup(getPack('elemental'), defaultMix(getPack('elemental')))
    expect(all(html, /class="tool-mix-quarter" style="left:(\d+)%"/g)).toEqual(Array.from({ length: 5 }, () => ['25', '50', '75']).flat())
  })
})
