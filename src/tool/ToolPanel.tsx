import { ControlRenderer, DialStore, type DialValue } from 'dialkit'
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
}

/**
 * DialKit's inline panel without its title and toolbar (versions, copy JSON):
 * the markup of DialKit's inline root folder minus its header, around DialKit's
 * controls for a registered panel, with each slot's markup at its control.
 * Slots go in the order of their controls. Renders nothing until the panel registers.
 */
export function ToolPanel({ panelId, slots }: { panelId: string; slots: readonly PanelSlot[] }) {
  const panel = useSyncExternalStore(subscribePanels, () => DialStore.getPanel(panelId), noPanel)
  const subscribeValues = useCallback((onChange: () => void) => DialStore.subscribe(panelId, onChange), [panelId])
  const values = useSyncExternalStore(subscribeValues, () => DialStore.getValues(panelId), () => NO_VALUES)
  if (!panel) return null
  // One group of DialKit controls before each slot and one after the last, so a group keeps its place in the
  // tree and its controls aren't rebuilt when another group changes.
  const parts: ReactNode[] = []
  let from = 0
  for (const [index, slot] of slots.entries()) {
    const at = panel.controls.findIndex((control, i) => i >= from && slot.paths.includes(control.path))
    const end = at === -1 ? from : slot.replace ? at : at + 1
    parts.push(<ControlRenderer key={`controls-${index}`} panelId={panelId} controls={panel.controls.slice(from, end)} values={values} />)
    parts.push(<Fragment key={`slot-${index}`}>{slot.node}</Fragment>)
    if (at !== -1) from = at + 1
  }
  parts.push(<ControlRenderer key="controls-last" panelId={panelId} controls={panel.controls.slice(from)} values={values} />)
  return (
    <div className="dialkit-root" data-mode="inline" data-theme="dark">
      <div className="dialkit-panel" data-mode="inline">
        <div className="dialkit-panel-wrapper">
          <div className="dialkit-panel-inner dialkit-panel-inline">
            <div className="dialkit-folder dialkit-folder-root">
              <div className="dialkit-folder-content">
                <div className="dialkit-folder-inner">{parts}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
