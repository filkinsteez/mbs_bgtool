import type { ShapeProto } from '@/core/canvas/shapeProtos'
import { createLabSourceFromCanvas } from '@/core/lab/sourceCache'
import { exportRecipeLookPng } from '../lookProcessor'
import type { BackgroundRecipeV2 } from '../recipe'
import { captureMaterialFrame } from './materialFrameCapture'

// The 3D export is WYSIWYG with the live overlay: capture the raw lit
// viewport frame at target size, then run the same canonical Canvas2D Look
// processor over it that the preview uses — for EVERY Look version. With
// the overlay off, the raw frame is the export.
export async function exportMaterialAtTarget(
  recipe: BackgroundRecipeV2,
  protos: ShapeProto[],
): Promise<Blob> {
  const { width, height } = recipe.format
  const canvas = await captureMaterialFrame(width, height)
  if (!recipe.materialLookOverlay.enabled) return canvasToPng(canvas)
  const source = createLabSourceFromCanvas(canvas, {
    filename: 'material-export-frame.rgba',
  })
  return exportRecipeLookPng(recipe, source, protos, 'contain')
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))),
      'image/png',
    )
  })
}
