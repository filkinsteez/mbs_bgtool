import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { EXPORT_SIZES, type ExportAspect, type Scene } from '@/light'
import type { LightDrag, LightPoint } from './controls'
import { PreviewLoop } from './previewLoop'

const MAX_LONG_SIDE = 2560
const STAGE_PADDING = 32
const MAX_RENDERER_ATTEMPTS = 5
/** A press becomes a drag once the pointer moves this many CSS pixels; less is a click or a tap. */
const TAP_SLOP: Readonly<Record<string, number>> = { mouse: 4, pen: 6, touch: 12 }
const TAP_MS = 500
/** Two taps this close in time, and within twice the slop of each other, make a double-click. */
const DOUBLE_TAP_MS = 400

interface Box {
  width: number
  height: number
}

interface Press {
  id: number
  type: string
  x: number
  y: number
  time: number
  /** Where the press started, in frame units: the dragged line's start. */
  from: LightPoint
  dragging: boolean
}

function fitBox(stage: Box, aspect: ExportAspect): Box {
  const frame = EXPORT_SIZES[aspect]
  const scale = Math.min(
    Math.max(1, stage.width - 2 * STAGE_PADDING) / frame.width,
    Math.max(1, stage.height - 2 * STAGE_PADDING) / frame.height,
  )
  return { width: Math.max(1, Math.floor(frame.width * scale)), height: Math.max(1, Math.floor(frame.height * scale)) }
}

function renderSize(box: Box, pixelRatio: number): Box {
  const width = box.width * pixelRatio
  const height = box.height * pixelRatio
  const scale = Math.min(1, MAX_LONG_SIDE / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const slopFor = (pointerType: string) => TAP_SLOP[pointerType] ?? TAP_SLOP.touch

/** The pointer's place on the frame in frame units: x from the left edge, y from the top edge. */
function framePoint(event: PointerEvent<HTMLElement>): LightPoint {
  const rect = event.currentTarget.getBoundingClientRect()
  return [(event.clientX - rect.left) / Math.max(rect.width, 1), (event.clientY - rect.top) / Math.max(rect.height, 1)]
}

const percent = (value: number) => `${(value * 100).toFixed(3)}%`

export interface PreviewProps {
  scene: Scene
  aspect: ExportAspect
  paused: boolean
  /** The line being dragged on the image, from the press point to the pointer, in frame units: at most once per animation frame. */
  onDrag: (line: LightDrag) => void
  /** A drag on the image starts (true) or ends (false). A click without moving is not a drag. */
  onDragging: (dragging: boolean) => void
  /** A double-click or double-tap on the image. */
  onReset: () => void
}

export function Preview({ scene, aspect, paused, onDrag, onDragging, onReset }: PreviewProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(SVGLineElement | null)[]>([])
  const loopRef = useRef<PreviewLoop | null>(null)
  const attemptsRef = useRef(0)
  const handlersRef = useRef({ onDrag, onDragging, onReset })
  const pressRef = useRef<Press | null>(null)
  const pendingRef = useRef<LightDrag | null>(null)
  const lineFrameRef = useRef(0)
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const [stage, setStage] = useState<Box | null>(null)
  const [generation, setGeneration] = useState(0)
  const [pressed, setPressed] = useState(false)
  const [dragging, setDragging] = useState(false)
  const box = stage ? fitBox(stage, aspect) : null
  const boxWidth = box?.width ?? 0
  const boxHeight = box?.height ?? 0

  useLayoutEffect(() => {
    handlersRef.current = { onDrag, onDragging, onReset }
  })

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setStage((previous) => (previous && previous.width === width && previous.height === height ? previous : { width, height }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // A canvas keeps its context after it is lost, so every renderer gets a new canvas.
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const canvas = document.createElement('canvas')
    canvas.className = 'tool-canvas'
    frame.appendChild(canvas)
    const retry = (delay: number) => {
      if (attemptsRef.current >= MAX_RENDERER_ATTEMPTS) return
      attemptsRef.current++
      setTimeout(() => setGeneration((value) => value + 1), delay)
    }
    let loop: PreviewLoop | null = null
    try {
      loop = new PreviewLoop(canvas, () => retry(50))
    } catch (error) {
      console.error('Preview renderer could not start', error)
      retry(1000)
    }
    loopRef.current = loop
    return () => {
      loop?.dispose()
      canvas.remove()
      if (loopRef.current === loop) loopRef.current = null
    }
  }, [generation])

  useEffect(() => {
    const loop = loopRef.current
    if (!loop || boxWidth < 1 || boxHeight < 1) return
    const size = renderSize({ width: boxWidth, height: boxHeight }, window.devicePixelRatio || 1)
    loop.update(scene, size.width, size.height)
    attemptsRef.current = 0
  }, [scene, boxWidth, boxHeight, generation])

  useEffect(() => {
    loopRef.current?.setPaused(paused)
  }, [paused, generation])

  useEffect(() => () => cancelAnimationFrame(lineFrameRef.current), [])

  const drawLine = (line: LightDrag) => {
    for (const element of lineRefs.current) {
      element?.setAttribute('x1', percent(line.from[0]))
      element?.setAttribute('y1', percent(line.from[1]))
      element?.setAttribute('x2', percent(line.to[0]))
      element?.setAttribute('y2', percent(line.to[1]))
    }
  }

  const sendLine = () => {
    lineFrameRef.current = 0
    const line = pendingRef.current
    pendingRef.current = null
    if (!line) return
    drawLine(line)
    handlersRef.current.onDrag(line)
  }

  const queueLine = (line: LightDrag) => {
    pendingRef.current = line
    if (!lineFrameRef.current) lineFrameRef.current = requestAnimationFrame(sendLine)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (pressRef.current || !event.isPrimary || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pressRef.current = { id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY, time: event.timeStamp, from: framePoint(event), dragging: false }
    setPressed(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current
    if (!press || event.pointerId !== press.id) return
    const line = { from: press.from, to: framePoint(event) }
    if (!press.dragging) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) <= slopFor(press.type)) return
      press.dragging = true
      drawLine(line)
      setDragging(true)
      handlersRef.current.onDragging(true)
    }
    queueLine(line)
  }

  const finishPress = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const press = pressRef.current
    if (!press || event.pointerId !== press.id) return
    pressRef.current = null
    if (lineFrameRef.current) {
      cancelAnimationFrame(lineFrameRef.current)
      sendLine()
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setPressed(false)
    if (press.dragging) {
      lastTapRef.current = null
      setDragging(false)
      handlersRef.current.onDragging(false)
      return
    }
    // A click or tap does nothing on its own; two in a row return the light to the seed's own direction and reach.
    const tap = !cancelled && event.timeStamp - press.time < TAP_MS
    const last = lastTapRef.current
    const double = tap && last !== null && event.timeStamp - last.time < DOUBLE_TAP_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) <= 2 * slopFor(press.type)
    lastTapRef.current = tap && !double ? { time: event.timeStamp, x: event.clientX, y: event.clientY } : null
    if (double) handlersRef.current.onReset()
  }

  const frameStyle: CSSProperties = {
    ...(box ? { width: box.width, height: box.height } : { visibility: 'hidden' }),
    position: 'relative',
    cursor: pressed ? 'grabbing' : 'grab',
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTouchCallout: 'none',
  }

  return (
    <div ref={stageRef} className="tool-stage">
      <div
        ref={frameRef}
        className="tool-frame"
        style={frameStyle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishPress(event, false)}
        onPointerCancel={(event) => finishPress(event, true)}
        onLostPointerCapture={(event) => finishPress(event, true)}
      >
        <svg
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', display: dragging ? 'block' : 'none' }}
        >
          <line ref={(element) => void (lineRefs.current[0] = element)} stroke="rgba(0, 0, 0, 0.35)" strokeWidth={3} strokeLinecap="round" />
          <line ref={(element) => void (lineRefs.current[1] = element)} stroke="rgba(255, 255, 255, 0.9)" strokeWidth={1.25} strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )
}
