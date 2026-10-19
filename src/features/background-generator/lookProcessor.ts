import { scaleLabForPreview } from '@/core/lab/preview'
import { renderLab } from '@/core/lab/render'
import type { LabSource } from '@/core/lab/sourceCache'
import type { LabFit, LabState } from '@/core/lab/types'
import {
  backgroundRecipeToLab,
  type BackgroundRecipeV2,
} from './recipe'

export type RecipeLookRenderOptions = {
  fit?: LabFit
  maxLongEdge?: number
}

export function sourceAwareLabForRecipe(
  recipe: BackgroundRecipeV2,
  source: LabSource,
  fit: LabFit = 'contain',
): LabState {
  return backgroundRecipeToLab(recipe, {
    hasSource: true,
    source: {
      filename: source.filename,
      width: source.fullW,
      height: source.fullH,
      contentHash: source.hash,
      fit,
    },
  })
}

// Shared screen-space processor for material preview and export.
export function renderRecipeLookToCanvas(
  canvas: HTMLCanvasElement,
  recipe: BackgroundRecipeV2,
  source: LabSource,
  options: RecipeLookRenderOptions = {},
): LabState {
  const fullLab = sourceAwareLabForRecipe(recipe, source, options.fit)
  const lab = options.maxLongEdge
    ? scaleLabForPreview(fullLab, options.maxLongEdge)
    : fullLab
  if (canvas.width !== lab.output.width) canvas.width = lab.output.width
  if (canvas.height !== lab.output.height) canvas.height = lab.output.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('2D Look context unavailable')
  context.setTransform(1, 0, 0, 1, 0, 0)
  renderLab(context, lab, source, 'composite')
  return lab
}

export function exportRecipeLookPng(
  recipe: BackgroundRecipeV2,
  source: LabSource,
  fit: LabFit = 'contain',
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  renderRecipeLookToCanvas(canvas, recipe, source, { fit })
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('toBlob failed')),
      'image/png',
    )
  })
}
