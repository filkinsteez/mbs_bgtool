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
import {
  attachLabAuxPlanes,
  createLabSourceFromCanvas,
  createLabSourceFromOpaqueWithSilhouette,
  type LabAuxPlanes,
} from '@/core/lab/sourceCache'
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

type AuxCaptureKit = {
  depthTarget: THREE.WebGLRenderTarget
  normalTarget: THREE.WebGLRenderTarget
  depthMaterial: THREE.MeshDepthMaterial
  normalMaterial: THREE.MeshNormalMaterial
  dispose: () => void
}

type ViewerRuntime = {
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  renderer: THREE.WebGLRenderer
  processedCanvas: HTMLCanvasElement
  lookColorFrame: HTMLCanvasElement
  lookMaskFrame: HTMLCanvasElement
  controls: OrbitControls
  modelRoot: THREE.Group
  model: THREE.Group | null
  surface: THREE.MeshPhysicalMaterial
  keyLight: THREE.DirectionalLight
  fillLight: THREE.HemisphereLight
  rimLight: THREE.DirectionalLight
  environment: THREE.Texture
  pmrem: THREE.PMREMGenerator
  aux: AuxCaptureKit | null
  baseScale: number
  modelWidth: number
  modelHeight: number
  modelRadius: number
  viewportAspect: number
  cameraKey: string
  recipe: BackgroundRecipeV2
  invalidateSource: () => void
}

type ViewerStatus = 'loading' | 'ready' | 'error'
type LookStatus = 'idle' | 'processing' | 'ready' | 'error'

const MODEL_URL = '/api/material-model'
const HQ_LOOK_EDGE = 1200
const LOOK_SETTLE_MS = 160
// Aux (depth/normal) planes read back at half the ~1MP analysis budget —
// they are smooth control surfaces, not imagery.
const AUX_MAX = 512

type MaterialDebugApi = {
  loseAndRestoreContext: () => boolean
  captureAuxPlanes: () => {
    w: number
    h: number
    depth: number[]
    normalX: number[]
    normalY: number[]
  } | null
  // Exercises the REAL export capture chain (captureRuntimeFrame →
  // createLabSourceFromCanvas) and reports whether the aux planes rode
  // along — what exportMaterialAtTarget's LabSource will carry.
  captureExportSourceInfo: (width: number, height: number) => Promise<{
    hash: string
    hasAux: boolean
    auxW: number
    auxH: number
  }>
}

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
  if (runtime.scene.background instanceof THREE.Color) {
    runtime.scene.background.set(config.backgroundColor)
  } else {
    runtime.scene.background = new THREE.Color(config.backgroundColor)
  }
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

function ensureAuxKit(runtime: ViewerRuntime): AuxCaptureKit {
  if (runtime.aux) return runtime.aux
  const targetOptions: THREE.RenderTargetOptions = {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: false,
  }
  const depthTarget = new THREE.WebGLRenderTarget(8, 8, targetOptions)
  const normalTarget = new THREE.WebGLRenderTarget(8, 8, targetOptions)
  // RGBA-packed depth carries ~24 bits through an 8-bit target — the model
  // occupies a thin slice of the camera's near/far range, so BasicDepthPacking
  // would band hard after per-model renormalization. NoBlending on both:
  // packed depth bits in alpha must never blend with the clear color.
  const depthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    blending: THREE.NoBlending,
  })
  const normalMaterial = new THREE.MeshNormalMaterial({
    blending: THREE.NoBlending,
  })
  const kit: AuxCaptureKit = {
    depthTarget,
    normalTarget,
    depthMaterial,
    normalMaterial,
    dispose: () => {
      depthTarget.dispose()
      normalTarget.dispose()
      depthMaterial.dispose()
      normalMaterial.dispose()
    },
  }
  runtime.aux = kit
  return kit
}

// Render the scene twice more with scene.overrideMaterial into small render
// targets and read the planes back: view-space normals (packed 0..1, alpha =
// model coverage) and RGBA-packed depth, renormalized in JS over the model's
// own depth span so 0..1 covers the model and empty space reads exactly 1.
// Same cadence as the callers — settled hq captures and exports only, never
// per-frame during gestures. Returns null instead of throwing so a failed or
// context-lost aux pass degrades to a source without planes.
function captureAuxPlanes(
  runtime: ViewerRuntime,
  frameW: number,
  frameH: number,
): LabAuxPlanes | null {
  if (!runtime.model) return null
  const gl = runtime.renderer.getContext()
  if (gl.isContextLost()) return null
  const k = Math.min(1, AUX_MAX / Math.max(frameW, frameH))
  const w = Math.max(8, Math.round(frameW * k))
  const h = Math.max(8, Math.round(frameH * k))
  const normalPixels = new Uint8Array(w * h * 4)
  const depthPixels = new Uint8Array(w * h * 4)

  const { renderer, scene, camera } = runtime
  const previousBackground = scene.background
  const previousOverride = scene.overrideMaterial
  const previousTarget = renderer.getRenderTarget()
  const previousClearColor = renderer.getClearColor(new THREE.Color())
  const previousClearAlpha = renderer.getClearAlpha()
  try {
    const kit = ensureAuxKit(runtime)
    if (kit.normalTarget.width !== w || kit.normalTarget.height !== h) {
      kit.normalTarget.setSize(w, h)
      kit.depthTarget.setSize(w, h)
    }
    scene.background = null
    scene.overrideMaterial = kit.normalMaterial
    renderer.setClearColor(0x000000, 0)
    renderer.setRenderTarget(kit.normalTarget)
    renderer.render(scene, camera)
    renderer.readRenderTargetPixels(kit.normalTarget, 0, 0, w, h, normalPixels)
    scene.overrideMaterial = kit.depthMaterial
    renderer.setClearColor(0xffffff, 1)
    renderer.setRenderTarget(kit.depthTarget)
    renderer.render(scene, camera)
    renderer.readRenderTargetPixels(kit.depthTarget, 0, 0, w, h, depthPixels)
  } catch {
    return null
  } finally {
    scene.background = previousBackground
    scene.overrideMaterial = previousOverride
    renderer.setRenderTarget(previousTarget)
    renderer.setClearColor(previousClearColor, previousClearAlpha)
  }
  if (gl.isContextLost()) return null

  const count = w * h
  const depth = new Float32Array(count)
  const normalX = new Float32Array(count)
  const normalY = new Float32Array(count)
  const covered = new Uint8Array(count)
  let minDepth = Infinity
  let maxDepth = -Infinity
  for (let y = 0; y < h; y += 1) {
    // readRenderTargetPixels rows run bottom-up (WebGL origin); the planes
    // use the analysis maps' top-down order
    const sourceRow = (h - 1 - y) * w
    for (let x = 0; x < w; x += 1) {
      const index = y * w + x
      const offset = (sourceRow + x) * 4
      if (normalPixels[offset + 3] >= 128) {
        covered[index] = 1
        normalX[index] = normalPixels[offset] / 255
        normalY[index] = normalPixels[offset + 1] / 255
        // unpackRGBAToDepth for PackFactors (1, 256, 256^2, 256^3)
        const value =
          depthPixels[offset] / 256
          + depthPixels[offset + 1] / 65536
          + depthPixels[offset + 2] / 16777216
          + depthPixels[offset + 3] / (255 * 16777216)
        depth[index] = value
        if (value < minDepth) minDepth = value
        if (value > maxDepth) maxDepth = value
      } else {
        normalX[index] = 0.5
        normalY[index] = 0.5
        depth[index] = 1
      }
    }
  }
  if (minDepth < maxDepth) {
    const scale = 1 / (maxDepth - minDepth)
    for (let index = 0; index < count; index += 1) {
      if (covered[index]) {
        depth[index] = Math.min(1, Math.max(0, (depth[index] - minDepth) * scale))
      }
    }
  } else if (Number.isFinite(minDepth)) {
    // a single covered depth (flat facing slab): nearest by convention
    for (let index = 0; index < count; index += 1) {
      if (covered[index]) depth[index] = 0
    }
  }
  return { w, h, depth, normalX, normalY }
}

function captureLookSource(runtime: ViewerRuntime) {
  const canvas = runtime.renderer.domElement
  const colorFrame = runtime.lookColorFrame
  if (colorFrame.width !== canvas.width) colorFrame.width = canvas.width
  if (colorFrame.height !== canvas.height) colorFrame.height = canvas.height
  const colorContext = colorFrame.getContext('2d')
  if (!colorContext) throw new Error('2D color capture context unavailable')
  const maskFrame = runtime.lookMaskFrame
  if (maskFrame.width !== canvas.width) maskFrame.width = canvas.width
  if (maskFrame.height !== canvas.height) maskFrame.height = canvas.height
  const maskContext = maskFrame.getContext('2d')
  if (!maskContext) throw new Error('2D mask capture context unavailable')

  const previousBackground = runtime.scene.background
  const previousClearAlpha = runtime.renderer.getClearAlpha()
  try {
    // One transparent render feeds both captures: the silhouette (alpha
    // cutout) and, composited over the recipe's ground while everything
    // is OPAQUE, the color frame the Look treatments sample. Baking the
    // silhouette into the color canvas's alpha instead premultiplies
    // every background RGB to black — the audited "black ground" bug.
    runtime.scene.background = null
    runtime.renderer.setClearAlpha(0)
    runtime.renderer.render(runtime.scene, runtime.camera)
    maskContext.clearRect(0, 0, maskFrame.width, maskFrame.height)
    maskContext.drawImage(canvas, 0, 0)
    colorContext.fillStyle = runtime.recipe.palette.ground
    colorContext.fillRect(0, 0, colorFrame.width, colorFrame.height)
    colorContext.drawImage(canvas, 0, 0)
  } finally {
    runtime.scene.background = previousBackground
    runtime.renderer.setClearAlpha(previousClearAlpha)
    runtime.renderer.render(runtime.scene, runtime.camera)
  }

  // Depth/normal planes render to their own small targets AFTER the canvas
  // readbacks above, so the raw render, silhouette, and color captures stay
  // byte-identical whether or not the aux passes succeed.
  const aux = captureAuxPlanes(runtime, canvas.width, canvas.height)

  return createLabSourceFromOpaqueWithSilhouette(
    colorFrame,
    maskFrame,
    colorFrame.width,
    colorFrame.height,
    { filename: 'three-material-frame.rgba', aux },
  )
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
    // Every version exports the same way: the raw lit frame is captured
    // here, and the canonical Canvas2D Look processor treats it downstream
    // (exportMaterial.ts), exactly as the live overlay does.
    runtime.renderer.render(runtime.scene, runtime.camera)

    const frame = document.createElement('canvas')
    frame.width = width
    frame.height = height
    const context = frame.getContext('2d')
    if (!context) throw new Error('3D export canvas unavailable')
    context.drawImage(runtime.renderer.domElement, 0, 0, width, height)
    frame.dataset.renderPipeline = 'three-raw'
    // The export runs through the same capture contract as the live
    // overlay: depth/normal planes for THIS pose at THIS aspect ride along
    // with the frame so the treated export sees the same env fields.
    const aux = captureAuxPlanes(runtime, width, height)
    if (aux) attachLabAuxPlanes(frame, aux)
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
  const lookVersion = recipe.look.version
  const lookOverlayEnabled = recipe.materialLookOverlay.enabled
  const containerRef = useRef<HTMLDivElement>(null)
  const processedCanvasRef = useRef<HTMLCanvasElement>(null)
  const runtimeRef = useRef<ViewerRuntime | null>(null)
  const controlsFlushRef = useRef<(() => void) | null>(null)
  const keyboardViewRef = useRef<((event: ReactKeyboardEvent<HTMLDivElement>) => boolean) | null>(null)
  const interactedRef = useRef(false)
  const lookFailedRef = useRef(false)
  const lookConfigKeyRef = useRef(`${lookOverlayEnabled}:${lookId}:${lookVersion}`)
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
    let contextRecoveryQueued = false
    let debugApi: MaterialDebugApi | null = null
    let onContextLost: ((event: Event) => void) | null = null
    let onContextRestored: (() => void) | null = null
    let sourceVersion = 0
    let processedVersion = -1
    let processedRevision = 0
    let lastSourceChange = performance.now()
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
        alpha: true,
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
        lookColorFrame: document.createElement('canvas'),
        lookMaskFrame: document.createElement('canvas'),
        controls,
        modelRoot,
        model: null,
        surface,
        keyLight,
        fillLight,
        rimLight,
        environment,
        pmrem,
        aux: null,
        baseScale: 1,
        modelWidth: 2.3,
        modelHeight: 1,
        modelRadius: 1.2,
        viewportAspect: 1,
        cameraKey: '',
        recipe: recipeRef.current,
        invalidateSource,
      }
      runtimeRef.current = runtime
      onContextLost = (event) => {
        event.preventDefault()
        if (cancelled) return
        contextRecoveryQueued = true
        lookFailedRef.current = false
        renderer.domElement.dataset.renderStatus = 'context-lost'
        queueMicrotask(() => {
          if (!cancelled) {
            setStatus('loading')
            setLookStatus('processing')
          }
        })
      }
      onContextRestored = () => {
        if (cancelled || !contextRecoveryQueued) return
        lookFailedRef.current = false
        queueMicrotask(() => {
          if (!cancelled) setAttempt((value) => value + 1)
        })
      }
      renderer.domElement.addEventListener('webglcontextlost', onContextLost)
      renderer.domElement.addEventListener('webglcontextrestored', onContextRestored)

      if (process.env.NODE_ENV !== 'production') {
        debugApi = {
          loseAndRestoreContext: () => {
            if (!runtime) return false
            const extension = runtime.renderer.getContext().getExtension('WEBGL_lose_context')
            if (!extension) return false
            extension.loseContext()
            window.setTimeout(() => extension.restoreContext(), 80)
            return true
          },
          captureAuxPlanes: () => {
            if (!runtime) return null
            const element = runtime.renderer.domElement
            const aux = captureAuxPlanes(runtime, element.width, element.height)
            if (!aux) return null
            return {
              w: aux.w,
              h: aux.h,
              depth: Array.from(aux.depth),
              normalX: Array.from(aux.normalX),
              normalY: Array.from(aux.normalY),
            }
          },
          captureExportSourceInfo: async (width, height) => {
            if (!runtime) throw new Error('3D view is not ready')
            const frame = await captureRuntimeFrame(runtime, width, height)
            const source = createLabSourceFromCanvas(frame, {
              filename: 'debug-export-frame.rgba',
            })
            return {
              hash: source.hash,
              hasAux: !!source.aux,
              auxW: source.aux?.w ?? 0,
              auxH: source.aux?.h ?? 0,
            }
          },
        }
        ;(window as unknown as {
          __mbsMaterialDebug?: MaterialDebugApi
        }).__mbsMaterialDebug = debugApi
      }
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

      const processLegacyLook = () => {
        if (!runtime?.model) return
        try {
          runtime.processedCanvas.dataset.renderStatus = 'processing'
          if (processedVersion === -1) {
            queueMicrotask(() => {
              if (!cancelled) setLookStatus('processing')
            })
          }
          const source = captureLookSource(runtime)
          const liveRecipe = recipeRef.current
          const sourceLab = sourceAwareLabForRecipe(liveRecipe, source)
          renderRecipeLookToCanvas(
            runtime.processedCanvas,
            liveRecipe,
            source,
            resolveBankCached(sourceLab.mark.bank, sourceLab.look.version),
            {
              fit: 'contain',
              maxLongEdge: HQ_LOOK_EDGE,
            },
          )
          runtime.processedCanvas.dataset.sourceHash = source.hash
          runtime.processedCanvas.dataset.look = liveRecipe.look.id
          runtime.processedCanvas.dataset.lookVersion = liveRecipe.look.version
          runtime.processedCanvas.dataset.quality = 'hq'
          processedRevision += 1
          runtime.processedCanvas.dataset.renderRevision = String(processedRevision)
          runtime.processedCanvas.dataset.renderStatus = 'ready'
          processedVersion = sourceVersion
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
        if (contextRecoveryQueued) {
          animationFrame = requestAnimationFrame(render)
          return
        }
        runtime.controls.update()
        const now = performance.now()
        const liveRecipe = recipeRef.current
        // Every Look version is a render layer over the live viewport: the
        // raw lit frame renders first, then the shared Canvas2D processor
        // treats a capture of it in processLegacyLook.
        const useLegacyLook = (
          liveRecipe.materialLookOverlay.enabled
          && runtime.model !== null
          && !lookFailedRef.current
        )
        runtime.recipe = liveRecipe

        runtime.renderer.render(runtime.scene, runtime.camera)
        runtime.renderer.domElement.dataset.renderPipeline = 'three-raw'
        runtime.renderer.domElement.dataset.renderStatus = 'ready'

        if (useLegacyLook) {
          const settled =
            !controlsGestureActive && now - lastSourceChange >= LOOK_SETTLE_MS
          const stale = processedVersion !== sourceVersion
          if (stale && !settled) {
            // The camera is moving: chasing frames with the full treatment
            // is what made orbiting lag, so drop straight to the raw
            // viewport and re-treat once with the settled pose below.
            container.dataset.lookHold = 'moving'
          } else {
            if (stale) processLegacyLook()
            delete container.dataset.lookHold
          }
        } else {
          delete container.dataset.lookHold
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
      if (onContextLost) {
        runtime.renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      }
      if (onContextRestored) {
        runtime.renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored)
      }
      const debugWindow = window as unknown as {
        __mbsMaterialDebug?: MaterialDebugApi
      }
      if (debugApi && debugWindow.__mbsMaterialDebug === debugApi) {
        delete debugWindow.__mbsMaterialDebug
      }
      runtime.renderer.domElement.removeEventListener('pointercancel', flushControls)
      window.removeEventListener('blur', flushControls)
      window.removeEventListener('pagehide', flushControls)
      window.removeEventListener(MATERIAL_MODEL_SETTLE_VIEW_EVENT, flushControls)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      runtime.controls.removeEventListener('start', onControlsStart)
      runtime.controls.removeEventListener('change', onControlsChange)
      runtime.controls.removeEventListener('end', onControlsEnd)
      runtime.controls.dispose()
      if (!contextRecoveryQueued) {
        if (runtime.model) disposeModel(runtime.model)
        runtime.aux?.dispose()
        runtime.surface.dispose()
        runtime.environment.dispose()
        runtime.pmrem.dispose()
        runtime.renderer.dispose()
      }
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
    const lookConfigKey = `${lookOverlayEnabled}:${lookId}:${lookVersion}`
    if (lookConfigKeyRef.current !== lookConfigKey) {
      lookConfigKeyRef.current = lookConfigKey
      lookFailedRef.current = false
      queueMicrotask(() => setLookStatus(lookOverlayEnabled ? 'processing' : 'idle'))
    }
    const runtime = runtimeRef.current
    if (runtime) {
      runtime.recipe = recipe
      syncRuntime(runtime, config)
    }
  }, [lookId, lookOverlayEnabled, lookVersion, material, recipe, transform])

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
      data-look-version={lookVersion}
      data-postprocess={
        lookOverlayEnabled && lookStatus === 'ready'
          ? 'legacy-canvas2d-look'
          : 'raw'
      }
      role="region"
      aria-label="Interactive 3D model"
      aria-describedby="lab-material-model-help"
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown + - R"
      tabIndex={0}
      onPointerDown={(event) => {
        stopPointer(event)
        containerRef.current?.focus({ preventScroll: true })
      }}
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
        data-render-pipeline="legacy-canvas2d-only"
        aria-hidden
      />
      {status === 'loading' ? (
        <div className="lab-material-model-status">
          <span className="lab-material-model-spinner" aria-hidden />
          Loading 3D model{progress === null ? '…' : ` · ${Math.round(progress * 100)}%`}
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
