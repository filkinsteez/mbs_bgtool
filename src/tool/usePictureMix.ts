import { useCallback, useEffect, useRef, useState } from 'react'

/** While a color slider is dragged, the picture takes a new mix at most this often. */
export const MIX_DRAG_MS = 120

export interface PictureMix {
  /** The mix the picture draws, as the panel keeps it (`mixPanelValue`). */
  shares: string
  /** A color slider's drag starts (true) or ends (false). */
  setDragging: (dragging: boolean) => void
}

/**
 * The mix the picture draws, given the panel's. With no color slider dragged it is the panel's mix. While one is, the
 * picture takes the panel's mix after the slider has painted, at most every MIX_DRAG_MS: each new mix costs the color
 * stage a solve of about 15 to 35 ms on the CPU, which would otherwise hold up the slider on every step. When the drag
 * ends the picture takes the panel's mix at once.
 */
export function usePictureMix(panelShares: string): PictureMix {
  // The mix the picture shows while a drag runs; null with no drag.
  const [held, setHeld] = useState<string | null>(null)
  const shownAt = useRef(-Infinity)
  const panelRef = useRef(panelShares)

  useEffect(() => {
    panelRef.current = panelShares
    if (held === null || held === panelShares) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const wait = Math.max(0, shownAt.current + MIX_DRAG_MS - performance.now())
    // A task after the next frame, so the slider's new value is painted before the stage solves the new mix.
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        shownAt.current = performance.now()
        setHeld((current) => (current === null ? null : panelRef.current))
      }, wait)
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [held, panelShares])

  const setDragging = useCallback((dragging: boolean) => {
    shownAt.current = -Infinity
    setHeld(dragging ? panelRef.current : null)
  }, [])

  return { shares: held ?? panelShares, setDragging }
}
