import { describe, expect, it } from 'vitest'
import { buildDialConfig, PANEL_ID, PANEL_NAME, panelLabels } from './dialConfig'
import type { FilterChoice } from './filterControl'
import { matchByPlace, panelAccessFor } from './panelAccess'
import { DEFAULT_STATE } from './state'

const toolAccess = (filter: FilterChoice) =>
  panelAccessFor(PANEL_ID, PANEL_NAME, buildDialConfig(DEFAULT_STATE, 'Export', filter), { labels: panelLabels(filter) })

describe('panel access', () => {
  it('names sliders by the label the panel shows', () => {
    expect(toolAccess('grain').sliders.map((slider) => [slider.path, slider.where])).toEqual([
      ['seed', 'Seed'],
      ['density', 'Strength'],
    ])
    expect(toolAccess('pixel').sliders.map((slider) => [slider.path, slider.where])).toEqual([
      ['seed', 'Seed'],
      ['density', 'Density'],
    ])
    expect(toolAccess('none').sliders.map((slider) => slider.path)).toEqual(['seed'])
  })

  it('gives each of two sliders with the same label its own path, in the order the panel draws them', () => {
    const { sliders } = panelAccessFor('check', 'Check', { first: [0.5, 0, 1, 0.01], second: [0.5, 0, 1, 0.01] }, { labels: { first: 'Strength', second: 'Strength' } })
    expect(matchByPlace(['Strength', 'Strength'], sliders).map((slider) => slider?.path)).toEqual(['first', 'second'])
    expect(matchByPlace(['Strength'], sliders).map((slider) => slider?.path)).toEqual(['first'])
  })

  it('matches a control inside its panel folder, and nothing for a label it does not know', () => {
    const { sliders } = toolAccess('grain')
    expect(matchByPlace([`${PANEL_NAME} / Strength`, 'Softness'], sliders).map((slider) => slider?.path)).toEqual(['density', undefined])
  })
})
