import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { getPack, PACKS, type ColorPack } from '@/light'
import { defaultMix, formatMix, linkMix, mixPercents, neighbourMixes, setColorOn, setShare, type ColorMix } from '@/light/color/mix'
import { HUE_ORDER, hueOrder } from '@/light/color/packs'
import { MixControl, runStep, type MixRun } from './MixControl'

/** The control's markup for a pack and mix, as the server draws it. */
const markup = (pack: ColorPack, mix: ColorMix) => renderToStaticMarkup(createElement(MixControl, { pack, mix, onChange: () => {} }))
const all = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].map((match) => match[1])
const labels = (html: string) => all(html, /class="dialkit-slider-label">([^<]+)</g)
const values = (html: string) => all(html, /class="dialkit-slider-value[^"]*"[^>]*>(\d+)</g).map(Number)
const at = (pack: ColorPack, name: string) => pack.colors.findIndex((color) => color.name === name)

describe("a run of changes to one color's slider", () => {
  const key = (mix: ColorMix) => mix.shares.map((share) => share.toFixed(9)).join(',')

  it('lands every step on a mix the preview solved ahead of time, whatever steps came before in the run', () => {
    for (const pack of PACKS) {
      const start = defaultMix(pack)
      const near = new Set(neighbourMixes(pack, start).map(key))
      for (const index of hueOrder(pack)) {
        let run: MixRun | null = null
        let mix = start
        for (const value of [0.2, 0.4, 0.6, 0.8, 0.25, 0.5, 0.75, 0, 0.4]) {
          ;({ mix, run } = runStep(pack, run, mix, index, value, true))
          if (key(mix) !== key(start)) expect(near.has(key(mix)), `${pack.id} ${pack.colors[index].name} ${value}`).toBe(true)
        }
      }
    }
  })

  it('gives mixes in the link’s whole percents, so a link brings back exactly the mix on screen', () => {
    const elemental = getPack('elemental')
    let run: MixRun | null = null
    let mix = defaultMix(elemental)
    for (const [index, value] of [[1, 0.2], [2, 0.4], [1, 0.6], [4, 0.2]] as const) {
      ;({ mix, run } = runStep(elemental, run, mix, index, value, true))
      expect(linkMix(elemental, mix), formatMix(elemental, mix) ?? 'default').toEqual(mix)
    }
  })

  it('starts again from the mix on screen for another color or a mix changed elsewhere', () => {
    const bold = getPack('bold')
    const first = runStep(bold, null, defaultMix(bold), 1, 0.25, true)
    const other = runStep(bold, first.run, first.mix, 2, 0.25, true)
    expect(other.run.from).toBe(first.mix)
    const elsewhere = linkMix(bold, setShare(bold, first.mix, 3, 0.5))
    expect(runStep(bold, first.run, elsewhere, 1, 0.5, true).run.from).toBe(elsewhere)
  })
})

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
