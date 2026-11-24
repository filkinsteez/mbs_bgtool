import { DialStore } from 'dialkit'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildDialConfig, panelLabels } from './dialConfig'
import { DEFAULT_STATE } from './state'
import { panelLayout, panelSteps, StepTitle, withLabels, type PanelBlock, type PanelStep } from './ToolPanel'

/** The tool's slots in panel order, as `Tool` lays them out. */
const SLOTS = [
  { paths: ['colors'], replace: true, card: 'colors', step: '1. Pick a color pack' },
  { paths: ['mix'], replace: true, card: 'colors' },
  { paths: ['mood'], replace: true, card: 'mood', step: '2. Pick a mood' },
  { paths: ['seed'], replace: true, card: 'mood' },
  { paths: ['filter'], replace: true, card: 'filter', step: '3. Apply a filter' },
  { paths: ['format'], replace: true, card: 'export', step: '4. Export' },
  { paths: ['export'], card: 'export' },
]

/** What a block shows: a slot as its first path, a run of DialKit controls as their paths. */
const blockShows = (paths: readonly string[], block: PanelBlock) =>
  block.parts.flatMap((part) => ('slot' in part ? [SLOTS[part.slot].paths[0]] : paths.slice(part.from, part.to)))

/** What each block shows, in order, leaving out blocks that show nothing. */
const shows = (paths: readonly string[], blocks: readonly PanelBlock[]) =>
  blocks.map((block) => ({ card: block.card, shows: blockShows(paths, block) })).filter((block) => block.shows.length > 0)

/** What each step shows: its title and the controls of its blocks in order. */
const stepShows = (paths: readonly string[], steps: readonly PanelStep[]) =>
  steps.map((step) => ({ title: step.title, shows: step.blocks.flatMap((block) => blockShows(paths, block)) })).filter((step) => step.shows.length > 0)

/** The tree the steps make: step keys, block keys and cards, and the keys of the parts in each. */
const tree = (steps: readonly PanelStep[]) => steps.map((step) => [step.key, step.blocks.map((block) => [block.key, block.card, block.parts.map((part) => part.key)])])

describe('tool panel layout', () => {
  it('lays the panel out in four numbered steps, and keeps the tree as controls come and go', () => {
    const id = 'layout-check'
    const paths = () => DialStore.getPanel(id)!.controls.map((control) => control.path)
    DialStore.registerPanel(id, 'Check', buildDialConfig(DEFAULT_STATE, 'Export', 'none'))
    const offBlocks = panelLayout(paths(), SLOTS)
    expect(shows(paths(), offBlocks)).toEqual([
      { card: 'colors', shows: ['colors', 'mix'] },
      { card: 'mood', shows: ['mood', 'seed'] },
      { card: 'filter', shows: ['filter'] },
      { card: 'export', shows: ['format', 'export'] },
    ])
    const off = panelSteps(offBlocks, SLOTS)
    expect(stepShows(paths(), off)).toEqual([
      { title: '1. Pick a color pack', shows: ['colors', 'mix'] },
      { title: '2. Pick a mood', shows: ['mood', 'seed'] },
      { title: '3. Apply a filter', shows: ['filter'] },
      { title: '4. Export', shows: ['format', 'export'] },
    ])

    DialStore.updatePanel(id, 'Check', buildDialConfig(DEFAULT_STATE, 'Export', 'grain'))
    const grain = panelSteps(panelLayout(paths(), SLOTS), SLOTS)
    expect(stepShows(paths(), grain)[2]).toEqual({ title: '3. Apply a filter', shows: ['filter', 'density'] })
    expect(tree(grain)).toEqual(tree(off))

    // Pixel's Asymmetrical toggle sits in the Filter card under Density.
    DialStore.updatePanel(id, 'Check', buildDialConfig(DEFAULT_STATE, 'Export', 'pixel'))
    const pixelBlocks = panelLayout(paths(), SLOTS)
    expect(shows(paths(), pixelBlocks)[2]).toEqual({ card: 'filter', shows: ['filter', 'density', 'asymmetrical'] })
    expect(tree(panelSteps(pixelBlocks, SLOTS))).toEqual(tree(off))
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

  it('puts blocks before the first step in no step, and each later block in the step before it', () => {
    const slots = [{ paths: ['b'], card: 'x', step: 'One' }, { paths: ['d'], replace: true }]
    const steps = panelSteps(panelLayout(['a', 'b', 'c', 'd'], slots), slots)
    expect(steps.map((step) => [step.key, step.title, step.blocks.map((block) => block.key)])).toEqual([
      ['step-none', undefined, ['controls-0']],
      ['step-0', 'One', ['card-slot-0', 'slot-1', 'controls-last']],
    ])
  })

  it('shows the filter slider as Strength with Grain and Density with Pixel, its key kept, and every other label as DialKit makes it', () => {
    for (const [filter, label] of [
      ['grain', 'Strength'],
      ['pixel', 'Density'],
    ] as const) {
      const id = `labels-check-${filter}`
      DialStore.registerPanel(id, 'Check', buildDialConfig(DEFAULT_STATE, 'Export', filter))
      const controls = withLabels(DialStore.getPanel(id)!.controls, panelLabels(filter))
      expect(controls.filter((control) => control.type === 'slider').map((control) => [control.path, control.label])).toEqual([
        ['seed', 'Seed'],
        ['density', label],
      ])
      DialStore.unregisterPanel(id)
    }
  })
})

describe('numbered step titles', () => {
  const title = (open: boolean) =>
    renderToStaticMarkup(createElement(StepTitle, { id: 'step', bodyId: 'step-body', title: '2. Pick a mood', open, onToggle: () => {} }))

  it('are buttons that fold their step open and shut, saying whether it is open and which part they fold', () => {
    expect(title(true)).toMatch(/^<h2 id="step" class="tool-step-title"><button type="button" class="tool-step-toggle" aria-expanded="true" aria-controls="step-body">2\. Pick a mood<svg/)
    expect(title(false)).toContain('aria-expanded="false"')
  })
})
