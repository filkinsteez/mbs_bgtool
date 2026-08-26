'use client'

import { useCallback, useEffect, useRef } from 'react'

// Continuous controls update transiently, then create one history entry.
//
// Refs are only ever touched inside effects and event handlers — never
// during render — so this stays clean under React 19's rules.
export function useCommitOnRelease(onCommit?: () => void) {
  const latest = useRef<(() => void) | undefined>(undefined)
  const dirty = useRef(false)
  const pointerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    latest.current = onCommit
  }, [onCommit])

  useEffect(() => {
    const done = () => {
      clearTimeout(pointerTimer.current)
      pointerTimer.current = undefined
      if (!dirty.current) return
      dirty.current = false
      latest.current?.()
    }
    const schedulePointerDone = () => {
      clearTimeout(pointerTimer.current)
      pointerTimer.current = setTimeout(done, 250)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') done()
    }
    window.addEventListener('pointerup', schedulePointerDone)
    window.addEventListener('pointercancel', done)
    window.addEventListener('keyup', done)
    window.addEventListener('blur', done)
    window.addEventListener('pagehide', done)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      done()
      window.removeEventListener('pointerup', schedulePointerDone)
      window.removeEventListener('pointercancel', done)
      window.removeEventListener('keyup', done)
      window.removeEventListener('blur', done)
      window.removeEventListener('pagehide', done)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  // mark a change as pending — the next release commits it
  const touch = useCallback(() => {
    clearTimeout(pointerTimer.current)
    pointerTimer.current = undefined
    if (!dirty.current) latest.current?.()
    dirty.current = true
  }, [])

  // commit immediately (discrete edits: a typed value, a reset)
  const commitNow = useCallback(() => {
    clearTimeout(pointerTimer.current)
    pointerTimer.current = undefined
    dirty.current = false
    latest.current?.()
  }, [])

  return { touch, commitNow }
}
