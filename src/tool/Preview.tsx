import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { EXPORT_SIZES, type ExportAspect, type Scene } from '@/light'
import type { LightPoint } from './controls'
import { PreviewLoop } from './previewLoop'

const MAX_LONG_SIDE = 2560
const STAGE_PADDING = 32
const MAX_RENDERER_ATTEMPTS = 5
/** A press that moves less than this many CSS pixels and ends within TAP_MS is a click or a tap. */
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
  moved: boolean
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

export interface PreviewProps {
  scene: Scene
  aspect: ExportAspect
  paused: boolean
  /** The pointer's place on the image, in frame units, while it is pressed: at most once per animation frame. */
  onPoint: (point: LightPoint) => void
  /** A press on the image starts (true) or ends (false). */
  onPress: (pressed: boolean) => void
  /** A double-click or double-tap on the image. */
  onReset: () => void
}

export function Preview({ scene, aspect, paused, onPoint, onPress, onReset }: PreviewProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const loopRef = useRef<PreviewLoop | null>(null)
  const attemptsRef = useRef(0)
  const handlersRef = useRef({ onPoint, onPress, onReset })
  const pressRef = useRef<Press | null>(null)
  const pendingRef = useRef<LightPoint | null>(null)
  const pointFrameRef = useRef(0)
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const [stage, setStage] = useState<Box | null>(null)
  const [generation, setGeneration] = useState(0)
  const [pressed, setPressed] = useState(false)
  const box = stage ? fitBox(stage, aspect) : null
  const boxWidth = box?.width ?? 0
  const boxHeight = box?.height ?? 0

  useLayoutEffect(() => {
    handlersRef.current = { onPoint, onPress, onReset }
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

  useEffect(() => () => cancelAnimationFrame(pointFrameRef.current), [])

  const sendPoint = () => {
    pointFrameRef.current = 0
    const point = pendingRef.current
    pendingRef.current = null
    if (point) handlersRef.current.onPoint(point)
  }

  const queuePoint = (point: LightPoint) => {
    pendingRef.current = point
    if (!pointFrameRef.current) pointFrameRef.current = requestAnimationFrame(sendPoint)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (pressRef.current || !event.isPrimary || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pressRef.current = { id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY, time: event.timeStamp, moved: false }
    setPressed(true)
    handlersRef.current.onPress(true)
    queuePoint(framePoint(event))
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current
    if (!press || event.pointerId !== press.id) return
    if (!press.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) > slopFor(press.type)) press.moved = true
    queuePoint(framePoint(event))
  }

  const finishPress = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const press = pressRef.current
    if (!press || event.pointerId !== press.id) return
    pressRef.current = null
    if (pointFrameRef.current) {
      cancelAnimationFrame(pointFrameRef.current)
      sendPoint()
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const tap = !cancelled && !press.moved && event.timeStamp - press.time < TAP_MS
    const last = lastTapRef.current
    const double = tap && last !== null && event.timeStamp - last.time < DOUBLE_TAP_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) <= 2 * slopFor(press.type)
    lastTapRef.current = tap && !double ? { time: event.timeStamp, x: event.clientX, y: event.clientY } : null
    if (double) handlersRef.current.onReset()
    setPressed(false)
    handlersRef.current.onPress(false)
  }

  const frameStyle: CSSProperties = {
    ...(box ? { width: box.width, height: box.height } : { visibility: 'hidden' }),
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
      />
    </div>
  )
}
