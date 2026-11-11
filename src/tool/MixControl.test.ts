import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { getPack, PACKS, type ColorPack } from '@/light'
import { defaultMix, mixPercents, setColorOn, setShare, type ColorMix } from '@/light/color/mix'
import { HUE_ORDER, hueOrder } from '@/light/color/packs'
import { MixControl } from './MixControl'

/** The control's markup for a pack and mix, as the server draws it. */
const markup = (pack: ColorPack, mix: ColorMix) => renderToStaticMarkup(createElement(MixControl, { pack, mix, onChange: () => {} }))
const all = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].map((match) => match[1])
const labels = (html: string) => all(html, /class="dialkit-slider-label">([^<]+)</g)
const values = (html: string) => all(html, /class="dialkit-slider-value[^"]*"[^>]*>(\d+)</g).map(Number)
const at = (pack: ColorPack, name: string) => pack.colors.findIndex((color) => color.name === name)

describe('the color percentages control', () => {
  it("is one of DialKit's sliders per pack color in hue order, labeled with the color's name and its exact hex", () => {
    for (const pack of PACKS) {
      const html = markup(pack, defaultMix(pack))
      expect(labels(html), pack.id).toEqual(HUE_ORDER[pack.id])
      expect(all(html, /--mix-color:(#[0-9A-Fa-f]{6})/g), pack.id).toEqual(hueOrder(pack).map((i) => pack.colors[i].hex))
      expect(html.match(/class="dialkit-slider-wrapper"/g), pack.id).toHaveLength(pack.colors.length)
    }
    expect(HUE_ORDER.elemental).toEqual(['Tan', 'Lime', 'Forest', 'Meta Blue', 'Plum'])
  })

  it('shows each share in whole percents adding up to 100', () => {
    for (const pack of PACKS) {
      const mix = setShare(pack, defaultMix(pack), hueOrder(pack)[1], 0.4)
      const shown = values(markup(pack, mix))
      expect(shown, pack.id).toEqual(hueOrder(pack).map((i) => mixPercents(pack, mix)[i]))
      expect(shown.reduce((a, b) => a + b, 0)).toBe(100)
    }
  })

  it("marks its pack's steps with DialKit's own marks: quarters in Bold, fifths in the five-color packs", () => {
    const marks = (pack: ColorPack) => all(markup(pack, defaultMix(pack)), /class="dialkit-slider-hashmark" style="left:([\d.]+)%"/g).map((left) => Math.round(Number(left)))
    expect(marks(getPack('bold'))).toEqual(Array.from({ length: 4 }, () => [25, 50, 75]).flat())
    expect(marks(getPack('elemental'))).toEqual(Array.from({ length: 5 }, () => [20, 40, 60, 80]).flat())
    expect(marks(getPack('atmospheric'))).toEqual(Array.from({ length: 5 }, () => [20, 40, 60, 80]).flat())
  })

  it("shows a five-color pack's default Meta Blue at 50%, between the 40 and 60% marks", () => {
    const elemental = getPack('elemental')
    const html = markup(elemental, defaultMix(elemental))
    const row = HUE_ORDER.elemental.indexOf('Meta Blue')
    expect(values(html)[row]).toBe(50)
    expect(all(html, /class="dialkit-slider-fill" style="width:([\d.]+)%"/g).map(Number)[row]).toBe(50)
  })

  it('draws a color at 0% as off', () => {
    const bold = getPack('bold')
    const html = markup(bold, setColorOn(bold, defaultMix(bold), at(bold, 'Yellow'), false))
    expect(values(html)[HUE_ORDER.bold.indexOf('Yellow')]).toBe(0)
    expect(values(html).reduce((a, b) => a + b, 0)).toBe(100)
    const rows = [...html.matchAll(/<div class="tool-mix-row"[^>]*>/g)].map((match) => match[0].includes('data-off'))
    expect(rows).toEqual([false, false, true, false])
  })
})
