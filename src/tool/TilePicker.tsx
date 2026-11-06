import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'

export interface TileOption<T extends string> {
  value: T
  label: string
}

/** What the tiles show, which sets their height in tool.css: color strips, pictures, or shapes and icons with a name. */
export type TileKind = 'swatch' | 'picture' | 'shape'

/** The option an arrow, Home or End key moves to from `index` of `count`, or null for other keys. Arrows wrap around. */
export function optionForKey(key: string, index: number, count: number): number | null {
  const last = count - 1
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return index === last ? 0 : index + 1
    case 'ArrowLeft':
    case 'ArrowUp':
      return index === 0 ? last : index - 1
    case 'Home':
      return 0
    case 'End':
      return last
    default:
      return null
  }
}

interface TilePickerProps<T extends string> {
  label: string
  /**
   * The choice's panel key, set as `data-dial-path` on the chosen tile so focus finds it again when the tiles are
   * rebuilt (panelAccess) and page checks can focus it, as with DialKit's controls.
   */
  path: string
  kind: TileKind
  options: readonly TileOption<T>[]
  value: T
  onChange: (value: T) => void
  tile: (option: TileOption<T>) => ReactNode
}

/**
 * A panel choice drawn as a row of tiles, the chosen one ringed and named. A radio group: the arrow keys move the
 * choice, and Tab reaches the chosen tile only.
 */
export function TilePicker<T extends string>({ label, path, kind, options, value, onChange, tile }: TilePickerProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const chosen = options.find((option) => option.value === value) ?? options[0]

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = optionForKey(event.key, index, options.length)
    if (next === null) return
    event.preventDefault()
    onChange(options[next].value)
    buttons.current[next]?.focus()
  }

  return (
    <div className="tool-tiles" data-kind={kind} role="radiogroup" aria-label={label}>
      <div className="tool-tiles-head" aria-hidden="true">
        <span className="dialkit-select-label">{label}</span>
        <span className="dialkit-select-value">{chosen.label}</span>
      </div>
      <div className="tool-tiles-options" style={{ '--tile-columns': options.length } as CSSProperties}>
        {options.map((option, index) => (
          <button
            key={option.value}
            ref={(element) => void (buttons.current[index] = element)}
            type="button"
            role="radio"
            className="tool-tile"
            aria-checked={option.value === chosen.value}
            aria-label={option.label}
            title={option.label}
            tabIndex={option.value === chosen.value ? 0 : -1}
            data-dial-path={option.value === chosen.value ? path : undefined}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {tile(option)}
          </button>
        ))}
      </div>
    </div>
  )
}
