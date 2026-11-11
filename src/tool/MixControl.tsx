import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import type { ColorPack, PackId } from '@/light'
import { canTurnOff, isColorOn, MAX_SHARE, mixPercents, setColorOn, setShare, SHARE_STEP, type ColorMix } from '@/light/color/mix'

/** Shares closer than this to a step count as on it, so float error never skips or repeats a step. */
const ON_STEP = 1e-6
/** The lines that split each slider into quarters, as in the owner's sketch (Figma 111:588). */
const QUARTERS = [0.25, 0.5, 0.75]

/**
 * The share a key gives a color, or null for other keys: arrows step 5% from the step at or past the share, Shift and
 * Page keys 10%, Home and End go to 0 and 90%.
 */
export function shareForKey(key: string, shift: boolean, share: number): number | null {
  const steps = shift || key === 'PageUp' || key === 'PageDown' ? 2 : 1
  const below = Math.floor(share / SHARE_STEP + ON_STEP)
  const above = Math.ceil(share / SHARE_STEP - ON_STEP)
  let next: number
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
    case 'PageUp':
      next = (below + steps) * SHARE_STEP
      break
    case 'ArrowLeft':
    case 'ArrowDown':
    case 'PageDown':
      next = (above - steps) * SHARE_STEP
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = MAX_SHARE
      break
    default:
      return null
  }
  return Math.min(MAX_SHARE, Math.max(0, next))
}

/**
 * The share at a point along a slider, 0 at its left edge and 1 at its right, on the 5% steps. The slider runs from 0
 * to 100% so its quarter lines sit at 25, 50 and 75%; past MAX_SHARE the share stays at MAX_SHARE.
 */
export function shareAt(fraction: number): number {
  const steps = Math.round(Math.min(1, Math.max(0, fraction)) / SHARE_STEP)
  return Math.min(MAX_SHARE, steps * SHARE_STEP)
}

interface MixControlProps {
  pack: ColorPack
  mix: ColorMix
  onChange: (mix: ColorMix) => void
  /** A slider drag starts (true) or ends (false). */
  onDragging?: (dragging: boolean) => void
}

/**
 * The color percentages in step 1, one row per pack color in pack order: the color's swatch, its On/Off switch and a
 * slider for its share of the picture, 0 to 90% in steps of 5, with the share in whole percents. Moving one color's
 * share moves the others the other way, keeping their ratios to each other, so the percents always add up to 100.
 * Off is 0%; on brings the color back at the share it had (or its default share), and at least two colors stay on.
 */
export function MixControl({ pack, mix, onChange, onDragging }: MixControlProps) {
  // The share each color had when its switch turned it off, for this pack.
  const before = useRef<{ pack: PackId; shares: (number | undefined)[] } | null>(null)
  // The slider being dragged: the ref for the pointer handlers, the state for drawing it as active.
  const dragRef = useRef<number | null>(null)
  const [dragged, setDragged] = useState<number | null>(null)
  const percents = mixPercents(mix)

  function change(next: ColorMix) {
    if (next.shares.some((share, i) => Math.abs(share - mix.shares[i]) > 1e-12)) onChange(next)
  }

  function toggle(index: number) {
    const remembered = before.current?.pack === pack.id ? before.current.shares : []
    if (!isColorOn(mix, index)) {
      change(setColorOn(pack, mix, index, true, remembered[index]))
      return
    }
    if (!canTurnOff(mix, index)) return
    const shares = [...remembered]
    shares[index] = mix.shares[index]
    before.current = { pack: pack.id, shares }
    change(setColorOn(pack, mix, index, false))
  }

  function slideTo(event: PointerEvent<HTMLDivElement>, index: number) {
    const box = event.currentTarget.getBoundingClientRect()
    change(setShare(pack, mix, index, shareAt((event.clientX - box.left) / box.width)))
  }

  function startDrag(index: number) {
    dragRef.current = index
    setDragged(index)
    onDragging?.(true)
  }

  function endDrag() {
    if (dragRef.current === null) return
    dragRef.current = null
    setDragged(null)
    onDragging?.(false)
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const next = shareForKey(event.key, event.shiftKey, mix.shares[index])
    if (next === null) return
    event.preventDefault()
    change(setShare(pack, mix, index, next))
  }

  return (
    <div className="tool-mix" role="group" aria-label="Color percentages">
      {pack.colors.map((color, index) => {
        const on = isColorOn(mix, index)
        const locked = on && !canTurnOff(mix, index)
        const fill = mix.shares[index] * 100
        return (
          <div key={color.hex} className="tool-mix-row" style={{ '--mix-color': color.hex } as CSSProperties}>
            <span className="tool-mix-swatch" aria-hidden="true" />
            <button
              type="button"
              role="switch"
              className="tool-mix-switch"
              aria-checked={on}
              aria-label={color.name}
              aria-disabled={locked || undefined}
              onClick={() => toggle(index)}
            >
              <span className="tool-mix-switch-knob" aria-hidden="true">
                {on ? 'On' : 'Off'}
              </span>
            </button>
            <div className="dialkit-slider-wrapper tool-mix-slider">
              <div
                className={`dialkit-slider${dragged === index ? ' dialkit-slider-active' : ''}`}
                role="slider"
                tabIndex={0}
                aria-label={color.name}
                aria-valuemin={0}
                aria-valuemax={Math.round(MAX_SHARE * 100)}
                aria-valuenow={percents[index]}
                aria-valuetext={`${percents[index]}%`}
                data-dragging={dragged === index ? '' : undefined}
                data-off={on ? undefined : ''}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.preventDefault()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  event.currentTarget.focus({ preventScroll: true })
                  startDrag(index)
                  slideTo(event, index)
                }}
                onPointerMove={(event) => {
                  if (dragRef.current === index && event.currentTarget.hasPointerCapture(event.pointerId)) slideTo(event, index)
                }}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
                onKeyDown={(event) => handleKey(event, index)}
              >
                {QUARTERS.map((quarter) => (
                  <span key={quarter} className="tool-mix-quarter" style={{ left: `${quarter * 100}%` }} />
                ))}
                <div className="dialkit-slider-fill" style={{ width: `${fill}%` }} />
                <div className="dialkit-slider-handle tool-mix-handle" style={{ '--fill': `${fill}%` } as CSSProperties} />
                <span className="dialkit-slider-label">{color.name}</span>
                <span className="dialkit-slider-value">{percents[index]}%</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
