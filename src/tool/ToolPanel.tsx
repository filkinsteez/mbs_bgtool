import { ControlRenderer, DialStore, type DialValue } from 'dialkit'
import { useCallback, useSyncExternalStore, type ReactNode } from 'react'

const NO_VALUES: Record<string, DialValue> = {}
const subscribePanels = (onChange: () => void) => DialStore.subscribeGlobal(onChange)
const noPanel = () => undefined

/**
 * DialKit's inline panel without its title and toolbar (versions, copy JSON):
 * the markup of DialKit's inline root folder minus its header, around DialKit's
 * controls for a registered panel, with `after` placed after the control at
 * `afterPath`. Renders nothing until the panel registers.
 */
export function ToolPanel({ panelId, afterPath, after }: { panelId: string; afterPath: string; after: ReactNode }) {
  const panel = useSyncExternalStore(subscribePanels, () => DialStore.getPanel(panelId), noPanel)
  const subscribeValues = useCallback((onChange: () => void) => DialStore.subscribe(panelId, onChange), [panelId])
  const values = useSyncExternalStore(subscribeValues, () => DialStore.getValues(panelId), () => NO_VALUES)
  if (!panel) return null
  const split = panel.controls.findIndex((control) => control.path === afterPath) + 1
  return (
    <div className="dialkit-root" data-mode="inline" data-theme="dark">
      <div className="dialkit-panel" data-mode="inline">
        <div className="dialkit-panel-wrapper">
          <div className="dialkit-panel-inner dialkit-panel-inline">
            <div className="dialkit-folder dialkit-folder-root">
              <div className="dialkit-folder-content">
                <div className="dialkit-folder-inner">
                  <ControlRenderer panelId={panelId} controls={panel.controls.slice(0, split)} values={values} />
                  {after}
                  <ControlRenderer panelId={panelId} controls={panel.controls.slice(split)} values={values} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
