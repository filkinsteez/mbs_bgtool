import { useRef, type KeyboardEvent } from 'react'
import { PACKS, type PackId } from '@/light'

const LABEL = 'Colors'

/** The pack an arrow, Home or End key moves to from `index`, or null for other keys. Arrows wrap around. */
export function packForKey(key: string, index: number): number | null {
  const last = PACKS.length - 1
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

/**
 * The Colors control: each pack as a strip of its own colors in pack order, the chosen one ringed and named. A radio
 * group: the arrow keys move the choice, and Tab reaches the chosen pack only.
 */
export function PackPicker({ value, onChange }: { value: PackId; onChange: (pack: PackId) => void }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const chosen = PACKS.find((pack) => pack.id === value) ?? PACKS[0]

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = packForKey(event.key, index)
    if (next === null) return
    event.preventDefault()
    onChange(PACKS[next].id)
    buttons.current[next]?.focus()
  }

  return (
    <div className="tool-packs" role="radiogroup" aria-label={LABEL}>
      <div className="tool-packs-head" aria-hidden="true">
        <span className="dialkit-select-label">{LABEL}</span>
        <span className="dialkit-select-value">{chosen.name}</span>
      </div>
      <div className="tool-packs-options">
        {PACKS.map((pack, index) => (
          <button
            key={pack.id}
            ref={(element) => void (buttons.current[index] = element)}
            type="button"
            role="radio"
            className="tool-pack"
            aria-checked={pack.id === chosen.id}
            aria-label={pack.name}
            title={pack.name}
            tabIndex={pack.id === chosen.id ? 0 : -1}
            onClick={() => onChange(pack.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {pack.colors.map((color) => (
              <span key={color.hex} style={{ background: color.hex }} />
            ))}
          </button>
        ))}
      </div>
    </div>
  )
}
