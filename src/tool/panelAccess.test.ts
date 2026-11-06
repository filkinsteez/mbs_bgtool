import { describe, expect, it } from 'vitest'
import { buildDialConfig, PANEL_ID, PANEL_LABELS, PANEL_NAME } from './dialConfig'
import { matchByPlace, panelAccessFor } from './panelAccess'
import { DEFAULT_STATE } from './state'

const toolAccess = (filter: 'none' | 'grain') =>
  panelAccessFor(PANEL_ID, PANEL_NAME, buildDialConfig('sunset', DEFAULT_STATE, 'Export', filter), { labels: PANEL_LABELS })

describe('panel access', () => {
  it('names sliders by the label the panel shows', () => {
    expect(toolAccess('grain').sliders.map((slider) => [slider.path, slider.where])).toEqual([
      ['intensity', 'Strength'],
      ['softness', 'Softness'],
      ['horizon', 'Horizon'],
      ['seed', 'Seed'],
      ['density', 'Strength'],
    ])
  })

  it('gives each of two sliders with the same label its own path, in the order the panel draws them', () => {
    const shown = ['Strength', 'Softness', 'Horizon', 'Strength']
    expect(matchByPlace(shown, toolAccess('grain').sliders).map((slider) => slider?.path)).toEqual(['intensity', 'softness', 'horizon', 'density'])
    expect(matchByPlace(shown.slice(0, 3), toolAccess('none').sliders).map((slider) => slider?.path)).toEqual(['intensity', 'softness', 'horizon'])
  })

  it('matches a control inside its panel folder, and nothing for a label it does not know', () => {
    const { sliders } = toolAccess('none')
    expect(matchByPlace([`${PANEL_NAME} / Softness`, 'Density'], sliders).map((slider) => slider?.path)).toEqual(['softness', undefined])
  })
})
