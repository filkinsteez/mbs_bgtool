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
import type { MaterialId } from '@/features/background-generator/material/shadersCatalog'
import type {
  BackgroundRecipeV2,
  SubjectTransform,
} from '@/features/background-generator/recipe'
import { useBackgroundStore } from '@/features/background-generator/store'
import { resolveBankCached } from '@/components/lab/bankCache'
import {
  createMaterialSurface,
  prepareMaterialGeometry,
} from './materialModelProcessing'
import { MATERIAL_MODEL_RESET_VIEW_EVENT } from './materialModelEvents'

type ViewerConfig = {
  id: MaterialId
  backgroundColor: string
  highlightColor: string
  intensity: number
  light: number
  depth: number
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
  invalidateSource: () => void
}

type ViewerStatus = 'loading' | 'ready' | 'error'

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
  } else if (config.id === 'film') {
    surface.metalness = 0.12 + intensity * 0.12
    surface.roughness = 0.5 + depth * 0.28
    surface.sheen = 0.25 + intensity * 0.55
    surface.sheenRoughness = 0.65
    surface.sheenColor.set(config.highlightColor)
  } else if (config.id === 'pixel') {
    surface.metalness = 0.2 + intensity * 0.3
    surface.roughness = 0.62 - intensity * 0.25
    surface.flatShading = true
    surface.clearcoat = depth * 0.2
  } else if (config.id === 'crt') {
    surface.metalness = 0.28
    surface.roughness = 0.34 - intensity * 0.18
    surface.clearcoat = 0.72 + depth * 0.28
    surface.clearcoatRoughness = 0.08
    surface.iridescence = intensity * 0.42
    surface.emissive.set(config.highlightColor)
    surface.emissiveIntensity = 0.08 + intensity * 0.5
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

function disposeModel(model: THREE.Object3D): void {
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) child.geometry.dispose()
  })
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
  const interactedRef = useRef(false)
  const [status, setStatus] = useState<ViewerStatus>('loading')
  const [progress, setProgress] = useState<number | null>(null)

  const configRef = useRef<ViewerConfig>({
    ...material,
    transform,
    lookId,
    lookOverlayEnabled,
  })
  const recipeRef = useRef<BackgroundRecipeV2>(recipe)

  const resetView = useCallback(() => {
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
  }, [])

  useEffect(() => {
    const onResetView = () => resetView()
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
    let sourceVersion = 0
    let processedVersion = -1
    let lastSourceChange = performance.now()
    let lastProcess = -Infinity
    let processedQuality: 'live' | 'hq' | null = null
    const invalidateSource = () => {
      sourceVersion += 1
      lastSourceChange = performance.now()
    }
    const onControlsStart = () => {
      controlsGestureActive = true
      interactedRef.current = true
      invalidateSource()
    }
    const onControlsChange = () => {
      invalidateSource()
      if (!controlsGestureActive) return
      const store = useBackgroundStore.getState()
      if (store.recipe.transforms.material.preset === 'free') return
      store.updateRecipe({ transforms: { material: { preset: 'free' } } })
    }
    const onControlsEnd = () => {
      controlsGestureActive = false
      invalidateSource()
    }

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
        invalidateSource,
      }
      runtimeRef.current = runtime
      syncRuntime(runtime, configRef.current)

      const resize = () => {
        if (!runtime) return
        const width = Math.max(1, container.clientWidth)
        const height = Math.max(1, container.clientHeight)
        runtime.renderer.setSize(width, height, false)
        runtime.viewportAspect = width / height
        if (runtime.model && !interactedRef.current) {
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
          fitCamera(runtime)
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
        } catch {
          runtime.processedCanvas.dataset.renderStatus = 'error'
          queueMicrotask(() => {
            if (!cancelled) setStatus('error')
          })
        }
      }

      const render = () => {
        if (cancelled || !runtime) return
        runtime.controls.update()
        // Render exactly one raw, ACES-tonemapped/sRGB source frame. The
        // Canvas2D Look path freezes this framebuffer before the next rAF.
        runtime.renderer.render(runtime.scene, runtime.camera)
        if (configRef.current.lookOverlayEnabled && runtime.model) {
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
      resizeObserver?.disconnect()
      if (!runtime) return
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
  }, [])

  useEffect(() => {
    const config: ViewerConfig = {
      ...material,
      transform,
      lookId,
      lookOverlayEnabled,
    }
    configRef.current = config
    recipeRef.current = recipe
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
    if (event.key.toLowerCase() !== 'r') return
    event.preventDefault()
    event.stopPropagation()
    resetView()
  }

  return (
    <div
      ref={containerRef}
      className="lab-material-model-viewer"
      data-mbs-material-model="true"
      data-model-status={status}
      data-material={material.id}
      data-look={lookOverlayEnabled ? lookId : 'off'}
      data-postprocess={lookOverlayEnabled ? 'canvas2d-look' : 'raw'}
      role="application"
      aria-label="Interactive 3D Meta symbol"
      aria-describedby="lab-material-model-help"
      tabIndex={0}
      onPointerDown={stopPointer}
      onPointerMove={stopPointer}
      onPointerUp={stopPointer}
      onPointerCancel={stopPointer}
      onWheel={stopWheel}
      onDoubleClick={resetView}
      onKeyDown={onKeyDown}
    >
      <p id="lab-material-model-help" className="lab-visually-hidden">
        Left drag to orbit the model, middle drag to pan, scroll to zoom, and double click or press
        R to reset the view.
      </p>
      <canvas
        ref={processedCanvasRef}
        className="lab-material-look-canvas"
        data-mbs-material-look-canvas="true"
        aria-hidden
      />
      {status === 'loading' ? (
        <div className="lab-material-model-status" role="status">
          <span className="lab-material-model-spinner" aria-hidden />
          Loading 3D symbol{progress === null ? '…' : ` · ${Math.round(progress * 100)}%`}
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="lab-material-model-status error" role="alert">
          3D model unavailable
        </div>
      ) : null}
      <div className="lab-material-model-actions">
        <button type="button" onClick={resetView} disabled={status !== 'ready'}>
          Reset view
        </button>
      </div>
    </div>
  )
}
