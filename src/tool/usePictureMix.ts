import { useCallback, useEffect, useRef, useState } from 'react'

export interface PictureMix {
  /** The mix the picture draws, as the panel keeps it (`mixPanelValue`). */
  shares: string
  /** A color slider's drag starts (true) or ends (false). */
  setDragging: (dragging: boolean) => void
}

/**
 * The mix the picture draws, given the panel's. With no color slider dragged it is the panel's mix. While one is, the
 * picture takes the panel's mix in a task after the next frame, so the slider's new step is painted before the frame
 * that draws it, which still has to solve the color stage when the preview hasn't solved that mix ahead of time. When
 * the drag ends the picture takes the panel's mix at once.
 */
export function usePictureMix(panelShares: string): PictureMix {
  // The mix the picture shows while a drag runs; null with no drag.
  const [held, setHeld] = useState<string | null>(null)
  const panelRef = useRef(panelShares)

  useEffect(() => {
    panelRef.current = panelShares
    if (held === null || held === panelShares) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => setHeld((current) => (current === null ? null : panelRef.current)), 0)
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [held, panelShares])

  const setDragging = useCallback((dragging: boolean) => setHeld(dragging ? panelRef.current : null), [])

  return { shares: held ?? panelShares, setDragging }
}
