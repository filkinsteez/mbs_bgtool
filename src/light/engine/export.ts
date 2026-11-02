import type { Preset, Scene } from '../scene'
import { LightRenderer, type RenderOptions } from './renderer'

export const EXPORT_SIZES = {
  '16:9': { width: 3840, height: 2160 },
  '9:16': { width: 2160, height: 3840 },
  '1:1': { width: 3840, height: 3840 },
  '4:5': { width: 3072, height: 3840 },
} as const

export type ExportAspect = keyof typeof EXPORT_SIZES

export const EXPORT_ASPECTS = Object.keys(EXPORT_SIZES) as ExportAspect[]

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

/** `<recipe>-<pack or reference id>-<aspect>-seed<seed>.png` */
export function exportFileName(preset: Pick<Preset, 'pack' | 'referenceId' | 'id'> & { scene: Pick<Scene, 'recipe' | 'seed'> }, sizeLabel: string): string {
  const source = preset.pack ?? preset.referenceId ?? preset.id
  return `${preset.scene.recipe}-${source}-${sizeLabel}-seed${preset.scene.seed}.png`
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

/** Renders a preset on its own offscreen renderer (preview canvases stay untouched) and returns a PNG. */
export async function exportPreset(preset: Preset, request: ExportRequest): Promise<ExportResult> {
  const { width, height, label } = exportSize(request)
  const renderer = new LightRenderer()
  try {
    renderer.render(preset.scene, { width, height, supersample: request.supersample ?? 2 })
    const pixels = renderer.readPixels()
    const blob = await encodePng(pixels, width, height)
    return { blob, fileName: exportFileName(preset, label), width, height }
  } finally {
    renderer.dispose()
  }
}
