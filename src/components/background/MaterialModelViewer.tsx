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
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createLabSourceFromCanvas } from '@/core/lab/sourceCache'
import type { LookId } from '@/core/lab/looks'
import { sourceAwareLabForRecipe, renderRecipeLookToCanvas } from '@/features/background-generator/lookProcessor'
import type { MaterialId } from '@/features/background-generator/material/catalog'
import { registerMaterialFrameCapture } from '@/features/background-generator/material/materialFrameCapture'
import type {
  BackgroundRecipeV2,
  MaterialCameraPose,
  SubjectTransform,
} from '@/features/background-generator/recipe'
import { useBackgroundStore } from '@/features/background-generator/store'
import { resolveBankCached } from '@/components/lab/bankCache'
import {
  createMaterialSurface,
  prepareMaterialGeometry,
} from './materialModelProcessing'
import {
  MATERIAL_MODEL_RESET_VIEW_EVENT,
  MATERIAL_MODEL_SETTLE_VIEW_EVENT,
  reportMaterialModelStatus,
} from './materialModelEvents'

type ViewerConfig = {
  id: MaterialId
  backgroundColor: string
  highlightColor: string
  intensity: number
  light: number
  depth: number
  camera: MaterialCameraPose | null
  transform: SubjectTransform
  lookId: LookId
  lookOverlayEnabled: boolean
}

type ViewerRuntime = {
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  renderer: THREE.WebGLRenderer
  processedCanvas: HTMLCanvasElement
  controls: OrbitControls
  modelRoot: THREE.Group
  model: THREE.Group | null
  surface: THREE.MeshPhysicalMaterial
  keyLight: THREE.DirectionalLight
  fillLight: THREE.HemisphereLight
  rimLight: THREE.DirectionalLight
  environment: THREE.Texture
  pmrem: THREE.PMREMGenerator
  baseScale: number
  modelWidth: number
  modelHeight: number
  modelRadius: number
  viewportAspect: number
  cameraKey: string
  invalidateSource: () => void
}

type ViewerStatus = 'loading' | 'ready' | 'error'
type LookStatus = 'idle' | 'processing' | 'ready' | 'error'

const MODEL_URL = '/api/material-model'
const LIVE_LOOK_EDGE = 700
const HQ_LOOK_EDGE = 1200
const LIVE_LOOK_INTERVAL_MS = 90
const LOOK_SETTLE_MS = 160

function applyFinish(surface: THREE.MeshPhysicalMaterial, config: ViewerConfig): void {
  const intensity = THREE.MathUtils.clamp(config.intensity, 0, 1)
  const depth = THREE.MathUtils.clamp(config.depth, 0, 1)

  surface.color.set(config.highlightColor)
  surface.emissive.set('#000000')
  surface.emissiveIntensity = 0
  surface.metalness = 0.08
  surface.roughness = 0.5
  surface.clearcoat = 0
  surface.clearcoatRoughness = 0.2
  surface.transmission = 0
  surface.thickness = 0
  surface.ior = 1.5
  surface.iridescence = 0
  surface.iridescenceIOR = 1.3
  surface.iridescenceThicknessRange = [100, 400]
  surface.sheen = 0
  surface.sheenRoughness = 1
  surface.sheenColor.set('#000000')
  surface.attenuationColor.set(config.highlightColor)
  surface.attenuationDistance = Infinity
  surface.anisotropy = 0
  surface.opacity = 1
  surface.transparent = false
  surface.depthWrite = true
  surface.flatShading = false
  surface.wireframe = false

  if (config.id === 'clean') {
    surface.metalness = 0.03 + intensity * 0.08
    surface.roughness = 0.72 - intensity * 0.3
    surface.clearcoat = depth * 0.18
  } else if (config.id === 'liquid') {
    surface.metalness = 0.64 + intensity * 0.32
    surface.roughness = 0.24 - intensity * 0.14
    surface.clearcoat = 0.65 + depth * 0.35
    surface.clearcoatRoughness = 0.08
    surface.iridescence = 0.12 + intensity * 0.45
    surface.anisotropy = 0.35 + depth * 0.5
  } else if (config.id === 'glass') {
    surface.metalness = 0
    surface.roughness = 0.2 - intensity * 0.14
    surface.clearcoat = 0.25 + intensity * 0.3
    surface.clearcoatRoughness = 0.08
    surface.transmission = 0.62 + intensity * 0.34
    surface.thickness = 0.2 + depth * 1.4
    surface.ior = 1.32 + intensity * 0.28
    surface.attenuationDistance = 0.8 + (1 - depth) * 4
  } else if (config.id === 'metal') {
    surface.metalness = 0.9 + intensity * 0.1
    surface.roughness = 0.4 - intensity * 0.3
    surface.clearcoat = 0.1 + depth * 0.18
    surface.clearcoatRoughness = 0.12
    surface.anisotropy = 0.25 + depth * 0.65
  }

  surface.needsUpdate = true
}

function syncRuntime(runtime: ViewerRuntime, config: ViewerConfig): void {
  runtime.scene.background = new THREE.Color(config.backgroundColor)
  runtime.renderer.toneMappingExposure = 0.82 + config.light * 0.42
  runtime.keyLight.intensity = 1.6 + config.light * 3.4
  runtime.fillLight.intensity = 0.55 + config.light * 1.15
  runtime.fillLight.groundColor.set(config.backgroundColor)
  runtime.rimLight.intensity = 0.8 + config.light * 2.1

  runtime.modelRoot.position.set(config.transform.x * 1.35, -config.transform.y * 1.35, 0)
  runtime.modelRoot.rotation.z = THREE.MathUtils.degToRad(-config.transform.rotation)
  runtime.modelRoot.scale.setScalar(runtime.baseScale * config.transform.scale)
  // The raw post-tone-mapped frame is the canonical source for both bypass
  // and Look processing, so its material dithering cannot depend on the Look.
  runtime.surface.dithering = true
  applyFinish(runtime.surface, config)
  if (runtime.model) {
    const cameraKey = config.camera ? JSON.stringify(config.camera) : 'default'
    if (runtime.cameraKey !== cameraKey) {
      fitCamera(runtime)
      if (config.camera) applyCameraPose(runtime, config.camera)
      runtime.cameraKey = cameraKey
    }
  }
  runtime.invalidateSource()
}

function orientModel(model: THREE.Group): {
  baseScale: number
  width: number
  height: number
  radius: number
} {
  const bounds = new THREE.Box3().setFromObject(model)
  const center = bounds.getCenter(new THREE.Vector3())
  model.position.copy(center).multiplyScalar(-1)

  const orientedBounds = new THREE.Box3().setFromObject(model)
  const orientedSize = orientedBounds.getSize(new THREE.Vector3())
  const largestDimension = Math.max(orientedSize.x, orientedSize.y, orientedSize.z, 0.0001)
  const baseScale = 2.3 / largestDimension
  const sphere = orientedBounds.getBoundingSphere(new THREE.Sphere())

  return {
    baseScale,
    width: orientedSize.x * baseScale,
    height: orientedSize.y * baseScale,
    radius: sphere.radius * baseScale,
  }
}

function fitCamera(runtime: ViewerRuntime): void {
  const aspect = Math.max(0.01, runtime.viewportAspect)
  const halfHeight = Math.max(
    runtime.modelHeight / 2,
    runtime.modelWidth / (2 * aspect),
  ) * 1.12
  const halfWidth = halfHeight * aspect
  const distance = Math.max(5, runtime.modelRadius * 4)

  runtime.camera.left = -halfWidth
  runtime.camera.right = halfWidth
  runtime.camera.top = halfHeight
  runtime.camera.bottom = -halfHeight
  runtime.camera.near = Math.max(0.01, runtime.modelRadius / 50)
  runtime.camera.far = Math.max(100, runtime.modelRadius * 50)
  runtime.camera.zoom = 1
  runtime.camera.position.set(0, 0, distance)
  runtime.camera.updateProjectionMatrix()
  runtime.controls.target.set(0, 0, 0)
  runtime.controls.minZoom = 0.5
  runtime.controls.maxZoom = 8
  runtime.controls.update()
  runtime.controls.saveState()
}

function applyCameraPose(
  runtime: ViewerRuntime,
  pose: MaterialCameraPose,
): void {
  runtime.camera.position.fromArray(pose.position)
  runtime.camera.zoom = pose.zoom
  runtime.controls.target.fromArray(pose.target)
  runtime.camera.updateProjectionMatrix()
  runtime.controls.update()
}

function disposeModel(model: THREE.Object3D): void {
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) child.geometry.dispose()
  })
}

async function captureRuntimeFrame(
  runtime: ViewerRuntime,
  width: number,
  height: number,
): Promise<HTMLCanvasElement> {
  if (!runtime.model) throw new Error('3D model is not ready')
  if (
    width > runtime.renderer.capabilities.maxTextureSize
    || height > runtime.renderer.capabilities.maxTextureSize
  ) {
    throw new Error(`3D export exceeds this GPU's ${runtime.renderer.capabilities.maxTextureSize}px limit`)
  }

  const originalSize = runtime.renderer.getSize(new THREE.Vector2())
  const originalPixelRatio = runtime.renderer.getPixelRatio()
  const originalAspect = runtime.viewportAspect
  const originalFrustum = {
    left: runtime.camera.left,
    right: runtime.camera.right,
    top: runtime.camera.top,
    bottom: runtime.camera.bottom,
  }

  try {
    runtime.renderer.setPixelRatio(1)
    runtime.renderer.setSize(width, height, false)
    runtime.viewportAspect = width / height
    const halfHeight = Math.max(0.01, (runtime.camera.top - runtime.camera.bottom) / 2)
    const centerX = (runtime.camera.left + runtime.camera.right) / 2
    const halfWidth = halfHeight * runtime.viewportAspect
    runtime.camera.left = centerX - halfWidth
    runtime.camera.right = centerX + halfWidth
    runtime.camera.updateProjectionMatrix()
    runtime.controls.update()
    runtime.renderer.render(runtime.scene, runtime.camera)

    const frame = document.createElement('canvas')
    frame.width = width
    frame.height = height
    const context = frame.getContext('2d')
    if (!context) throw new Error('3D export canvas unavailable')
    context.drawImage(runtime.renderer.domElement, 0, 0, width, height)
    return frame
  } finally {
    runtime.renderer.setPixelRatio(originalPixelRatio)
    runtime.renderer.setSize(originalSize.x, originalSize.y, false)
    runtime.viewportAspect = originalAspect
    runtime.camera.left = originalFrustum.left
    runtime.camera.right = originalFrustum.right
    runtime.camera.top = originalFrustum.top
    runtime.camera.bottom = originalFrustum.bottom
    runtime.camera.updateProjectionMatrix()
    runtime.renderer.render(runtime.scene, runtime.camera)
    runtime.invalidateSource()
  }
}

export function MaterialModelViewer() {
  const recipe = useBackgroundStore((state) => state.recipe)
  const material = recipe.material
  const transform = recipe.transforms.material
  const lookId = recipe.look.id
  const lookOverlayEnabled = recipe.materialLookOverlay.enabled
  const containerRef = useRef<HTMLDivElement>(null)
  const processedCanvasRef = useRef<HTMLCanvasElement>(null)
  const runtimeRef = useRef<ViewerRuntime | null>(null)
  const controlsFlushRef = useRef<(() => void) | null>(null)
  const keyboardViewRef = useRef<((event: ReactKeyboardEvent<HTMLDivElement>) => boolean) | null>(null)
  const interactedRef = useRef(false)
  const lookFailedRef = useRef(false)
  const lookConfigKeyRef = useRef(`${lookOverlayEnabled}:${lookId}`)
  const [status, setStatus] = useState<ViewerStatus>('loading')
  const [lookStatus, setLookStatus] = useState<LookStatus>('idle')
  const [progress, setProgress] = useState<number | null>(null)
  const [attempt, setAttempt] = useState(0)

  const configRef = useRef<ViewerConfig>({
    ...material,
    transform,
    lookId,
    lookOverlayEnabled,
  })
  const recipeRef = useRef<BackgroundRecipeV2>(recipe)

  useEffect(() => {
    reportMaterialModelStatus(status)
  }, [status])

  useEffect(() => () => reportMaterialModelStatus('loading'), [])

  useEffect(
    () => registerMaterialFrameCapture(async (width, height) => {
      const runtime = runtimeRef.current
      if (!runtime) throw new Error('3D view is not ready')
      return captureRuntimeFrame(runtime, width, height)
    }),
    [],
  )

  const resetView = useCallback((persist = true) => {
    controlsFlushRef.current?.()
    const runtime = runtimeRef.current
    if (!runtime || !runtime.model) return
    interactedRef.current = false
    const dampingEnabled = runtime.controls.enableDamping
    runtime.controls.enableDamping = false
    // The first reset clears any damped orbit delta; the second lands exactly
    // on the saved orthographic front view.
    runtime.controls.reset()
    runtime.controls.reset()
    runtime.controls.enableDamping = dampingEnabled
    runtime.cameraKey = 'default'
    runtime.invalidateSource()
    if (persist) {
      useBackgroundStore.getState().updateRecipe({
        material: { camera: null },
      })
    }
  }, [])

  useEffect(() => {
    const onResetView = () => resetView(false)
    window.addEventListener(MATERIAL_MODEL_RESET_VIEW_EVENT, onResetView)
    return () => window.removeEventListener(MATERIAL_MODEL_RESET_VIEW_EVENT, onResetView)
  }, [resetView])

  useEffect(() => {
    const container = containerRef.current
    const processedCanvas = processedCanvasRef.current
    if (!container || !processedCanvas) return

    let cancelled = false
    let animationFrame = 0
    let resizeObserver: ResizeObserver | null = null
    let runtime: ViewerRuntime | null = null
    let controlsGestureActive = false
    let controlsTransactionOpen = false
    let controlsChanged = false
    let controlsSettleTimer: ReturnType<typeof setTimeout> | undefined
    let sourceVersion = 0
    let processedVersion = -1
    let lastSourceChange = performance.now()
    let lastProcess = -Infinity
    let processedQuality: 'live' | 'hq' | null = null
    const invalidateSource = () => {
      sourceVersion += 1
      lastSourceChange = performance.now()
    }
    const settleControls = () => {
      clearTimeout(controlsSettleTimer)
      controlsSettleTimer = undefined
      if (!controlsTransactionOpen) return
      const store = useBackgroundStore.getState()
      if (runtime && controlsChanged) {
        const dampingEnabled = runtime.controls.enableDamping
        runtime.controls.enableDamping = false
        runtime.controls.update()
        runtime.controls.enableDamping = dampingEnabled
        store.setTransient({
          material: {
            camera: {
              position: runtime.camera.position.toArray() as [number, number, number],
              target: runtime.controls.target.toArray() as [number, number, number],
              zoom: runtime.camera.zoom,
            },
          },
        })
      }
      controlsGestureActive = false
      controlsTransactionOpen = false
      controlsChanged = false
      store.commitTransaction()
      invalidateSource()
    }
    const scheduleControlsSettlement = () => {
      clearTimeout(controlsSettleTimer)
      controlsSettleTimer = setTimeout(settleControls, 240)
    }
    const flushControls = () => {
      if (!controlsTransactionOpen) return
      settleControls()
    }
    const onControlsStart = () => {
      clearTimeout(controlsSettleTimer)
      controlsSettleTimer = undefined
      controlsGestureActive = true
      interactedRef.current = true
      if (!controlsTransactionOpen) {
        controlsTransactionOpen = true
        controlsChanged = false
        useBackgroundStore.getState().beginTransaction()
      }
      invalidateSource()
    }
    const onControlsChange = () => {
      invalidateSource()
      if (!controlsTransactionOpen) return
      controlsChanged = true
      const store = useBackgroundStore.getState()
      if (store.recipe.transforms.material.preset !== 'free') {
        store.setTransient({ transforms: { material: { preset: 'free' } } })
      }
    }
    const onControlsEnd = () => {
      controlsGestureActive = false
      scheduleControlsSettlement()
      invalidateSource()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushControls()
    }
    controlsFlushRef.current = flushControls

    try {
      const scene = new THREE.Scene()
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100)
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      renderer.domElement.className = 'lab-material-model-canvas'
      renderer.domElement.setAttribute('aria-hidden', 'true')
      container.appendChild(renderer.domElement)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.055
      controls.enablePan = true
      controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN
      controls.addEventListener('start', onControlsStart)
      controls.addEventListener('change', onControlsChange)
      controls.addEventListener('end', onControlsEnd)

      const pmrem = new THREE.PMREMGenerator(renderer)
      const room = new RoomEnvironment()
      const environment = pmrem.fromScene(room, 0.04).texture
      room.dispose()
      scene.environment = environment

      const keyLight = new THREE.DirectionalLight('#ffffff', 3)
      keyLight.position.set(4, 5, 7)
      const fillLight = new THREE.HemisphereLight('#ffffff', '#0d1420', 1)
      const rimLight = new THREE.DirectionalLight('#78a9ff', 1.8)
      rimLight.position.set(-4, 1.5, -5)
      scene.add(keyLight, fillLight, rimLight)

      const surface = createMaterialSurface()
      const modelRoot = new THREE.Group()
      scene.add(modelRoot)

      runtime = {
        scene,
        camera,
        renderer,
        processedCanvas,
        controls,
        modelRoot,
        model: null,
        surface,
        keyLight,
        fillLight,
        rimLight,
        environment,
        pmrem,
        baseScale: 1,
        modelWidth: 2.3,
        modelHeight: 1,
        modelRadius: 1.2,
        viewportAspect: 1,
        cameraKey: '',
        invalidateSource,
      }
      runtimeRef.current = runtime
      const adjustViewFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!runtime) return false
        const key = event.key
        const arrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)
        const zoom = key === '+' || key === '=' || key === '-'
        if (!arrow && !zoom) return false

        onControlsStart()
        if (zoom) {
          const factor = key === '-' ? 1 / 1.12 : 1.12
          runtime.camera.zoom = THREE.MathUtils.clamp(
            runtime.camera.zoom * factor,
            runtime.controls.minZoom,
            runtime.controls.maxZoom,
          )
          runtime.camera.updateProjectionMatrix()
        } else if (event.altKey) {
          runtime.camera.updateMatrixWorld()
          const distance = runtime.camera.position.distanceTo(runtime.controls.target)
          const amount = distance * (event.shiftKey ? 0.08 : 0.025)
          const right = new THREE.Vector3().setFromMatrixColumn(runtime.camera.matrixWorld, 0)
          const up = new THREE.Vector3().setFromMatrixColumn(runtime.camera.matrixWorld, 1)
          const delta = new THREE.Vector3()
          if (key === 'ArrowLeft') delta.addScaledVector(right, -amount)
          if (key === 'ArrowRight') delta.addScaledVector(right, amount)
          if (key === 'ArrowUp') delta.addScaledVector(up, amount)
          if (key === 'ArrowDown') delta.addScaledVector(up, -amount)
          runtime.camera.position.add(delta)
          runtime.controls.target.add(delta)
        } else {
          const offset = runtime.camera.position.clone().sub(runtime.controls.target)
          const spherical = new THREE.Spherical().setFromVector3(offset)
          const amount = event.shiftKey ? 0.15 : 0.05
          if (key === 'ArrowLeft') spherical.theta -= amount
          if (key === 'ArrowRight') spherical.theta += amount
          if (key === 'ArrowUp') spherical.phi -= amount
          if (key === 'ArrowDown') spherical.phi += amount
          spherical.makeSafe()
          runtime.camera.position
            .copy(runtime.controls.target)
            .add(offset.setFromSpherical(spherical))
          runtime.camera.lookAt(runtime.controls.target)
        }
        runtime.controls.update()
        onControlsEnd()
        return true
      }
      keyboardViewRef.current = adjustViewFromKeyboard
      renderer.domElement.addEventListener('pointercancel', flushControls)
      window.addEventListener('blur', flushControls)
      window.addEventListener('pagehide', flushControls)
      window.addEventListener(MATERIAL_MODEL_SETTLE_VIEW_EVENT, flushControls)
      document.addEventListener('visibilitychange', onVisibilityChange)
      syncRuntime(runtime, configRef.current)

      const resize = () => {
        if (!runtime) return
        const width = Math.max(1, container.clientWidth)
        const height = Math.max(1, container.clientHeight)
        runtime.renderer.setSize(width, height, false)
        runtime.viewportAspect = width / height
        if (runtime.model && !interactedRef.current && runtime.cameraKey === 'default') {
          fitCamera(runtime)
        } else {
          const halfHeight = Math.max(0.01, (runtime.camera.top - runtime.camera.bottom) / 2)
          const halfWidth = halfHeight * runtime.viewportAspect
          runtime.camera.left = -halfWidth
          runtime.camera.right = halfWidth
          runtime.camera.updateProjectionMatrix()
        }
        invalidateSource()
      }
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(container)
      resize()

      const loader = new OBJLoader()
      loader.load(
        MODEL_URL,
        (model) => {
          if (cancelled || !runtime) {
            disposeModel(model)
            return
          }

          model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return
            const importedMaterials = Array.isArray(child.material)
              ? child.material
              : [child.material]
            importedMaterials.forEach((importedMaterial) => importedMaterial.dispose())
            const importedGeometry = child.geometry
            child.geometry = prepareMaterialGeometry(importedGeometry)
            importedGeometry.dispose()
            child.material = surface
            child.castShadow = true
            child.receiveShadow = true
          })
          const oriented = orientModel(model)
          runtime.baseScale = oriented.baseScale
          runtime.modelWidth = oriented.width
          runtime.modelHeight = oriented.height
          runtime.modelRadius = oriented.radius
          runtime.model = model
          runtime.modelRoot.add(model)
          syncRuntime(runtime, configRef.current)
          setStatus('ready')
          window.dispatchEvent(new CustomEvent('mbs:model-ready'))
        },
        (event) => {
          if (cancelled) return
          setProgress(event.lengthComputable && event.total > 0 ? event.loaded / event.total : null)
        },
        () => {
          if (!cancelled) setStatus('error')
        },
      )

      const processLook = (quality: 'live' | 'hq', now: number) => {
        if (!runtime?.model) return
        try {
          if (processedQuality === null) {
            queueMicrotask(() => {
              if (!cancelled) setLookStatus('processing')
            })
          }
          const source = createLabSourceFromCanvas(runtime.renderer.domElement, {
            filename: 'three-material-frame.rgba',
          })
          const liveRecipe = recipeRef.current
          const sourceLab = sourceAwareLabForRecipe(liveRecipe, source)
          renderRecipeLookToCanvas(
            runtime.processedCanvas,
            liveRecipe,
            source,
            resolveBankCached(sourceLab.mark.bank),
            {
              fit: 'contain',
              maxLongEdge: quality === 'live' ? LIVE_LOOK_EDGE : HQ_LOOK_EDGE,
            },
          )
          runtime.processedCanvas.dataset.sourceHash = source.hash
          runtime.processedCanvas.dataset.look = liveRecipe.look.id
          runtime.processedCanvas.dataset.quality = quality
          runtime.processedCanvas.dataset.renderStatus = 'ready'
          processedVersion = sourceVersion
          processedQuality = quality
          lastProcess = now
          lookFailedRef.current = false
          queueMicrotask(() => {
            if (!cancelled) setLookStatus('ready')
          })
        } catch {
          runtime.processedCanvas.dataset.renderStatus = 'error'
          lookFailedRef.current = true
          queueMicrotask(() => {
            if (!cancelled) setLookStatus('error')
          })
        }
      }

      const render = () => {
        if (cancelled || !runtime) return
        runtime.controls.update()
        // Render exactly one raw, ACES-tonemapped/sRGB source frame. The
        // Canvas2D Look path freezes this framebuffer before the next rAF.
        runtime.renderer.render(runtime.scene, runtime.camera)
        if (
          configRef.current.lookOverlayEnabled
          && runtime.model
          && !lookFailedRef.current
        ) {
          const now = performance.now()
          const settled =
            !controlsGestureActive && now - lastSourceChange >= LOOK_SETTLE_MS
          const quality = settled ? 'hq' : 'live'
          const needsCurrentFrame = processedVersion !== sourceVersion
          const needsSettledFrame = settled && processedQuality !== 'hq'
          if (
            (needsCurrentFrame || needsSettledFrame)
            && (settled || now - lastProcess >= LIVE_LOOK_INTERVAL_MS)
          ) {
            processLook(quality, now)
          }
        }
        animationFrame = requestAnimationFrame(render)
      }
      render()
    } catch {
      queueMicrotask(() => {
        if (!cancelled) setStatus('error')
      })
    }

    return () => {
      cancelled = true
      cancelAnimationFrame(animationFrame)
      clearTimeout(controlsSettleTimer)
      resizeObserver?.disconnect()
      if (controlsFlushRef.current === flushControls) controlsFlushRef.current = null
      if (keyboardViewRef.current) keyboardViewRef.current = null
      if (!runtime) return
      flushControls()
      runtime.renderer.domElement.removeEventListener('pointercancel', flushControls)
      window.removeEventListener('blur', flushControls)
      window.removeEventListener('pagehide', flushControls)
      window.removeEventListener(MATERIAL_MODEL_SETTLE_VIEW_EVENT, flushControls)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      runtime.controls.removeEventListener('start', onControlsStart)
      runtime.controls.removeEventListener('change', onControlsChange)
      runtime.controls.removeEventListener('end', onControlsEnd)
      runtime.controls.dispose()
      if (runtime.model) disposeModel(runtime.model)
      runtime.surface.dispose()
      runtime.environment.dispose()
      runtime.pmrem.dispose()
      runtime.renderer.dispose()
      runtime.renderer.forceContextLoss()
      runtime.renderer.domElement.remove()
      if (runtimeRef.current === runtime) runtimeRef.current = null
    }
  }, [attempt])

  useEffect(() => {
    const config: ViewerConfig = {
      ...material,
      transform,
      lookId,
      lookOverlayEnabled,
    }
    configRef.current = config
    recipeRef.current = recipe
    const lookConfigKey = `${lookOverlayEnabled}:${lookId}`
    if (lookConfigKeyRef.current !== lookConfigKey) {
      lookConfigKeyRef.current = lookConfigKey
      lookFailedRef.current = false
      queueMicrotask(() => setLookStatus(lookOverlayEnabled ? 'processing' : 'idle'))
    }
    const runtime = runtimeRef.current
    if (runtime) syncRuntime(runtime, config)
  }, [lookId, lookOverlayEnabled, material, recipe, transform])

  const stopPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }

  const stopWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key.toLowerCase() === 'r') {
      event.preventDefault()
      event.stopPropagation()
      resetView()
      return
    }
    if (!keyboardViewRef.current?.(event)) return
    event.preventDefault()
    event.stopPropagation()
  }

  const retryModel = () => {
    containerRef.current?.focus()
    setStatus('loading')
    setProgress(null)
    setAttempt((value) => value + 1)
  }

  const retryLook = () => {
    containerRef.current?.focus()
    lookFailedRef.current = false
    setLookStatus('processing')
    runtimeRef.current?.invalidateSource()
  }

  const bypassLook = () => {
    useBackgroundStore.getState().updateRecipe({
      materialLookOverlay: { enabled: false },
    })
  }

  return (
    <div
      ref={containerRef}
      className="lab-material-model-viewer"
      data-mbs-material-model="true"
      data-model-status={status}
      data-material={material.id}
      data-look={lookOverlayEnabled ? lookId : 'off'}
      data-postprocess={
        lookOverlayEnabled && lookStatus === 'ready'
          ? 'canvas2d-look'
          : 'raw'
      }
      role="region"
      aria-label="Interactive 3D Meta symbol"
      aria-describedby="lab-material-model-help"
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown + - R"
      tabIndex={0}
      onPointerDown={(event) => {
        stopPointer(event)
        containerRef.current?.focus({ preventScroll: true })
      }}
      onPointerMove={stopPointer}
      onPointerUp={stopPointer}
      onPointerCancel={stopPointer}
      onWheel={stopWheel}
      onDoubleClick={() => resetView()}
      onKeyDown={onKeyDown}
    >
      <p id="lab-material-model-help" className="lab-visually-hidden">
        Left drag to orbit the model, middle drag to pan, scroll to zoom, and double click or press
        R to reset the view. With the viewer focused, use arrow keys to orbit, Alt plus arrow keys
        to pan, and plus or minus to zoom.
      </p>
      <canvas
        ref={processedCanvasRef}
        className="lab-material-look-canvas"
        data-mbs-material-look-canvas="true"
        aria-hidden
      />
      {status === 'loading' ? (
        <div className="lab-material-model-status">
          <span className="lab-material-model-spinner" aria-hidden />
          Loading 3D symbol{progress === null ? '…' : ` · ${Math.round(progress * 100)}%`}
        </div>
      ) : null}
      {status === 'ready' ? (
        <span className="lab-visually-hidden" role="status">3D model ready</span>
      ) : null}
      {status === 'error' ? (
        <div className="lab-material-model-status error" role="alert">
          3D model unavailable
        </div>
      ) : null}
      {status === 'ready' && lookOverlayEnabled && lookStatus === 'processing' ? (
        <div className="lab-material-model-status" role="status">
          Applying Look…
        </div>
      ) : null}
      {lookOverlayEnabled && lookStatus === 'error' ? (
        <div className="lab-material-look-error" role="alert">
          Look failed
        </div>
      ) : null}
      {status !== 'loading' || (lookOverlayEnabled && lookStatus === 'error') ? (
        <div className="lab-material-model-actions">
        {status === 'error' ? (
          <button type="button" onClick={retryModel}>Retry 3D</button>
        ) : null}
        {lookOverlayEnabled && lookStatus === 'error' ? (
          <>
            <button type="button" onClick={retryLook}>Retry Look</button>
            <button type="button" onClick={bypassLook}>Turn Look off</button>
          </>
        ) : null}
        {status === 'ready' ? (
          <button type="button" aria-keyshortcuts="R" onClick={() => resetView()}>
            Reset view
          </button>
        ) : null}
        </div>
      ) : null}
    </div>
  )
}
