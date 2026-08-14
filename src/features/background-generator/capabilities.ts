import type { AspectId } from './recipe'
import type { MaterialId } from './material/shadersCatalog'
import { dimensionsFor } from './recipe'

export type ExportCapability = {
  supported: boolean
  reason?: string
  maxTextureSize: number
  estimatedBytes: number
}

export function inspect8kCapability(
  aspect: AspectId,
  material: MaterialId,
  maxTextureSize = getMaxTextureSize(),
): ExportCapability {
  const dimensions = dimensionsFor('8k', aspect === 'custom' ? '16:9' : aspect)
  const passes = material === 'clean' || material === 'pixel' ? 2 : 4
  const estimatedBytes = dimensions.width * dimensions.height * 4 * passes
  if (Math.max(dimensions.width, dimensions.height) > maxTextureSize) {
    return { supported: false, reason: `GPU texture limit is ${maxTextureSize}px`, maxTextureSize, estimatedBytes }
  }
  if (estimatedBytes > 512 * 1024 * 1024) {
    return { supported: false, reason: 'Estimated render memory exceeds 512 MB', maxTextureSize, estimatedBytes }
  }
  return { supported: true, maxTextureSize, estimatedBytes }
}

let cachedMaxTextureSize: number | undefined

export function getMaxTextureSize(): number {
  if (typeof document === 'undefined') return 0
  if (cachedMaxTextureSize !== undefined) return cachedMaxTextureSize
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  cachedMaxTextureSize = gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) : 0
  return cachedMaxTextureSize
}
