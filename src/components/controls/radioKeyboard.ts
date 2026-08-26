import type { KeyboardEvent } from 'react'

export function handleRadioGroupKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
): void {
  if (
    event.key !== 'ArrowLeft'
    && event.key !== 'ArrowRight'
    && event.key !== 'ArrowUp'
    && event.key !== 'ArrowDown'
    && event.key !== 'Home'
    && event.key !== 'End'
  ) return

  const group = event.currentTarget.closest<HTMLElement>('[role="radiogroup"]')
    ?? event.currentTarget.parentElement
  const radios = Array.from(
    group
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')
      ?? [],
  )
  if (radios.length < 2) return
  const current = radios.indexOf(event.currentTarget)
  if (current < 0) return

  event.preventDefault()
  const next = event.key === 'Home'
    ? radios[0]
    : event.key === 'End'
      ? radios.at(-1)
      : radios[
          (current + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1)
            + radios.length)
          % radios.length
        ]
  next?.focus()
  next?.click()
}

export function handleRovingGridKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
): void {
  if (
    event.key !== 'ArrowLeft'
    && event.key !== 'ArrowRight'
    && event.key !== 'ArrowUp'
    && event.key !== 'ArrowDown'
    && event.key !== 'Home'
    && event.key !== 'End'
  ) return

  const grid = event.currentTarget.closest<HTMLElement>('[data-roving-grid]')
  const buttons = Array.from(
    grid?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
  )
  const current = buttons.indexOf(event.currentTarget)
  if (current < 0) return

  event.preventDefault()
  const columns = 7
  const offset = event.key === 'ArrowLeft' ? -1
    : event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowUp' ? -columns
        : event.key === 'ArrowDown' ? columns
          : 0
  const index = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? buttons.length - 1
      : Math.max(0, Math.min(buttons.length - 1, current + offset))
  buttons[index]?.focus()
}
