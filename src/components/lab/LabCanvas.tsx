'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { Box, Image as ImageIcon } from 'lucide-react'
import { MaterialModelViewer } from '@/components/background/MaterialModelViewer'
import { MATERIAL_MODEL_SETTLE_VIEW_EVENT } from '@/components/background/materialModelEvents'
import { applyMotionAt } from '@/core/lab/motion'
import { scaleLabForPreview } from '@/core/lab/preview'
import { renderLabArtwork } from '@/core/lab/render'
import { useLabStore } from '@/core/lab/labStore'
import { getLabSource } from '@/core/lab/sourceCache'
import {
  artworkContainsPoint,
  moveSubject,
  rotateSubject,
  scaleSubjectFromCorner,
  subjectBox,
  type Corner,
} from '@/features/background-generator/canvasGeometry'
import {
  dimensionsForRatio,
  materialBaseColor,
  type BackgroundRecipePatch,
  type GeneratorMode,
  type SubjectTransform,
} from '@/features/background-generator/recipe'
import { useReducedMotion } from '@/features/background-generator/motion/useReducedMotion'
import { useBackgroundStore } from '@/features/background-generator/store'
import { renderController } from '@/render/renderController'
import { resolveBankCached } from './bankCache'
import { CANVAS_ASPECT_TOOL_EVENT, CANVAS_FIT_VIEW_EVENT } from './canvasEvents'

type CanvasTool = 'select' | 'hand' | 'aspect'
type Camera = { zoom: number; panX: number; panY: number }
type SnapGuides = { x?: number; y?: number }
type Hud = { x: number; y: number; text: string }
type AspectHandle = 'n' | 'e' | 's' | 'w'
type AspectRect = { left: number; top: number; width: number; height: number }

type Gesture =
  | {
      kind: 'pan'
      pointerId: number
      startX: number
      startY: number
      camera: Camera
    }
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
      kind: 'aspect'
      pointerId: number
      handle: AspectHandle
      startX: number
      startY: number
      rect: AspectRect
    }

const CAMERA_MIN = 0.1
const CAMERA_MAX = 32
const FIT_PADDING_X = 80
const FIT_PADDING_TOP = 32
const FIT_PADDING_BOTTOM = 76
const MODE_OPTIONS = [
  {
    mode: 'background',
    label: '2D',
    tooltip: 'Edit the flat 2D artwork',
    Icon: ImageIcon,
  },
  {
    mode: 'material',
    label: '3D',
    tooltip: 'Preview the dimensional 3D material',
    Icon: Box,
  },
] as const

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

function zoomCameraAt(
  current: Camera,
  nextZoom: number,
  fitScale: number,
  centerX: number,
  centerY: number,
  pointerX: number,
  pointerY: number,
): Camera {
  const zoom = Math.max(CAMERA_MIN, Math.min(CAMERA_MAX, nextZoom))
  const currentScale = fitScale * current.zoom
  const nextScale = fitScale * zoom
  const worldX = (pointerX - centerX - current.panX) / Math.max(0.0001, currentScale)
  const worldY = (pointerY - centerY - current.panY) / Math.max(0.0001, currentScale)
  return {
    zoom,
    panX: pointerX - centerX - worldX * nextScale,
    panY: pointerY - centerY - worldY * nextScale,
  }
}

export function LabCanvas() {
  const lab = useLabStore((state) => state.lab)
  const view = useLabStore((state) => state.ui.view)
  const quality = useLabStore((state) => state.ui.quality)
  const sourceNonce = useLabStore((state) => state.ui.sourceNonce)
  const note = useLabStore((state) => state.ui.note)
  const focusedSourceId = useLabStore((state) => state.ui.focusedSourceId)
  const motionEnabled = useLabStore((state) => state.lab.motion.amount > 0)
  const recipe = useBackgroundStore((state) => state.recipe)
  const mode = useBackgroundStore((state) => state.mode)
  const transform = recipe.transforms[mode]
  const reducedMotion = useReducedMotion()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)
  const gestureRef = useRef<Gesture | null>(null)
  const captureTargetRef = useRef<Element | null>(null)
  const keyboardTransactionRef = useRef(false)
  const [wrapSize, setWrapSize] = useState({ w: 0, h: 0 })
  const [camera, setCamera] = useState<Camera>({ zoom: 1, panX: 0, panY: 0 })
  const [tool, setTool] = useState<CanvasTool>('select')
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [guides, setGuides] = useState<SnapGuides>({})
  const [hud, setHud] = useState<Hud | null>(null)
  const [aspectDraft, setAspectDraft] = useState<AspectRect | null>(null)
  const aspectDraftRef = useRef<AspectRect | null>(null)
  const [artworkSelected, setArtworkSelected] = useState(true)
  const fitView = useCallback(() => {
    setCamera({ zoom: 1, panX: 0, panY: 0 })
  }, [setCamera])

  useEffect(() => {
    window.addEventListener(CANVAS_FIT_VIEW_EVENT, fitView)
    return () => window.removeEventListener(CANVAS_FIT_VIEW_EVENT, fitView)
  }, [fitView])

  useEffect(() => {
    const activateAspect = () => setTool('aspect')
    window.addEventListener(CANVAS_ASPECT_TOOL_EVENT, activateAspect)
    return () => window.removeEventListener(CANVAS_ASPECT_TOOL_EVENT, activateAspect)
  }, [])

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

  const draw = useCallback(
    (timeMs?: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const background = useBackgroundStore.getState()
      const liveRecipe = background.recipe
      const liveLab = useLabStore.getState().lab
      const viewMode = useLabStore.getState().ui.view
      const activeLab = timeMs !== undefined ? applyMotionAt(liveLab, timeMs) : liveLab
      const previewLab = scaleLabForPreview(activeLab, quality === 'live' ? 700 : 1200)
      if (canvas.width !== previewLab.output.width) canvas.width = previewLab.output.width
      if (canvas.height !== previewLab.output.height) canvas.height = previewLab.output.height
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(1, 0, 0, 1, 0, 0)
      if (background.mode === 'material') {
        context.fillStyle = materialBaseColor(liveRecipe)
        context.fillRect(0, 0, canvas.width, canvas.height)
        return
      }
      renderLabArtwork(
        context,
        previewLab,
        getLabSource(),
        resolveBankCached(previewLab.mark.bank),
        viewMode,
        liveRecipe.transforms.background,
        focusedSourceId,
      )
    },
    [focusedSourceId, quality],
  )

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => draw())
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw, lab, mode, view, sourceNonce])

  useEffect(() => {
    if (mode !== 'background' || !motionEnabled || reducedMotion) return
    renderController.start()
    const unsubscribe = renderController.subscribe((_, time) => draw(time))
    return () => {
      unsubscribe()
      renderController.stop()
    }
  }, [draw, mode, motionEnabled, reducedMotion])

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
  const displayScale = fitScale * camera.zoom
  const stackWidth = recipe.format.width * displayScale
  const stackHeight = recipe.format.height * displayScale
  const stackLeft = viewportCenterX - stackWidth * 0.5 + camera.panX
  const stackTop = viewportCenterY - stackHeight * 0.5 + camera.panY
  const box = subjectBox(transform, stackWidth, stackHeight)
  const aspectRect = aspectDraft ?? {
    left: stackLeft,
    top: stackTop,
    width: stackWidth,
    height: stackHeight,
  }

  const setTransformTransient = (next: SubjectTransform) => {
    useBackgroundStore.getState().setTransient(transformPatch(mode, next))
  }

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
    if (tool === 'hand' || spaceHeld) {
      startPan(event)
      return
    }
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
    if (tool === 'hand' || spaceHeld) {
      startPan(event)
      return
    }
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
    if (tool === 'hand' || spaceHeld) {
      startPan(event)
      return
    }
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

  const startAspectResize = (event: ReactPointerEvent, handle: AspectHandle) => {
    if (event.button !== 0) return
    beginGesture(event, {
      kind: 'aspect',
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      rect: aspectRect,
    }, false)
  }

  const startPan = (event: ReactPointerEvent) => {
    beginGesture(event, {
      kind: 'pan',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      camera,
    }, false)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    wrapRef.current?.focus({ preventScroll: true })
    if (event.button === 1 || tool === 'hand' || spaceHeld) {
      startPan(event)
      return
    }
    if (event.button !== 0 || mode !== 'background' || tool !== 'select') return

    const target = event.target as Element
    if (target.closest('.lab-canvas-toolbar, .lab-mode-switch, .lab-aspect-frame')) return
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
      startMove(event)
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setArtworkSelected(false)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.kind === 'pan') {
      setCamera({
        ...gesture.camera,
        panX: gesture.camera.panX + event.clientX - gesture.startX,
        panY: gesture.camera.panY + event.clientY - gesture.startY,
      })
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
      return
    }

    const dx = event.clientX - gesture.startX
    const dy = event.clientY - gesture.startY
    const next = { ...gesture.rect }
    const centerX = gesture.rect.left + gesture.rect.width / 2
    const centerY = gesture.rect.top + gesture.rect.height / 2
    if (gesture.handle === 'w' || gesture.handle === 'e') {
      const direction = gesture.handle === 'e' ? 1 : -1
      next.width = Math.max(80, gesture.rect.width + dx * direction * 2)
      next.left = centerX - next.width / 2
    } else {
      const direction = gesture.handle === 's' ? 1 : -1
      next.height = Math.max(80, gesture.rect.height + dy * direction * 2)
      next.top = centerY - next.height / 2
    }
    const dimensions = dimensionsForRatio(next.width / Math.max(1, next.height))
    aspectDraftRef.current = next
    setAspectDraft(next)
    showHud(event, `${dimensions.width} × ${dimensions.height}`)
  }

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    setGuides({})
    setHud(null)

    if (gesture.kind === 'move' || gesture.kind === 'scale' || gesture.kind === 'rotate') {
      if (cancelled) useBackgroundStore.getState().cancelTransaction()
      else useBackgroundStore.getState().commitTransaction()
    } else if (gesture.kind === 'pan' && cancelled) {
      setCamera(gesture.camera)
    } else if (gesture.kind === 'aspect') {
      const draft = aspectDraftRef.current
      if (!cancelled && draft) {
        const dimensions = dimensionsForRatio(
          draft.width / Math.max(1, draft.height),
        )
        useBackgroundStore.getState().updateRecipe({
          format: { aspect: 'custom', ...dimensions },
        })
        setCamera({ zoom: 1, panX: 0, panY: 0 })
      }
      aspectDraftRef.current = null
      setAspectDraft(null)
    }

    try {
      captureTargetRef.current?.releasePointerCapture(event.pointerId)
    } catch {
      // Capture may already be lost.
    } finally {
      captureTargetRef.current = null
    }
  }

  const zoomAt = (nextZoom: number, clientX?: number, clientY?: number) => {
    const element = wrapRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const pointerX = (clientX ?? rect.left + viewportCenterX) - rect.left
    const pointerY = (clientY ?? rect.top + viewportCenterY) - rect.top
    setCamera((current) =>
      zoomCameraAt(
        current,
        nextZoom,
        fitScale,
        viewportCenterX,
        viewportCenterY,
        pointerX,
        pointerY,
      ),
    )
  }

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? wrapSize.h : 1
    const deltaX = event.deltaX * unit
    const deltaY = event.deltaY * unit
    if (event.ctrlKey || event.metaKey) {
      zoomAt(camera.zoom * Math.exp(-deltaY * 0.0022), event.clientX, event.clientY)
      return
    }
    setCamera((current) => ({
      ...current,
      panX: current.panX - (event.shiftKey && deltaX === 0 ? deltaY : deltaX),
      panY: current.panY - (event.shiftKey && deltaX === 0 ? 0 : deltaY),
    }))
  }

  const cancelActiveGesture = () => {
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
    if (gesture.kind === 'move' || gesture.kind === 'scale' || gesture.kind === 'rotate') {
      useBackgroundStore.getState().cancelTransaction()
    } else if (gesture.kind === 'pan') {
      setCamera(gesture.camera)
    } else {
      aspectDraftRef.current = null
      setAspectDraft(null)
    }
    return true
  }

  const changeMode = (nextMode: GeneratorMode) => {
    cancelActiveGesture()
    if (mode === 'material') {
      window.dispatchEvent(new Event(MATERIAL_MODEL_SETTLE_VIEW_EVENT))
    }
    if (keyboardTransactionRef.current) {
      keyboardTransactionRef.current = false
      useBackgroundStore.getState().commitTransaction()
    }
    aspectDraftRef.current = null
    setAspectDraft(null)
    setTool(nextMode === 'material' ? 'hand' : 'select')
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
        if (tool === 'aspect') {
          setTool(mode === 'background' ? 'select' : 'hand')
          return
        }
        if (mode === 'background' && artworkSelected) setArtworkSelected(false)
        return
      }
      if (editableTarget(event.target)) return
      if (event.key === ' ') {
        event.preventDefault()
        setSpaceHeld(true)
        return
      }
      const key = event.key.toLowerCase()
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (key === 'v' && mode === 'background') setTool('select')
        else if (key === 'h') setTool('hand')
        else if (key === 'a') setTool('aspect')
        else if (key === '+' || key === '=') {
          setCamera((current) =>
            zoomCameraAt(
              current,
              current.zoom * 1.2,
              fitScale,
              viewportCenterX,
              viewportCenterY,
              viewportCenterX,
              viewportCenterY,
            ),
          )
        } else if (key === '-') {
          setCamera((current) =>
            zoomCameraAt(
              current,
              current.zoom / 1.2,
              fitScale,
              viewportCenterX,
              viewportCenterY,
              viewportCenterX,
              viewportCenterY,
            ),
          )
        } else if (key === '0') {
          fitView()
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
      if (event.key === ' ') setSpaceHeld(false)
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
      setSpaceHeld(false)
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
    fitScale,
    mode,
    stackHeight,
    stackWidth,
    artworkSelected,
    fitView,
    tool,
    viewportCenterX,
    viewportCenterY,
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

  const resizeAspectWithKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    handle: AspectHandle,
  ) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
    if (horizontal !== (handle === 'e' || handle === 'w')) return
    event.preventDefault()
    event.stopPropagation()
    const outward = event.key === (
      handle === 'e' ? 'ArrowRight'
        : handle === 'w' ? 'ArrowLeft'
          : handle === 'n' ? 'ArrowUp'
            : 'ArrowDown'
    )
    const delta = (outward ? 1 : -1) * (event.shiftKey ? 50 : 10) * 2
    const next = { ...aspectRect }
    const centerX = next.left + next.width / 2
    const centerY = next.top + next.height / 2
    if (horizontal) {
      next.width = Math.max(80, next.width + delta)
      next.left = centerX - next.width / 2
    } else {
      next.height = Math.max(80, next.height + delta)
      next.top = centerY - next.height / 2
    }
    const dimensions = dimensionsForRatio(next.width / Math.max(1, next.height))
    if (!keyboardTransactionRef.current) {
      keyboardTransactionRef.current = true
      useBackgroundStore.getState().beginTransaction()
    }
    useBackgroundStore.getState().setTransient({
      format: { aspect: 'custom', ...dimensions },
    })
    setCamera({ zoom: 1, panX: 0, panY: 0 })
  }

  return (
    <div className="lab-stage-inner">
      <div
        ref={wrapRef}
        className={`lab-canvas-wrap tool-${spaceHeld ? 'hand' : tool}`}
        role="application"
        aria-label={`${mode === 'background' ? '2D' : '3D'} design canvas`}
        aria-describedby="lab-canvas-instructions"
        aria-keyshortcuts="V H A 0"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finishPointer(event, false)}
        onPointerCancel={(event) => finishPointer(event, true)}
        onLostPointerCapture={(event) => finishPointer(event, false)}
        onWheel={onWheel}
      >
        <p id="lab-canvas-instructions" className="lab-visually-hidden">
          V selects, H pans, A changes the output aspect, and 0 fits the artboard. Click the artwork to select it or empty canvas to
          deselect. Drag the selected artwork to move it. Use its corner handles to scale, or drag
          just outside a corner to rotate. Arrow keys nudge; Shift uses larger steps; Escape
          cancels the active gesture.
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

          {mode === 'background' && tool === 'select' && artworkSelected ? (
            <div
              className="lab-subject-frame"
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
                  aria-label={`Scale from ${corner.toUpperCase()} corner`}
                  onPointerDown={(event) => startScale(event, corner)}
                  onKeyDown={(event) => {
                    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
                    event.preventDefault()
                    event.stopPropagation()
                    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
                    useBackgroundStore.getState().updateRecipe(transformPatch(mode, {
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
                  aria-label={`Rotate from ${corner.toUpperCase()} corner`}
                  onPointerDown={startRotate}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                    event.preventDefault()
                    event.stopPropagation()
                    const direction = event.key === 'ArrowRight' ? 1 : -1
                    useBackgroundStore.getState().updateRecipe(transformPatch('background', {
                      ...transform,
                      preset: 'free',
                      rotation: transform.rotation + direction * (event.shiftKey ? 15 : 1),
                    }))
                  }}
                />
              ))}
            </div>
          ) : null}

          {guides.x !== undefined ? (
            <span className="lab-snap-guide vertical" style={{ left: guides.x }} />
          ) : null}
          {guides.y !== undefined ? (
            <span className="lab-snap-guide horizontal" style={{ top: guides.y }} />
          ) : null}
        </div>

        {tool === 'aspect' ? (
          <div
            className="lab-aspect-frame"
            aria-label="Centered output aspect frame"
            style={{
              left: aspectRect.left,
              top: aspectRect.top,
              width: aspectRect.width,
              height: aspectRect.height,
            }}
          >
            {(['n', 'e', 's', 'w'] as const).map((handle) => (
              <button
                key={handle}
                type="button"
                className={`lab-aspect-handle handle-${handle}`}
                aria-label={`Resize centered aspect from ${handle.toUpperCase()} edge`}
                onPointerDown={(event) => startAspectResize(event, handle)}
                onKeyDown={(event) => resizeAspectWithKeyboard(event, handle)}
              />
            ))}
          </div>
        ) : null}

        <div
          className="lab-canvas-toolbar"
          role="group"
          aria-label="Canvas tools"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={tool === 'select' ? 'active' : ''}
            aria-pressed={tool === 'select'}
            aria-label="Select"
            aria-keyshortcuts="V"
            disabled={mode !== 'background'}
            onClick={() => setTool('select')}
          >
            <span className="lab-toolbar-label">Select</span>
          </button>
          <button
            type="button"
            className={tool === 'hand' ? 'active' : ''}
            aria-pressed={tool === 'hand'}
            aria-label="Hand"
            aria-keyshortcuts="H"
            onClick={() => setTool('hand')}
          >
            <span className="lab-toolbar-label">Hand</span>
          </button>
          <button
            type="button"
            className={tool === 'aspect' ? 'active' : ''}
            aria-pressed={tool === 'aspect'}
            aria-label="Aspect"
            aria-keyshortcuts="A"
            onClick={() => setTool('aspect')}
          >
            <span className="lab-toolbar-label">Aspect</span>
          </button>
          <span className="lab-toolbar-divider" aria-hidden />
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => zoomAt(camera.zoom / 1.2)}
          >
            −
          </button>
          <output className="lab-zoom-readout" aria-label="Canvas zoom">
            {Math.round(displayScale * 100)}%
          </output>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => zoomAt(camera.zoom * 1.2)}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Fit view"
            aria-keyshortcuts="0"
            onClick={fitView}
          >
            <span className="lab-toolbar-label">Fit</span>
          </button>
        </div>

        <div
          className="lab-mode-switch"
          role="tablist"
          aria-label="Canvas mode"
          aria-orientation="horizontal"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {MODE_OPTIONS.map(({ mode: optionMode, label, tooltip, Icon }, index) => {
            const selected = mode === optionMode
            return (
              <button
                key={optionMode}
                id={`lab-mode-${optionMode}`}
                type="button"
                role="tab"
                className={selected ? 'lab-mode-tab active' : 'lab-mode-tab'}
                aria-label={label}
                aria-controls="lab-generator-artboard"
                aria-describedby={`lab-mode-${optionMode}-tooltip`}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                title={tooltip}
                data-mode={optionMode}
                onClick={() => changeMode(optionMode)}
                onKeyDown={(event) => selectModeWithKeyboard(event, index)}
              >
                <Icon aria-hidden size={16} strokeWidth={1.8} />
                <span className="lab-mode-label">{label}</span>
                <span
                  id={`lab-mode-${optionMode}-tooltip`}
                  className="lab-mode-tooltip"
                  role="tooltip"
                >
                  {tooltip}
                </span>
              </button>
            )
          })}
        </div>

        {hud ? (
          <div
            className="lab-transform-hud"
            role="status"
            style={{
              left: hud.x,
              top: hud.y,
            }}
          >
            {hud.text}
          </div>
        ) : null}
        {note ? <div className="lab-note">{note}</div> : null}
      </div>
    </div>
  )
}
