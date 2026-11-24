import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { FORMAT_SIZES, type ExportFormat } from '@/light'
import { FORMAT_GROUPS, formatName } from './dialConfig'

/** DialKit's chevron, as its selects draw it. */
const CHEVRON = 'M6 9.5L12 15.5L18 9.5'

/** How long typed letters keep adding to one search, as in a native select. */
const TYPE_RESET_MS = 600

/** The tallest the list grows before it scrolls, and the gap it keeps from the row and the panel's edges. */
const LIST_MAX = 640
const LIST_GAP = 6

const OPTIONS = FORMAT_GROUPS.flatMap(({ options }) => options)

/** A format's icon: a rectangle in its aspect ratio whose long side fills the icon's box. */
export function formatShapeStyle(format: ExportFormat): CSSProperties {
  const { width, height } = FORMAT_SIZES[format]
  const long = Math.max(width, height)
  return {
    width: `calc(var(--format-shape-box) * ${width / long})`,
    height: `calc(var(--format-shape-box) * ${height / long})`,
  }
}

/** The option a list key moves to from `active`, or null for a key the list doesn't use. The ends don't wrap. */
export function stepOption(key: string, active: number, count: number): number | null {
  switch (key) {
    case 'ArrowDown':
      return Math.min(active + 1, count - 1)
    case 'ArrowUp':
      return Math.max(active - 1, 0)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * The option that typed letters find: the next one after `active` whose name starts with them. Typing one letter
 * again and again steps through the names that start with it, as in a native select.
 */
export function findOption(labels: readonly string[], typed: string, active: number): number | null {
  const query = typed.toLowerCase()
  const repeat = query.length > 1 && [...query].every((char) => char === query[0])
  const prefix = repeat ? query[0] : query
  const start = repeat || query.length === 1 ? active + 1 : active
  for (let i = 0; i < labels.length; i++) {
    const index = (start + i) % labels.length
    if (labels[index].toLowerCase().startsWith(prefix)) return index
  }
  return null
}

const LABELS = OPTIONS.map((option) => option.label)

function FormatIcon({ format }: { format: ExportFormat }) {
  return (
    <span className="tool-format-icon" aria-hidden="true">
      <span className="tool-format-shape" style={formatShapeStyle(format)} />
    </span>
  )
}

/**
 * The Format dropdown (owner, 2026-11-17: "for sizes, lets change to a drop down", and at 12:16 PM: "for resolutions
 * can we add lil icons on the left that are a preview of each aspect ratio. also give the 16:9, 9:16, etc section a
 * header"). The row is drawn as DialKit's selects are: its name on the left, and the chosen format's icon and name on
 * the right (the row is too narrow for the sizes). It opens a list of the ratios under "Aspect ratio" and the devices
 * under Figma's Phone, Tablet and Desktop, each with its icon and size. The list keeps to the panel's width, opens on
 * whichever side of the row has more room in the panel, and scrolls when it is taller than that room.
 */
export function FormatPicker({ value, onChange }: { value: ExportFormat; onChange: (format: ExportFormat) => void }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState<{ above: boolean; maxHeight: number }>({ above: false, maxHeight: LIST_MAX })
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typedRef = useRef({ text: '', at: 0 })
  const chosen = Math.max(0, OPTIONS.findIndex((option) => option.value === value))
  const optionId = (index: number) => `${id}-option-${index}`

  function openList() {
    const row = rootRef.current?.getBoundingClientRect()
    const bounds = rootRef.current?.closest('.tool-panel')?.getBoundingClientRect()
    if (row) {
      const top = Math.max(bounds?.top ?? 0, 0)
      const bottom = Math.min(bounds?.bottom ?? window.innerHeight, window.innerHeight)
      const below = bottom - row.bottom - LIST_GAP * 2
      const above = row.top - top - LIST_GAP * 2
      setPlace({ above: above > below, maxHeight: Math.min(LIST_MAX, Math.max(above, below)) })
    }
    setActive(chosen)
    setOpen(true)
  }

  function close(refocus: boolean) {
    setOpen(false)
    typedRef.current.text = ''
    if (refocus) buttonRef.current?.focus()
  }

  function pick(index: number) {
    const format = OPTIONS[index].value
    if (format !== value) onChange(format)
    close(true)
  }

  useEffect(() => {
    if (!open) return
    listRef.current?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open])

  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
  })

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    openList()
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = stepOption(event.key, active, OPTIONS.length)
    if (step !== null) {
      event.preventDefault()
      setActive(step)
      return
    }
    if (event.key === 'Enter' || (event.key === ' ' && !typedRef.current.text)) {
      event.preventDefault()
      pick(active)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
      return
    }
    if (event.key === 'Tab') {
      close(false)
      return
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      const typed = typedRef.current
      const now = event.timeStamp
      typed.text = now - typed.at > TYPE_RESET_MS ? event.key : typed.text + event.key
      typed.at = now
      const found = findOption(LABELS, typed.text, active)
      if (found !== null) setActive(found)
    }
  }

  return (
    <div className="tool-format" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="tool-format-button"
        data-dial-path="format"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (open ? close(true) : openList())}
        onKeyDown={onButtonKeyDown}
      >
        <span className="dialkit-select-label" id={`${id}-label`}>
          Format
        </span>
        <span className="tool-format-value">
          <FormatIcon format={value} />
          <span className="dialkit-select-value" id={`${id}-value`}>
            {formatName(value)}
          </span>
        </span>
        <svg
          className="dialkit-select-chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={CHEVRON} />
        </svg>
      </button>
      {open && (
        <div
          ref={listRef}
          id={`${id}-list`}
          className="tool-format-list"
          role="listbox"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          aria-activedescendant={optionId(active)}
          data-above={place.above ? '' : undefined}
          style={{ maxHeight: place.maxHeight }}
          onKeyDown={onListKeyDown}
          onBlur={(event) => {
            if (!rootRef.current?.contains(event.relatedTarget as Node | null)) close(false)
          }}
        >
          {FORMAT_GROUPS.map(({ title, options }, group) => (
            <div key={title} role="group" aria-labelledby={`${id}-group-${group}`}>
              <div className="tool-format-group" id={`${id}-group-${group}`} role="presentation">
                {title}
              </div>
              {options.map((option) => {
                const index = OPTIONS.indexOf(option)
                return (
                  <div
                    key={option.value}
                    id={optionId(index)}
                    className="tool-format-option"
                    role="option"
                    aria-selected={option.value === value}
                    data-active={index === active ? '' : undefined}
                    onPointerMove={() => index !== active && setActive(index)}
                    onClick={() => pick(index)}
                  >
                    <FormatIcon format={option.value} />
                    <span className="tool-format-option-label">{option.label}</span>
                    {option.value === value && (
                      <svg className="tool-format-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 12.5L10 17.5L19 7" />
                      </svg>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
