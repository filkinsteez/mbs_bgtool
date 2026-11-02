import { useEffect, useRef, type RefObject } from 'react'

export interface SliderAccess {
  path: string
  label: string
  min: number
  max: number
  step: number
}

export interface SelectAccess {
  path: string
  label: string
  options: readonly { value: string; label: string }[]
}

export interface PanelAccess {
  sliders: readonly SliderAccess[]
  selects: readonly SelectAccess[]
  /** Labels of action buttons that are busy: shown dimmed and ignored. */
  busy: readonly string[]
  /** Option label to the CSS background of its swatch row. */
  swatches: Readonly<Record<string, string>>
}

export interface PanelValues {
  getValue: (path: string) => unknown
  setValue: (path: string, value: number | string) => void
}

function setAttribute(element: HTMLElement, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name)
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value)
  }
}

function setSwatches(element: HTMLElement, background: string | undefined): void {
  setAttribute(element, 'data-swatches', background ? '' : null)
  if (background) element.style.setProperty('--swatches', background)
  else element.style.removeProperty('--swatches')
}

const textOf = (element: Element | null) => element?.textContent?.trim() ?? ''

/**
 * DialKit's sliders are pointer-only and its select list has no keyboard
 * support. This finds DialKit's elements by their labels and adds slider
 * roles, tab stops and value attributes, plus the swatch rows and busy state.
 */
export function applyPanelAccess(root: HTMLElement, access: PanelAccess, values: PanelValues): void {
  const sliders = new Map(access.sliders.map((slider) => [slider.label, slider]))
  for (const track of root.querySelectorAll<HTMLElement>('.dialkit-slider')) {
    const slider = sliders.get(textOf(track.querySelector('.dialkit-slider-label')))
    if (!slider) continue
    const value = Number(values.getValue(slider.path))
    setAttribute(track, 'data-dial-path', slider.path)
    setAttribute(track, 'tabindex', '0')
    setAttribute(track, 'role', 'slider')
    setAttribute(track, 'aria-label', slider.label)
    setAttribute(track, 'aria-valuemin', String(slider.min))
    setAttribute(track, 'aria-valuemax', String(slider.max))
    setAttribute(track, 'aria-valuenow', Number.isFinite(value) ? String(value) : null)
  }

  const selects = new Map(access.selects.map((select) => [select.label, select]))
  for (const trigger of root.querySelectorAll<HTMLElement>('.dialkit-select-trigger')) {
    const select = selects.get(textOf(trigger.querySelector('.dialkit-select-label')))
    if (!select) continue
    setAttribute(trigger, 'data-dial-path', select.path)
    setAttribute(trigger, 'aria-haspopup', 'listbox')
    setAttribute(trigger, 'aria-expanded', trigger.dataset.open === 'true' ? 'true' : 'false')
    const selected = select.options.find((option) => option.value === values.getValue(select.path))
    setSwatches(trigger, selected ? access.swatches[selected.label] : undefined)
  }
  for (const option of root.querySelectorAll<HTMLElement>('.dialkit-select-option')) {
    setSwatches(option, access.swatches[textOf(option)])
  }

  for (const button of root.querySelectorAll<HTMLElement>('.dialkit-button')) {
    const busy = access.busy.includes(textOf(button))
    setAttribute(button, 'aria-disabled', busy ? 'true' : null)
    setAttribute(button, 'data-busy', busy ? '' : null)
  }
}

function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))
  return Number((Math.round(value / step) * step).toFixed(decimals))
}

function sliderKey(event: KeyboardEvent, slider: SliderAccess, values: PanelValues): boolean {
  const current = Number(values.getValue(slider.path))
  if (!Number.isFinite(current)) return false
  const step = slider.step * (event.shiftKey ? 10 : 1)
  const page = (slider.max - slider.min) / 10
  let next: number
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowUp':
      next = current + step
      break
    case 'ArrowLeft':
    case 'ArrowDown':
      next = current - step
      break
    case 'PageUp':
      next = current + page
      break
    case 'PageDown':
      next = current - page
      break
    case 'Home':
      next = slider.min
      break
    case 'End':
      next = slider.max
      break
    default:
      return false
  }
  values.setValue(slider.path, roundToStep(Math.min(slider.max, Math.max(slider.min, next)), slider.step))
  return true
}

function selectKey(event: KeyboardEvent, trigger: HTMLElement, select: SelectAccess, values: PanelValues): boolean {
  const last = select.options.length - 1
  const index = select.options.findIndex((option) => option.value === values.getValue(select.path))
  let next: number
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowRight':
      next = Math.min(last, index + 1)
      break
    case 'ArrowUp':
    case 'ArrowLeft':
      next = Math.max(0, index - 1)
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = last
      break
    case 'Escape':
      if (trigger.dataset.open !== 'true') return false
      trigger.click()
      return true
    default:
      return false
  }
  if (next !== index && next >= 0) values.setValue(select.path, select.options[next].value)
  return true
}

function handleKeyDown(event: KeyboardEvent, access: PanelAccess, values: PanelValues): void {
  if (event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLElement)) return
  const target = event.target
  const path = target.dataset.dialPath
  if (!path) return
  const slider = access.sliders.find((candidate) => candidate.path === path)
  const select = access.selects.find((candidate) => candidate.path === path)
  const handled = slider ? sliderKey(event, slider, values) : select ? selectKey(event, target, select, values) : false
  if (handled) event.preventDefault()
}

export function usePanelAccess(rootRef: RefObject<HTMLElement | null>, access: PanelAccess, values: PanelValues): void {
  const latest = useRef({ access, values })

  useEffect(() => {
    latest.current = { access, values }
    if (rootRef.current) applyPanelAccess(rootRef.current, access, values)
  })

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new MutationObserver(() => applyPanelAccess(root, latest.current.access, latest.current.values))
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-open'] })
    const onKeyDown = (event: KeyboardEvent) => handleKeyDown(event, latest.current.access, latest.current.values)
    root.addEventListener('keydown', onKeyDown)
    return () => {
      observer.disconnect()
      root.removeEventListener('keydown', onKeyDown)
    }
  }, [rootRef])
}
