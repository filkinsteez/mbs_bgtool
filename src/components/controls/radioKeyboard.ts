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

  const radios = Array.from(
    event.currentTarget.parentElement
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
