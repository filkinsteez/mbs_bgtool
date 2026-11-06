import { ControlRenderer, DialStore, type ControlMeta, type DialValue } from 'dialkit'
import { Fragment, useCallback, useSyncExternalStore, type ReactNode } from 'react'

const NO_VALUES: Record<string, DialValue> = {}
const subscribePanels = (onChange: () => void) => DialStore.subscribeGlobal(onChange)
const noPanel = () => undefined

/** The tool's own markup in the panel, placed at a DialKit control. */
export interface PanelSlot {
  /**
   * Every path the control can have: when its path changes with the config, the panel holds the old one for a
   * render, and a slot that misses it would move controls into the next group and rebuild them all.
   */
  paths: readonly string[]
  node: ReactNode
  /** Shown instead of the control; otherwise after it. The control's value stays in the panel store. */
  replace?: boolean
  /**
   * The card the slot sits in: one surface with its controls inside it. Neighbouring slots with the same card share
   * it, and the DialKit controls after a slot, up to the next slot, sit in the slot's card too.
   */
  card?: string
}

/** DialKit's controls from index `from` up to `to`, or a slot with its control when the slot doesn't replace it. */
export type PanelPart = { key: string } & ({ from: number; to: number } | { slot: number; control?: number })

/** A card and the parts in it, or one part in no card. */
export interface PanelBlock {
  key: string
  card?: string
  parts: PanelPart[]
}

/**
 * The panel in order: the DialKit controls before each slot, the slot, and the controls after the last slot, in their
 * cards. The blocks, parts and keys follow from the slots alone, so a control that changes its path or comes and goes
 * (the mood control, Density) never moves a part to another place in the tree, where React would rebuild it.
 */
export function panelLayout(paths: readonly string[], slots: readonly Omit<PanelSlot, 'node'>[]): PanelBlock[] {
  const blocks: PanelBlock[] = []
  const add = (part: PanelPart, card: string | undefined) => {
    const last = blocks.at(-1)
    if (card !== undefined && last?.card === card) last.parts.push(part)
    else blocks.push({ key: card === undefined ? part.key : `card-${part.key}`, card, parts: [part] })
  }
  let from = 0
  let card: string | undefined
  for (const [index, slot] of slots.entries()) {
    const at = paths.findIndex((path, i) => i >= from && slot.paths.includes(path))
    add({ key: `controls-${index}`, from, to: at === -1 ? from : at }, card)
    add({ key: `slot-${index}`, slot: index, control: at === -1 || slot.replace ? undefined : at }, slot.card)
    card = slot.card
    if (at !== -1) from = at + 1
  }
  add({ key: 'controls-last', from, to: paths.length }, card)
  return blocks
}

/** The controls with the label `labels` gives for their path, where it gives one, instead of DialKit's label from the key. */
export function withLabels(controls: readonly ControlMeta[], labels: Readonly<Record<string, string>>): ControlMeta[] {
  return controls.map((control) => (Object.hasOwn(labels, control.path) ? { ...control, label: labels[control.path] } : control))
}

/**
 * DialKit's inline panel without its title and toolbar (versions, copy JSON):
 * the markup of DialKit's inline root folder minus its header, around DialKit's
 * controls for a registered panel, with each slot's markup at its control.
 * Slots go in the order of their controls. Renders nothing until the panel registers.
 */
export function ToolPanel({
  panelId,
  slots,
  labels = {},
}: {
  panelId: string
  slots: readonly PanelSlot[]
  /** Shown label by control path, for a label DialKit can't make from the key. */
  labels?: Readonly<Record<string, string>>
}) {
  const panel = useSyncExternalStore(subscribePanels, () => DialStore.getPanel(panelId), noPanel)
  const subscribeValues = useCallback((onChange: () => void) => DialStore.subscribe(panelId, onChange), [panelId])
  const values = useSyncExternalStore(subscribeValues, () => DialStore.getValues(panelId), () => NO_VALUES)
  if (!panel) return null
  const controls = (from: number, to: number) => withLabels(panel.controls.slice(from, to), labels)
  const renderPart = (part: PanelPart) =>
    'slot' in part ? (
      <Fragment key={part.key}>
        {part.control === undefined ? null : <ControlRenderer panelId={panelId} controls={controls(part.control, part.control + 1)} values={values} />}
        {slots[part.slot].node}
      </Fragment>
    ) : (
      <ControlRenderer key={part.key} panelId={panelId} controls={controls(part.from, part.to)} values={values} />
    )
  const blocks = panelLayout(panel.controls.map((control) => control.path), slots)
  return (
    <div className="dialkit-root" data-mode="inline" data-theme="dark">
      <div className="dialkit-panel" data-mode="inline">
        <div className="dialkit-panel-wrapper">
          <div className="dialkit-panel-inner dialkit-panel-inline">
            <div className="dialkit-folder dialkit-folder-root">
              <div className="dialkit-folder-content">
                <div className="dialkit-folder-inner">
                  {blocks.map((block) =>
                    block.card === undefined ? (
                      <Fragment key={block.key}>{block.parts.map(renderPart)}</Fragment>
                    ) : (
                      <div key={block.key} className="tool-card">
                        {block.parts.map(renderPart)}
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
