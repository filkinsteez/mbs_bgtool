import { useEffect, useId, useRef, useState } from 'react'
import { CaretDownIcon, CheckIcon } from './icons'

export interface SelectOption {
  value: string
  label: string
}

export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly SelectOption[]
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonId = useId()
  const listId = useId()
  const active = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])

  return (
    <div className="xmds-select" ref={rootRef}>
      <button
        id={buttonId}
        type="button"
        className="xmds-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((state) => !state)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen(true)
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
      >
        <span className="xmds-label">{label}</span>
        <span className="xmds-select-value">{active?.label ?? value}</span>
        <CaretDownIcon className="xmds-icon" />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-labelledby={buttonId}
          id={listId}
          className="xmds-select-list"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false)
            }
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`xmds-select-option${option.value === value ? ' is-active' : ''}`}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <CheckIcon className="xmds-icon" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
