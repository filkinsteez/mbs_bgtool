'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  Box,
  Image as ImageIcon,
} from 'lucide-react'
import { MaterialModelViewer } from '@/components/background/MaterialModelViewer'
import { MATERIAL_MODEL_SETTLE_VIEW_EVENT } from '@/components/background/materialModelEvents'
import {
  artworkContainsPoint,
  moveGradientCenter,
  moveSubject,
  rotateSubject,
  scaleSubjectFromCorner,
  subjectBox,
  type Corner,
} from '@/features/background-generator/canvasGeometry'
import {
  materialBaseColor,
  type BackgroundRecipePatch,
  type GeneratorMode,
  type SubjectTransform,
} from '@/features/background-generator/recipe'
import { resolvePaletteMix } from '@/features/background-generator/gradientControls'
import {
  renderBackground2DCanvas,
  resolveBackground2DInputs,
} from '@/features/background-generator/render2d'
import { useBackgroundStore } from '@/features/background-generator/store'

type SnapGuides = { x?: number; y?: number }
type Hud = { x: number; y: number; text: string }

type Gesture =
  | {
      kind: 'move'
      pointerId: number
      startX: number
      startY: number
      transform: SubjectTransform
      width: number
      height: number
    }
  | {
      kind: 'scale'
      pointerId: number
      corner: Corner
      transform: SubjectTransform
      rect: DOMRect
    }
  | {
      kind: 'rotate'
      pointerId: number
      transform: SubjectTransform
      rect: DOMRect
      centerX: number
      centerY: number
      startX: number
      startY: number
    }
  | {
      kind: 'source'
      pointerId: number
      startX: number
      startY: number
      sourceId: 'primary' | 'secondary' | 'tertiary'
      source: { x: number; y: number }
      baseReflow: number
      width: number
      height: number
      rotation: number
    }

const FIT_PADDING_X = 80
const FIT_PADDING_TOP = 32
const FIT_PADDING_BOTTOM = 76
const MODE_OPTIONS = [
  {
    mode: 'background',
    label: '2D Texture',
    tooltip: 'Edit the 2D texture layer',
    Icon: ImageIcon,
  },
  {
    mode: 'material',
    label: '3D Logo',
    tooltip: 'Edit the 3D logo source',
    Icon: Box,
  },
] as const
export const LAB_CANVAS_MODE_REQUEST_EVENT = 'mbs:canvas-mode-request'

const RESIZE_CURSORS = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'] as const
const CORNER_NAMES: Record<Corner, string> = {
  nw: 'top left',
  ne: 'top right',
  sw: 'bottom left',
  se: 'bottom right',
}

function resizeCursor(corner: Corner, rotation: number): string {
  const offset = corner === 'ne' || corner === 'sw' ? 2 : 0
  const step = Math.round(rotation / 45)
  return RESIZE_CURSORS[((step + offset) % 4 + 4) % 4]
}

function rotateCursor(corner: Corner, rotation: number): string {
  const cornerRotation = { nw: 270, ne: 0, se: 90, sw: 180 }[corner]
  const angle = cornerRotation + rotation
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">',
    `<g transform="rotate(${angle} 12 12)">`,
    '<path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" fill="none" stroke="#000" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
    '<path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    '</g></svg>',
  ].join('')
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`
}

function editableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return !!element && (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.tagName === 'BUTTON' ||
    element.tagName === 'A' ||
    element.isContentEditable
  )
}

function transformPatch(
  mode: GeneratorMode,
  transform: SubjectTransform,
): BackgroundRecipePatch {
  return {
    transforms: mode === 'background'
      ? { background: transform }
      : { material: transform },
  }
}

export function LabCanvas() {
  const recipe = useBackgroundStore((state) => state.recipe)
  const mode = useBackgroundStore((state) => state.mode)
  const transform = recipe.transforms[mode]
  const paletteMix = resolvePaletteMix(recipe.paletteState).mix
  const sourceCount = Math.max(1, Math.min(3, paletteMix.length))
  const activeSources = recipe.gradientState.field.sources.slice(0, sourceCount)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)
  const gestureRef = useRef<Gesture | null>(null)
  const captureTargetRef = useRef<Element | null>(null)
  const keyboardTransactionRef = useRef(false)
  const gradientHandleFadeRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [wrapSize, setWrapSize] = useState({ w: 0, h: 0 })
  const [guides, setGuides] = useState<SnapGuides>({})
  const [hud, setHud] = useState<Hud | null>(null)
  const [artworkSelected, setArtworkSelected] = useState(true)
  const [gradientHandleVisible, setGradientHandleVisible] = useState(false)

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      setWrapSize({ w: rect.width, h: rect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => {
    if (gradientHandleFadeRef.current) {
      clearTimeout(gradientHandleFadeRef.current)
    }
  }, [])

  const draw = useCallback(
    () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const background = useBackgroundStore.getState()
      const liveRecipe = background.recipe
      if (background.mode === 'material') {
        const inputs = resolveBackground2DInputs(liveRecipe, {
          phase: 'preview',
          maxLongEdge: 1200,
        })
        if (canvas.width !== inputs.lab.output.width) canvas.width = inputs.lab.output.width
        if (canvas.height !== inputs.lab.output.height) canvas.height = inputs.lab.output.height
        const context = canvas.getContext('2d')
        if (!context) return
        context.setTransform(1, 0, 0, 1, 0, 0)
        context.fillStyle = materialBaseColor(liveRecipe)
        context.fillRect(0, 0, canvas.width, canvas.height)
        return
      }
      renderBackground2DCanvas(canvas, liveRecipe, {
        phase: 'preview',
        maxLongEdge: 1200,
      })
    },
    [],
  )

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => draw())
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw, recipe, mode])

  const fitHeight = Math.max(1, wrapSize.h - FIT_PADDING_TOP - FIT_PADDING_BOTTOM)
  const viewportCenterX = wrapSize.w * 0.5
  const viewportCenterY = FIT_PADDING_TOP + fitHeight * 0.5
  const fitScale = Math.max(
    0.02,
    Math.min(
      1,
      (wrapSize.w - FIT_PADDING_X) / Math.max(1, recipe.format.width),
      fitHeight / Math.max(1, recipe.format.height),
    ),
  )
  const displayScale = fitScale
  const stackWidth = recipe.format.width * displayScale
  const stackHeight = recipe.format.height * displayScale
  const stackLeft = viewportCenterX - stackWidth * 0.5
  const stackTop = viewportCenterY - stackHeight * 0.5
  const box = subjectBox(transform, stackWidth, stackHeight)
  const sourceGesture = {
    width: box.width,
    height: box.height,
    rotation: box.rotation,
  }
  const gradientAngle = (box.rotation * Math.PI) / 180
  const sourceHandles = activeSources.map((source, index) => {
    const localX = (source.x - 0.5) * box.width
    const localY = (source.y - 0.5) * box.height
    return {
      id: source.id,
      source,
      color: paletteMix[Math.min(index, paletteMix.length - 1)]?.color ?? '#ffffff',
      x: box.centerX + localX * Math.cos(gradientAngle) - localY * Math.sin(gradientAngle),
      y: box.centerY + localX * Math.sin(gradientAngle) + localY * Math.cos(gradientAngle),
      index,
    }
  })

  const setTransformTransient = (next: SubjectTransform) => {
    useBackgroundStore.getState().setTransient(transformPatch(mode, next))
  }

  const setSpatialSourceTransient = (
    sourceId: 'primary' | 'secondary' | 'tertiary',
    source: { x: number; y: number },
    energy = 0,
    reflow = recipe.gradientState.controls.position,
  ) => {
    const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
    const liveField = useBackgroundStore.getState().recipe.gradientState.field
    const movedFrom = liveField.sources.find((entry) => entry.id === sourceId)
    const dx = source.x - (movedFrom?.x ?? source.x)
    const dy = source.y - (movedFrom?.y ?? source.y)
    const pulse = Math.max(0, Math.min(1, energy))
    const movedSpread = clamp01((movedFrom?.spread ?? 0.5) + pulse * 0.16)
    const nextSources = liveField.sources.map((entry) => {
      if (entry.id === sourceId) {
        return { ...entry, x: source.x, y: source.y, spread: movedSpread }
      }
      const distance = Math.hypot(entry.x - source.x, entry.y - source.y)
      const follow = Math.exp(-distance * 5.5) * (0.1 + pulse * 0.22)
      const spreadLift = Math.exp(-distance * 4.2) * pulse * 0.08
      return {
        ...entry,
        x: clamp01(entry.x + dx * follow),
        y: clamp01(entry.y + dy * follow),
        spread: clamp01(entry.spread + spreadLift),
      }
    })
    const activeCount = Math.max(1, Math.min(3, sourceCount))
    const active = nextSources.slice(0, activeCount)
    const fallbackCenter = active.reduce(
      (acc, item) => ({ x: acc.x + item.x / activeCount, y: acc.y + item.y / activeCount }),
      { x: 0, y: 0 },
    )
    useBackgroundStore.getState().setTransient({
      gradientState: {
        // Keep the legacy center in sync so drag feedback remains visible while
        // the procedural renderer is still the production default.
        center: fallbackCenter,
        controls: {
          ...recipe.gradientState.controls,
          position: Math.max(0, Math.min(1, reflow)),
        },
        field: {
          ...recipe.gradientState.field,
          sources: nextSources as typeof recipe.gradientState.field.sources,
        },
      },
    })
  }

  const holdGradientHandle = useCallback(() => {
    if (gradientHandleFadeRef.current) {
      clearTimeout(gradientHandleFadeRef.current)
      gradientHandleFadeRef.current = null
    }
    setGradientHandleVisible(true)
  }, [])

  const fadeGradientHandle = useCallback((delay = 700) => {
    // Handles should stay visible while the 2D artwork is selected.
    if (mode === 'background' && artworkSelected) return
    if (gradientHandleFadeRef.current) {
      clearTimeout(gradientHandleFadeRef.current)
    }
    gradientHandleFadeRef.current = setTimeout(() => {
      gradientHandleFadeRef.current = null
      setGradientHandleVisible(false)
    }, delay)
  }, [artworkSelected, mode])

  const revealGradientHandle = useCallback(() => {
    if (mode !== 'background' || !artworkSelected) return
    holdGradientHandle()
    fadeGradientHandle(900)
  }, [artworkSelected, fadeGradientHandle, holdGradientHandle, mode])

  const showHud = (event: ReactPointerEvent, text: string) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    setHud({
      x: event.clientX - (rect?.left ?? 0) + 12,
      y: event.clientY - (rect?.top ?? 0) + 12,
      text,
    })
  }

  const beginGesture = (
    event: ReactPointerEvent,
    gesture: Gesture,
    transactional = true,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    wrapRef.current?.focus({ preventScroll: true })
    gestureRef.current = gesture
    if (transactional) useBackgroundStore.getState().beginTransaction()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
      captureTargetRef.current = event.currentTarget
    } catch {
      // Automation and synthetic pointers may not be capturable.
    }
  }

  const startMove = (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    beginGesture(event, {
      kind: 'move',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      transform,
      width: stackWidth,
      height: stackHeight,
    })
  }

  const startScale = (event: ReactPointerEvent, corner: Corner) => {
    if (event.button !== 0) return
    const rect = stackRef.current?.getBoundingClientRect()
    if (!rect) return
    beginGesture(event, {
      kind: 'scale',
      pointerId: event.pointerId,
      corner,
      transform,
      rect,
    })
  }

  const startRotate = (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    const rect = stackRef.current?.getBoundingClientRect()
    if (!rect) return
    beginGesture(event, {
      kind: 'rotate',
      pointerId: event.pointerId,
      transform,
      rect,
      centerX: box.centerX,
      centerY: box.centerY,
      startX: event.clientX - rect.left,
      startY: event.clientY - rect.top,
    })
  }

  const startSourceMove = (
    event: ReactPointerEvent,
    sourceId: 'primary' | 'secondary' | 'tertiary',
    source: { x: number; y: number },
  ) => {
    if (event.button !== 0) return
    holdGradientHandle()
    beginGesture(event, {
      kind: 'source',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      sourceId,
      source,
      baseReflow: recipe.gradientState.controls.position,
      ...sourceGesture,
    })
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as Element
    if (target.closest('[data-mbs-material-model="true"]')) return
    wrapRef.current?.focus({ preventScroll: true })
    if (event.button !== 0 || mode !== 'background') return

    if (target.closest('.lab-mode-switch')) return
    const rect = stackRef.current?.getBoundingClientRect()
    const hitArtwork = !!rect && artworkContainsPoint(
      transform,
      rect.width,
      rect.height,
      event.clientX - rect.left,
      event.clientY - rect.top,
    )
    if (hitArtwork) {
      setArtworkSelected(true)
      holdGradientHandle()
      fadeGradientHandle(1800)
      startMove(event)
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setArtworkSelected(false)
    if (gradientHandleFadeRef.current) {
      clearTimeout(gradientHandleFadeRef.current)
      gradientHandleFadeRef.current = null
    }
    setGradientHandleVisible(false)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (gesture?.kind === 'source') holdGradientHandle()
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.kind === 'source') {
      const source = moveGradientCenter(
        gesture.source,
        event.clientX - gesture.startX,
        event.clientY - gesture.startY,
        gesture.width,
        gesture.height,
        gesture.rotation,
      )
      const dragPixels = Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY,
      )
      const dragEnergy = Math.max(0, Math.min(1, dragPixels / 180))
      const dragReflow = Math.max(0, Math.min(1, gesture.baseReflow + dragEnergy * 0.25))
      setSpatialSourceTransient(gesture.sourceId, source, dragEnergy, dragReflow)
      showHud(
        event,
        `Source X ${Math.round(source.x * 100)}% · Y ${Math.round(source.y * 100)}% · Flow ${Math.round(dragReflow * 100)}%`,
      )
      return
    }
    if (gesture.kind === 'move') {
      const result = moveSubject(
        gesture.transform,
        event.clientX - gesture.startX,
        event.clientY - gesture.startY,
        gesture.width,
        gesture.height,
        event.shiftKey,
        !event.ctrlKey,
      )
      setTransformTransient(result.transform)
      setGuides({ x: result.guideX, y: result.guideY })
      showHud(
        event,
        `X ${Math.round(result.transform.x * 100)}% · Y ${Math.round(result.transform.y * 100)}%`,
      )
      return
    }
    if (gesture.kind === 'scale') {
      const result = scaleSubjectFromCorner(
        gesture.transform,
        gesture.corner,
        gesture.rect.width,
        gesture.rect.height,
        event.clientX - gesture.rect.left,
        event.clientY - gesture.rect.top,
        event.altKey,
        !event.ctrlKey,
      )
      setTransformTransient(result.transform)
      setGuides({ x: result.guideX, y: result.guideY })
      showHud(event, `${Math.round(result.transform.scale * 100)}%`)
      return
    }
    if (gesture.kind === 'rotate') {
      const next = rotateSubject(
        gesture.transform,
        gesture.centerX,
        gesture.centerY,
        gesture.startX,
        gesture.startY,
        event.clientX - gesture.rect.left,
        event.clientY - gesture.rect.top,
        event.shiftKey,
      )
      setTransformTransient(next)
      showHud(event, `${Math.round(next.rotation * 10) / 10}°`)
    }
  }

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    setGuides({})
    setHud(null)

    if (
      gesture.kind === 'move'
      || gesture.kind === 'scale'
      || gesture.kind === 'rotate'
      || gesture.kind === 'source'
    ) {
      if (cancelled) useBackgroundStore.getState().cancelTransaction()
      else useBackgroundStore.getState().commitTransaction()
    }
    if (gesture.kind === 'source') fadeGradientHandle()

    try {
      captureTargetRef.current?.releasePointerCapture(event.pointerId)
    } catch {
      // Capture may already be lost.
    } finally {
      captureTargetRef.current = null
    }
  }

  const cancelActiveGesture = useCallback(() => {
    const gesture = gestureRef.current
    if (!gesture) return false
    gestureRef.current = null
    try {
      captureTargetRef.current?.releasePointerCapture(gesture.pointerId)
    } catch {
      // Capture may already be lost.
    } finally {
      captureTargetRef.current = null
    }
    setGuides({})
    setHud(null)
    if (
      gesture.kind === 'move'
      || gesture.kind === 'scale'
      || gesture.kind === 'rotate'
      || gesture.kind === 'source'
    ) {
      useBackgroundStore.getState().cancelTransaction()
    }
    if (gesture.kind === 'source') fadeGradientHandle()
    return true
  }, [fadeGradientHandle])

  const changeMode = (nextMode: GeneratorMode) => {
    if (nextMode === mode) return
    cancelActiveGesture()
    if (mode === 'material') {
      window.dispatchEvent(new Event(MATERIAL_MODEL_SETTLE_VIEW_EVENT))
    }
    if (keyboardTransactionRef.current) {
      keyboardTransactionRef.current = false
      useBackgroundStore.getState().commitTransaction()
    }
    useBackgroundStore.getState().setMode(nextMode)
  }

  useEffect(() => {
    const finishKeyboardTransaction = () => {
      if (!keyboardTransactionRef.current) return
      keyboardTransactionRef.current = false
      useBackgroundStore.getState().commitTransaction()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === 'Escape') {
        const target = event.target as HTMLElement | null
        const canvasButton = target?.tagName === 'BUTTON' && !!wrapRef.current?.contains(target)
        if (editableTarget(target) && !canvasButton) return
        if (cancelActiveGesture()) return
        if (mode === 'background' && artworkSelected) {
          setArtworkSelected(false)
          if (gradientHandleFadeRef.current) {
            clearTimeout(gradientHandleFadeRef.current)
            gradientHandleFadeRef.current = null
          }
          setGradientHandleVisible(false)
          requestAnimationFrame(() => wrapRef.current?.focus())
        }
        return
      }
      if (editableTarget(event.target)) return
      const key = event.key.toLowerCase()
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (key === 'v' && mode === 'background') {
          setArtworkSelected(true)
          holdGradientHandle()
          fadeGradientHandle(1800)
        }
      }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      if (mode !== 'background' || !artworkSelected) return
      event.preventDefault()
      if (!keyboardTransactionRef.current) {
        keyboardTransactionRef.current = true
        useBackgroundStore.getState().beginTransaction()
      }
      const step = event.shiftKey ? 10 : 1
      const live = useBackgroundStore.getState()
      const current = live.recipe.transforms[live.mode]
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
      const result = moveSubject(
        current,
        dx,
        dy,
        stackWidth,
        stackHeight,
        false,
        !event.ctrlKey,
      )
      live.setTransient(transformPatch(live.mode, result.transform))
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (
        keyboardTransactionRef.current &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      ) {
        finishKeyboardTransaction()
      }
    }
    const onWindowBlur = () => {
      cancelActiveGesture()
      finishKeyboardTransaction()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') onWindowBlur()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      finishKeyboardTransaction()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [
    cancelActiveGesture,
    mode,
    stackHeight,
    stackWidth,
    artworkSelected,
    holdGradientHandle,
    fadeGradientHandle,
  ])

  const selectModeWithKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex = currentIndex
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + MODE_OPTIONS.length) % MODE_OPTIONS.length
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % MODE_OPTIONS.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = MODE_OPTIONS.length - 1
    } else {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const next = MODE_OPTIONS[nextIndex]
    changeMode(next.mode)
    requestAnimationFrame(() => document.getElementById(`lab-mode-${next.mode}`)?.focus())
  }

  useEffect(() => {
    const onModeRequest = (event: Event) => {
      const requested = (event as CustomEvent<{ mode?: GeneratorMode }>).detail?.mode
      if (requested !== 'background' && requested !== 'material') return
      changeMode(requested)
    }
    window.addEventListener(LAB_CANVAS_MODE_REQUEST_EVENT, onModeRequest)
    return () => window.removeEventListener(LAB_CANVAS_MODE_REQUEST_EVENT, onModeRequest)
  }, [changeMode])

  return (
    <div className="lab-stage-inner">
      <div
        ref={wrapRef}
        className="lab-canvas-wrap"
        role="region"
        aria-label={`${mode === 'background' ? '2D' : '3D'} design canvas`}
        aria-describedby="lab-canvas-instructions"
        aria-keyshortcuts={mode === 'background' ? 'V' : 'R'}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finishPointer(event, false)}
        onPointerCancel={(event) => finishPointer(event, true)}
        onLostPointerCapture={(event) => finishPointer(event, false)}
        onPointerLeave={() => {
          if (gestureRef.current?.kind !== 'source') fadeGradientHandle(200)
        }}
      >
        <p id="lab-canvas-instructions" className="lab-visually-hidden">
          {mode === 'background'
            ? 'Click the artwork or press V to select it. Click empty canvas or press Escape to deselect. Drag the artwork to move it, drag color source handles to shape the gradient, and use the corner controls to scale or rotate. Arrow keys nudge the focused control; Shift uses larger steps.'
            : 'Drag to orbit the 3D logo. Scroll over the logo to zoom the 3D view. Press R to reset the 3D view.'}
        </p>
        <div
          ref={stackRef}
          id="lab-generator-artboard"
          className="lab-canvas-stack"
          data-measured={wrapSize.w > 0 && wrapSize.h > 0 ? 'true' : 'false'}
          style={{
            left: stackLeft,
            top: stackTop,
            width: stackWidth,
            height: stackHeight,
            visibility: wrapSize.w > 0 && wrapSize.h > 0 ? 'visible' : 'hidden',
          }}
        >
          <canvas
            ref={canvasRef}
            className="lab-canvas"
            data-renderer={mode === 'background' ? 'looks' : 'material'}
            aria-hidden
          />
          {mode === 'material' ? (
            <MaterialModelViewer />
          ) : null}

          {mode === 'background' && artworkSelected ? (
            <div
              className="lab-subject-frame"
              role="group"
              aria-label="2D artwork selected"
              style={{
                left: box.centerX - box.width / 2,
                top: box.centerY - box.height / 2,
                width: box.width,
                height: box.height,
                transform: `rotate(${box.rotation}deg)`,
              }}
            >
              {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                <button
                  key={corner}
                  type="button"
                  className={`lab-transform-handle corner-${corner}`}
                  role="slider"
                  aria-label={`Scale artwork from ${CORNER_NAMES[corner]}`}
                  aria-valuemin={10}
                  aria-valuemax={1200}
                  aria-valuenow={Math.round(transform.scale * 100)}
                  aria-valuetext={`${Math.round(transform.scale * 100)} percent`}
                  tabIndex={0}
                  title="Drag to resize. Hold Alt to resize from the center."
                  style={{ cursor: resizeCursor(corner, transform.rotation) }}
                  onPointerDown={(event) => startScale(event, corner)}
                  onKeyDown={(event) => {
                    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
                    event.preventDefault()
                    event.stopPropagation()
                    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
                    const store = useBackgroundStore.getState()
                    if (!keyboardTransactionRef.current) {
                      keyboardTransactionRef.current = true
                      store.beginTransaction()
                    }
                    store.setTransient(transformPatch(mode, {
                      ...transform,
                      preset: 'free',
                      scale: transform.scale + direction * (event.shiftKey ? 0.1 : 0.01),
                    }))
                  }}
                />
              ))}
              {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                <button
                  key={`rotate-${corner}`}
                  type="button"
                  className={`lab-rotation-zone corner-${corner}`}
                  role={corner === 'nw' ? 'slider' : undefined}
                  aria-label={corner === 'nw' ? 'Rotate artwork' : undefined}
                  aria-hidden={corner === 'nw' ? undefined : true}
                  aria-valuemin={corner === 'nw' ? -180 : undefined}
                  aria-valuemax={corner === 'nw' ? 180 : undefined}
                  aria-valuenow={corner === 'nw' ? Math.round(transform.rotation) : undefined}
                  aria-valuetext={corner === 'nw' ? `${Math.round(transform.rotation)} degrees` : undefined}
                  tabIndex={corner === 'nw' ? 0 : -1}
                  title="Drag outside the corner to rotate. Hold Shift to snap to 15 degrees."
                  style={{ cursor: rotateCursor(corner, transform.rotation) }}
                  onPointerDown={startRotate}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
                    event.preventDefault()
                    event.stopPropagation()
                    const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1
                    const store = useBackgroundStore.getState()
                    if (!keyboardTransactionRef.current) {
                      keyboardTransactionRef.current = true
                      store.beginTransaction()
                    }
                    store.setTransient(transformPatch('background', {
                      ...transform,
                      preset: 'free',
                      rotation: transform.rotation + direction * (event.shiftKey ? 15 : 1),
                    }))
                  }}
                />
              ))}
            </div>
          ) : null}

          {mode === 'background' && artworkSelected ? sourceHandles.map((handle) => (
            <button
              key={handle.id}
              type="button"
              className={`lab-gradient-position-handle${gradientHandleVisible ? ' visible' : ''}`}
              data-gradient-position="true"
              data-gradient-x={Math.round(handle.source.x * 100)}
              data-gradient-y={Math.round(handle.source.y * 100)}
              aria-label={`Move color source ${handle.index + 1}`}
              aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
              title="Drag to reposition this color source."
              style={{
                left: handle.x,
                top: handle.y,
                backgroundColor: handle.color,
              }}
              onPointerDown={(event) => startSourceMove(event, handle.id, handle.source)}
              onPointerEnter={revealGradientHandle}
              onPointerMove={() => {
                if (gestureRef.current?.kind !== 'source') revealGradientHandle()
              }}
              onPointerLeave={() => {
                if (gestureRef.current?.kind !== 'source') fadeGradientHandle(150)
              }}
              onFocus={holdGradientHandle}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
                event.preventDefault()
                event.stopPropagation()
                const store = useBackgroundStore.getState()
                if (!keyboardTransactionRef.current) {
                  keyboardTransactionRef.current = true
                  store.beginTransaction()
                }
                const step = (event.shiftKey ? 0.1 : 0.01)
                  * Math.min(sourceGesture.width, sourceGesture.height)
                const liveSource = store.recipe.gradientState.field.sources.find((source) => source.id === handle.id)
                if (!liveSource) return
                const next = moveGradientCenter(
                  liveSource,
                  event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
                  event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
                  sourceGesture.width,
                  sourceGesture.height,
                  sourceGesture.rotation,
                )
                const nextSources = store.recipe.gradientState.field.sources.map((source) =>
                  source.id === handle.id ? { ...source, x: next.x, y: next.y } : source)
                const activeCount = Math.max(1, Math.min(3, sourceCount))
                const active = nextSources.slice(0, activeCount)
                const fallbackCenter = active.reduce(
                  (acc, item) => ({
                    x: acc.x + item.x / activeCount,
                    y: acc.y + item.y / activeCount,
                  }),
                  { x: 0, y: 0 },
                )
                store.setTransient({
                  gradientState: {
                    center: fallbackCenter,
                    field: {
                      ...store.recipe.gradientState.field,
                      sources: nextSources as typeof store.recipe.gradientState.field.sources,
                    },
                  },
                })
              }}
              onBlur={() => {
                if (keyboardTransactionRef.current) {
                  keyboardTransactionRef.current = false
                  useBackgroundStore.getState().commitTransaction()
                }
                fadeGradientHandle()
              }}
            />
          )) : null}

          {guides.x !== undefined ? (
            <span className="lab-snap-guide vertical" style={{ left: guides.x }} />
          ) : null}
          {guides.y !== undefined ? (
            <span className="lab-snap-guide horizontal" style={{ top: guides.y }} />
          ) : null}
        </div>

        {hud ? (
          <div
            className="lab-transform-hud"
            aria-hidden="true"
            style={{
              left: hud.x,
              top: hud.y,
            }}
          >
            {hud.text}
          </div>
        ) : null}
      </div>
    </div>
  )
}
