import { DialStore } from 'dialkit'
import { describe, expect, it } from 'vitest'
import { buildDialConfig, PANEL_LABELS } from './dialConfig'
import { DEFAULT_STATE } from './state'
import { panelLayout, withLabels, type PanelBlock } from './ToolPanel'

/** The tool's slots in panel order, as `Tool` lays them out. */
const SLOTS = [
  { paths: ['mood'], replace: true },
  { paths: ['look'], replace: true },
  { paths: ['colors'], replace: true, card: 'colors' },
  { paths: ['seed'], replace: true, card: 'colors' },
  { paths: ['filter'], replace: true, card: 'filter' },
  { paths: ['format'], replace: true },
]

/** What each block shows, in order: a slot as its first path, a run of DialKit controls as their paths. */
const shows = (paths: readonly string[], blocks: readonly PanelBlock[]) =>
  blocks
    .map((block) => ({ card: block.card, shows: block.parts.flatMap((part) => ('slot' in part ? [SLOTS[part.slot].paths[0]] : paths.slice(part.from, part.to))) }))
    .filter((block) => block.shows.length > 0)

/** The tree the blocks make: block keys and cards, and the keys of the parts in each. */
const tree = (blocks: readonly PanelBlock[]) => blocks.map((block) => [block.key, block.card, block.parts.map((part) => part.key)])

describe('tool panel layout', () => {
  it('puts Colors, the sliders and Shuffle in one card and Filter with Density in another, and keeps the tree as controls change', () => {
    const id = 'layout-check'
    const paths = () => DialStore.getPanel(id)!.controls.map((control) => control.path)
    DialStore.registerPanel(id, 'Check', buildDialConfig('sunset', DEFAULT_STATE, 'Export', 'none'))
    const off = panelLayout(paths(), SLOTS)
    expect(shows(paths(), off)).toEqual([
      { card: undefined, shows: ['mood'] },
      { card: undefined, shows: ['look'] },
      { card: 'colors', shows: ['colors', 'intensity', 'softness', 'horizon', 'seed'] },
      { card: 'filter', shows: ['filter'] },
      { card: undefined, shows: ['format'] },
      { card: undefined, shows: ['export'] },
    ])

    DialStore.updatePanel(id, 'Check', buildDialConfig('sunset', DEFAULT_STATE, 'Export', 'grain'))
    const grain = panelLayout(paths(), SLOTS)
    expect(shows(paths(), grain).find((block) => block.card === 'filter')).toEqual({ card: 'filter', shows: ['filter', 'density'] })
    expect(tree(grain)).toEqual(tree(off))

    DialStore.updatePanel(id, 'Check', buildDialConfig('contour', DEFAULT_STATE, 'Export', 'grain'))
    const contour = panelLayout(paths(), SLOTS)
    expect(shows(paths(), contour).find((block) => block.card === 'colors')).toEqual({ card: 'colors', shows: ['colors', 'intensity', 'softness', 'light position', 'seed'] })
    expect(tree(contour)).toEqual(tree(off))
    DialStore.unregisterPanel(id)
  })

  it('keeps a slot that shows its control after it together with that control, in the slot card', () => {
    const blocks = panelLayout(['a', 'b', 'c', 'd'], [{ paths: ['b'], card: 'x' }, { paths: ['d'], replace: true }])
    expect(blocks).toEqual([
      { key: 'controls-0', card: undefined, parts: [{ key: 'controls-0', from: 0, to: 1 }] },
      {
        key: 'card-slot-0',
        card: 'x',
        parts: [
          { key: 'slot-0', slot: 0, control: 1 },
          { key: 'controls-1', from: 2, to: 3 },
        ],
      },
      { key: 'slot-1', card: undefined, parts: [{ key: 'slot-1', slot: 1, control: undefined }] },
      { key: 'controls-last', card: undefined, parts: [{ key: 'controls-last', from: 4, to: 4 }] },
    ])
  })

  it('shows the light and filter sliders as Strength with their keys kept, and every other label as DialKit makes it', () => {
    const id = 'labels-check'
    DialStore.registerPanel(id, 'Check', buildDialConfig('sunset', DEFAULT_STATE, 'Export', 'grain'))
    const controls = withLabels(DialStore.getPanel(id)!.controls, PANEL_LABELS)
    expect(controls.filter((control) => control.type === 'slider').map((control) => [control.path, control.label])).toEqual([
      ['intensity', 'Strength'],
      ['softness', 'Softness'],
      ['horizon', 'Horizon'],
      ['seed', 'Seed'],
      ['density', 'Strength'],
    ])
    DialStore.unregisterPanel(id)
  })
})
