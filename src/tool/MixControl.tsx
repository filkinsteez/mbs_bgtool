import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import type { ColorPack, PackId } from '@/light'
import { DEFAULT_META_BLUE_SHARE, isMetaBlueOn, MAX_SHARE, metaBlueIndex, mixPercents, setMetaBlue, setShare, SHARE_STEP, type ColorMix } from '@/light/color/mix'
import { MIX_DIAL_KEY } from './dialConfig'
import { mixForPack } from './state'
import { optionForKey } from './TilePicker'

/** Shares closer than this to a step count as on it, so float error never skips or repeats a step. */
const ON_STEP = 1e-6
/** The slider's marks: every 10%, short of both ends. */
const MARKS = Array.from({ length: Math.round(MAX_SHARE / (2 * SHARE_STEP)) - 1 }, (_, i) => (i + 1) * 2 * SHARE_STEP)

/**
 * The share a key gives the chosen color, or null for other keys: arrows step 5% from the step at or past the share,
 * Shift and Page keys 10%, Home and End go to 0 and 90%.
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

/** The share at a point along the slider, 0 at its left edge and 1 at its right, on the 5% steps. */
export function shareAt(fraction: number): number {
  const steps = Math.round((Math.min(1, Math.max(0, fraction)) * MAX_SHARE) / SHARE_STEP)
  return steps * SHARE_STEP
}

/** A color the mix has off: at or below the share `isMetaBlueOn` counts as off, so the bar and the switch agree. */
export const isOff = (share: number) => share <= 1e-9

interface MixControlProps {
  pack: ColorPack
  mix: ColorMix
  onChange: (mix: ColorMix) => void
}

/**
 * The color mix in step 1: a bar of the pack's colors, each as wide as its share with its percent under it, where a
 * click or the arrow keys pick a color; one slider for the picked color's share, 0 to 90% in steps of 5, the others
 * keeping their ratios; and the Meta Blue switch, which is Meta Blue at 0%. Every color keeps a place on the bar that a
 * click can hit, a color at 0% as a thin stripe, so it can be picked and raised again. A double-click on the bar, or
 * Escape on it, gives the pack's default mix with the switch as it is.
 */
export function MixControl({ pack, mix, onChange }: MixControlProps) {
  const blue = metaBlueIndex(pack)
  const [choice, setChoice] = useState<{ pack: PackId; index: number }>({ pack: pack.id, index: Math.max(0, blue) })
  const chosen = choice.pack === pack.id && choice.index < pack.colors.length ? choice.index : Math.max(0, blue)
  // The share Meta Blue had when the switch turned it off, for this pack.
  const blueBefore = useRef<{ pack: PackId; share: number } | null>(null)
  const colors = useRef<(HTMLButtonElement | null)[]>([])
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const labelId = useId()
  const percents = mixPercents(mix)
  const share = mix.shares[chosen]
  const name = pack.colors[chosen].name
  const fill = (share / MAX_SHARE) * 100
  const blueOn = isMetaBlueOn(pack, mix)

  const pick = (index: number) => setChoice({ pack: pack.id, index })
  const setChosenShare = (value: number) => onChange(setShare(pack, mix, chosen, value))

  function reset() {
    blueBefore.current = null
    onChange(mixForPack(pack, mix, pack))
  }

  function handleBarKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'Escape') {
      event.preventDefault()
      reset()
      return
    }
    const next = optionForKey(event.key, index, pack.colors.length)
    if (next === null) return
    event.preventDefault()
    pick(next)
    colors.current[next]?.focus()
  }

  function handleSliderKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const next = shareForKey(event.key, event.shiftKey, share)
    if (next === null) return
    event.preventDefault()
    setChosenShare(next)
  }

  function slideTo(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    setChosenShare(shareAt((event.clientX - box.left) / box.width))
  }

  function toggleBlue() {
    if (blueOn) {
      blueBefore.current = { pack: pack.id, share: mix.shares[blue] }
      onChange(setMetaBlue(pack, mix, false))
    } else {
      const before = blueBefore.current?.pack === pack.id ? blueBefore.current.share : DEFAULT_META_BLUE_SHARE
      onChange(setMetaBlue(pack, mix, true, before))
    }
  }

  return (
    <div className="tool-mix">
      <div className="tool-mix-bar" role="radiogroup" aria-label="Mix" onDoubleClick={reset}>
        {pack.colors.map((color, index) => (
          <button
            key={color.hex}
            ref={(element) => void (colors.current[index] = element)}
            type="button"
            role="radio"
            className="tool-mix-color"
            aria-checked={index === chosen}
            aria-label={`${color.name} ${percents[index]}%`}
            tabIndex={index === chosen ? 0 : -1}
            data-dial-path={index === chosen ? MIX_DIAL_KEY : undefined}
            data-off={isOff(mix.shares[index]) ? '' : undefined}
            style={{ flexGrow: mix.shares[index], '--mix-color': color.hex } as CSSProperties}
            onClick={() => pick(index)}
            onKeyDown={(event) => handleBarKey(event, index)}
          />
        ))}
      </div>
      <div className="tool-mix-percents" aria-hidden="true">
        {pack.colors.map((color, index) => (
          <span key={color.hex} className="tool-mix-percent" data-chosen={index === chosen ? '' : undefined} style={{ flexGrow: mix.shares[index] }}>
            <span>{percents[index]}%</span>
          </span>
        ))}
      </div>
      <div className="dialkit-slider-wrapper">
        <div
          className={`dialkit-slider${hovered || dragging ? ' dialkit-slider-active' : ''}`}
          role="slider"
          tabIndex={0}
          aria-labelledby={labelId}
          aria-valuemin={0}
          aria-valuemax={Math.round(MAX_SHARE * 100)}
          aria-valuenow={percents[chosen]}
          aria-valuetext={`${percents[chosen]}%`}
          data-dragging={dragging ? '' : undefined}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onPointerDown={(event) => {
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            event.currentTarget.focus({ preventScroll: true })
            setDragging(true)
            slideTo(event)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) slideTo(event)
          }}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onKeyDown={handleSliderKey}
        >
          <div className="dialkit-slider-hashmarks">
            {MARKS.map((mark) => (
              <div key={mark} className="dialkit-slider-hashmark" style={{ left: `${(mark / MAX_SHARE) * 100}%` }} />
            ))}
          </div>
          <div className="dialkit-slider-fill" style={{ width: `${fill}%` }} />
          <div className="dialkit-slider-handle tool-mix-handle" style={{ '--fill': `${fill}%` } as CSSProperties} />
          <span id={labelId} className="dialkit-slider-label">
            {name}
          </span>
          <span className="dialkit-slider-value">{percents[chosen]}%</span>
        </div>
      </div>
      {blue >= 0 && (
        <button type="button" role="switch" className="tool-mix-switch" aria-checked={blueOn} onClick={toggleBlue}>
          <span className="tool-mix-switch-label">{pack.colors[blue].name}</span>
          <span className="tool-mix-switch-track" aria-hidden="true">
            <span className="tool-mix-switch-knob" />
          </span>
        </button>
      )}
    </div>
  )
}
