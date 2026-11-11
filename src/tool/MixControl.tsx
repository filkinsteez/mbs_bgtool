import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import type { ColorPack, PackId } from '@/light'
import { canTurnOff, isColorOn, mixPercents, mixStep, setColorOn, setShare, setStep, stepForKey, stepRange, type ColorMix } from '@/light/color/mix'
import { hueOrder } from '@/light/color/packs'

/** The lines on a slider: one at each step between 0 and 100%. */
export function stepLines(step: number): number[] {
  const count = Math.round(1 / step)
  return Array.from({ length: count - 1 }, (_, i) => (i + 1) / count)
}

interface MixControlProps {
  pack: ColorPack
  mix: ColorMix
  onChange: (mix: ColorMix) => void
  /** A slider drag starts (true) or ends (false). */
  onDragging?: (dragging: boolean) => void
}

/**
 * The color percentages in step 1, one row per pack color in hue order: the color's swatch, its On/Off switch and a
 * slider for its share of the picture, with a line at each of its pack's steps (MIX_STEPS: a quarter in Bold, a fifth
 * in the five-color packs) and the share in whole percents. A drag or an arrow key sets the color to a step; the
 * others share the rest in their ratios, so the percents always add up to 100, and a color the user hasn't set may sit
 * between steps (Meta Blue's default 50% in a five-color pack). Off is 0%; on brings the color back at the share it had
 * (or its default share), and at least two colors stay on.
 */
export function MixControl({ pack, mix, onChange, onDragging }: MixControlProps) {
  // The share each color had when its switch turned it off, for this pack.
  const before = useRef<{ pack: PackId; shares: (number | undefined)[] } | null>(null)
  // The slider being dragged: the ref for the pointer handlers, the state for drawing it as active.
  const dragRef = useRef<number | null>(null)
  const [dragged, setDragged] = useState<number | null>(null)
  const percents = mixPercents(pack, mix)
  const lines = stepLines(mixStep(pack))

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
    change(setStep(pack, mix, index, (event.clientX - box.left) / box.width))
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
    const next = stepForKey(pack, mix, index, event.key)
    if (next === null) return
    event.preventDefault()
    change(setShare(pack, mix, index, next))
  }

  return (
    <div className="tool-mix" role="group" aria-label="Color percentages">
      {hueOrder(pack).map((index) => {
        const color = pack.colors[index]
        const on = isColorOn(mix, index)
        const locked = on && !canTurnOff(mix, index)
        const fill = mix.shares[index] * 100
        const [lowest, highest] = stepRange(pack, mix, index)
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
                aria-valuemin={Math.round(lowest * 100)}
                aria-valuemax={Math.round(highest * 100)}
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
                <div className="dialkit-slider-fill" style={{ width: `${fill}%` }} />
                {lines.map((line) => (
                  <span key={line} className="tool-mix-step" style={{ left: `${line * 100}%` }} />
                ))}
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
