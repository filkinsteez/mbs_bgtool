import { useEffect, type RefObject } from 'react'

/** A press on a DialKit slider that DialKit is still treating as a drag. */
export interface SliderPress<T> {
  track: T
  pointerId: number
  /** Where the pointer last was while pressed: where a drag DialKit missed the end of is released. */
  x: number
  y: number
}

/** A pointer event as the guard sees it: `track` is the DialKit slider the event is on, or null. */
export type SliderPointerEvent<T> =
  | { kind: 'down'; track: T | null; primary: boolean; pointerId: number; x: number; y: number }
  | { kind: 'move'; track: T | null; pressed: boolean; x: number; y: number }
  | { kind: 'up'; track: T | null }
  | { kind: 'cancel' | 'lost' | 'blur' }

export interface SliderPointerOutcome<T> {
  /** Keep the event from reaching the slider. */
  block: boolean
  /** A drag DialKit hasn't ended, to end with a release. */
  end: SliderPress<T> | null
  press: SliderPress<T> | null
}

/**
 * DialKit's slider takes a press of any button and ends a drag only on a pointerup that reaches it. When the pointer
 * is taken away before the release (a context menu, another window, a native drag) or released after the slider lost
 * it, the slider keeps dragging, and every later move over it sets its value. Per pointer event this decides what
 * prevents that: only the main button starts a drag; a drag ends on the release wherever it lands, on pointercancel, on
 * lost capture and when the window loses focus; and a move with no button down never reaches a slider.
 */
export function sliderPointer<T>(press: SliderPress<T> | null, event: SliderPointerEvent<T>): SliderPointerOutcome<T> {
  switch (event.kind) {
    case 'down':
      if (event.track === null) return { block: false, end: null, press }
      if (!event.primary) return { block: true, end: null, press }
      return { block: false, end: null, press: { track: event.track, pointerId: event.pointerId, x: event.x, y: event.y } }
    case 'move':
      if (!event.pressed) return { block: event.track !== null, end: press, press: null }
      return { block: false, end: null, press: press && { ...press, x: event.x, y: event.y } }
    case 'up':
      return { block: false, end: press && press.track !== event.track ? press : null, press: null }
    case 'cancel':
    case 'lost':
    case 'blur':
      return { block: false, end: press, press: null }
    default: {
      const unknown: never = event
      return unknown
    }
  }
}

const TRACK = '.dialkit-slider'

/** Ends a DialKit slider's drag the way DialKit expects: a release on its track. */
function release({ track, pointerId, x, y }: SliderPress<HTMLElement>): void {
  track.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, composed: true, pointerId, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 0 }))
}

/** Applies sliderPointer to the DialKit sliders inside `rootRef`, through listeners on the window. */
export function useSliderRelease(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    let press: SliderPress<HTMLElement> | null = null
    const trackOf = (target: EventTarget | null): HTMLElement | null => {
      const track = target instanceof Element ? target.closest<HTMLElement>(TRACK) : null
      return track && rootRef.current?.contains(track) ? track : null
    }
    const apply = (event: Event | null, outcome: SliderPointerOutcome<HTMLElement>) => {
      press = outcome.press
      if (outcome.block) event?.stopPropagation()
      if (outcome.end) release(outcome.end)
    }
    const onDown = (e: PointerEvent) =>
      apply(e, sliderPointer(press, { kind: 'down', track: trackOf(e.target), primary: e.button === 0 && !e.ctrlKey, pointerId: e.pointerId, x: e.clientX, y: e.clientY }))
    const onMove = (e: PointerEvent) => apply(e, sliderPointer(press, { kind: 'move', track: trackOf(e.target), pressed: e.buttons !== 0, x: e.clientX, y: e.clientY }))
    const onUp = (e: PointerEvent) => apply(e, sliderPointer(press, { kind: 'up', track: trackOf(e.target) }))
    const onCancel = () => apply(null, sliderPointer(press, { kind: 'cancel' }))
    const onLost = (e: PointerEvent) => {
      if (press && trackOf(e.target) === press.track) apply(null, sliderPointer(press, { kind: 'lost' }))
    }
    const onBlur = () => apply(null, sliderPointer(press, { kind: 'blur' }))
    const onHidden = () => {
      if (document.hidden) onBlur()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('lostpointercapture', onLost, true)
    window.addEventListener('contextmenu', onCancel, true)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
      window.removeEventListener('lostpointercapture', onLost, true)
      window.removeEventListener('contextmenu', onCancel, true)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [rootRef])
}
