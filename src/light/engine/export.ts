import type { Preset, Scene } from '../scene'
import { filterFileTag } from './filters'
import { EXPORT_SIZES, type ExportAspect } from './frame'
import { LightRenderer, type RenderOptions } from './renderer'

export { EXPORT_ASPECTS, EXPORT_SIZES, type ExportAspect } from './frame'

export interface ExportRequest {
  /** A preset size, or give width and height. */
  aspect?: ExportAspect
  width?: number
  height?: number
  /** 2 by default, as the deck asks. */
  supersample?: RenderOptions['supersample']
}

export interface ExportResult {
  blob: Blob
  fileName: string
  width: number
  height: number
}

export function exportSize(request: ExportRequest): { width: number; height: number; label: string } {
  if (request.aspect) {
    const size = EXPORT_SIZES[request.aspect]
    return { ...size, label: request.aspect.replace(':', 'x') }
  }
  if (!request.width || !request.height) throw new Error('Export needs an aspect or a width and height.')
  return { width: Math.round(request.width), height: Math.round(request.height), label: `${Math.round(request.width)}x${Math.round(request.height)}` }
}

/** `<recipe>-<pack or reference id>-<aspect>-seed<seed>.png`; a filter that is on adds its name and strength after the seed (`-grain50`). */
export function exportFileName(
  preset: Pick<Preset, 'pack' | 'referenceId' | 'id'> & { scene: Pick<Scene, 'recipe' | 'seed'> & Partial<Pick<Scene, 'output'>> },
  sizeLabel: string,
): string {
  const source = preset.pack ?? preset.referenceId ?? preset.id
  return `${preset.scene.recipe}-${source}-${sizeLabel}-seed${preset.scene.seed}${filterFileTag(preset.scene.output)}.png`
}

/** Encodes top-down RGBA8 pixels as a PNG. */
export async function encodePng(pixels: Uint8Array<ArrayBuffer>, width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is not available for PNG encoding.')
  const image = new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height)
  context.putImageData(image, 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

/**
 * Renders a preset on its own offscreen renderer (preview canvases stay
 * untouched) and returns a PNG. Throws a LightEngineError when the context is
 * lost or the GPU runs out of memory, so a caller can retry at 1x.
 */
export async function exportPreset(preset: Preset, request: ExportRequest): Promise<ExportResult> {
  const { width, height, label } = exportSize(request)
  const renderer = new LightRenderer()
  try {
    renderer.render(preset.scene, { width, height, supersample: request.supersample ?? 2 })
    renderer.gpu.checkErrors()
    const pixels = renderer.readPixels()
    const blob = await encodePng(pixels, width, height)
    return { blob, fileName: exportFileName(preset, label), width, height }
  } finally {
    renderer.dispose()
  }
}
