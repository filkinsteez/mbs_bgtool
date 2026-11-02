import { useEffect, useRef, useState } from 'react'
import { EXPORT_SIZES, type ExportAspect, type Scene } from '@/light'
import { PreviewLoop } from './previewLoop'

const MAX_LONG_SIDE = 2560
const STAGE_PADDING = 32
const MAX_RENDERER_ATTEMPTS = 5

interface Box {
  width: number
  height: number
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

export function Preview({ scene, aspect, paused }: { scene: Scene; aspect: ExportAspect; paused: boolean }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const loopRef = useRef<PreviewLoop | null>(null)
  const attemptsRef = useRef(0)
  const [stage, setStage] = useState<Box | null>(null)
  const [generation, setGeneration] = useState(0)
  const box = stage ? fitBox(stage, aspect) : null
  const boxWidth = box?.width ?? 0
  const boxHeight = box?.height ?? 0

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

  return (
    <div ref={stageRef} className="tool-stage">
      <div ref={frameRef} className="tool-frame" style={box ? { width: box.width, height: box.height } : { visibility: 'hidden' }} />
    </div>
  )
}
