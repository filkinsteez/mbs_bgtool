'use client'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { useBackgroundStore } from '@/features/background-generator/store'
import { applyBrushSegment, artworkBrushPoint, decodeDeformation, encodeDeformation, type Point } from '@/core/lab/gradients/deformation'
import { useGradientBrush } from './gradientBrushStore'

export function GradientBrushOverlay() {
  const elementRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const stroke = useRef<{ pointer: number; last: Point; field: Float32Array } | null>(null)
  const brush = useGradientBrush()
  const [cursorVisible, setCursorVisible] = useState(false)
  const radius = brush.radius
  const finish = (cancel: boolean) => {
    if (!stroke.current) return
    stroke.current = null
    if (cancel) useBackgroundStore.getState().cancelTransaction()
    else useBackgroundStore.getState().commitTransaction()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(true) }
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase()) && stroke.current) {
        e.preventDefault()
        e.stopImmediatePropagation()
        finish(true)
      }
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === '[' || e.key === ']') {
        e.preventDefault()
        const ui = useGradientBrush.getState()
        ui.set({ radius: Math.max(0.04, Math.min(0.7, ui.radius + (e.key === '[' ? -0.025 : 0.025))) })
      }
    }
    const cancel = () => finish(true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', cancel)
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('blur', cancel); finish(false) }
  }, [])

  const position = (event: PointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    const cursor = cursorRef.current
    if (cursor) {
      const diameter = radius * Math.min(rect.width, rect.height) * 2
      cursor.style.width = `${diameter}px`
      cursor.style.height = `${diameter}px`
      cursor.style.left = `${event.clientX - rect.left}px`
      cursor.style.top = `${event.clientY - rect.top}px`
    }
    // Invert the displayed artwork transform. Painting still lands under the
    // cursor after the user pans, zooms, scales, moves, or rotates the artwork.
    const recipe = useBackgroundStore.getState().recipe
    const t = recipe.transforms.background
    const aspect = recipe.format.width / recipe.format.height
    return artworkBrushPoint((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, aspect, t)
  }
  const paint = (event: PointerEvent<HTMLDivElement>, point: Point, stamp = false) => {
    const active = stroke.current
    if (!active || active.pointer !== event.pointerId) return
    if (!stamp && Math.hypot(point.x - active.last.x, point.y - active.last.y) < 0.0001) return
    const store = useBackgroundStore.getState()
    const recipe = store.recipe
    active.field = applyBrushSegment(active.field, {
      from: active.last, to: point, radius: brush.radius / recipe.transforms.background.scale,
      strength: brush.strength * (event.pointerType === 'pen' ? Math.max(0.08, event.pressure) : 1),
      mode: event.altKey ? 'restore' : brush.mode, aspect: recipe.format.width / recipe.format.height, reverse: event.shiftKey,
    })
    active.last = point
    store.setTransient({ look: { deformation: encodeDeformation(active.field) } })
  }
  return <div ref={elementRef} className="gradient-brush-overlay" role="img" aria-label="Paint gradient distortion. Drag to distort. Brackets change size. Alt restores, Shift reverses, Escape cancels a stroke." tabIndex={0}
    onPointerDown={(event) => {
      if (event.button !== 0 || stroke.current) return
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true })
      const point = position(event)
      useBackgroundStore.getState().beginTransaction()
      stroke.current = { pointer: event.pointerId, last: point, field: decodeDeformation(useBackgroundStore.getState().recipe.look.deformation) }
      event.currentTarget.setPointerCapture(event.pointerId)
      if (brush.mode !== 'push') paint(event, point, true)
    }}
    onPointerMove={(event) => { setCursorVisible(true); const point = position(event); paint(event, point); if (stroke.current) event.stopPropagation() }}
    onPointerUp={(event) => {
      if (stroke.current?.pointer !== event.pointerId) return
      paint(event, position(event)); finish(false)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      event.stopPropagation()
    }}
    onPointerCancel={(event) => { if (stroke.current?.pointer === event.pointerId) finish(true) }}
    onLostPointerCapture={(event) => { if (stroke.current?.pointer === event.pointerId) finish(false) }}
    onPointerLeave={() => { if (!stroke.current) setCursorVisible(false) }}>
    <div ref={cursorRef} className="gradient-brush-cursor" style={{ opacity: cursorVisible ? 1 : 0 }} />
  </div>
}
