import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { getPack, PACKS, type ColorPack } from '@/light'
import { defaultMix, mixPercents, setColorOn, setShare, type ColorMix } from '@/light/color/mix'
import { HUE_ORDER, hueOrder } from '@/light/color/packs'
import { MixControl, stepLines } from './MixControl'

/** The control's markup for a pack and mix, as the server draws it. */
const markup = (pack: ColorPack, mix: ColorMix) => renderToStaticMarkup(createElement(MixControl, { pack, mix, onChange: () => {} }))
const all = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].map((match) => match[1])
const at = (pack: ColorPack, name: string) => pack.colors.findIndex((color) => color.name === name)

describe('the color percentages control', () => {
  it('has one row per pack color in hue order, with its exact hex, for the four- and five-color packs', () => {
    for (const pack of PACKS) {
      const html = markup(pack, defaultMix(pack))
      expect(all(html, /role="slider"[^>]*aria-label="([^"]+)"/g), pack.id).toEqual(HUE_ORDER[pack.id])
      expect(all(html, /--mix-color:(#[0-9A-Fa-f]{6})/g), pack.id).toEqual(hueOrder(pack).map((i) => pack.colors[i].hex))
    }
    expect(HUE_ORDER.elemental).toEqual(['Tan', 'Lime', 'Forest', 'Meta Blue', 'Plum'])
  })

  it('shows each share in whole percents adding up to 100, on the slider and as its value', () => {
    for (const pack of PACKS) {
      const mix = setShare(pack, defaultMix(pack), hueOrder(pack)[1], 0.4)
      const html = markup(pack, mix)
      const shown = all(html, /aria-valuenow="(\d+)"/g).map(Number)
      expect(shown, pack.id).toEqual(hueOrder(pack).map((i) => mixPercents(pack, mix)[i]))
      expect(shown.reduce((a, b) => a + b, 0)).toBe(100)
      expect(all(html, /class="dialkit-slider-value">(\d+)%</g).map(Number)).toEqual(shown)
    }
  })

  it("draws a line at each of its pack's steps: quarters in Bold, fifths in the five-color packs", () => {
    expect(stepLines(0.25)).toEqual([0.25, 0.5, 0.75])
    expect(stepLines(0.2).map((line) => Math.round(line * 100))).toEqual([20, 40, 60, 80])
    expect(all(markup(getPack('bold'), defaultMix(getPack('bold'))), /class="tool-mix-step" style="left:(\d+)%"/g)).toEqual(Array.from({ length: 4 }, () => ['25', '50', '75']).flat())
    expect(all(markup(getPack('elemental'), defaultMix(getPack('elemental'))), /class="tool-mix-step" style="left:(\d+)%"/g)).toEqual(Array.from({ length: 5 }, () => ['20', '40', '60', '80']).flat())
  })

  it("shows a five-color pack's default Meta Blue at 50%, between the 40 and 60% lines", () => {
    const elemental = getPack('elemental')
    const html = markup(elemental, defaultMix(elemental))
    const blueRow = HUE_ORDER.elemental.indexOf('Meta Blue')
    expect(all(html, /aria-valuenow="(\d+)"/g)[blueRow]).toBe('50')
    expect(all(html, /class="dialkit-slider-fill" style="width:([\d.]+)%"/g)[blueRow]).toBe('50')
  })

  it('draws a switch per color, On while its share is above 0, and Off at 0%', () => {
    const bold = getPack('bold')
    const mix = setColorOn(bold, defaultMix(bold), at(bold, 'Yellow'), false)
    const html = markup(bold, mix)
    expect(all(html, /role="switch"[^>]*aria-checked="(true|false)"/g)).toEqual(['true', 'true', 'false', 'true'])
    expect(all(html, /class="tool-mix-switch-knob"[^>]*>(On|Off)</g)).toEqual(['On', 'On', 'Off', 'On'])
  })

  it("can't turn off either of the last two colors on", () => {
    const bold = getPack('bold')
    let mix = setColorOn(bold, defaultMix(bold), at(bold, 'Yellow'), false)
    expect(markup(bold, mix)).not.toContain('aria-disabled')
    mix = setColorOn(bold, mix, at(bold, 'Orange-red'), false)
    const locked = [...markup(bold, mix).matchAll(/<button[^>]*role="switch"[^>]*>/g)].map((match) => match[0].includes('aria-disabled="true"'))
    expect(locked).toEqual([true, true, false, false])
  })
})
