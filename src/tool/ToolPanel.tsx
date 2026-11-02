import { ControlRenderer, DialStore, Folder, type DialValue } from 'dialkit'
import { useCallback, useSyncExternalStore, type ReactNode } from 'react'

const NO_VALUES: Record<string, DialValue> = {}
const subscribePanels = (onChange: () => void) => DialStore.subscribeGlobal(onChange)
const noPanel = () => undefined

/**
 * DialKit's inline panel without its toolbar (versions, copy JSON): DialKit's
 * own root folder and controls for a registered panel, with `after` placed
 * after the control at `afterPath`. Renders nothing until the panel registers.
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
          <Folder title={panel.name} defaultOpen isRoot inline>
            <ControlRenderer panelId={panelId} controls={panel.controls.slice(0, split)} values={values} />
            {after}
            <ControlRenderer panelId={panelId} controls={panel.controls.slice(split)} values={values} />
          </Folder>
        </div>
      </div>
    </div>
  )
}
