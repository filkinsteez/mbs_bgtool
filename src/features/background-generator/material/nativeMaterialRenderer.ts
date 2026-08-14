import type {
  GpuShaderDefinition,
  NodeMetadata,
} from 'shaders/core'
import type {
  ComponentConfig,
  PresetConfig,
} from 'shaders/js'
import { isNativeTargetSize } from './renderSizing'

type DefinitionModule = {
  default: GpuShaderDefinition
}

const DEFINITION_LOADERS: Record<string, () => Promise<DefinitionModule>> = {
  CRTScreen: () => import('shaders/core/CRTScreen'),
  FilmGrain: () => import('shaders/core/FilmGrain'),
  FilmStock: () => import('shaders/core/FilmStock'),
  Glass: () => import('shaders/core/Glass'),
  LiquidMetal: () => import('shaders/core/LiquidMetal'),
  Pixelate: () => import('shaders/core/Pixelate'),
  SolidColor: () => import('shaders/core/SolidColor'),
  StudioBackground: () => import('shaders/core/StudioBackground'),
  Swirl: () => import('shaders/core/Swirl'),
}

const SDF_SIDE = 512
const SDF_COMPACT_BYTES = SDF_SIDE * SDF_SIDE * 2
const SDF_LEGACY_BYTES = SDF_SIDE * SDF_SIDE * 4

export type NativeMaterialRender = {
  destroy: () => void
}

/**
 * Renders at a true 1:1 target backing size. The public createShader resize API
 * intentionally caps canvases to the visible viewport; the renderer's recording
 * resolution path bypasses that preview cap without resampling the result.
 */
export async function renderMaterialPresetNative(
  canvas: HTMLCanvasElement,
  preset: PresetConfig,
  width: number,
  height: number,
): Promise<NativeMaterialRender> {
  await validatePresetAssets(preset)

  const {
    createGpuUniformsMap,
    resolveBoundingBox,
    rootPassthrough,
    shaderRendererGPU,
  } = await import('shaders/core')
  const definitions = await loadDefinitions(preset)
  const renderer = shaderRendererGPU()
  let failure: string | null = null
  let ready = false
  renderer.setOnUnavailable((reason) => {
    failure = reason
  })
  renderer.setOnReady(() => {
    ready = true
  })

  // Keep initialization cheap and independent of the browser viewport. The
  // recording resolution below establishes the actual target backing store.
  canvas.style.width = '1px'
  canvas.style.height = '1px'

  try {
    await renderer.initialize({
      canvas,
      colorSpace: 'p3-linear',
      toneMapping: 'linear',
      observeElement: false,
      forceFullFrameRate: true,
    })
    throwIfFailed(failure ?? renderer.getFailureReason())
    renderer.stopAnimation()

    const rootId = 'material-export-root'
    renderer.registerNode(
      rootId,
      rootPassthrough.fragment,
      null,
      null,
      {},
      rootPassthrough,
    )

    let generatedId = 0
    const register = (
      component: ComponentConfig,
      parentId: string,
      renderOrder: number,
    ) => {
      const definition = definitions.get(component.type)
      if (!definition) {
        throw new Error(`Unsupported material export component: ${component.type}`)
      }
      const nodeId = component.id ?? `material-export-${component.type}-${generatedId++}`
      const props = component.props ?? {}
      const values = Object.fromEntries(
        Object.entries(definition.props).map(([key, config]) => [
          key,
          props[key] !== undefined ? props[key] : config.default,
        ]),
      )
      const uniforms = createGpuUniformsMap(definition, values, nodeId)
      const metadata: NodeMetadata = {
        blendMode: props.blendMode ?? 'normal',
        opacity: props.opacity,
        visible: props.visible,
        id: component.id,
        renderOrder,
        mask: props.maskSource
          ? { source: props.maskSource, type: props.maskType ?? 'alpha' }
          : undefined,
        transform: props.transform
          ? {
              offsetX: 0,
              offsetY: 0,
              rotation: 0,
              scale: 1,
              anchorX: 0.5,
              anchorY: 0.5,
              edges: 'transparent',
              ...props.transform,
            }
          : undefined,
        boundingBox: resolveBoundingBox(props.boundingBox),
        flow: props.flow,
        absolute: props.absolute,
      }
      renderer.registerNode(
        nodeId,
        definition.fragment,
        parentId,
        metadata,
        uniforms,
        definition,
      )
      component.children?.forEach((child, index) => register(child, nodeId, index))
    }
    preset.components.forEach((component, index) => register(component, rootId, index))

    const maxTextureDimension = renderer.getInternalRenderer()
      ?.device.limits.maxTextureDimension2D
    if (
      maxTextureDimension
      && (width > maxTextureDimension || height > maxTextureDimension)
    ) {
      throw new Error(
        `Material renderer target ${width} × ${height} exceeds this GPU's ${maxTextureDimension}px texture limit`,
      )
    }

    const restoreResolution = renderer.beginRecordingResolution(width, height, 1)
    let settledFrames = 0
    for (let frame = 0; frame < 8 && settledFrames < 2; frame += 1) {
      await nextFrame()
      await renderer.renderAndWait({ waitForGpu: true })
      throwIfFailed(failure ?? renderer.getFailureReason())
      if (ready) settledFrames += 1
    }
    if (!ready) throw new Error('Material renderer timed out; choose Clean to export')
    if (!isNativeTargetSize(
      { width: canvas.width, height: canvas.height },
      { width, height },
    )) {
      throw new Error(
        `Material renderer produced ${canvas.width} × ${canvas.height}, expected native ${width} × ${height}`,
      )
    }

    return {
      destroy: () => {
        restoreResolution()
        renderer.cleanup()
      },
    }
  } catch (error) {
    renderer.cleanup()
    throw error
  }
}

async function loadDefinitions(
  preset: PresetConfig,
): Promise<Map<string, GpuShaderDefinition>> {
  const types = new Set<string>()
  visitComponents(preset.components, (component) => types.add(component.type))
  const definitions = new Map<string, GpuShaderDefinition>()
  await Promise.all([...types].map(async (type) => {
    const load = DEFINITION_LOADERS[type]
    if (!load) throw new Error(`Unsupported material export component: ${type}`)
    definitions.set(type, (await load()).default)
  }))
  return definitions
}

async function validatePresetAssets(preset: PresetConfig): Promise<void> {
  const urls = new Set<string>()
  visitComponents(preset.components, (component) => {
    const url = component.props?.shapeSdfUrl
    if (typeof url === 'string' && url) urls.add(url)
  })
  await Promise.all([...urls].map(async (url) => {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Material SDF asset failed to load (HTTP ${response.status})`)
    }
    const bytes = (await response.arrayBuffer()).byteLength
    if (bytes !== SDF_COMPACT_BYTES && bytes !== SDF_LEGACY_BYTES) {
      throw new Error(
        `Material SDF asset has ${bytes} bytes; the runtime requires a native 512 × 512 field`,
      )
    }
  }))
}

function visitComponents(
  components: ComponentConfig[],
  visit: (component: ComponentConfig) => void,
): void {
  for (const component of components) {
    visit(component)
    if (component.children) visitComponents(component.children, visit)
  }
}

function throwIfFailed(reason: string | null): void {
  if (reason) {
    throw new Error(`Material renderer unavailable (${reason}); choose Clean to export`)
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}
