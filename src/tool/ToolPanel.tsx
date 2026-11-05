import { DialStore, type ControlMeta, type DialValue } from 'dialkit'
import { useCallback, useSyncExternalStore, type ReactNode } from 'react'
import { Button } from '@/ui/Button'
import { Select } from '@/ui/Select'
import { Slider } from '@/ui/Slider'

const NO_VALUES: Record<string, DialValue> = {}
const subscribePanels = (onChange: () => void) => DialStore.subscribeGlobal(onChange)
const noPanel = () => undefined

function asNumber(value: DialValue | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asOptions(control: ControlMeta): { value: string; label: string }[] {
  return (control.options ?? []).map((option) => (typeof option === 'string' ? { value: option, label: option[0]?.toUpperCase() + option.slice(1) } : option))
}

function renderControl(
  panelId: string,
  control: ControlMeta,
  values: Record<string, DialValue>,
  onAction?: (path: string) => void,
  onSliderStart?: (path: string) => void,
  onSliderEnd?: (path: string) => void,
) {
  if (control.type === 'slider') {
    const min = control.min ?? 0
    const max = control.max ?? 1
    const step = control.step ?? 0.01
    return (
      <Slider
        key={control.path}
        label={control.label}
        min={min}
        max={max}
        step={step}
        value={asNumber(values[control.path], min)}
        onChange={(next) => DialStore.updateValue(panelId, control.path, next)}
        onChangeStart={() => onSliderStart?.(control.path)}
        onChangeEnd={() => onSliderEnd?.(control.path)}
      />
    )
  }

  if (control.type === 'select') {
    const options = asOptions(control)
    const value = typeof values[control.path] === 'string' ? String(values[control.path]) : options[0]?.value ?? ''
    return <Select key={control.path} label={control.label} value={value} options={options} onChange={(next) => DialStore.updateValue(panelId, control.path, next)} />
  }

  if (control.type === 'action') {
    return (
      <Button
        key={control.path}
        variant={control.path === 'export' ? 'primary' : 'secondary'}
        onClick={() => {
          if (onAction) onAction(control.path)
          else DialStore.triggerAction(panelId, control.path)
        }}
      >
        {control.label ?? control.path}
      </Button>
    )
  }
  return null
}

export function ToolPanel({
  panelId,
  afterPaths,
  after,
  onAction,
  onSliderStart,
  onSliderEnd,
}: {
  panelId: string
  afterPaths: readonly string[]
  after: ReactNode
  onAction?: (path: string) => void
  onSliderStart?: (path: string) => void
  onSliderEnd?: (path: string) => void
}) {
  const panel = useSyncExternalStore(subscribePanels, () => DialStore.getPanel(panelId), noPanel)
  const subscribeValues = useCallback((onChange: () => void) => DialStore.subscribe(panelId, onChange), [panelId])
  const values = useSyncExternalStore(subscribeValues, () => DialStore.getValues(panelId), () => NO_VALUES)
  if (!panel) return null
  const split = panel.controls.findIndex((control) => afterPaths.includes(control.path)) + 1
  const top = panel.controls.slice(0, split)
  const bottom = panel.controls.slice(split)

  return (
    <div className="xmds-control-stack">
      {top.map((control) => renderControl(panelId, control, values, onAction, onSliderStart, onSliderEnd))}
      {after}
      {bottom.map((control) => renderControl(panelId, control, values, onAction, onSliderStart, onSliderEnd))}
    </div>
  )
}
