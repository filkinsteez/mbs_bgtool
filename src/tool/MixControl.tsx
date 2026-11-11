import { Slider } from 'dialkit'
import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import type { ColorPack } from '@/light'
import { isColorOn, linkMix, mixPercents, mixStep, setShare, setStep, stepForKey, stepRange, type ColorMix } from '@/light/color/mix'
import { hueOrder } from '@/light/color/packs'

/** A run of changes to one color: the mix it started from and the last mix it set. */
export interface MixRun {
  index: number
  from: ColorMix
  last: ColorMix
}

const sameMix = (a: ColorMix, b: ColorMix) => a.shares.length === b.shares.length && a.shares.every((share, i) => Math.abs(share - b.shares[i]) < 1e-9)

/**
 * The mix that color `index` at `value` gives (on the pack's nearest step with `snap`), in the link's whole percents,
 * set from the mix the run of changes to that color started from: so each step of a drag or of keys lands on a mix
 * the preview solved ahead of time (neighbourMixes) and the rounding to whole percents doesn't build up. A change to
 * another color, or a mix changed from elsewhere, starts a new run.
 */
export function runStep(pack: ColorPack, run: MixRun | null, mix: ColorMix, index: number, value: number, snap: boolean): { mix: ColorMix; run: MixRun } {
  const from = run && run.index === index && sameMix(run.last, mix) ? run.from : mix
  const next = linkMix(pack, snap ? setStep(pack, from, index, value) : setShare(pack, from, index, value))
  return { mix: next, run: { index, from, last: next } }
}

interface MixControlProps {
  pack: ColorPack
  mix: ColorMix
  onChange: (mix: ColorMix) => void
  /** A slider drag starts (true) or ends (false). */
  onDragging?: (dragging: boolean) => void
}

/**
 * The color percentages in step 1: one DialKit slider per pack color in hue order, labeled with the color's name and
 * swatch, from 0 to 100% in its pack's step (MIX_STEPS: a quarter in Bold, a fifth in the five-color packs), with its
 * share in whole percents. A drag, a click or an arrow key sets the color to a step; the others share the rest in their
 * ratios, so the percents always add up to 100, and a color the user hasn't set may sit between steps (Meta Blue's
 * default 50% in a five-color pack). Every mix it sets is in the link's whole percents (runStep). 0% is off; at least
 * two colors stay on, so the last two stop one step above it.
 */
export function MixControl({ pack, mix, onChange, onDragging }: MixControlProps) {
  const rowsRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const runRef = useRef<MixRun | null>(null)
  const percents = mixPercents(pack, mix)
  const order = hueOrder(pack)
  const step = Math.round(mixStep(pack) * 100)

  function setColor(index: number, value: number, snap: boolean) {
    const { mix: next, run } = runStep(pack, runRef.current, mix, index, value, snap)
    runRef.current = run
    if (!sameMix(next, mix)) onChange(next)
  }

  function dragging(on: boolean) {
    if (draggingRef.current === on) return
    draggingRef.current = on
    onDragging?.(on)
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const next = stepForKey(pack, mix, index, event.key)
    if (next === null) return
    event.preventDefault()
    setColor(index, next, false)
  }

  // DialKit's sliders take no focus or keys of their own; as usePanelAccess does for the panel's other sliders, each
  // track gets a slider's tab stop and values.
  useLayoutEffect(() => {
    const tracks = rowsRef.current?.querySelectorAll<HTMLElement>('.dialkit-slider') ?? []
    tracks.forEach((track, row) => {
      const index = order[row]
      if (index === undefined) return
      const [lowest, highest] = stepRange(pack, mix, index)
      track.setAttribute('tabindex', '0')
      track.setAttribute('role', 'slider')
      track.setAttribute('aria-label', pack.colors[index].name)
      track.setAttribute('aria-valuemin', String(Math.round(lowest * 100)))
      track.setAttribute('aria-valuemax', String(Math.round(highest * 100)))
      track.setAttribute('aria-valuenow', String(percents[index]))
      track.setAttribute('aria-valuetext', `${percents[index]}%`)
    })
  })

  return (
    <div ref={rowsRef} className="tool-mix">
      {order.map((index) => {
        const color = pack.colors[index]
        return (
          <div
            key={color.hex}
            className="tool-mix-row"
            style={{ '--mix-color': color.hex } as CSSProperties}
            data-off={isColorOn(mix, index) ? undefined : ''}
            onKeyDown={(event) => handleKey(event, index)}
            onPointerDown={() => dragging(true)}
            onPointerUp={() => dragging(false)}
            onPointerCancel={() => dragging(false)}
            onLostPointerCapture={() => dragging(false)}
          >
            <Slider label={color.name} value={percents[index]} min={0} max={100} step={step} onChange={(value) => setColor(index, value / 100, true)} />
          </div>
        )
      })}
    </div>
  )
}
