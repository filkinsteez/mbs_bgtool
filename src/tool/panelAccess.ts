import { DialStore, type DialConfig, type SelectConfig } from 'dialkit'
import { useEffect, useId, useRef, type RefObject } from 'react'

/**
 * Where a control sits in the panel, as DialKit shows it: the folder titles
 * and the control label, joined with " / " (for example "Params / Light At / X").
 */
type Where = string

export interface SliderAccess {
  panelId: string
  panelName: string
  path: string
  where: Where
  min: number
  max: number
  /** Arrow-key step; Shift multiplies it by 10. */
  step: number
  /** The slider's own step; key changes are rounded to it. */
  precision: number
}

export interface SelectAccess {
  panelId: string
  panelName: string
  path: string
  where: Where
  options: readonly { value: string; label: string }[]
}

export interface PanelAccess {
  sliders: readonly SliderAccess[]
  selects: readonly SelectAccess[]
  /** Labels of action buttons that are busy: shown dimmed and ignored. */
  busy: readonly string[]
}

export const NO_ACCESS: PanelAccess = { sliders: [], selects: [], busy: [] }

/** DialKit labels controls and folders from their keys; this is the same rule. */
export function dialLabel(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim()
}

const titleCase = (text: string) => text.replace(/\b\w/g, (c) => c.toUpperCase())

type SliderTuple = [number, number, number, number?]

function isSlider(control: DialConfig[string]): control is SliderTuple {
  return Array.isArray(control) && control.length >= 3 && control.every((n) => typeof n === 'number' || n === undefined)
}

function isSelect(control: DialConfig[string]): control is SelectConfig {
  return typeof control === 'object' && !Array.isArray(control) && control.type === 'select' && 'options' in control
}

function isFolder(control: DialConfig[string]): control is DialConfig {
  return typeof control === 'object' && !Array.isArray(control) && !('type' in control)
}

export interface AccessOptions {
  busy?: readonly string[]
  /** Arrow-key steps by dot path, for sliders whose DialKit step is finer than a useful key step. */
  keySteps?: Readonly<Record<string, number>>
  /** Labels the panel shows in place of DialKit's, by dot path (ToolPanel's `labels`). */
  labels?: Readonly<Record<string, string>>
}

/** The sliders and selects of a panel config, found by walking its folders. */
export function panelAccessFor(panelId: string, panelName: string, config: DialConfig, options: AccessOptions = {}): PanelAccess {
  const sliders: SliderAccess[] = []
  const selects: SelectAccess[] = []
  const walk = (node: DialConfig, prefix: string, where: string) => {
    for (const [key, control] of Object.entries(node)) {
      if (key === '_collapsed') continue
      const path = prefix ? `${prefix}.${key}` : key
      const label = options.labels?.[path] ?? dialLabel(key)
      const place = where ? `${where} / ${label}` : label
      if (isSlider(control)) {
        const [, min, max, step = 0.01] = control
        sliders.push({ panelId, panelName, path, where: place, min, max, step: options.keySteps?.[path] ?? step, precision: step })
      } else if (isSelect(control)) {
        const choices = control.options.map((option) => (typeof option === 'string' ? { value: option, label: titleCase(option) } : option))
        selects.push({ panelId, panelName, path, where: place, options: choices })
      } else if (isFolder(control)) {
        walk(control, path, place)
      }
    }
  }
  walk(config, '', '')
  return { sliders, selects, busy: options.busy ?? [] }
}

export function mergeAccess(...parts: readonly PanelAccess[]): PanelAccess {
  return {
    sliders: parts.flatMap((part) => part.sliders),
    selects: parts.flatMap((part) => part.selects),
    busy: parts.flatMap((part) => part.busy),
  }
}

function setAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name)
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value)
  }
}

const textOf = (element: Element | null) => element?.textContent?.trim() ?? ''

/** The control's label with the titles of the folders around it (DialKit's root folder excluded). */
function placeOf(element: Element, label: string): Where {
  const parts = [label]
  let folder = element.parentElement?.closest('.dialkit-folder') ?? null
  while (folder && !folder.classList.contains('dialkit-folder-root')) {
    parts.unshift(textOf(folder.querySelector(':scope > .dialkit-folder-header .dialkit-folder-title')))
    folder = folder.parentElement?.closest('.dialkit-folder') ?? null
  }
  return parts.join(' / ')
}

/**
 * The entry for each element, from the place the element shows. With several panels DialKit puts each in a folder
 * named after the panel; with one it does not. Elements that show the same place (two sliders with one label) take
 * that place's entries in panel order, the order DialKit draws them in.
 */
export function matchByPlace<T extends { panelName: string; where: Where }>(places: readonly Where[], entries: readonly T[]): (T | undefined)[] {
  const byPlace = new Map<Where, T[]>()
  for (const entry of entries) {
    for (const place of [entry.where, `${entry.panelName} / ${entry.where}`]) byPlace.set(place, [...(byPlace.get(place) ?? []), entry])
  }
  const taken = new Map<Where, number>()
  return places.map((place) => {
    const index = taken.get(place) ?? 0
    taken.set(place, index + 1)
    return byPlace.get(place)?.[index]
  })
}

function asButton(element: HTMLElement, name: string | null): void {
  setAttribute(element, 'tabindex', '0')
  setAttribute(element, 'role', 'button')
  if (name !== null) setAttribute(element, 'aria-label', name)
}

/**
 * DialKit's sliders, folder headers and hex values are pointer-only, its
 * select list has no keyboard support and its toggles carry no pressed state.
 * This finds DialKit's elements by their labels and adds what is missing.
 */
export function applyPanelAccess(root: HTMLElement, access: PanelAccess): void {
  const tracks = [...root.querySelectorAll<HTMLElement>('.dialkit-slider')]
  const sliders = matchByPlace(
    tracks.map((track) => placeOf(track, textOf(track.querySelector('.dialkit-slider-label')))),
    access.sliders,
  )
  for (const [index, track] of tracks.entries()) {
    const slider = sliders[index]
    if (!slider) continue
    const value = Number(DialStore.getValue(slider.panelId, slider.path))
    setAttribute(track, 'data-dial-panel', slider.panelId)
    setAttribute(track, 'data-dial-path', slider.path)
    setAttribute(track, 'tabindex', '0')
    setAttribute(track, 'role', 'slider')
    setAttribute(track, 'aria-label', slider.where.split(' / ').slice(-2).join(' '))
    setAttribute(track, 'aria-valuemin', String(slider.min))
    setAttribute(track, 'aria-valuemax', String(slider.max))
    setAttribute(track, 'aria-valuenow', Number.isFinite(value) ? String(value) : null)
  }

  const triggers = [...root.querySelectorAll<HTMLElement>('.dialkit-select-trigger')]
  const selects = matchByPlace(
    triggers.map((trigger) => placeOf(trigger, textOf(trigger.querySelector('.dialkit-select-label')))),
    access.selects,
  )
  for (const [index, trigger] of triggers.entries()) {
    const select = selects[index]
    if (!select) continue
    setAttribute(trigger, 'data-dial-panel', select.panelId)
    setAttribute(trigger, 'data-dial-path', select.path)
    setAttribute(trigger, 'aria-haspopup', 'listbox')
    setAttribute(trigger, 'aria-expanded', trigger.dataset.open === 'true' ? 'true' : 'false')
  }

  for (const control of root.querySelectorAll<HTMLElement>('.dialkit-labeled-control')) {
    const segments = control.querySelector('.dialkit-segmented')
    if (!segments) continue
    setAttribute(segments, 'role', 'group')
    setAttribute(segments, 'aria-label', textOf(control.querySelector('.dialkit-labeled-control-label')))
    for (const button of segments.querySelectorAll('.dialkit-segmented-button')) {
      setAttribute(button, 'aria-pressed', button.getAttribute('data-active') === 'true' ? 'true' : 'false')
    }
  }

  for (const control of root.querySelectorAll<HTMLElement>('.dialkit-color-control')) {
    const label = textOf(control.querySelector('.dialkit-color-label'))
    const hex = control.querySelector<HTMLElement>('.dialkit-color-hex')
    if (hex) asButton(hex, `${label} hex ${textOf(hex)}`)
    const swatch = control.querySelector('.dialkit-color-swatch')
    if (swatch) setAttribute(swatch, 'aria-label', `${label} color picker`)
  }

  for (const header of root.querySelectorAll<HTMLElement>('.dialkit-folder:not(.dialkit-folder-root) > .dialkit-folder-header')) {
    asButton(header, null)
    setAttribute(header, 'aria-expanded', header.parentElement?.dataset.open === 'true' ? 'true' : 'false')
  }

  for (const button of root.querySelectorAll<HTMLElement>('.dialkit-button')) {
    const busy = access.busy.includes(textOf(button))
    setAttribute(button, 'aria-disabled', busy ? 'true' : null)
    setAttribute(button, 'data-busy', busy ? '' : null)
  }
}

/** Busy labels of every mounted usePanelAccess, so one hook does not undo another's. */
const shared = new Map<string, readonly string[]>()

function withShared(access: PanelAccess): PanelAccess {
  return { ...access, busy: [...shared.values()].flat() }
}

function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))
  return Number((Math.round(value / step) * step).toFixed(decimals))
}

function sliderKey(event: KeyboardEvent, slider: SliderAccess): boolean {
  const current = Number(DialStore.getValue(slider.panelId, slider.path))
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
  DialStore.updateValue(slider.panelId, slider.path, roundToStep(Math.min(slider.max, Math.max(slider.min, next)), slider.precision))
  return true
}

function selectKey(event: KeyboardEvent, trigger: HTMLElement, select: SelectAccess): boolean {
  const last = select.options.length - 1
  const index = select.options.findIndex((option) => option.value === DialStore.getValue(select.panelId, select.path))
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
  if (next !== index && next >= 0) DialStore.updateValue(select.panelId, select.path, select.options[next].value)
  return true
}

function handleKeyDown(event: KeyboardEvent, access: PanelAccess): void {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLElement)) return
  const target = event.target
  const { dialPanel, dialPath } = target.dataset
  let handled = false
  if (dialPanel && dialPath) {
    const matches = <T extends { panelId: string; path: string }>(entry: T) => entry.panelId === dialPanel && entry.path === dialPath
    const slider = access.sliders.find(matches)
    const select = access.selects.find(matches)
    if (slider) handled = sliderKey(event, slider)
    else if (select) handled = selectKey(event, target, select)
  } else if (target.getAttribute('role') === 'button' && (event.key === 'Enter' || event.key === ' ')) {
    target.click()
    handled = true
  }
  if (handled) event.preventDefault()
}

/** DialKit closes a select's list only on a click outside it; this also closes it when focus moves to another control. */
function closeListOnLeave(event: FocusEvent): void {
  const trigger = event.target
  if (!(trigger instanceof HTMLElement) || !trigger.matches('.dialkit-select-trigger') || !(event.relatedTarget instanceof HTMLElement)) return
  setTimeout(() => {
    const active = document.activeElement
    if (trigger.dataset.open !== 'true' || active === trigger || active?.closest('.dialkit-select-dropdown')) return
    trigger.click()
  }, 0)
}

/**
 * DialKit rebuilds some controls when the panel changes (Mood rebuilds its own select). When the focused control
 * is rebuilt, focus moves to the new one with the same path. Returns the control that has focus now.
 */
function keepFocus(root: HTMLElement, focused: HTMLElement | null): HTMLElement | null {
  if (!focused || focused.isConnected) return focused
  const active = document.activeElement
  if (active && active !== document.body) return null
  const path = focused.dataset.dialPath
  const rebuilt = path ? root.querySelector<HTMLElement>(`[data-dial-path="${path}"]`) : null
  rebuilt?.focus({ preventScroll: true })
  return rebuilt
}

/** DialKit takes a picked option's list away, so focus would fall to the page; this puts it back on the list's select. */
function refocusAfterPick(event: MouseEvent, root: HTMLElement): void {
  if (!(event.target instanceof Element) || !event.target.closest('.dialkit-select-option')) return
  const trigger = root.querySelector<HTMLElement>('.dialkit-select-trigger[data-open="true"]')
  if (!trigger) return
  const path = trigger.dataset.dialPath
  setTimeout(() => {
    const active = document.activeElement
    if (active && active !== document.body && !active.closest('.dialkit-select-dropdown')) return
    const current = path ? root.querySelector<HTMLElement>(`.dialkit-select-trigger[data-dial-path="${path}"]`) : null
    ;(current ?? trigger).focus({ preventScroll: true })
  }, 0)
}

export function usePanelAccess(rootRef: RefObject<HTMLElement | null>, access: PanelAccess): void {
  const key = useId()
  const latest = useRef(access)

  useEffect(() => {
    latest.current = access
    shared.set(key, access.busy)
    if (rootRef.current) applyPanelAccess(rootRef.current, withShared(access))
  })

  useEffect(() => () => void shared.delete(key), [key])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let focused: HTMLElement | null = null
    const observer = new MutationObserver(() => {
      applyPanelAccess(root, withShared(latest.current))
      focused = keepFocus(root, focused)
    })
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-open', 'data-active'] })
    const onKeyDown = (event: KeyboardEvent) => handleKeyDown(event, latest.current)
    const onClick = (event: MouseEvent) => refocusAfterPick(event, root)
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) focused = event.target
    }
    root.addEventListener('keydown', onKeyDown)
    root.addEventListener('focusout', closeListOnLeave)
    root.addEventListener('focusin', onFocusIn)
    root.addEventListener('click', onClick, true)
    return () => {
      observer.disconnect()
      root.removeEventListener('keydown', onKeyDown)
      root.removeEventListener('focusout', closeListOnLeave)
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('click', onClick, true)
    }
  }, [rootRef])
}
