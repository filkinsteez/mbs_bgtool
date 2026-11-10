import { DialStore, type DialConfig, type DialValue } from 'dialkit'

/** How long a value waits for its control to appear in the panel. */
const LATE_MS = 1000

/** Controls whose value is a string default: selects, colors and text fields. */
const STRING_CONTROLS: readonly unknown[] = ['select', 'color', 'text']

const stringDefault = (value: object): string | undefined => {
  const control = value as { type?: unknown; default?: unknown }
  return STRING_CONTROLS.includes(control.type) && typeof control.default === 'string' ? control.default : undefined
}

/** The panel values a config's defaults give, by key: what the panel shows for the state the config was built from. */
export function panelValues(config: DialConfig): Record<string, DialValue> {
  const values: Record<string, DialValue> = {}
  for (const [key, value] of Object.entries(config)) {
    if (Array.isArray(value)) values[key] = value[0]
    else if (typeof value !== 'object' || value === null) values[key] = value
    else {
      const text = stringDefault(value)
      if (text !== undefined) values[key] = text
    }
  }
  return values
}

/**
 * Sets the panel to these values at once. A control that only exists for some values (the filter's Strength appears
 * once a filter is on) gets its value when the panel adds it.
 */
export function applyPanelValues(panelId: string, values: Readonly<Record<string, DialValue>>): void {
  const before = DialStore.getValues(panelId)
  let late = Object.entries(values).filter(([key]) => !Object.hasOwn(before, key))
  DialStore.updateValues(panelId, values)
  if (late.length === 0) return
  const stop = () => {
    unsubscribe()
    clearTimeout(timer)
  }
  const unsubscribe = DialStore.subscribe(panelId, () => {
    const now = DialStore.getValues(panelId)
    const ready = late.filter(([key]) => Object.hasOwn(now, key))
    if (ready.length === 0) return
    late = late.filter(([key]) => !Object.hasOwn(now, key))
    if (late.length === 0) stop()
    DialStore.updateValues(panelId, Object.fromEntries(ready))
  })
  const timer = setTimeout(stop, LATE_MS)
}
